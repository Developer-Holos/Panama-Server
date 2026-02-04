require('dotenv').config();
const OpenAI = require('openai');
const fetch = require('node-fetch');
const { authenticate, readTokenFromDB } = require('./refreshTokenKommo'); // Importar authenticate y readTokenFromDB

// Clase que encapsula la lógica para interactuar con la API de OpenAI
class OpenAIService {
  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    this.openai = new OpenAI({ apiKey: apiKey });
    // Map para almacenar contexto de conversaciones (temporal, en producción usar base de datos)
    this.conversationContexts = new Map();
  }

  // Obtener el token desde la base de datos
  async getToken() {
    const domain = process.env.SUBDOMINIO;
    const tokenData = await readTokenFromDB(domain);
    return tokenData.access_token;
  }

  // Método helper para hacer fetch con retry automático si el token está vencido
  async fetchWithTokenRetry(url, options, retryCount = 0) {
    const MAX_RETRIES = 1;
    
    try {
      const response = await fetch(url, options);
      
      // Si obtenemos un 401 (Unauthorized), el token podría estar vencido
      if (response.status === 401 && retryCount < MAX_RETRIES) {
        console.log('Token inválido (401), actualizando token...');
        
        // Refrescar el token
        await authenticate();
        
        // Obtener el nuevo token
        const newToken = await this.getToken();
        
        // Actualizar el header de autorización en las opciones
        options.headers.authorization = 'Bearer ' + newToken;
        
        // Reintentar la solicitud con el nuevo token
        console.log('Reintentando solicitud con token actualizado...');
        return await this.fetchWithTokenRetry(url, options, retryCount + 1);
      }
      
      return response;
    } catch (error) {
      console.error('Error en fetchWithTokenRetry:', error);
      throw error;
    }
  }

  async main(msg_client, conversationId, lead_id) {
    try {
      const promptId = process.env.PROMPT_ID_IDENTIFICAR;
      
      if (!promptId) {
        console.error("PROMPT_ID_IDENTIFICAR no está configurado en las variables de entorno");
        return "Error de configuración: falta PROMPT_ID_IDENTIFICAR en el archivo .env";
      }
      
      // Con Responses API, creamos directamente la respuesta con el input
      const lastMessage = await this.createResponse(promptId, msg_client, conversationId, lead_id);
      return lastMessage;
    } catch (error) {
      console.error("Error en main:", error);
      // Si hay cualquier error, transferir a un asesor (solo si lead_id existe)
      if (lead_id) {
        try {
          await this.getInterest("ASESOR", lead_id);
        } catch (fallbackError) {
          console.error("Error en la transferencia a asesor:", fallbackError);
        }
      }
      return "Lo siento, estoy teniendo problemas técnicos. " + (lead_id ? "Te estoy transfiriendo a un asesor humano que te atenderá a la brevedad." : "Por favor, revisa la configuración del servidor.");
    }
  }

  // Crear una nueva conversación (genera un ID único)
  async createdConversation() {
    // Generar un ID único para la conversación
    const conversationId = 'conv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    // Inicializar el contexto de la conversación
    this.conversationContexts.set(conversationId, {
      messages: [],
      lastResponseId: null,
      createdAt: new Date()
    });
    console.log('Nueva conversación creada:', conversationId);
    return conversationId;
  }

  // Eliminar una conversación existente
  async deletedConversation(conversation_id) {
    if (this.conversationContexts.has(conversation_id)) {
      this.conversationContexts.delete(conversation_id);
      console.log('Conversación eliminada:', conversation_id);
    }
  }

  // Obtener contexto de una conversación
  getConversationContext(conversation_id) {
    return this.conversationContexts.get(conversation_id) || null;
  }

  // Actualizar contexto de una conversación
  updateConversationContext(conversation_id, updates) {
    const context = this.conversationContexts.get(conversation_id);
    if (context) {
      Object.assign(context, updates);
      this.conversationContexts.set(conversation_id, context);
    }
  }

  // En Responses API, los mensajes se envían directamente como input en createResponse()
  // Esta función se mantiene para compatibilidad pero ya no se usa
    async addMessageToConversation(conversationId, msg_client) {
      // En Responses API los mensajes se agregan automáticamente a la conversación
      // cuando usamos el parámetro conversation en responses.create()
      return { role: "user", content: msg_client };
    }
  
  async createResponse(promptId, msg_client, conversationId, lead_id) {
    try {
      if (!promptId) {
        throw new Error("Missing required parameter: 'prompt_id'");
      }

      // Obtener contexto de la conversación si existe
      let context = conversationId ? this.getConversationContext(conversationId) : null;
      let input = [];
      let previousResponseId = null;

      if (context && context.messages.length > 0) {
        // Si hay contexto previo, usar previous_response_id
        previousResponseId = context.lastResponseId;
        input = [{ role: "user", content: msg_client }];
      } else {
        // Primera interacción o sin contexto
        input = [{ role: "user", content: msg_client }];
      }

      // Crear la respuesta usando Responses API con el formato correcto
      const requestParams = {
        prompt: { 
          id: promptId,
          version: "13"
        },
        input: input,
        text: {
          format: {
            type: "text"
          }
        },
        max_output_tokens: 2048,
        store: true
      };

      // Agregar previous_response_id si existe
      if (previousResponseId) {
        requestParams.previous_response_id = previousResponseId;
      }

      console.log('Creando respuesta con Responses API...');
      const stream = await this.openai.responses.stream(requestParams);

      // Variables para manejar el loop de tool calls
      let currentResponse = null;
      let needsToolHandling = false;
      let toolCallItems = [];

      for await (const event of stream) {
        console.log('Evento recibido:', event.type); // Debug: mostrar tipo de evento
        
        // Guardar la respuesta completa cuando termine
        // Intentar múltiples tipos de eventos
        if (event.type === 'response.done' || event.type === 'done' || event.response) {
          currentResponse = event.response || event;
          console.log('Respuesta completa recibida:', JSON.stringify(currentResponse).substring(0, 200));
          
          // Buscar tool calls en los output items
          if (currentResponse.output) {
            for (const item of currentResponse.output) {
              if (item.type === 'function_call') {
                needsToolHandling = true;
                toolCallItems.push(item);
              }
            }
          }
        }
      }

      // Si hay tool calls que manejar, procesarlos
      if (needsToolHandling && toolCallItems.length > 0) {
        const toolOutputItems = [];

        for (const toolCall of toolCallItems) {
          const args = JSON.parse(toolCall.arguments);
          console.log("ToolCall detectado:", toolCall.name);
          console.log("Argumentos procesados:", args);

          let outputValue = null;

          if (toolCall.name === 'unknow_message') {
            const customer_message = args.customer_message;
            const action_id = args.action_id;
            console.log(`Mensaje del cliente: ${customer_message}`);
            console.log(`ID de acción: ${action_id}`);
            if (lead_id) {
              outputValue = await this.postAppScriptAndKommo(action_id, customer_message, lead_id);
            } else {
              outputValue = { success: true, message: '[MODO PRUEBA] Mensaje procesado' };
            }
          } else if (toolCall.name === 'enviar_a_asistente_humano') {
            const mandar_a_asistente_humano = args.mandar_a_asistente_humano;
            console.log(`Instrucción para enviar a asistente humano: ${mandar_a_asistente_humano}`);
            if (lead_id) {
              outputValue = await this.getInterest("ASESOR", lead_id);
            } else {
              outputValue = { success: true, message: '[MODO PRUEBA] Transferencia a asesor simulada' };
            }
          } else if (toolCall.name === 'send_asesor') {
            const action_id = args.action_id;
            console.log(`ID de acción para servicio de reparación: ${action_id}`);
            if (lead_id) {
              outputValue = await this.getInterest(action_id, lead_id);
            } else {
              outputValue = { success: true, message: '[MODO PRUEBA] Acción de servicio de reparación simulada' };
            }
          } else if (toolCall.name === 'save_form') {
            const num_personas = args.num_personas;
            const tour_seleccionado = args.tour_seleccionado;
            const idioma = args.idioma;
            const pais_origen = args.pais_origen;
            const tipo_cliente = args.tipo_cliente;
            console.log(`Guardando formulario con: ${num_personas}, ${tour_seleccionado}, ${idioma}, ${pais_origen}, ${tipo_cliente}`);
            if (lead_id) {
              outputValue = await this.saveFormToKommo(lead_id, num_personas, tour_seleccionado, idioma, pais_origen, tipo_cliente);
            } else {
              outputValue = { success: false, message: '[MODO PRUEBA] Formulario guardado simuladamente' };
            }
          }

          // Agregar el output del tool call
          toolOutputItems.push({
            type: 'function_call_output',
            call_id: toolCall.call_id,
            output: JSON.stringify(outputValue)
          });
        }

        // Crear una nueva respuesta con los tool outputs
        const followUpRequestParams = {
          prompt: { id: promptId },
          input: toolOutputItems,
          previous_response_id: currentResponse.id,
          store: true
        };

        const followUpResponse = await this.openai.responses.create(followUpRequestParams);

        // Actualizar contexto de la conversación
        if (conversationId) {
          this.updateConversationContext(conversationId, {
            lastResponseId: followUpResponse.id,
            messages: [...(context?.messages || []), 
              { role: 'user', content: msg_client },
              { role: 'assistant', content: this.extractTextFromResponse(followUpResponse) }
            ]
          });
        }

        // Extraer y retornar el texto de la respuesta final
        return this.extractTextFromResponse(followUpResponse);
      }

      // Si no hay tool calls, retornar el texto directamente
      if (currentResponse) {
        // Actualizar contexto de la conversación
        if (conversationId) {
          this.updateConversationContext(conversationId, {
            lastResponseId: currentResponse.id,
            messages: [...(context?.messages || []), 
              { role: 'user', content: msg_client },
              { role: 'assistant', content: this.extractTextFromResponse(currentResponse) }
            ]
          });
        }

        return this.extractTextFromResponse(currentResponse);
      }

      throw new Error("No se recibió respuesta del modelo");

    } catch (error) {
      console.error("Error en createResponse:", error);
      // En caso de error, llamar a getInterest con "ASESOR" solo si hay lead_id
      if (lead_id) {
        try {
          await this.getInterest("ASESOR", lead_id);
          return "Lo siento, estoy teniendo problemas para procesar la solicitud. Te estoy transfiriendo a un asesor humano que te atenderá a la brevedad.";
        } catch (fallbackError) {
          console.error("Error en la transferencia a asesor:", fallbackError);
          return "Lo siento, estoy teniendo problemas técnicos. Por favor, intenta nuevamente más tarde o contacta directamente a un asesor.";
        }
      } else {
        // Modo prueba: retornar el error sin transferir
        return `[MODO PRUEBA] Error: ${error.message}. Por favor verifica la configuración.`;
      }
    }
  }

  // Helper para extraer texto de una respuesta
  extractTextFromResponse(response) {
    for (const item of response.output) {
      if (item.type === 'message' && item.content) {
        for (const content of item.content) {
          if (content.type === 'output_text') {
            let text = content.text;
            // Limpiar referencias
            text = text.replace(/【\d+:\d+†[^】]+】/g, '');
            // Verificar si el mensaje contiene Markdown
            const markdownPattern = /(\*\*|_|~~|`|# |\* |- )/;
            if (markdownPattern.test(text)) {
              text = this.transformMarkdownToWhatsApp(text);
            }
            return text;
          }
        }
      }
    }
    return response.output_text || "Lo siento, no pude generar una respuesta.";
  }

  // Fallback usando Chat Completions API (disponible en SDK actual)
  async createResponseFallback(promptId, msg_client, conversationId, lead_id) {
    try {
      console.log("Usando Chat Completions API como fallback");
      
      // Obtener contexto de la conversación si existe
      let context = conversationId ? this.getConversationContext(conversationId) : null;
      let messages = [];

      // Construir array de mensajes con el historial
      if (context && context.messages.length > 0) {
        messages = [...context.messages];
      }

      // Agregar el nuevo mensaje del usuario
      messages.push({ role: "user", content: msg_client });

      // Usar el modelo especificado o uno por defecto
      const model = process.env.OPENAI_MODEL || "gpt-4o";

      // Llamar a Chat Completions
      const completion = await this.openai.chat.completions.create({
        model: model,
        messages: messages,
        temperature: 0.7,
      });

      const responseText = completion.choices[0].message.content;

      // Actualizar contexto de la conversación
      if (conversationId) {
        this.updateConversationContext(conversationId, {
          lastResponseId: completion.id,
          messages: [...messages, { role: 'assistant', content: responseText }]
        });
      }

      // Limpiar y formatear la respuesta
      let text = responseText.replace(/【\d+:\d+†[^】]+】/g, '');
      const markdownPattern = /(\*\*|_|~~|`|# |\* |- )/;
      if (markdownPattern.test(text)) {
        text = this.transformMarkdownToWhatsApp(text);
      }

      return text;

    } catch (error) {
      console.error("Error en createResponseFallback:", error);
      throw error;
    }
  }
  

  transformMarkdownToWhatsApp(markdownText) {
    // Reemplazar negritas
    let whatsappText = markdownText.replace(/\*\*(.*?)\*\*/g, '*$1*');
    
    // Reemplazar cursivas
    whatsappText = whatsappText.replace(/_(.*?)_/g, '_$1_');
    
    // Reemplazar tachado
    whatsappText = whatsappText.replace(/~~(.*?)~~/g, '~$1~');
    
    // Reemplazar monoespaciado
    whatsappText = whatsappText.replace(/`(.*?)`/g, '```$1```');
    
    // Reemplazar títulos y subtítulos
    whatsappText = whatsappText.replace(/^# (.*$)/gim, '*$1*');
    whatsappText = whatsappText.replace(/^## (.*$)/gim, '*$1*');
    whatsappText = whatsappText.replace(/^### (.*$)/gim, '*$1*');
    
    // Reemplazar viñetas
    whatsappText = whatsappText.replace(/^\* (.*$)/gim, '- $1');
    whatsappText = whatsappText.replace(/^- (.*$)/gim, '- $1');
    
    return whatsappText;
  }
  async saveFormToKommo(lead_id, num_personas, tour_seleccionado, idioma, pais_origen, tipo_cliente) {
    try {
      const token = await this.getToken();
      const options = {
        method: 'PATCH',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: 'Bearer ' + token
        },
        body: JSON.stringify([{
          id: Number(lead_id),
          custom_fields_values: [
            { field_id: 956366, values: [{ value: num_personas }] }, // numero
            { field_id: 956368, values: [{ value: tour_seleccionado }] }, // string
            { field_id: 956370, values: [{ value: idioma }] }, // string
            { field_id: 956372, values: [{ value: pais_origen }] }, //string
            { field_id: 956374, values: [{ value: tipo_cliente }] } //select
          ]
        }])
      };
      const subdominio = process.env.SUBDOMINIO;
      const response = await this.fetchWithTokenRetry(`https://${subdominio}.kommo.com/api/v4/leads`, options);
      
      if (!response.ok) {
        console.error(`HTTP error! status: ${response.status}`);
        return { success: false, message: 'Error al guardar el formulario en Kommo.' };
      }
      return { success: true, message: 'Formulario guardado en Kommo correctamente.' };
    } catch (err) {
      console.error("Error en la solicitud:", err);
      return { success: false, message: 'Error técnico al guardar el formulario en Kommo.' };
    }
  }

  async postAppScriptAndKommo(action_id, customer_message, lead_id) {
    try {
      // Enviar action_id a Kommo
      const token = await this.getToken();
      const kommoOptions = {
        method: 'PATCH',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: 'Bearer ' + token
        },
        body: JSON.stringify([{
          id: Number(lead_id),
          custom_fields_values: [
            { field_id: 955670, values: [{ value: action_id }] }
          ]
        }])
      };
    
      const subdominio = process.env.SUBDOMINIO;
      const kommoResponse = await this.fetchWithTokenRetry(`https://${subdominio}.kommo.com/api/v4/leads`, kommoOptions);
      
      if (!kommoResponse.ok) {
        console.error(`HTTP error! status: ${kommoResponse.status}`);
        // Si hay un error HTTP, transferir a asesor
        await this.getInterest("ASESOR", lead_id);
        return { success: false, error: 'Error al actualizar el lead. Te transferimos a un asesor.' };
      }
      
      console.log('Se actualizó el lead en Kommo');
    
      // Enviar customer_message a AppScript
      const appScriptUrl = process.env.APPSCRIPT_URL;
      const appScriptOptions = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message: customer_message })
      };
    
      console.log('Enviando a AppScript:', { message: customer_message });
    
      const appScriptResponse = await fetch(appScriptUrl, appScriptOptions);
      
      if (!appScriptResponse.ok) {
        console.error(`HTTP error! status: ${appScriptResponse.status}`);
        // Si hay un error HTTP, transferir a asesor si no se ha hecho ya
        if (action_id !== "ASESOR") {
          await this.getInterest("ASESOR", lead_id);
        }
        return { success: false, error: 'Error al consultar AppScript. Te transferimos a un asesor.' };
      }
      
      const text = await appScriptResponse.text();
      try {
        const responseData = JSON.parse(text);
        console.log('Respuesta de AppScript:', responseData);
        return responseData;
      } catch (err) {
        console.error("Error parseando la respuesta de AppScript:", err);
        // Si hay un error al parsear, transferir a asesor
        await this.getInterest("ASESOR", lead_id);
        return { success: false, error: 'Error parseando la respuesta de AppScript. Te transferimos a un asesor.' };
      }
    } catch (err) {
      console.error("Error en la solicitud:", err);
      // En caso de cualquier error, transferir a asesor
      await this.getInterest("ASESOR", lead_id);
      return { success: false, error: 'Error técnico. Te transferimos a un asesor.' };
    }
  }

  // Enviar el valor de la call fuction para cambiar a un asesor
  async getInterest(action_id, lead_id) {
    // Asegurarse de que el token es válido antes de realizar la solicitud
    await authenticate();
  
    console.log('action_id:', action_id); // Log para depuración
    console.log('lead_id:', lead_id); // Log para depuración
  
    const token = await this.getToken();
    const options = {
      method: 'PATCH',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: 'Bearer ' + token
      },
      body: JSON.stringify([{
        id: Number(lead_id),
        status_id: 97856616, // Cambiar al estado "En atención"
        custom_fields_values: [
          { field_id: 955670, values: [{ value: action_id }] }
        ]
      }])
    };
  
    try {
      const subdominio = process.env.SUBDOMINIO;
      const response = await this.fetchWithTokenRetry(`https://${subdominio}.kommo.com/api/v4/leads`, options);
      console.log('response status:', response.status); // Log para depuración
      const responseBody = await response.json();
      console.log('responseBody:', responseBody); // Log para depuración
  
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return { success: true, message: 'Se actualizó el lead' };
    } catch (err) {
      console.error("Error en la solicitud:", err);
      return { success: false, message: 'Error al actualizar el lead' };
    }
  }
  


  async processRequestData(request) {
    try {
      console.log('request.body:', request.body); // Log para depuración del cuerpo de la solicitud
  
      const formData = request.body;
      console.log('formData:', formData); // Log para depuración
      const parsedData = {};
      for (const key in formData) {
        const value = Array.isArray(formData[key]) ? formData[key][0] : formData[key];
        parsedData[key] = value;
      }
      console.log('parsedData:', parsedData); // Log para depuración
  
      const idLead = formData.leads.add[0].id;
      console.log('idLead:', idLead); // Log para depuración
      if (!idLead) {
        throw new Error('idLead no encontrado en los datos del formulario');
      }
  
      const token = await this.getToken();
      console.log('Token:', token); // Log para depuración
      const optionsGetLead = {
        method: 'get',
        headers: {
          'Accept': 'application/json',
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json',
        }
      };
  
      const subdominio = process.env.SUBDOMINIO;
      console.log('subdominio:', subdominio); // Log para depuración
      const response_get = await this.fetchWithTokenRetry(`https://${subdominio}.kommo.com/api/v4/leads/${idLead}?with=contacts`, optionsGetLead);
      console.log('response_get status:', response_get.status); // Log para depuración
      const responseBody = await response_get.json();
      console.log('responseBody:', responseBody); // Log para depuración
  
      if (!responseBody.custom_fields_values) {
        throw new Error('custom_fields_values no encontrado en la respuesta');
      }

      // Obtener el teléfono del contacto embebido en el lead
      let phoneNumber = null;
      let isPanama = false;
      
      const contact = responseBody._embedded?.contacts?.[0];
      console.log('contact:', contact); // Log para depuración
      
      if (contact && contact.custom_fields_values) {
        // Buscar el campo de teléfono
        const phoneField = contact.custom_fields_values.find((obj) => obj.field_code === 'PHONE');
        if (phoneField && phoneField.values && phoneField.values.length > 0) {
          phoneNumber = phoneField.values[0].value;
          console.log('Número de teléfono:', phoneNumber); // Log para depuración
          
          // Verificar si el número es de Panamá (+507)
          const cleanedPhone = phoneNumber.replace(/\s+/g, '');
          isPanama = cleanedPhone.startsWith('+507') || cleanedPhone.startsWith('507');
          console.log('¿Es de Panamá?:', isPanama); // Log para depuración
        }
      }

      // mensaje del cliente
      const msj_client = responseBody.custom_fields_values.find((obj) => obj.field_id === 955672);
      console.log('msj_client:', msj_client); // Log para depuración
      let msj_client_value = msj_client?.values?.[0]?.value;
      
      // Agregar información de origen al mensaje
      if (msj_client_value && isPanama !== null) {
        const origen = isPanama ? "Usuario de Panamá" : "Usuario internacional";
        msj_client_value = `[${origen}] ${msj_client_value}`;
        console.log('Mensaje enriquecido con información de origen:', msj_client_value);
      }
            
      console.log('msj_client_value:', msj_client_value); // Log para depuración
  
      const conversation_id = responseBody.custom_fields_values.find((obj) => obj.field_id === 955664);
      console.log('conversation_id:', conversation_id); // Log para depuración
      let conversation_id_value = conversation_id?.values?.[0]?.value || null;
      console.log('conversation_id_value:', conversation_id_value); // Log para depuración
      
      // Crear una nueva conversación si no se proporciona una
      if (!conversation_id_value) {
        console.log('Creando una nueva conversación'); // Log para depuración
        conversation_id_value = await this.createdConversation();
        console.log('Nuevo conversation_id_value:', conversation_id_value); // Log para depuración
      }
  
      // Llamar a las funciones correspondientes con los valores obtenidos
      if (conversation_id_value) {
        const promptId = process.env.PROMPT_ID_IDENTIFICAR;
        console.log('Llamando a main con conversation_id_value y msj_client_value'); // Log para depuración
        // Ya no necesitamos waitForActiveResponseToFinish en Responses API
        console.log('Llamando a main con:', { conversation_id_value, msj_client_value });
        const message = await this.main(msj_client_value, conversation_id_value, idLead);
        console.log('Mensaje obtenido:', message); // Log para depuración
  
        // Actualizar el campo personalizado en Kommo con el mensaje obtenido
        console.log('Actualizando el campo personalizado en Kommo'); // Log para depuración
        console.log('Llamando a updateLeadCustomField con:', { idLead, message, conversation_id_value });
        await this.updateLeadCustomField(idLead, message, conversation_id_value);
        console.log('Campo personalizado actualizado'); // Log para depuración
      }
      return {
        msj_client: msj_client_value,
        lead_id: idLead,
        conversation_id: conversation_id_value
      };
    } catch (error) {
      console.error("Error procesando los datos de la solicitud:", error);
      return null;
    }
  }


  async updateLeadCustomField(lead_id, value, conversation_id) {
    try {
      await authenticate();
    
      if (!lead_id || !value || !conversation_id) {
        throw new Error("Missing required parameters for updating lead custom field.");
      }
    
      const token = await this.getToken();
      const options = {
        method: 'PATCH',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: 'Bearer ' + token
        },
        body: JSON.stringify([{
          id: Number(lead_id),
          custom_fields_values: [
            // IA TEXT RESPONSE
            { field_id: 955668, values: [{ value: value }] },
            { field_id: 955664, values: [{ value: conversation_id }] }
          ]
        }])
      };
    
      const subdominio = process.env.SUBDOMINIO;
      const response = await this.fetchWithTokenRetry(`https://${subdominio}.kommo.com/api/v4/leads`, options);
      await this.launchSalesbot(lead_id, token, subdominio);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`HTTP error! status: ${response.status}, response: ${errorText}`);
        // Si hay un error HTTP, transferir a asesor
        await this.getInterest("ASESOR", lead_id);
        return { success: false, message: 'Error al actualizar el lead. Te transferimos a un asesor.' };
      }
      
      return { success: true, message: 'Se actualizó el lead' };
    } catch (err) {
      console.error("Error en la solicitud:", err);
      // En caso de cualquier error, transferir a asesor
      await this.getInterest("ASESOR", lead_id);
      throw err;
    }
  }

  async launchSalesbot(idLead, token, subdominio) {
    const botLaunch = JSON.stringify([{ bot_id: 71430, entity_type: 2, entity_id: idLead }]);

    const optionsPostBot = {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: botLaunch,
    };
  
    fetch(`https://${subdominio}.kommo.com/api/v2/salesbot/run`, optionsPostBot)
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then(data => {
        console.log('Respuesta del bot:', data);
      })
      .catch(error => {
        console.error('Error al ejecutar el bot:', error);
      });
  }

}

module.exports = OpenAIService;

require('dotenv').config();
const OpenAI = require('openai');
const fetch = require('node-fetch');
const { authenticate } = require('./refreshTokenKommo'); // Importar authenticate

// Clase que encapsula la lógica para interactuar con la API de OpenAI
class OpenAIService {
  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    this.openai = new OpenAI({ apiKey: apiKey });
  }

  async main(msg_client, threadsId, lead_id) {
    const assistantId = process.env.ASSISTANT_ID_FORM;
    const message = await this.createdMessage(threadsId, msg_client);
    const lastMessage = await this.getMessageStream(assistantId, threadsId, lead_id);
    return lastMessage;
  }

  // Crear un nuevo hilo
  async createdThread() {
    const emptyThread = await this.openai.beta.threads.create();
    return emptyThread.id;
  }

  // Eliminar un hilo existente
  async deletedThread(thread_id) {
    await this.openai.beta.threads.del(thread_id);
  }

  // Crear un mensaje en el hilo correspondiente
  async createdMessage(threadsId, msg_client) {
    const messagesResponse = await this.openai.beta.threads.messages.create(
      threadsId,
      {
        role: "user",
        content: msg_client
      }
    );
    return messagesResponse;
  }

  // Obtener el flujo de mensajes
  async getMessageStream(assistantId, threadsId, lead_id) {
    try {
      if (!assistantId) {
        throw new Error("Missing required parameter: 'assistant_id'");
      }
  
      const stream = await this.openai.beta.threads.runs.stream(
        threadsId,
        { assistant_id: assistantId }
      );
  
      for await (const event of stream) {
        if (event.event === "thread.run.requires_action") {
          console.log("Se requiere acción:", event.event);
          const runData = event.data;
          const toolCall = runData.required_action.submit_tool_outputs.tool_calls[0];
          console.log("ToolCall detectado:", toolCall.function);
          const args = JSON.parse(toolCall.function.arguments);
          console.log("Argumentos procesados:", args);
  
          if (toolCall.function.name === 'agendar_cita') {
            const action_id = args.action_id;
            const propiedadInteres = await this.getInterest(action_id, lead_id);
            const toolOutput = [
              {
                tool_call_id: toolCall.id,
                output: JSON.stringify(propiedadInteres),
              },
            ];
            const tools = await this.submitToolOutputs(toolOutput, runData.id, threadsId);
            console.log('tools:', tools);
            return tools;

          }
  
          if (toolCall.function.name === 'enviar_formulario') {
            const formData = args;
            console.log("Datos del formulario:", args);
            const formOutput = await this.enviarFormulario(formData, lead_id);
            const toolOutput = [
              {
                tool_call_id: toolCall.id,
                output: JSON.stringify(formOutput),
              },
            ];
            const tools = await this.submitToolOutputs(toolOutput, runData.id, threadsId);
            return tools;
          }
        }
  
        if (event.event === "thread.run.completed") {
          const message = await this.openai.beta.threads.messages.list(threadsId);
          return message.data[0].content[0].text.value;
        }
      }
    } catch (error) {
      console.error("Error en getMessageStream:", error);
    }
  }
  
  // Enviar salidas de herramientas
  async submitToolOutputs(toolOutputs, runId, threadId) {
    try {
      const stream = await this.openai.beta.threads.runs.submitToolOutputsStream(
        threadId,
        runId,
        { tool_outputs: toolOutputs }
      );

      for await (const event of stream) {
        if (event.event === "thread.run.completed") {
          const message = await this.openai.beta.threads.messages.list(threadId);
          return message.data[0].content[0].text.value;
        }
      }
    } catch (error) {
      console.error("Error enviando tool outputs:", error);
    }
  }

  // Enviar el valor de la call fuction para cambiar a un asesor
  async getInterest(action_id, lead_id) {
    // Asegurarse de que el token es válido antes de realizar la solicitud
    await authenticate();

    const options = {
      method: 'PATCH',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: 'Bearer ' + process.env.TOKEN_API_KOMMO
      },
      body: JSON.stringify([{
        id: Number(lead_id),
        custom_fields_values: [
          { field_id: 955670, values: [{ value: action_id }] }
        ]
      }])
    };

    try {
      const subdominio = process.env.SUBDOMINIO;
      const response = await fetch(`https://${subdominio}.kommo.com/api/v4/leads`, options);
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
  
      const token = process.env.TOKEN_API_KOMMO;
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
      const response_get = await fetch(`https://${subdominio}.kommo.com/api/v4/leads/${idLead}`, optionsGetLead);
      console.log('response_get status:', response_get.status); // Log para depuración
      const responseBody = await response_get.json();
      console.log('responseBody:', responseBody); // Log para depuración
  
      if (!responseBody.custom_fields_values) {
        throw new Error('custom_fields_values no encontrado en la respuesta');
      }
  
      // mensaje del cliente
      const msj_client = responseBody.custom_fields_values.find((obj) => obj.field_id === 955672);
      console.log('msj_client:', msj_client); // Log para depuración
      let msj_client_value = msj_client?.values?.[0]?.value || "Hola"; // Establecer "Hola" si es indefinido o vacío
      console.log('msj_client_value:', msj_client_value); // Log para depuración
      if (!msj_client_value) {
        throw new Error('msj_client_value no encontrado en los custom fields');
      }
  
      const thread_id = responseBody.custom_fields_values.find((obj) => obj.field_id === 955664);
      console.log('thread_id:', thread_id); // Log para depuración
      let thread_id_value = thread_id?.values?.[0]?.value || null; // Cambiar const a let
      console.log('thread_id_value:', thread_id_value); // Log para depuración
      
      // Crear un nuevo hilo si no se proporciona uno
      if (!thread_id_value) {
        console.log('Creando un nuevo hilo'); // Log para depuración
        thread_id_value = await this.createdThread();
        console.log('Nuevo thread_id_value:', thread_id_value); // Log para depuración
      }
  
      // Llamar a las funciones correspondientes con los valores obtenidos
      if (thread_id_value) {
        const assistantId = process.env.ASSISTANT_ID_FORM;
        console.log('Llamando a createdMessage con thread_id_value y msj_client_value'); // Log para depuración
        await this.createdMessage(thread_id_value, msj_client_value);
        console.log('Mensaje creado'); // Log para depuración
        console.log('Llamando a getMessageStream con assistantId, thread_id_value y idLead'); // Log para depuración
        const message = await this.getMessageStream(assistantId, thread_id_value, idLead);
        console.log('Mensaje obtenido del stream:', message); // Log para depuración
  
        // Actualizar el campo personalizado en Kommo con el mensaje obtenido
        console.log('Actualizando el campo personalizado en Kommo'); // Log para depuración
        await this.updateLeadCustomField(idLead, message, thread_id_value);
        console.log('Campo personalizado actualizado'); // Log para depuración
      }
      return {
        msj_client: msj_client_value,
        lead_id: idLead,
        thread_id: thread_id_value
      };
    } catch (error) {
      console.error("Error procesando los datos de la solicitud:", error);
      return null;
    }
  }

  async enviarFormulario(formData, lead_id) {
    await authenticate();
  
    const options = {
      method: 'PATCH',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: 'Bearer ' + process.env.TOKEN_API_KOMMO
      },
      body: JSON.stringify([{
        id: Number(lead_id),
        custom_fields_values: [
          { field_id: 1994945, values: [{ value: formData.nombre_completo.toString() }] },
          { field_id: 1994947, values: [{ value: formData.cedula.toString() }] },
          { field_id: 1011886, values: [{ value: formData.telefono.toString() }] },
          { field_id: 1011890, values: [{ value: formData.email.toString() }] },
          { field_id: 1011892, values: [{ value: formData.ocupacion.toString() }] },
          { field_id: 1994949, values: [{ value: formData.total_ingresos.toString() }] },
          { field_id: 1011896, values: [{ value: formData.bancos.join(', ') }] },
          { field_id: 1994951, values: [{ value: formData.modelo_auto.toString() }] }
        ]
      }])
    };
  
    console.log("Body de la solicitud:", options.body);
  
    try {
      const subdominio = process.env.SUBDOMINIO;
      const response = await fetch(`https://${subdominio}.kommo.com/api/v4/leads`, options);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, response: ${errorText}`);
      }
      return { success: true, message: 'Formulario enviado y lead actualizado' };
    } catch (err) {
      console.error("Error en la solicitud:", err);
      return { success: false, message: 'Error al enviar el formulario', error: err.message };
    }
  }
  // Nueva función para actualizar el custom field en Kommo
  async updateLeadCustomField(lead_id, value, thread_id) {
    // Asegurarse de que el token es válido antes de realizar la solicitud
    await authenticate();

    const options = {
      method: 'PATCH',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: 'Bearer ' + process.env.TOKEN_API_KOMMO
      },
      body: JSON.stringify([{
        id: Number(lead_id),
        custom_fields_values: [
          { field_id: 1994931, values: [{ value: value }] },
          { field_id: 955664, values: [{ value: thread_id }] } // Añadir el thread_id aquí
        ]
      }])
    };

    try {
      const subdominio = process.env.SUBDOMINIO;
      const response = await fetch(`https://${subdominio}.kommo.com/api/v4/leads`, options);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return { success: true, message: 'Se actualizó el lead' };
    } catch (err) {
      console.error("Error en la solicitud:", err);
      return { success: false, message: 'Error al actualizar el lead' };
    }
  }
}

module.exports = OpenAIService;
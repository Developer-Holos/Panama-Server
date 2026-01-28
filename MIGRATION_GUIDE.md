# Guía de Migración: Assistants API → Responses API

## 📋 Resumen de Cambios

Este proyecto ha sido migrado de la **Assistants API (deprecada)** a la nueva **Responses API** de OpenAI. La Assistants API será descontinuada el 26 de agosto de 2026.

## 🔧 Cambios en Variables de Entorno

### Variables que deben ACTUALIZARSE en tu archivo `.env`:

```env
# ❌ ANTES (Assistants API):
ASSISTANT_ID_IDENTIFICAR=asst_xxxxxxxxxxxxx

# ✅ AHORA (Responses API):
PROMPT_ID_IDENTIFICAR=prompt_xxxxxxxxxxxxx
```

### Variables adicionales opcionales:

```env
# Para el asistente auxiliar de información de autos
PROMPT_ID_AUXILIAR=prompt_xxxxxxxxxxxxx
# Si no se configura, se usará temporalmente el ID: asst_BpHw5C6GN58wIeaU5r1RoEQ7
```

## 📝 Pasos para Completar la Migración

### 1. Crear Prompts en el Dashboard de OpenAI

Los Assistants ya no se crean mediante API. Ahora debes:

1. **Ir al Dashboard de OpenAI**: https://platform.openai.com/
2. **Crear un nuevo Prompt** para cada asistente que tenías:
   - Navegar a la sección de "Prompts"
   - Crear un nuevo prompt con la misma configuración que tu asistente anterior:
     - **Instrucciones del sistema** (las que tenía tu asistente)
     - **Herramientas** (tools/functions que usaba)
     - **Modelo** (gpt-4, gpt-5, etc.)
     - **Parámetros** (temperatura, etc.)

3. **Copiar los IDs de los Prompts** creados:
   - Prompt principal (para `PROMPT_ID_IDENTIFICAR`)
   - Prompt auxiliar (para `PROMPT_ID_AUXILIAR`)

### 2. Actualizar el archivo `.env`

Reemplaza las variables antiguas con los nuevos IDs de prompts:

```env
PROMPT_ID_IDENTIFICAR=prompt_tu_id_aqui
PROMPT_ID_AUXILIAR=prompt_tu_id_auxiliar_aqui
```

### 3. Actualizar el campo personalizado en Kommo (Opcional pero recomendado)

El campo personalizado con `field_id: 955664` ahora almacena `conversation_id` en lugar de `thread_id`. Aunque funciona igual, puedes renombrar el campo en Kommo para mayor claridad:

- **Antes**: "Thread ID"
- **Ahora**: "Conversation ID"

## 🎯 Principales Cambios Técnicos Implementados

### Cambios en el Código

| Componente Anterior | Componente Nuevo | Descripción |
|---------------------|------------------|-------------|
| `Threads` | `Conversations` | Ahora se usan conversaciones en lugar de hilos |
| `Assistants` | `Prompts` | Los asistentes ahora son prompts configurados en el dashboard |
| `Runs` | `Responses` | Las ejecuciones ahora son respuestas directas |
| `Messages` | `Items` | Los mensajes son ahora items con tipos más específicos |
| `threads.runs.stream()` | `responses.stream()` | Streaming simplificado |

### Funciones Actualizadas

1. **`createdThread()` → `createdConversation()`**
   - Crea conversaciones en lugar de hilos

2. **`deletedThread()` → `deletedConversation()`**
   - Elimina conversaciones

3. **`main()`**
   - Ahora usa `PROMPT_ID_IDENTIFICAR` en lugar de `ASSISTANT_ID_IDENTIFICAR`
   - Llama a `createResponse()` en lugar de `createdMessage()` + `getMessageStream()`

4. **`getMessageStream()` → `createResponse()`**
   - Usa `responses.stream()` en lugar de `threads.runs.stream()`
   - Manejo de tool calls simplificado usando `function_call` y `function_call_output` items

5. **`consultarAsistenteAuxiliar()`**
   - Usa Responses API con el nuevo `PROMPT_ID_AUXILIAR`

6. **`processRequestData()`**
   - Actualizado para trabajar con `conversation_id` en lugar de `thread_id`

## ✨ Beneficios de la Nueva API

- **Mejor rendimiento**: Mejora del 3% en benchmarks internos
- **Menores costos**: 40-80% de mejora en utilización de caché
- **Más herramientas nativas**: Web search, file search, code interpreter, MCP, etc.
- **Contexto stateful**: Opción de mantener estado entre turnos
- **API más simple**: Menos llamadas necesarias para lograr el mismo resultado

## ⚠️ Notas Importantes

1. **Las conversaciones se almacenan por defecto** (`store: true`)
   - Si necesitas deshabilitar el almacenamiento, usa `store: false`

2. **El campo en Kommo no necesita cambios estructurales**
   - El campo con `field_id: 955664` seguirá funcionando
   - Solo cambia el tipo de ID que almacena (conversation_id vs thread_id)

3. **Compatibilidad hacia atrás**
   - Los conversation IDs son strings como los thread IDs
   - El formato es compatible con el sistema actual de Kommo

4. **Streaming mejorado**
   - El streaming ahora es más eficiente
   - Los eventos son más claros y fáciles de manejar

## 🔍 Verificación Post-Migración

Después de actualizar las variables de entorno, verifica que:

- [ ] Los prompts están creados en el dashboard de OpenAI
- [ ] Las variables `PROMPT_ID_IDENTIFICAR` y `PROMPT_ID_AUXILIAR` están configuradas
- [ ] El servidor se reinicia sin errores
- [ ] Los webhooks de Kommo funcionan correctamente
- [ ] Las conversaciones se crean y almacenan correctamente
- [ ] Las tool calls (agendar_cita, enviar_formulario, etc.) funcionan
- [ ] El asistente auxiliar responde correctamente

## 📚 Referencias

- [Guía de Migración Oficial de OpenAI](https://platform.openai.com/docs/guides/assistants/migration)
- [Documentación de Responses API](https://platform.openai.com/docs/guides/responses-vs-chat-completions)
- [Documentación de Conversations API](https://platform.openai.com/docs/api-reference/conversations)

## 🆘 Soporte

Si encuentras problemas durante la migración:

1. Revisa los logs del servidor para errores específicos
2. Verifica que los prompts estén correctamente configurados en el dashboard
3. Confirma que las variables de entorno estén actualizadas
4. Comprueba que la versión del SDK de OpenAI sea compatible (>= 4.70.0)

---

**Fecha de migración**: Enero 2026  
**Versión del SDK**: openai@^4.70.0+  
**Estado**: ✅ Completado

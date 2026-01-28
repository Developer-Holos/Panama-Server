// src/utils/index.js

require('dotenv').config();
const OpenAI = require('openai');

// Inicializa el cliente de OpenAI con la clave de API
const apiKey = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: apiKey });

// Crea un nuevo hilo en OpenAI
async function createdThread() {
  const emptyThread = await openai.beta.threads.create();
  return emptyThread.id;
}

// Elimina un hilo existente en OpenAI
async function deletedThread(thread_id) {
  await openai.beta.threads.del(thread_id);
}

// Crea un mensaje en un hilo específico
async function createdMessage(threadsId, msg_client) {
  const messagesResponse = await openai.beta.threads.messages.create(
    threadsId,
    {
      role: "user",
      content: msg_client
    }
  );
  return messagesResponse;
}

// Función principal para manejar la lógica de mensajes y hilos
async function main(msg_client, threadsId, assistant_Id, lead_id) {
  const message = await createdMessage(threadsId, msg_client);
  const lastMessage = await getMessageStream(assistant_Id, threadsId, lead_id);
  return lastMessage;
}

// Exporta las funciones para su uso en otros módulos
module.exports = { createdThread, deletedThread, createdMessage, main };
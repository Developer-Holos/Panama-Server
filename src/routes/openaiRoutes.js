const express = require('express');
const OpenAIController = require('../controllers/openaiController');
const { ensureValidToken } = require('../middleware/authMiddleware');

const router = express.Router();
const openAIController = new OpenAIController();

// Definir las rutas para las funcionalidades de OpenAI
// Se aplica el middleware para verificar y actualizar el token en cada petición
router.post('/meditec_ia', ensureValidToken, openAIController.handleBaseIA.bind(openAIController));
router.post('/meditec_ia_form', ensureValidToken, openAIController.handleFormData.bind(openAIController)); // Nueva ruta

// Ruta de prueba para testing sin Kommo
router.post('/test-chat', openAIController.handleTestChat.bind(openAIController));

module.exports = router;
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const openaiRoutes = require('./routes/openaiRoutes');

// Inicializa la aplicación Express
const app = express();

// Configura middleware para parsear JSON y datos de formularios
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Servir archivos estáticos desde la carpeta public
app.use(express.static(path.join(__dirname, '../public')));

// Ruta principal que sirve la interfaz de prueba
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/test-chat.html'));
});

// Configura las rutas para la aplicación
app.use('/api/openai', openaiRoutes);

// Exporta la aplicación para ser utilizada en el servidor
module.exports = app;
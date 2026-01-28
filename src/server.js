// src/server.js
// Este archivo es responsable de iniciar el servidor y escuchar en un puerto especificado.

const app = require('./app'); // Importa la aplicación Express desde app.js
const dotenv = require('dotenv'); // Importa dotenv para manejar variables de entorno
const { verifyToken, refreshToken } = require('./services/refreshTokenKommo'); // Importa las funciones desde refreshTokenKommo.js

dotenv.config(); // Carga las variables de entorno desde el archivo .env

const port = process.env.PORT || 3000; // Establece el puerto, usando el valor de la variable de entorno o 3000 por defecto

// Verificar y actualizar el token si es necesario
verifyToken().then(isValid => {
  if (!isValid) {
      refreshToken().catch(error => {
          console.error('Error al actualizar el token:', error);
      });
  }
}).catch(error => {
  console.error('Error al verificar el token:', error);
});

// Configurar la actualización del token cada 23 horas
const refreshInterval = 22 * 60 * 60 * 1000; // 22 horas en milisegundos
setInterval(() => {
  refreshToken().catch(error => {
    console.error('Error al actualizar el token automáticamente:', error);
  });
}, refreshInterval);


// Inicia el servidor y escucha en el puerto especificado
app.listen(port, () => {
  console.log(`Servidor escuchando en el puerto ${port}`); // Mensaje en consola indicando que el servidor está en funcionamiento
});
const { authenticate } = require('../services/refreshTokenKommo');

/**
 * Middleware que verifica y actualiza el token de Kommo en cada petición
 */
async function ensureValidToken(req, res, next) {
    try {
        console.log('Verificando token antes de procesar la petición...');
        await authenticate();
        console.log('Token verificado y actualizado si era necesario');
        next();
    } catch (error) {
        console.error('Error al verificar/actualizar token:', error);
        return res.status(500).json({
            error: 'Error al autenticar con Kommo',
            message: error.message
        });
    }
}

module.exports = { ensureValidToken };

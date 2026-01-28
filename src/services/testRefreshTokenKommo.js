const { refreshToken, verifyToken } = require('./refreshTokenKommo');

async function test() {
    try {
        // Primero, verifica si el token actual es válido
        const isValid = await verifyToken();
        console.log('Token válido:', isValid);

        // Si el token no es válido, intenta refrescarlo
        if (!isValid) {
            console.log('El token no es válido, intentando refrescar...');
            await refreshToken();
            const isRefreshedValid = await verifyToken();
            console.log('Token renovado válido:', isRefreshedValid);
        } else {
            console.log('El token actual es válido, no es necesario refrescar.');
        }
    } catch (error) {
        console.error('Error durante la prueba:', error);
    }
}

test();
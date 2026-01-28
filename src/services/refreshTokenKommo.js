const axios = require('axios');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const https = require('https');
const Token = require('../models/Token');

const domain = process.env.SUBDOMINIO;

// Leer token desde la base de datos por dominio
async function readTokenFromDB(domain) {
    let token = await Token.findOne({ where: { domain } });
    if (!token) {
        token = await Token.create({ domain, access_token: '', refresh_token: '' });
    }
    return token;
}

// Escribir token en la base de datos por dominio
async function writeTokenToDB(domain, tokenData) {
    let token = await Token.findOne({ where: { domain } });
    if (token) {
        await token.update(tokenData);
    } else {
        await Token.create({ domain, ...tokenData });
    }
}

async function refreshToken() {
    console.log("REFRESH TOKEN *** ");

    const tokenData = await readTokenFromDB(domain);

    const data = {
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: tokenData.refresh_token,
        redirect_uri: process.env.CLIENT_REDIRECT_URI,
    };

    const link = `https://${domain}.kommo.com/oauth2/access_token`;

    const agent = new https.Agent({  
        rejectUnauthorized: false
    });

    try {
        const response = await axios.post(link, data, {
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            httpsAgent: agent
        });

        const code = response.status;
        const responseData = response.data;
        console.log('RESPONSE DATA *** ', responseData);

        if (code < 200 || code > 204) {
            const error = responseData.error || 'Undefined error';
            throw new Error(`Error: ${error}\nError code: ${code}`);
        }

        const access_token = responseData.access_token;
        const refresh_token = responseData.refresh_token;

        await writeTokenToDB(domain, { access_token, refresh_token });

        process.env.TOKEN_API_KOMMO = access_token;

        console.log('Tokens actualizados.');
    } catch (error) {
        if (error.response) {
            console.error('Response error:', error.response.data);
            console.error('Status code:', error.response.status);
        } else if (error.request) {
            console.error('No response received:', error.request);
        } else {
            console.error('Request setup error:', error.message);
        }
    }
}

async function authenticate() {
    try {
        const isValid = await verifyToken();
        if (!isValid) {
            console.log('Token inválido o expirado, renovando...');
            await refreshToken();
        } else {
            console.log('Token válido, no es necesario renovar.');
        }
    } catch (error) {
        console.error('Error during authentication, intentando renovar token:', error);
        // Si hay un error en la verificación, intentar renovar el token
        try {
            await refreshToken();
        } catch (refreshError) {
            console.error('Error al renovar el token:', refreshError);
            throw refreshError;
        }
    }
}

// Nueva función para obtener el access token actualizado
async function getAccessToken() {
    await authenticate();
    const tokenData = await readTokenFromDB(domain);
    return tokenData.access_token;
}

async function verifyToken() {
    try {
        const tokenData = await readTokenFromDB(domain);
        
        // Si no hay token en la base de datos, retornar false
        if (!tokenData || !tokenData.access_token || !tokenData.refresh_token) {
            console.log(`No hay tokens en la base de datos para el dominio: ${domain}`);
            return false;
        }
        
        console.log(`Verificando token en el dominio: ${domain}`);
        const response = await axios.get(`https://${domain}.kommo.com/api/v4/account`, {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
            httpsAgent: new https.Agent({  
                rejectUnauthorized: false
            })
        });
        console.log('Respuesta de verificación del token:', response.status);
        return response.status === 200;
    } catch (error) {
        if (error.response) {
            console.error('Error en la respuesta de verificación del token:', error.response.status);
            if (error.response.status === 401 || error.response.status === 403) {
                console.log('Token expirado o inválido (401/403)');
                return false;
            }
        } else {
            console.error('Error en la solicitud de verificación del token:', error.message);
        }
        return false; // Retornar false en lugar de lanzar el error
    }
}

module.exports = { refreshToken, verifyToken, authenticate, readTokenFromDB, writeTokenToDB, getAccessToken };
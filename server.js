import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { initialState, validateState } from './state.js';

const root = new URL('./', import.meta.url);
const publicFiles = {
  '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'],
  '/app.js': ['app.js', 'text/javascript'], '/state.js': ['state.js', 'text/javascript'],
};

export function databaseConfig(env = process.env) {
  if (!env.DATABASE_URL) throw new Error('Configura DATABASE_URL en .env.local o .env.supabase. Consulta README.md.');
  const url = new URL(env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('DATABASE_URL debe ser una conexión PostgreSQL.');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const useSSL = env.DATABASE_SSL === 'true' || !local;
  // La configuración SSL de la URL sobreescribe el objeto ssl en pg.
  // Centralizarla aquí evita perder la validación del certificado o su CA.
  for (const option of ['ssl', 'sslmode', 'sslrootcert', 'sslcert', 'sslkey']) {
    if (!['ssl', 'sslmode'].includes(option) && url.searchParams.has(option)) {
      throw new Error('Usa DATABASE_CA_FILE para el certificado y retira los parámetros SSL de DATABASE_URL.');
    }
    url.searchParams.delete(option);
  }
  if (url.searchParams.size) throw new Error('Retira los parámetros de DATABASE_URL; configura el host, puerto y base en la URL principal.');
  return {
    connectionString: url.toString(), max: 5, connectionTimeoutMillis: 10000, query_timeout: 15000,
    ssl: useSSL ? {
      rejectUnauthorized: true,
      ...(env.DATABASE_CA_FILE ? { ca: readFileSync(resolve(env.DATABASE_CA_FILE), 'utf8') } : {}),
    } : false,
  };
}

function send(response, status, data, type = 'application/json') {
  response.writeHead(status, {
    'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  });
  response.end(type === 'application/json' ? JSON.stringify(data) : data);
}

async function readBody(request) {
  let length = 0;
  const chunks = [];
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 10 * 1024 * 1024) {
      const error = new Error('El respaldo supera el límite de 10 MB.');
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { const error = new Error('El contenido JSON no es válido.'); error.status = 400; throw error; }
}

export async function createApp(pool, { databaseLabel = 'PostgreSQL' } = {}) {
  const sessionId = randomUUID();
  await pool.query(await readFile(new URL('schema.sql', root), 'utf8'));
  await pool.query('INSERT INTO pos_privado.estado (id, datos) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [initialState]);

  return createServer(async (request, response) => {
    try {
      const host = new URL(`http://${request.headers.host}`).hostname;
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
        send(response, 403, { error: 'Solo se permite acceso mediante localhost.' }); return;
      }
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/api/state') {
        if (request.method === 'GET') {
          const { rows } = await pool.query('SELECT datos, revision FROM pos_privado.estado WHERE id = 1');
          send(response, 200, { state: rows[0].datos, revision: rows[0].revision, databaseLabel, sessionId });
          return;
        }
        if (request.method !== 'PUT') { send(response, 405, { error: 'Método no permitido.' }); return; }
        const expectedOrigin = `http://${request.headers.host}`;
        if ((request.headers.origin && request.headers.origin !== expectedOrigin) ||
            request.headers['sec-fetch-site'] === 'cross-site') {
          send(response, 403, { error: 'Origen no permitido.' }); return;
        }
        if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
          send(response, 415, { error: 'Se requiere application/json.' }); return;
        }
        const body = await readBody(request);
        let state;
        try {
          if (!Number.isSafeInteger(body?.revision) || body.revision < 0) throw new Error('Revisión inválida.');
          state = validateState(body.state);
        } catch (error) { send(response, 400, { error: error.message }); return; }
        if (body.sessionId !== sessionId) {
          send(response, 409, { error: 'El servidor se reinició o cambió de base. Actualiza los datos antes de guardar.' });
          return;
        }
        // Una sentencia atómica guarda todo o rechaza el estado desactualizado.
        // ponytail: documento completo; dividir por entidad cuando su volumen lo requiera.
        const { rows } = await pool.query(
          `UPDATE pos_privado.estado SET datos = $1, revision = revision + 1, actualizado_en = now()
           WHERE id = 1 AND revision = $2 RETURNING datos, revision`, [state, body.revision]
        );
        if (!rows.length) {
          send(response, 409, { error: 'Otra sesión modificó los datos. Actualiza los datos y vuelve a intentar.' });
          return;
        }
        send(response, 200, { state: rows[0].datos, revision: rows[0].revision, databaseLabel, sessionId });
        return;
      }
      const asset = publicFiles[pathname];
      if (!asset || !['GET', 'HEAD'].includes(request.method)) {
        send(response, 404, { error: 'No encontrado.' }); return;
      }
      const content = await readFile(new URL(asset[0], root));
      send(response, 200, request.method === 'HEAD' ? '' : content, asset[1]);
    } catch (error) {
      // Nunca registrar la URL de conexión ni contraseñas.
      if (!error.status) console.error('Error de solicitud:', error.code || error.name);
      if (!response.headersSent) send(response, error.status || 503, {
        error: error.status ? error.message : 'No se confirmó el guardado. Revisa la conexión y actualiza los datos antes de reintentar.',
      });
    }
  });
}

async function main() {
  const pool = new pg.Pool(databaseConfig());
  pool.on('error', (error) => console.error('Error de PostgreSQL:', error.code || error.name));
  try {
    const databaseLabel = process.env.DATABASE_LABEL || 'PostgreSQL';
    const server = await createApp(pool, { databaseLabel });
    const port = Number(process.env.PORT || 3000);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe estar entre 1 y 65535.');
    server.listen(port, '127.0.0.1', () => console.log(`POS disponible en http://127.0.0.1:${port} (${databaseLabel})`));
    server.on('error', async (error) => {
      console.error('No se pudo abrir el servidor:', error.code || error.name);
      await pool.end(); process.exitCode = 1;
    });
    const stop = () => server.close(async () => { await pool.end(); });
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch (error) { await pool.end(); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.code ? `No se pudo iniciar PostgreSQL (${error.code}). Revisa tu configuración y conexión.` : error.message);
    process.exitCode = 1;
  });
}

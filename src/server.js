import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import pg from 'pg';
import { readSnapshot, writeOperation } from './pos/store.js';
import { databaseConfig } from './db/config.js';
import { hostingConfig, authorized } from './hosting.js';

const root = new URL('../public/', import.meta.url);
const publicFiles = {
  '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'],
  '/app.js': ['app.js', 'text/javascript'],
  '/pwa.js': ['pwa.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'],
  '/sw.js': ['sw.js', 'text/javascript'], '/manifest.webmanifest': ['manifest.webmanifest', 'application/manifest+json'],
  '/icons/icon-192.png': ['icons/icon-192.png', 'image/png'],
  '/icons/icon-512.png': ['icons/icon-512.png', 'image/png'],
  '/icons/maskable-512.png': ['icons/maskable-512.png', 'image/png'],
  '/icons/apple-touch-icon.png': ['icons/apple-touch-icon.png', 'image/png'],
  '/assets/brand/repuestos-felix.jpg': ['assets/brand/repuestos-felix.jpg', 'image/jpeg'],
};

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

export async function createApp(pool, { databaseLabel = 'PostgreSQL', hosting = hostingConfig({}) } = {}) {
  return createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, 'http://localhost').pathname;
      if (pathname === '/health' && request.method === 'GET') { send(response, 200, { ok: true }); return; }
      const host = new URL(`http://${request.headers.host}`);
      const allowed = hosting.origin
        ? host.host === new URL(hosting.origin).host
        : ['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname);
      if (!allowed) { send(response, 403, { error: 'Nombre de servidor no permitido.' }); return; }
      if (hosting.origin && request.headers['x-forwarded-proto']?.split(',')[0].trim() !== 'https') {
        send(response, 426, { error: 'Accede mediante HTTPS. El proxy debe configurar X-Forwarded-Proto.' }); return;
      }
      if ((pathname.startsWith('/api/') || ['/', '/index.html', '/login'].includes(pathname)) && !authorized(request, hosting)) {
        response.setHeader('WWW-Authenticate', 'Basic realm="Repuestos Felix", charset="UTF-8"');
        send(response, 401, { error: 'Inicia sesión para acceder al sistema.' }); return;
      }
      if (pathname === '/login' && request.method === 'GET') {
        response.writeHead(303, { Location: '/', 'Cache-Control': 'no-store' }); response.end(); return;
      }
      if (pathname.startsWith('/api/')) {
        if (pathname === '/api/state' && request.method === 'PUT') {
          send(response, 410, { error: 'La escritura global fue retirada. Cierra y vuelve a abrir la aplicación para actualizarla.' }); return;
        }
        if (request.method === 'GET' && ['/api/state', '/api/backup'].includes(pathname)) {
          send(response, 200, await readSnapshot(pool, databaseLabel, pathname === '/api/backup')); return;
        }
        if (!['POST', 'PUT', 'DELETE'].includes(request.method)) { send(response, 405, { error: 'Método no permitido.' }); return; }
        const expectedOrigin = hosting.origin || `http://${request.headers.host}`;
        if ((request.headers.origin && request.headers.origin !== expectedOrigin) || request.headers['sec-fetch-site'] === 'cross-site') {
          send(response, 403, { error: 'Origen no permitido.' }); return;
        }
        if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
          send(response, 415, { error: 'Se requiere application/json.' }); return;
        }
        const body = await readBody(request);
        send(response, 200, await writeOperation(pool, request.method, pathname, body, request.headers['idempotency-key'], databaseLabel)); return;
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
  const hosting = hostingConfig();
  const pool = new pg.Pool(databaseConfig());
  pool.on('error', (error) => console.error('Error de PostgreSQL:', error.code || error.name));
  try {
    const databaseLabel = process.env.DATABASE_LABEL || 'PostgreSQL';
    // Verify the selected schema and connection without granting the server DDL.
    await readSnapshot(pool, databaseLabel);
    const server = await createApp(pool, { databaseLabel, hosting });
    const port = Number(process.env.PORT || 3000);
    if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe estar entre 1 y 65535.');
    server.listen(port, hosting.host, () => console.log(`POS disponible en ${hosting.origin || `http://127.0.0.1:${port}`} (${databaseLabel})`));
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

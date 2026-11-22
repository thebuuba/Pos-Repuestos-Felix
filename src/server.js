import { createServer } from 'node:http';
import { access, readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, resolve, sep } from 'node:path';
import pg from 'pg';
import { readSnapshot } from './pos/store.js';
import { databaseConfig } from './db/config.js';
import { hostingConfig } from './hosting.js';
import { handleRequest } from './http/app.js';

const root = new URL('../dist/operational/', import.meta.url);
const legacyPort = 3000;

function acceptsGzip(header = '') {
  const encodings = new Map(header.toLowerCase().split(',').map(part => {
    const [name, ...parameters] = part.trim().split(';');
    const quality = parameters.find(parameter => parameter.trim().startsWith('q='));
    return [name, quality ? Number(quality.trim().slice(2)) : 1];
  }));
  return (encodings.get('gzip') ?? encodings.get('*') ?? 0) > 0;
}

export async function createApp(pool, { assetsDirectory = root, ...options } = {}) {
  const directory = fileURLToPath(assetsDirectory);
  const readAsset = path => readFile(join(directory, path)).catch(error => {
    if (error.code === 'ENOENT') return new Response(null, { status: 404 });
    throw error;
  });
  return createServer(async (request, response) => {
    try {
      const method = request.method;
      const incoming = new Request(new URL(request.url, `http://${request.headers.host}`), {
        method, headers: request.headers,
        ...(!['GET', 'HEAD'].includes(method) ? { body: Readable.toWeb(request), duplex: 'half' } : {}),
      });
      const result = await handleRequest(incoming, { ...options, pool, readAsset });
      // Do not reuse a connection whose rejected upload remains unread.
      if (incoming.body && (!incoming.bodyUsed || result.status === 413)) response.setHeader('Connection', 'close');
      const headers = new Headers(result.headers);
      const compressible = /^(?:text\/|application\/json\b)/.test(headers.get('content-type') || '');
      const gzipAccepted = acceptsGzip(request.headers['accept-encoding']);
      const gzip = method !== 'HEAD' && !!result.body && compressible && !headers.has('content-encoding') && gzipAccepted;
      if (compressible) headers.set('Vary', 'Accept-Encoding');
      if (compressible && gzipAccepted && headers.has('etag') && !headers.get('etag').startsWith('W/')) headers.set('ETag', 'W/' + headers.get('etag'));
      if (gzip) {
        headers.set('Content-Encoding', 'gzip');
        headers.delete('Content-Length');
      }
      response.writeHead(result.status, Object.fromEntries(headers));
      if (method === 'HEAD' || !result.body) response.end();
      else if (gzip) await pipeline(Readable.fromWeb(result.body), createGzip({ level: 1 }), response);
      else await pipeline(Readable.fromWeb(result.body), response);
    } catch (error) {
      console.error(JSON.stringify({ event: 'node_http_error', code: error.code || error.name }));
      if (!response.headersSent) {
        response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end(JSON.stringify({ error: 'No se confirmó la solicitud. Revisa la conexión.' }));
      } else response.destroy();
    }
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 1 && args[0] === '--operational')) throw new Error('Modo de inicio desconocido. Usa --operational para la interfaz nueva.');
  const port = Number(process.env.PORT);
  if (!process.env.PORT || port === legacyPort) {
    throw new Error(`Configura un PORT explícito y distinto del puerto heredado (${legacyPort}).`);
  }
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('PORT debe estar entre 1 y 65535.');
  const hosting = hostingConfig();
  const compiled = resolve('dist', 'operational');
  try { await Promise.all(['index.html', 'app.js', 'styles.css'].map(file => access(join(compiled, file)))); }
  catch { throw new Error('Compila dist/operational con pnpm build desde la carpeta del proyecto.'); }
  const assetsDirectory = pathToFileURL(compiled + sep);
  const pool = new pg.Pool(databaseConfig());
  pool.on('error', (error) => console.error('Error de PostgreSQL:', error.code || error.name));
  try {
    const databaseLabel = process.env.DATABASE_LABEL || 'PostgreSQL';
    // Verify the selected schema and connection without granting the server DDL.
    await readSnapshot(pool, databaseLabel);
    const server = await createApp(pool, { databaseLabel, hosting, assetsDirectory });
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

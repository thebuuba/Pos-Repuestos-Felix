import pg from 'pg';
import { handleRequest } from './http/app.js';
import { hostingConfig } from './hosting.js';

const logError = (event, error) => console.error(JSON.stringify({ event, code: error.code || error.name }));

export default {
  async fetch(request, env, ctx) {
    let pool;
    try {
      const url = new URL(request.url);
      const health = url.pathname === '/health' && request.method === 'GET';
      const hosting = health ? hostingConfig({}) : hostingConfig({ ...env, HOST: '0.0.0.0' }, { requireSupabase: true });
      const headers = new Headers(request.headers);
      // El protocolo y el host provienen del Request recibido por Cloudflare,
      // nunca de cabeceras enviadas por el visitante.
      headers.set('x-forwarded-proto', url.protocol.slice(0, -1));
      headers.set('host', url.host);
      const proxied = new Request(request, { headers });
      const database = {
        connect() {
          if (!env.HYPERDRIVE?.connectionString) throw new Error('Configura el binding HYPERDRIVE.');
          if (!pool) {
            pool = new pg.Pool({ connectionString: env.HYPERDRIVE.connectionString, max: 1,
              connectionTimeoutMillis: 10000, query_timeout: 15000, application_name: 'felix-worker' });
            pool.on('error', error => logError('database_pool_error', error));
          }
          return pool.connect();
        },
      };
      return await handleRequest(proxied, {
        pool: database, hosting, databaseLabel: env.DATABASE_LABEL || 'Supabase - Repuestos Felix',
        readAsset(path) { return env.ASSETS.fetch(new Request(new URL('/' + path, url.origin))); },
      });
    } catch (error) {
      logError('worker_request_error', error);
      return Response.json({ error: 'El sistema no está disponible. Revisa la configuración del servidor.' },
        { status: 503, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY' } });
    } finally {
      if (pool) ctx.waitUntil(pool.end().catch(error => logError('database_cleanup_error', error)));
    }
  },
};

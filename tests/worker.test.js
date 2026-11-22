import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import worker from '../src/worker.js';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';

let database, pool, env;
const pending = [];
const ctx = { waitUntil(promise) { pending.push(promise); } };
const auth = 'Basic ' + Buffer.from('cajero:clave-prueba-worker-12345').toString('base64');
before(async () => {
  database = await temporaryPostgres();
  pool = new pg.Pool({ connectionString: database.connectionString });
  await migrateDatabase(pool);
  env = { PUBLIC_ORIGIN: 'https://pos.example', APP_USERNAME: 'cajero', APP_PASSWORD: 'clave-prueba-worker-12345', DATABASE_LABEL: 'Pruebas Worker',
    HYPERDRIVE: { connectionString: database.connectionString },
    ASSETS: { async fetch(request) {
      const path = new URL(request.url).pathname;
      return new Response(await readFile(new URL('../dist/operational' + path, import.meta.url)));
    } },
  };
});
after(async () => { await Promise.all(pending); await pool?.end(); await database?.stop(); });
const call = (path, options = {}, bindings = env) => worker.fetch(new Request('https://pos.example' + path, { ...options, headers: { Authorization: auth, ...options.headers } }), bindings, ctx);

test('Worker sirve la interfaz operativa y conserva la imagen original y protege rutas privadas sin necesitar conexión a la base', async () => {
  const bindings = { ...env, HYPERDRIVE: undefined };
  const response = await call('/', {}, bindings);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /type="module" src="\/app\.js"/);
  const image = await call('/assets/brand/repuestos-felix.jpg', {}, bindings);
  assert.equal(image.status, 200);
  assert.match(image.headers.get('content-type'), /image\/jpeg/);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), await readFile(new URL('../public/assets/brand/repuestos-felix.jpg', import.meta.url)));
  assert.equal((await call('/src/worker.js', {}, bindings)).status, 404);
  assert.equal((await call('/.env', {}, bindings)).status, 404);
  const head = await call('/styles.css', { method: 'HEAD' }, bindings);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('Worker exige acceso para HTML y API y no confía en cabeceras de protocolo o host falsificadas', async () => {
  assert.equal((await call('/', { headers: { Authorization: '' } })).status, 401);
  assert.equal((await call('/api/state', { headers: { Authorization: '' } })).status, 401);
  assert.equal((await worker.fetch(new Request('http://pos.example/api/state', { headers: { Authorization: auth, 'X-Forwarded-Proto': 'https' } }), env, ctx)).status, 426);
  assert.equal((await worker.fetch(new Request('https://ajeno.example/api/state', { headers: { Authorization: auth, Host: 'pos.example' } }), env, ctx)).status, 403);
  assert.equal((await call('/', {}, { ...env, APP_PASSWORD: '' })).status, 503);
  assert.equal((await call('/api/state', {}, { ...env, HYPERDRIVE: undefined })).status, 503);
});

test('health es público y no hace consultas ni depende de secretos', async () => {
  const response = await worker.fetch(new Request('https://pos.example/health'), {}, ctx);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test('Worker usa las operaciones transaccionales e idempotencia con PostgreSQL real y cierra conexiones', async () => {
  const snapshot = await (await call('/api/state')).json();
  const body = JSON.stringify({ databaseId: snapshot.databaseId, nombre: 'Cliente Worker' });
  const key = crypto.randomUUID();
  const options = { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body };
  const responses = await Promise.all([call('/api/clientes', options), call('/api/clientes', options)]);
  assert.deepEqual(responses.map(r => r.status), [200, 200]);
  const results = await Promise.all(responses.map(r => r.json()));
  assert.equal(results[0].result.id, results[1].result.id);
  const latest = await (await call('/api/state')).json();
  assert.equal(latest.state.clientes.filter(c => c.nombre === 'Cliente Worker').length, 1);
  assert.equal((await call('/api/clientes', { ...options, headers: { ...options.headers, Origin: 'https://ajeno.example' } })).status, 403);
  assert.equal((await call('/api/state', { method: 'PUT' })).status, 410);
  await Promise.all(pending.splice(0));
  const sessions = await pool.query("SELECT count(*) FROM pg_stat_activity WHERE application_name='felix-worker'");
  assert.equal(sessions.rows[0].count, '0');
});

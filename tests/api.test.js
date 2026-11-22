import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { migrateDatabase } from '../src/db/migrations.js';
import { temporaryPostgres } from './postgres.js';

let database, pool, server, base, createApp;
let remoteServer;
before(async () => {
  ({ createApp } = await import('../src/server.js'));
  database = await temporaryPostgres();
  pool = new pg.Pool({ connectionString: database.connectionString });
  await migrateDatabase(pool);
  server = await createApp(pool, { databaseLabel: 'Pruebas' });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (remoteServer) await new Promise((done) => remoteServer.close(done));
  if (server) await new Promise((done) => server.close(done));
  if (pool) await pool.end();
  if (database) await database.stop();
});

test('el acceso público requiere HTTPS, origen y credenciales válidas', async () => {
  const { hostingConfig, sessionCookie } = await import('../src/hosting.js');
  const hosting = hostingConfig({
    HOST: '0.0.0.0', PUBLIC_ORIGIN: 'https://pos.example', APP_USERNAME: 'felix', APP_PASSWORD: 'clave-de-pruebas-12345',
  });
  remoteServer = await createApp(pool, { hosting });
  await new Promise((done) => remoteServer.listen(0, '127.0.0.1', done));
  const remote = `http://127.0.0.1:${remoteServer.address().port}`;
  const headers = { Host: 'pos.example', 'X-Forwarded-Proto': 'https' };
  const auth = sessionCookie(hosting).split(';')[0];
  const call = (path, extras = {}) => new Promise((resolve, reject) => {
    const request = httpRequest(remote + path, { headers: { ...headers, ...extras } }, (response) => {
      response.resume(); resolve(response);
    }); request.on('error', reject); request.end();
  });
  const unauthorized = await call('/api/state');
  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.headers['www-authenticate'], undefined);
  assert.equal((await call('/api/state', { Cookie: auth })).statusCode, 200);
  assert.equal((await call('/api/state', { Cookie: 'sesion-invalida' })).statusCode, 401);
  assert.equal((await call('/api/state', { Cookie: auth, 'X-Forwarded-Proto': 'http' })).statusCode, 426);
  assert.equal((await call('/styles.css')).statusCode, 200);
  assert.equal((await call('/login', { Cookie: auth })).statusCode, 303);
  assert.equal((await call('/health', { Host: 'interno.example', 'X-Forwarded-Proto': 'http' })).statusCode, 200);
});
const get = async () => (await fetch(`${base}/api/state`)).json();
const write = async (body, headers = {}) => fetch(`${base}/api/clientes`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(), ...headers }, body: JSON.stringify({ databaseId: (await get()).databaseId, ...body }),
});

test('retires snapshot writes and preserves database identity between servers', async () => {
  assert.equal((await fetch(base + '/api/state', { method: 'PUT' })).status, 410);
  const original = await get();
  const other = await createApp(pool);
  await new Promise(done => other.listen(0, '127.0.0.1', done));
  try {
    const snapshot = await (await fetch(`http://127.0.0.1:${other.address().port}/api/state`)).json();
    assert.equal(snapshot.databaseId, original.databaseId);
    assert.deepEqual(snapshot.state.productos, []);
  } finally { await new Promise(done => other.close(done)); }
});

test('independent cash registers preserve both writes', async () => {
  const results = await Promise.all([write({ nombre: 'Caja A' }), write({ nombre: 'Caja B' })]);
  assert.deepEqual(results.map(response => response.status), [200, 200]);
  assert.ok((await get()).state.clientes.some(c => c.nombre === 'Caja A'));
  assert.ok((await get()).state.clientes.some(c => c.nombre === 'Caja B'));
});

test('rechaza JSON roto, tipos de contenido ajenos y peticiones de otros sitios', async () => {
  const broken = await fetch(`${base}/api/clientes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(broken.status, 400);
  assert.equal((await write({ nombre: 'Prueba' }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await write({ nombre: 'Prueba' }, { Origin: 'https://otro-sitio.example' })).status, 403);
});

test('no publica credenciales, SQL ni archivos del servidor', async () => {
  for (const path of ['/.env', '/.env.supabase', '/server.js', '/schema.sql', '/package.json', '/src/server.js', '/src/db/config.js', '/src/pos/legacy-state.js', '/supabase/schema.sql', '/public/index.html', '/assets/brand/../../.env']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/app.js')).status, 200);
});

test('el servidor por defecto entrega el inventario compilado de Polymet', async () => {
  const html = await (await fetch(base + '/inventario')).text();
  assert.match(html, /<div id="root"><main class="pos-startup"/);
  assert.match(html, /type="module" src="\/assets\/pwa\/app-[a-f0-9]{16}\.js"/);
  for (const path of ['/manifest.webmanifest', '/sw.js']) assert.equal((await fetch(base + path)).status, 200, path);
  assert.equal((await fetch(base + '/pwa.js')).status, 404, 'La entrada heredada no se publica');
});

test('responde con 413 si el respaldo supera 10 MB', async () => {
  const response = await fetch(`${base}/api/clientes`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(10 * 1024 * 1024 + 1),
  });
  assert.equal(response.status, 413);
  assert.equal((await fetch(`${base}/api/state`)).status, 200, 'El siguiente acceso debe funcionar después de rechazar el cuerpo grande');
});

test('rechaza nombres de host externos aunque apunten al servidor local', async () => {
  const status = await new Promise((resolve, reject) => {
    const request = httpRequest(`${base}/api/state`, { headers: { Host: 'sitio-ajeno.example' } }, (response) => {
      response.resume(); resolve(response.statusCode);
    });
    request.on('error', reject); request.end();
  });
  assert.equal(status, 403);
});

test('rejects a write from a different database', async () => {
  const original = await get();
  const response = await fetch(base + '/api/clientes', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ databaseId: randomUUID(), nombre: 'Ajeno' }) });
  assert.equal(response.status, 409);
  assert.deepEqual((await get()).state, original.state);
});

test('entrega la fuente compilada y admite HEAD', async () => {
  const response = await fetch(base + '/assets/fonts/inter-latin-wght-normal.woff2', { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'font/woff2');
  assert.equal((await response.arrayBuffer()).byteLength, 0);
});

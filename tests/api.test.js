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
  const { hostingConfig } = await import('../src/hosting.js');
  const hosting = hostingConfig({
    HOST: '0.0.0.0', PUBLIC_ORIGIN: 'https://pos.example', APP_USERNAME: 'felix', APP_PASSWORD: 'clave-de-pruebas-12345',
  });
  remoteServer = await createApp(pool, { hosting });
  await new Promise((done) => remoteServer.listen(0, '127.0.0.1', done));
  const remote = `http://127.0.0.1:${remoteServer.address().port}`;
  const headers = { Host: 'pos.example', 'X-Forwarded-Proto': 'https' };
  const auth = 'Basic ' + Buffer.from('felix:clave-de-pruebas-12345').toString('base64');
  const call = (path, extras = {}) => new Promise((resolve, reject) => {
    const request = httpRequest(remote + path, { headers: { ...headers, ...extras } }, (response) => {
      response.resume(); resolve(response);
    }); request.on('error', reject); request.end();
  });
  const unauthorized = await call('/api/state');
  assert.equal(unauthorized.statusCode, 401);
  assert.match(unauthorized.headers['www-authenticate'], /Basic/);
  assert.equal((await call('/api/state', { Authorization: auth })).statusCode, 200);
  assert.equal((await call('/api/state', { Authorization: 'Basic ' + Buffer.from('felix:incorrecta').toString('base64') })).statusCode, 401);
  assert.equal((await call('/api/state', { Authorization: auth, 'X-Forwarded-Proto': 'http' })).statusCode, 426);
  assert.equal((await call('/manifest.webmanifest')).statusCode, 200);
  assert.equal((await call('/login', { Authorization: auth })).statusCode, 303);
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

test('la cabecera muestra la imagen original y el servidor entrega el JPEG completo', async () => {
  const { readFile } = await import('node:fs/promises');
  const { JSDOM } = await import('jsdom');
  const html = new JSDOM(await (await fetch(base + '/')).text());
  try {
    const image = html.window.document.querySelector('.brand-banner');
    assert.ok(image, 'La cabecera debe incluir la imagen del negocio');
    assert.equal(image.getAttribute('alt'), 'Repuestos Félix · Tanaka · 829-782-3872');
    assert.equal(image.getAttribute('width'), '2272');
    assert.equal(image.getAttribute('height'), '464');
    const response = await fetch(base + image.getAttribute('src'));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /image\/jpeg/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(new URL('../public/assets/brand/repuestos-felix.jpg', import.meta.url)));
  } finally { html.window.close(); }
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

test('publica el manifiesto y todos sus iconos con tipos correctos', async () => {
  const response = await fetch(base + '/manifest.webmanifest');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/manifest\+json/);
  const manifest = await response.json();
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const response = await fetch(base + icon.src);
    assert.equal(response.status, 200, icon.src);
    assert.match(response.headers.get('content-type'), /image\/png/);
    const png = Buffer.from(await response.arrayBuffer());
    assert.equal(png.readUInt32BE(16), Number(icon.sizes.split('x')[0]));
    assert.equal(png.readUInt32BE(20), Number(icon.sizes.split('x')[1]));
  }
  const head = await fetch(base + '/icons/icon-192.png', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'image/png');
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  for (const path of ['/sw.js', '/styles.css', '/pwa.js', '/icons/apple-touch-icon.png']) {
    assert.equal((await fetch(base + path)).status, 200, path);
  }
});

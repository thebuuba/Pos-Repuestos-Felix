import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/http/app.js';
import { hostingConfig } from '../src/hosting.js';

const origin = 'https://pos.example';
const hosting = hostingConfig({ PUBLIC_ORIGIN: origin, APP_USERNAME: 'felix', APP_PASSWORD: 'clave-de-pruebas-12345' });
const auth = 'Basic ' + Buffer.from('felix:clave-de-pruebas-12345').toString('base64');
const request = (path, options = {}) => new Request(origin + path, {
  ...options, headers: { 'X-Forwarded-Proto': 'https', ...options.headers },
});
const forbiddenPool = { connect() { throw new Error('La ruta no debe consultar PostgreSQL'); } };

test('Fetch protege entrada y API antes de usar recursos; health es independiente de PostgreSQL', async () => {
  const options = { pool: forbiddenPool, hosting, readAsset() { throw new Error('No debe leer assets'); } };
  for (const path of ['/', '/index.html', '/login', '/api/state']) {
    const response = await handleRequest(request(path), options);
    assert.equal(response.status, 401, path);
    assert.match(response.headers.get('www-authenticate'), /Basic/);
  }
  assert.equal((await handleRequest(request('/health'), options)).status, 200);
  assert.equal((await handleRequest(request('/styles.css', { headers: { 'X-Forwarded-Proto': 'http' } }), options)).status, 426);
  assert.equal((await handleRequest(new Request('https://ajeno.example/styles.css'), options)).status, 403);
  assert.equal((await handleRequest(request('/styles.css', { headers: { Host: 'POS.EXAMPLE' } }), { ...options, readAsset: () => 'body{}' })).status, 200);
});

test('Fetch conserva streaming de assets y entrega bytes binarios sin convertirlos a texto', async () => {
  let finish;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([255, 216])); finish = () => { controller.enqueue(new Uint8Array([255, 217])); controller.close(); }; } });
  const loaded = [];
  const response = await handleRequest(request('/assets/brand/repuestos-felix.jpg'), {
    pool: forbiddenPool, hosting, readAsset: path => { loaded.push(path); return new Response(stream); },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /image\/jpeg/);
  const reader = response.body.getReader();
  assert.deepEqual((await reader.read()).value, new Uint8Array([255, 216]));
  finish();
  assert.deepEqual((await reader.read()).value, new Uint8Array([255, 217]));
  assert.equal((await reader.read()).done, true);
  assert.deepEqual(loaded, ['assets/brand/repuestos-felix.jpg']);
  const binary = new Uint8Array([137, 80, 78, 71, 0, 255]);
  const bytes = await handleRequest(request('/icons/icon-192.png'), { pool: forbiddenPool, hosting, readAsset: () => binary });
  assert.deepEqual(new Uint8Array(await bytes.arrayBuffer()), binary);
});

test('Fetch HEAD y rutas privadas conservan métodos, seguridad y cuerpo vacío', async () => {
  const options = { pool: forbiddenPool, hosting, readAsset: () => new Uint8Array([1, 2, 3]) };
  const head = await handleRequest(request('/styles.css', { method: 'HEAD' }), options);
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.match(head.headers.get('content-type'), /text\/css/);
  assert.equal(head.headers.get('x-frame-options'), 'DENY');
  for (const path of ['/.env', '/src/server.js', '/supabase/schema.sql', '/public/index.html']) {
    assert.equal((await handleRequest(request(path), options)).status, 404, path);
  }
  assert.equal((await handleRequest(request('/styles.css', { method: 'POST' }), options)).status, 404);
  assert.equal((await handleRequest(request('/login', { headers: { Authorization: auth } }), options)).status, 303);
});

test('Fetch rechaza JSON roto y exceso de tamaño antes de usar PostgreSQL', async () => {
  const options = { pool: forbiddenPool, hosting };
  const headers = { Authorization: auth, 'Content-Type': 'application/json' };
  assert.equal((await handleRequest(request('/api/clientes', { method: 'POST', headers, body: '{' }), options)).status, 400);
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(10 * 1024 * 1024)); controller.enqueue(new Uint8Array([32])); controller.close(); } });
  assert.equal((await handleRequest(request('/api/clientes', { method: 'POST', headers, body, duplex: 'half' }), options)).status, 413);
  assert.equal((await handleRequest(request('/api/clientes', { method: 'POST', headers: { ...headers, Origin: 'https://ajeno.example' }, body: '{}' }), options)).status, 403);
});

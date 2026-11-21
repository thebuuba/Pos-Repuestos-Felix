import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import pg from 'pg';
import { temporaryPostgres } from './postgres.js';

let database, pool, server, base, createApp;
before(async () => {
  ({ createApp } = await import('../server.js'));
  database = await temporaryPostgres();
  pool = new pg.Pool({ connectionString: database.connectionString });
  server = await createApp(pool, { databaseLabel: 'Pruebas' });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((done) => server.close(done));
  if (pool) await pool.end();
  if (database) await database.stop();
});
const get = async () => (await fetch(`${base}/api/state`)).json();
const put = (body, headers = {}) => fetch(`${base}/api/state`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

test('persiste los datos en PostgreSQL al abrir otra conexión', async () => {
  const state = await get();
  state.state.empresa = "Repuestos Félix ' Especial";
  const saved = await put(state);
  assert.equal(saved.status, 200);
  const other = new pg.Client({ connectionString: database.connectionString });
  await other.connect();
  try {
    const { rows } = await other.query('SELECT datos, revision FROM pos_privado.estado WHERE id = 1');
    assert.equal(rows[0].datos.empresa, "Repuestos Félix ' Especial");
    assert.equal(rows[0].revision, state.revision + 1);
  } finally { await other.end(); }
});

test('dos escrituras concurrentes no se sobrescriben', async () => {
  const original = await get();
  const first = structuredClone(original);
  const second = structuredClone(original);
  first.state.empresa = 'Sesión A';
  second.state.empresa = 'Sesión B';
  const results = await Promise.all([put(first), put(second)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const winner = results[0].status === 200 ? 'Sesión A' : 'Sesión B';
  assert.equal((await get()).state.empresa, winner);
});

test('rechaza stock negativo y respaldos incompletos sin alterar lo guardado', async () => {
  const original = await get();
  const invalid = structuredClone(original);
  invalid.state.productos[0].stock = -1;
  assert.equal((await put(invalid)).status, 400);
  assert.equal((await put({ state: {}, revision: original.revision })).status, 400);
  assert.deepEqual((await get()).state, original.state);
});

test('admite colecciones vacías omitidas por Firebase', async () => {
  const current = await get();
  delete current.state.facturas;
  delete current.state.compras;
  const response = await put(current);
  assert.equal(response.status, 200);
  const saved = await get();
  assert.deepEqual(saved.state.facturas, []);
  assert.deepEqual(saved.state.compras, []);
});

test('rechaza JSON roto, tipos de contenido ajenos y peticiones de otros sitios', async () => {
  const broken = await fetch(`${base}/api/state`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{',
  });
  assert.equal(broken.status, 400);
  assert.equal((await put(await get(), { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await put(await get(), { Origin: 'https://otro-sitio.example' })).status, 403);
});

test('no publica credenciales, SQL ni archivos del servidor', async () => {
  for (const path of ['/.env', '/.env.supabase', '/server.js', '/schema.sql', '/package.json']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/app.js')).status, 200);
});

test('responde con 413 si el respaldo supera 10 MB', async () => {
  const response = await fetch(`${base}/api/state`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: ' '.repeat(10 * 1024 * 1024 + 1),
  });
  assert.equal(response.status, 413);
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

test('una pestaña de otra ejecución no puede sobrescribir la base seleccionada', async () => {
  const original = await get();
  const fromPreviousServer = structuredClone(original);
  fromPreviousServer.sessionId = 'otra-ejecucion';
  fromPreviousServer.state.empresa = 'Datos de la otra base';
  assert.equal((await put(fromPreviousServer)).status, 409);
  assert.deepEqual((await get()).state, original.state);
});

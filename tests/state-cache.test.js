import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { migrateDatabase } from '../src/db/migrations.js';
import { hostingConfig } from '../src/hosting.js';
import { handleRequest } from '../src/http/app.js';
import { readSnapshot } from '../src/pos/store.js';
import { createApp } from '../src/server.js';
import { temporaryPostgres } from './postgres.js';

const compiledHtml = '<!doctype html><title>Compilación de prueba</title>';
const fontPath = 'assets/fonts/inter-latin-wght-normal.woff2';
const licensePath = 'assets/Inter-OFL.txt';
const label = 'Catálogo de prueba';
const publicOrigin = 'https://pos.example';
const password = 'clave-ficticia-para-pruebas';
const hosting = hostingConfig({ PUBLIC_ORIGIN: publicOrigin, APP_USERNAME: 'test', APP_PASSWORD: password });
const authorization = 'Basic ' + Buffer.from('test:' + password).toString('base64');
const statements = [];
let database, pool, server, origin, compiled, font, license;

const observedPool = {
  async connect() {
    const client = await pool.connect();
    return {
      query(sql, ...args) {
        statements.push(sql);
        return client.query(sql, ...args);
      },
      release: () => client.release(),
    };
  },
};

before(async () => {
  database = await temporaryPostgres();
  const admin = new pg.Pool({ connectionString: database.connectionString });
  try { await migrateDatabase(admin); } finally { await admin.end(); }
  pool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app' });

  compiled = await mkdtemp(join(tmpdir(), 'felix-state-cache-'));
  font = await readFile(new URL(import.meta.resolve('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')));
  license = await readFile(new URL(import.meta.resolve('@fontsource-variable/inter/LICENSE')));
  await mkdir(join(compiled, dirname(fontPath)), { recursive: true });
  await Promise.all([
    writeFile(join(compiled, 'index.html'), compiledHtml),
    writeFile(join(compiled, fontPath), font),
    writeFile(join(compiled, licensePath), license),
    writeFile(join(compiled, 'assets/fonts/privado.woff2'), font),
  ]);

  server = await createApp(observedPool, { assetsDirectory: pathToFileURL(compiled), databaseLabel: label });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(done => server.close(done));
  await pool?.end();
  await database?.stop();
  if (compiled) {
    const absolute = resolve(compiled);
    if (dirname(absolute) !== resolve(tmpdir()) || !absolute.startsWith(join(resolve(tmpdir()), 'felix-state-cache-'))) {
      throw new Error('Directorio temporal fuera de la ruta esperada');
    }
    await rm(absolute, { recursive: true, force: true });
  }
});

const getState = (etag) => fetch(origin + '/api/state', { headers: etag ? { 'If-None-Match': etag } : {} });
const write = (path, method, body, headers = {}) => fetch(origin + path, {
  method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID(), ...headers },
  body: JSON.stringify(body),
});

test('GET /api/state conserva el snapshot y valida el ETag con una sola consulta', async () => {
  const initial = await getState();
  const etag = initial.headers.get('etag');
  assert.equal(initial.status, 200);
  assert.match(etag ?? '', /^(?:W\/)?"[^"\s]+"$/);
  assert.deepEqual(await initial.json(), JSON.parse(JSON.stringify(await readSnapshot(pool, label))));

  const weakTag = etag.startsWith('W/') ? etag : `W/${etag}`;
  for (const condition of [etag, `"otro,tag", ${weakTag}`, '*']) {
    statements.length = 0;
    const matched = await getState(condition);
    assert.equal(matched.status, 304);
    assert.equal(matched.headers.get('etag'), etag);
    assert.equal(matched.headers.get('cache-control'), 'no-store');
    assert.equal(await matched.text(), '');
    assert.equal(statements.length, 1, statements.join('\n'));
    assert.match(statements[0], /^SELECT\s+database_id,\s*revision\s+FROM\s+pos_privado\.sistema\b/i);
  }
});

test('un BEGIN ejecutado antes del timeout no deja lecturas condicionales en una revisión obsoleta', async (t) => {
  const initial = await getState();
  const etag = initial.headers.get('etag');
  const previous = await initial.json();
  const reader = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app', max: 1 });
  t.after(() => reader.end());
  const timeout = new Error('Query read timeout');
  const timedOutPool = {
    async connect() {
      const client = await reader.connect();
      return {
        async query(sql, ...args) {
          const result = await client.query(sql, ...args);
          if (sql.startsWith('BEGIN')) throw timeout;
          return result;
        },
        release: (...args) => client.release(...args),
      };
    },
  };
  await assert.rejects(readSnapshot(timedOutPool, label), error => error === timeout);

  const conditionalRead = () => handleRequest(new Request(origin + '/api/state', { headers: { 'If-None-Match': etag } }), {
    pool: reader, databaseLabel: label,
  });
  assert.equal((await conditionalRead()).status, 304);
  const saved = await write('/api/clientes', 'POST', { databaseId: previous.databaseId, nombre: 'Cliente tras timeout' });
  assert.equal(saved.status, 200, await saved.clone().text());
  const confirmed = await saved.json();

  const latest = await conditionalRead();
  assert.equal(latest.status, 200);
  assert.notEqual(latest.headers.get('etag'), etag);
  const snapshot = await latest.json();
  assert.equal(snapshot.revision, confirmed.revision);
  assert.equal(snapshot.state.clientes.find(c => c.id === confirmed.result.id)?.nombre, 'Cliente tras timeout');
});

test('una edición de producto invalida el ETag sin aplicar caché a la escritura', async () => {
  const current = await (await getState()).json();
  const productData = { codigo: 'ETAG', nombre: 'Repuesto de prueba', stock: 1, costo: 10, precio1: 20, precio2: 20, precio3: 20 };
  const created = await write('/api/productos', 'POST', { databaseId: current.databaseId, ...productData });
  assert.equal(created.status, 200, await created.clone().text());
  const { result } = await created.json();
  const initial = await getState();
  const etag = initial.headers.get('etag');
  const previous = await initial.json();
  const product = previous.state.productos.find(row => row.id === result.id);
  const operationId = randomUUID();
  const path = `/api/productos/${product.id}`;
  const updated = await write(path, 'PUT', {
    databaseId: previous.databaseId, ...productData, version: product.version, nombre: 'Repuesto actualizado',
  }, { 'If-None-Match': etag, 'Idempotency-Key': operationId });
  assert.equal(updated.status, 200, await updated.clone().text());
  assert.equal(updated.headers.get('etag'), null);
  assert.equal(updated.headers.get('cache-control'), 'no-store');
  const { result: updatedResult, confirmation, ...confirmed } = await updated.json();
  assert.deepEqual(confirmation, { operationId, databaseId: previous.databaseId, method: 'PUT', path, replayed: false });
  assert.equal(updatedResult.id, product.id);

  statements.length = 0;
  const latest = await getState(etag);
  assert.equal(latest.status, 200);
  assert.ok(latest.headers.get('etag'));
  assert.notEqual(latest.headers.get('etag'), etag);
  assert.ok(statements.includes('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));
  assert.equal(statements.at(-1), 'COMMIT');
  const latestSnapshot = await latest.json();
  assert.deepEqual(latestSnapshot, confirmed);
  assert.equal(latestSnapshot.revision, previous.revision + 1);
  assert.equal(latestSnapshot.state.productos.find(row => row.id === product.id).nombre, 'Repuesto actualizado');
});

test('la etiqueta de base y una restauración invalidan los validadores anteriores', async () => {
  const initial = await getState();
  const etag = initial.headers.get('etag');
  const beforeRestore = await initial.json();

  const switchedLabel = 'Otra etiqueta de prueba';
  const relabeled = await handleRequest(new Request(publicOrigin + '/api/state', {
    headers: { Authorization: authorization, 'X-Forwarded-Proto': 'https', 'If-None-Match': etag },
  }), { pool: observedPool, hosting, databaseLabel: switchedLabel });
  assert.equal(relabeled.status, 200);
  assert.ok(relabeled.headers.get('etag'));
  assert.notEqual(relabeled.headers.get('etag'), etag);
  assert.deepEqual(await relabeled.json(), { ...beforeRestore, databaseLabel: switchedLabel });

  const backup = await (await fetch(origin + '/api/backup')).json();
  const restored = await write('/api/restore', 'POST', { databaseId: beforeRestore.databaseId, revision: beforeRestore.revision, backup });
  assert.equal(restored.status, 200, await restored.clone().text());
  await restored.arrayBuffer();
  const latest = await getState(etag);
  assert.equal(latest.status, 200);
  assert.ok(latest.headers.get('etag'));
  assert.notEqual(latest.headers.get('etag'), etag);
  const afterRestore = await latest.json();
  assert.notEqual(afterRestore.databaseId, beforeRestore.databaseId);
  assert.deepEqual(afterRestore.state, beforeRestore.state);
});

test('una lectura condicional valida acceso, host, HTTPS y origen antes de PostgreSQL', async () => {
  const options = { pool: observedPool, hosting };
  const headers = { Authorization: authorization, 'X-Forwarded-Proto': 'https', 'If-None-Match': '*' };
  for (const [url, changes, status] of [
    [publicOrigin, { Authorization: '' }, 401],
    ['https://ajeno.example', {}, 403],
    [publicOrigin, { 'X-Forwarded-Proto': 'http' }, 426],
    [publicOrigin, { Origin: 'https://ajeno.example' }, 403],
    [publicOrigin, { 'Sec-Fetch-Site': 'cross-site' }, 403],
  ]) {
    statements.length = 0;
    const response = await handleRequest(new Request(url + '/api/state', { headers: { ...headers, ...changes } }), options);
    assert.equal(response.status, status);
    assert.equal(response.headers.get('etag'), null);
    assert.deepEqual(statements, []);
  }
});

test('las rutas de Polymet sirven el HTML compilado con la misma protección que la raíz', async () => {
  const { routes } = JSON.parse(await readFile(new URL('../docs/design/polymet-reference.json', import.meta.url), 'utf8'));
  routes.push({ path: '/index.html' });
  for (const { path } of routes) {
    const protectedPage = await handleRequest(new Request(publicOrigin + path, {
      headers: { 'X-Forwarded-Proto': 'https' },
    }), { hosting, readAsset: () => assert.fail('No debe leer el HTML sin autenticación') });
    assert.equal(protectedPage.status, 401, path);
    assert.match(protectedPage.headers.get('www-authenticate'), /Basic/);

    const page = await fetch(origin + path);
    assert.equal(page.status, 200, path);
    assert.match(page.headers.get('content-type'), /^text\/html\b/);
    assert.ok((await page.text()) === compiledHtml, path);
  }
});

test('la lista cerrada entrega Inter y su licencia sin servir rutas privadas o desconocidas', async () => {
  const response = await fetch(`${origin}/${fontPath}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'font/woff2');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), font);
  const head = await fetch(`${origin}/${fontPath}`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'font/woff2');
  assert.equal(await head.text(), '');
  const ofl = await fetch(`${origin}/${licensePath}`);
  assert.equal(ofl.status, 200);
  assert.equal(ofl.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.deepEqual(Buffer.from(await ofl.arrayBuffer()), license);
  for (const path of ['/.env', '/src/server.js', '/ruta-desconocida', '/assets/fonts/privado.woff2']) {
    const hidden = await fetch(origin + path);
    assert.equal(hidden.status, 404, path);
    await hidden.arrayBuffer();
  }
});

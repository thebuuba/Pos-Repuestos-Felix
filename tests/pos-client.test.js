import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { acknowledged } from './pos-response-fixture.js';
import { chromium } from 'playwright-core';
import pg from 'pg';
import { migrateDatabase } from '../src/db/migrations.js';
import { createApp } from '../src/server.js';
import { temporaryPostgres } from './postgres.js';
import { buildOperational } from '../scripts/build-operational.mjs';

let database, pool, server, origin, browser, script, assets;

before(async () => {
  const bundle = await build({
    entryPoints: ['frontend/src/data/pos-client.js'], bundle: true, write: false,
    format: 'iife', globalName: 'clientModule',
  });
  script = bundle.outputFiles[0].text;
  database = await temporaryPostgres();
  const admin = new pg.Pool({ connectionString: database.connectionString });
  try { await migrateDatabase(admin); } finally { await admin.end(); }
  pool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app' });
  assets = await mkdtemp(path.join(tmpdir(), 'felix-pos-client-'));
  await buildOperational(assets);
  server = await createApp(pool, { assetsDirectory: pathToFileURL(assets + path.sep) });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise(done => server.close(done));
  await pool?.end();
  await database?.stop();
  if (assets) {
    assert.equal(path.dirname(path.resolve(assets)), path.resolve(tmpdir()));
    assert.ok(path.basename(assets).startsWith('felix-pos-client-'));
    await rm(assets, { recursive: true, force: true });
  }
});

async function open(context) {
  const page = await context.newPage();
  await page.route(origin + '/fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
  await page.goto(origin + '/fixture');
  await initialize(page);
  return page;
}
async function initialize(page) {
  await page.addScriptTag({ content: script });
  await page.evaluate(async () => {
    window.client = clientModule.createPosClient();
    await client.reload();
  });
}
async function tab(t) {
  const context = await browser.newContext();
  t.after(() => context.close());
  return open(context);
}
function createProduct(page, code) {
  return page.evaluate(codigo => client.writeOperation({
    method: 'POST', path: '/api/productos', databaseId: client.getState().snapshot.databaseId,
    payload: { codigo, nombre: codigo, costo: 1, precio1: 2, precio2: 0, precio3: 0, stock: 4 },
  }), code);
}
for (const initialWeak of [false, true]) test(`conditional refresh accepts the same opaque ETag when its weak marker ${initialWeak ? 'is removed' : 'is added'}`, async t => {
  const context = await browser.newContext();
  t.after(() => context.close());
  await context.route(origin + '/api/state', async route => {
    const condition = route.request().headers()['if-none-match'];
    if (!condition) {
      const response = await route.fetch();
      const headers = response.headers();
      if (initialWeak) headers.etag = 'W/' + headers.etag;
      return route.fulfill({ response, headers });
    }
    const tag = initialWeak ? condition.replace(/^W\//, '') : 'W/' + condition;
    return route.fulfill({ status: 304, headers: { ETag: tag, 'Cache-Control': 'no-store' } });
  });
  const page = await open(context);
  const unchanged = await page.evaluate(async () => {
    const previous = client.getState().snapshot;
    await client.reload();
    return client.getState().snapshot === previous && client.getState().connection === 'connected';
  });
  assert.equal(unchanged, true);
});

test('a committed packet survives restart and subsequent 401, and replays with one inventory movement', async t => {
  const page = await tab(t);
  const packets = [];
  await page.route('**/api/productos', async route => {
    const request = route.request();
    packets.push({ body: request.postData(), id: request.headers()['idempotency-key'] });
    if (packets.length === 1) {
      assert.equal((await route.fetch()).status(), 200);
      return route.abort();
    }
    if (packets.length === 2) return route.fulfill({ status: 401, json: { error: 'Inicia sesión' } });
    if (packets.length === 3) return route.fulfill({ status: 403, json: { error: 'Origen no permitido.' } });
    if (packets.length === 4) return route.fulfill({ status: 409, json: { error: 'Otra caja está usando estos datos. Reintenta la misma operación.' } });
    return route.continue();
  });
  await assert.rejects(createProduct(page, 'DURABLE'));
  await page.reload();
  await initialize(page);
  assert.equal(packets.length, 1);
  assert.equal(await page.evaluate(() => client.getState().pending.id), packets[0].id);
  await assert.rejects(page.evaluate(() => client.retryPending()), /Inicia sesión/);
  assert.equal(await page.evaluate(() => client.getState().pending.id), packets[0].id);
  await assert.rejects(page.evaluate(() => client.retryPending()), /Origen no permitido/);
  await assert.rejects(page.evaluate(() => client.retryPending()), /Otra caja/);
  assert.equal(await page.evaluate(() => client.getState().pending.id), packets[0].id);
  await page.evaluate(() => client.retryPending());
  assert.deepEqual(packets, Array(5).fill(packets[0]));
  assert.equal(await page.evaluate(() => client.getState().pending), null);
  const rows = await pool.query("SELECT id FROM productos WHERE codigo='DURABLE'");
  assert.equal(rows.rowCount, 1);
  assert.equal((await pool.query('SELECT id FROM movimientos_inventario WHERE producto_id=$1', [rows.rows[0].id])).rowCount, 1);
});

test('an open form replays its own packet after another tab recovers and renames the product', { timeout: 40_000 }, async t => {
  const other = await tab(t);
  const page = await other.context().newPage();
  const packets = [];
  let failOther = true;
  await page.context().route('**/api/productos', async route => {
    const request = route.request();
    if (request.postDataJSON().codigo === 'OTRO-PENDIENTE' && failOther) {
      failOther = false;
      return route.abort();
    }
    if (request.postDataJSON().codigo !== 'BORRADOR-FIJO') return route.continue();
    packets.push({ body: request.postData(), id: request.headers()['idempotency-key'] });
    if (packets.length === 1) {
      assert.equal((await route.fetch()).status(), 200);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(origin + '/inventario');
  await page.getByRole('button', { name: 'Nuevo artículo' }).click();
  const form = page.getByRole('dialog');
  await form.getByLabel('Código', { exact: true }).fill('BORRADOR-FIJO');
  await form.getByLabel('Descripción', { exact: true }).fill('Producto confirmado en dos pestañas');
  await form.getByLabel('Costo base RD$', { exact: true }).fill('2');
  await form.getByLabel('Precio 1 · Detalle', { exact: true }).fill('3');
  await form.getByLabel('Existencia', { exact: true }).fill('4');
  await form.getByRole('button', { name: 'Guardar artículo' }).click();
  const retry = form.getByRole('button', { name: 'Reintentar guardado' });
  await retry.waitFor();
  const id = await other.evaluate(async () => {
    const saved = await client.retryPending();
    const p = saved.state.productos.find(product => product.id === saved.result.id);
    await client.writeOperation({ method: 'PUT', path: '/api/productos/' + p.id, databaseId: saved.databaseId,
      payload: { codigo: 'CODIGO-CAMBIADO', nombre: p.nombre, costo: p.costo, precio1: p.precio1, precio2: p.precio2, precio3: p.precio3, stock: p.stock, version: p.version },
    });
    return p.id;
  });
  assert.deepEqual(packets, [packets[0], packets[0]]);
  await assert.rejects(createProduct(other, 'OTRO-PENDIENTE'));
  const foreignPacket = await other.evaluate(() => client.getState().pending);
  await retry.click();
  await form.getByRole('alert').filter({ hasText: /pendiente/i }).waitFor();
  await other.evaluate(() => client.reload());
  assert.deepEqual(await other.evaluate(() => client.getState().pending), foreignPacket);
  assert.equal(packets.length, 2);
  await other.evaluate(() => client.retryPending());
  await retry.click();
  await form.waitFor({ state: 'hidden' });
  assert.deepEqual(packets, [packets[0], packets[0], packets[0]]);
  const rows = await pool.query("SELECT codigo FROM productos WHERE codigo IN ('BORRADOR-FIJO', 'CODIGO-CAMBIADO')");
  assert.deepEqual(rows.rows, [{ codigo: 'CODIGO-CAMBIADO' }]);
  assert.equal((await pool.query('SELECT id FROM movimientos_inventario WHERE producto_id=$1', [id])).rowCount, 1);
});

test('a second tab releases a retried packet when the service confirms the same catalog rejection', { timeout: 30_000 }, async t => {
  const first = await tab(t);
  const second = await open(first.context());
  await createProduct(first, 'SKU-OCUPADO');
  const arriving = Promise.withResolvers();
  const proceed = Promise.withResolvers();
  const keys = [];
  await first.context().route('**/api/productos', async route => {
    if (route.request().postDataJSON().codigo === 'SKU-OCUPADO') {
      keys.push(route.request().headers()['idempotency-key']);
      if (keys.length === 1) {
        arriving.resolve();
        await proceed.promise;
      }
    }
    await route.continue();
  });
  async function tryDuplicate(page) {
    return page.evaluate(async () => {
      try {
        await client.writeOperation({
          method: 'POST', path: '/api/productos', databaseId: client.getState().snapshot.databaseId,
          payload: { codigo: 'SKU-OCUPADO', nombre: 'Borrador', stock: 2, costo: 1, precio1: 2, precio2: 1, precio3: 1 },
        });
      } catch (error) {
        window.replay = error.retry;
        return { uncertain: error.uncertain, message: error.message };
      }
    });
  }
  const sending = tryDuplicate(first);
  await arriving.promise;
  try {
    assert.equal((await tryDuplicate(second)).uncertain, true);
  } finally { proceed.resolve(); }
  assert.match((await sending).message, /Ya existe/);
  const rejection = await second.evaluate(async () => {
    try { await window.replay(); }
    catch (error) {
      return { definitive: error.definitive, uncertain: !!error.uncertain, pending: client.getState().pending, message: error.message };
    }
  });
  assert.match(rejection.message, /Ya existe/);
  assert.equal(rejection.uncertain, false);
  assert.equal(rejection.definitive, true);
  assert.equal(rejection.pending, null);
  assert.deepEqual(keys, [keys[0], keys[0]]);
  await createProduct(second, 'OTRO-DESPUES-DEL-RECHAZO');
  const rows = await pool.query("SELECT codigo FROM productos WHERE codigo IN ('SKU-OCUPADO','OTRO-DESPUES-DEL-RECHAZO') ORDER BY codigo");
  assert.deepEqual(rows.rows.map(row => row.codigo), ['OTRO-DESPUES-DEL-RECHAZO', 'SKU-OCUPADO']);
});

test('a lost validation response can release the exact restarted packet after a verified rejection', async t => {
  const page = await tab(t);
  const requests = [];
  const replies = [];
  const initial = await page.evaluate(() => client.getState().snapshot);
  await page.route('**/api/productos', async route => {
    const request = route.request();
    requests.push({ operationId: request.headers()['idempotency-key'], method: request.method(), path: new URL(request.url()).pathname, body: request.postData() });
    const response = await route.fetch();
    replies.push({ status: response.status(), body: await response.json() });
    return replies.length === 1 ? route.abort() : route.fulfill({ response });
  });
  await assert.rejects(page.evaluate(() => client.writeOperation({ method: 'POST', path: '/api/productos', databaseId: client.getState().snapshot.databaseId,
    payload: { codigo: 'VALIDACION', nombre: 'x'.repeat(2001), costo: 0, precio1: 0, precio2: 0, precio3: 0, stock: 0 } })));
  await page.reload();
  await initialize(page);
  const proof = await page.evaluate(async () => {
    try { await client.retryPending(); } catch (error) { return { definitive: !!error.definitive, message: error.message }; }
  });
  assert.deepEqual(requests, [requests[0], requests[0]]);
  const { body, ...request } = requests[0];
  for (const reply of replies) {
    assert.equal(reply.status, 400);
    assert.deepEqual(reply.body.rejection, { ...request, databaseId: initial.databaseId });
  }
  assert.deepEqual(proof, { definitive: true, message: replies[0].body.error });
  const after = await page.evaluate(() => client.getState());
  assert.equal(after.pending, null);
  assert.deepEqual(after.snapshot, initial);
  assert.equal((await pool.query("SELECT id FROM productos WHERE codigo='VALIDACION'")).rowCount, 0);
  await createProduct(page, 'VALIDACION');
  assert.equal(replies[2].status, 200);
  assert.equal(Object.hasOwn(replies[2].body, 'rejection'), false);
  assert.notEqual(requests[0].operationId, requests[2].operationId);
});

test('unverified business rejections preserve the original packet across repeated attempts', async t => {
  const page = await tab(t);
  const first = await page.evaluate(() => client.getState().snapshot);
  const invalid = [null, {}, { operationId: randomUUID() }, { databaseId: randomUUID() }, { method: 'DELETE' }, { path: '/api/productos/7' }];
  let count = 0;
  let mode = 'normal';
  const nextGeneration = randomUUID();
  await page.route('**/api/state', route => {
    if (mode === 'unreadable') return route.fulfill({ status: 503 });
    if (mode === 'wrongTag') return route.fulfill({ status: 304, headers: { ETag: '"otra-generacion"' } });
    return route.fulfill({ headers: { ETag: '"catalogo"' }, json: { ...first, databaseId: mode === 'restore' ? nextGeneration : first.databaseId } });
  });
  await page.route('**/api/productos', route => {
    const request = route.request();
    const proof = { operationId: request.headers()['idempotency-key'], databaseId: first.databaseId, method: 'POST', path: '/api/productos' };
    const n = count++;
    const rejection = n < 2 ? invalid[n] : { ...proof, ...invalid[n] };
    return route.fulfill({ status: n % 2 ? 400 : 409, json: { error: 'El producto cambió. Actualiza los datos antes de editar.', rejection } });
  });
  await assert.rejects(createProduct(page, 'PRUEBA-SIN-ACREDITAR'));
  const pending = await page.evaluate(() => client.getState().pending);
  assert.ok(pending);
  for (let i = 1; i < invalid.length + 3; i++) {
    if (i === invalid.length) mode = 'unreadable';
    if (i === invalid.length + 1) mode = 'wrongTag';
    if (i === invalid.length + 2) mode = 'restore';
    assert.equal(await page.evaluate(async () => {
      try { await client.retryPending(); } catch (error) { return error.uncertain === true && !error.definitive; }
    }), true);
    assert.deepEqual(await page.evaluate(() => client.getState().pending), pending);
  }
  assert.equal(await page.evaluate(() => client.getState().snapshot.databaseId), nextGeneration);
});

test('GET and write acknowledgements reject impossible products without changing the snapshot or journal', async t => {
  const page = await tab(t);
  const initial = await page.evaluate(() => client.getState().snapshot);
  const product = { id: 71, version: 1, codigo: 'DOMINIO', nombre: 'Artículo', marca: '', categoria: '', ubicacion: '',
    stock: 0, stockMinimo: 0, costo: 0, precio1: 999999999999.99, precio2: 0, precio3: 0, gravado: false, activo: true };
  const ack = { ...initial, revision: initial.revision + 1, state: { ...initial.state, productos: [product] }, result: { id: product.id } };
  await page.route('**/api/state', route => route.fulfill({ json: ack }));
  await page.route('**/api/productos', route => route.fulfill({ json: acknowledged(route, ack, product.id) }));
  const variants = [{ stock: 1.501 }, { stockMinimo: -1 }, { stock: 2147483648 }, { costo: -5.001 }, { precio1: 1.005 }, { precio2: 1e12 },
    { precio3: '0.20' }, { id: 0 }, { version: -1 }, { nombre: ' ' }, { codigo: '' }, { marca: 'x'.repeat(2001) },
    { categoria: 'x'.repeat(2001) }, { ubicacion: 'x'.repeat(2001) }, { gravado: 'false' }, { activo: 1 },
    { stock_minimo: -1 }, { stock_minimo: 1 }, { costoExacto: '0.00000' }, { costoExacto: '12.3456' }, { notificarMinimo: 'false' }];
  let pending;
  for (const products of [...variants.map(fields => [{ ...product, ...fields }]), [product, { ...product, codigo: 'OTRO' }],
    [product, { ...product, id: 72 }]]) {
    ack.state.productos = products;
    await assert.rejects(page.evaluate(() => client.reload()), /catálogo no válidos/);
    const write = pending ? page.evaluate(() => client.retryPending()) : createProduct(page, 'DOMINIO');
    await assert.rejects(write, /catálogo no válidos/);
    const current = await page.evaluate(() => client.getState());
    assert.deepEqual(current.snapshot, initial);
    assert.ok(current.pending);
    pending ??= current.pending;
    assert.deepEqual(current.pending, pending);
  }
  const fractional = { ...product, id: 72, codigo: 'dominio', stock: 1.25, stockMinimo: 0.5, costo: 12.3456,
    costoExacto: '12.3456', notificarMinimo: false };
  ack.state.productos = [product, fractional];
  await page.evaluate(() => client.retryPending());
  const confirmed = await page.evaluate(() => client.getState());
  assert.equal(confirmed.pending, null);
  assert.deepEqual(confirmed.snapshot.state.productos, [product, fractional]);
});

test('aborting IndexedDB after a successful sending put prevents the write request', async t => {
  const page = await tab(t);
  let requests = 0;
  await page.route('**/api/productos', route => { requests++; return route.abort(); });
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(record, ...args) {
      const req = put.call(this, record, ...args);
      if (record.status === 'sending') req.addEventListener('success', () => this.transaction.abort());
      return req;
    };
  });
  await assert.rejects(createProduct(page, 'ABORT'));
  assert.equal(requests, 0);
});

test('two tabs arbitrate different packets before fetch and an invalid 200 keeps the winner', async t => {
  const page = await tab(t);
  const other = await open(page.context());
  let requests = 0;
  await page.context().route('**/api/productos', route => {
    requests++;
    return route.fulfill({ json: { result: { id: 1 } } });
  });
  const results = await Promise.allSettled([createProduct(page, 'TAB-A'), createProduct(other, 'TAB-B')]);
  assert.ok(results.every(result => result.status === 'rejected'));
  assert.equal(requests, 1);
  await Promise.all([page, other].map(tab => tab.evaluate(() => client.reload())));
  const ids = await Promise.all([page, other].map(tab => tab.evaluate(() => client.getState().pending.id)));
  assert.equal(ids[0], ids[1]);
});

test('a conditional refresh preserves snapshot identity and a stale edit fails without consuming the draft', async t => {
  const page = await tab(t);
  const unchanged = page.waitForResponse(resp => resp.url().endsWith('/api/state'));
  assert.equal(await page.evaluate(async () => {
    const previous = client.getState().snapshot;
    await client.reload();
    return previous === client.getState().snapshot;
  }), true);
  assert.equal((await unchanged).status(), 304);
  const result = await createProduct(page, 'VERSION');
  const { databaseId } = result;
  const product = result.state.productos.find(p => p.codigo === 'VERSION');
  const draft = { ...product, nombre: 'Mi borrador' };
  const response = await fetch(origin + '/api/productos/' + product.id, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ ...product, databaseId, nombre: 'Otro cambio' }),
  });
  assert.equal(response.status, 200);
  const message = await page.evaluate(async ({ draft, databaseId }) => {
    const { codigo, nombre, costo, precio1, precio2, precio3, stock, version } = draft;
    window.draft = { codigo, nombre, costo, precio1, precio2, precio3, stock, version };
    try {
      await client.writeOperation({ method: 'PUT', path: '/api/productos/' + draft.id, payload: window.draft, databaseId });
    } catch (error) { return error.message; }
  }, { draft, databaseId });
  assert.match(message, /El producto cambió/);
  assert.equal(await page.evaluate(() => window.draft.nombre), 'Mi borrador');
  assert.equal(await page.evaluate(() => client.getState().pending), null);
});

for (const method of ['PUT', 'DELETE']) {
  test(method + ' keeps the original packet when the 200 confirms a different product', async t => {
    const page = await tab(t);
    const snapshot = await page.evaluate(() => client.getState().snapshot);
    let packet;
    await page.route('**/api/productos/7', async route => {
      const request = route.request();
      packet = { id: request.headers()['idempotency-key'], body: request.postData() };
      await route.fulfill({ json: acknowledged(route, { ...snapshot, revision: snapshot.revision + 1 }, 8) });
    });
    const uncertain = await page.evaluate(async method => {
      try {
        await client.writeOperation({ method, path: '/api/productos/7', payload: { version: 1 }, databaseId: client.getState().snapshot.databaseId });
        return false;
      } catch (error) { return error.uncertain; }
    }, method);
    assert.equal(uncertain, true);
    const state = await page.evaluate(() => client.getState());
    assert.equal(state.snapshot.revision, snapshot.revision);
    assert.equal(state.pending.id, packet.id);
    assert.equal(state.pending.body, packet.body);
  });
}

test('an unreadable first 409 preserves the packet and checks the generation after the rejection', { timeout: 20_000 }, async t => {
  const page = await tab(t);
  const snapshot = await page.evaluate(() => client.getState().snapshot);
  const newGeneration = randomUUID();
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  let reads = 0;
  await page.route('**/api/state', async route => {
    if (++reads === 1) {
      started.resolve();
      await release.promise;
      return route.fulfill({ status: 304, headers: { ETag: route.request().headers()['if-none-match'] } });
    }
    return route.fulfill({ json: { ...snapshot, databaseId: newGeneration } });
  });
  await page.route('**/api/productos', route => route.fulfill({ status: 409, body: 'incompleto' }));
  const earlier = page.evaluate(() => client.reload());
  await started.promise;
  try {
    const uncertain = await page.evaluate(async () => {
      try {
        await client.writeOperation({ method: 'POST', path: '/api/productos', payload: { codigo: 'CONFLICTO' }, databaseId: client.getState().snapshot.databaseId });
      } catch (error) { return error.uncertain; }
    });
    assert.equal(uncertain, true);
    const state = await page.evaluate(() => client.getState());
    assert.equal(state.snapshot.databaseId, newGeneration);
    assert.equal(state.pending.databaseId, snapshot.databaseId);
  } finally {
    release.resolve();
    await earlier;
  }
  assert.equal(reads, 2);
});

test('reloads never regress in revision or resurrect a retired generation', async t => {
  const page = await tab(t);
  const observed = await page.evaluate(async () => {
    const original = client.getState().snapshot;
    const next = { ...original, databaseId: crypto.randomUUID(), revision: 1 };
    const queue = [];
    window.fetch = () => new Promise(resolve => queue.push(value => resolve(Response.json(value))));
    async function start() {
      // Conflict verification can supersede a regular read in flight.
      const job = client.reload({ fresh: true });
      while (!queue.length) await new Promise(done => setTimeout(done, 0));
      return { job, answer: queue.shift() };
    }
    const older = await start();
    const newer = await start();
    newer.answer({ ...original, revision: original.revision + 10 });
    await newer.job;
    older.answer(original);
    await older.job;
    const monotone = client.getState().snapshot.revision === original.revision + 10;
    const early = await start();
    const later = await start();
    later.answer({ ...original, revision: original.revision + 11 });
    await later.job;
    early.answer({ ...original, databaseId: crypto.randomUUID() });
    await early.job;
    const staleUnknown = client.getState().snapshot.databaseId === original.databaseId;
    const a = await start();
    const b = await start();
    b.answer(next);
    await b.job;
    a.answer(original);
    await a.job;
    return { monotone, staleUnknown, newGeneration: client.getState().snapshot.databaseId === next.databaseId };
  });
  assert.deepEqual(observed, { monotone: true, staleUnknown: true, newGeneration: true });
});

test('a restore blocks an old committed response and its replay without rewriting the packet', { timeout: 30_000 }, async t => {
  const page = await tab(t);
  let requests = 0;
  const committed = Promise.withResolvers();
  const release = Promise.withResolvers();
  await page.route('**/api/productos', async route => {
    requests++;
    const response = await route.fetch();
    committed.resolve(response.status());
    await release.promise;
    await route.fulfill({ response });
  });
  const writing = assert.rejects(createProduct(page, 'OLD'), /base/i);
  assert.equal(await committed.promise, 200);
  const pending = await page.evaluate(() => client.getState().pending);
  const backup = await (await fetch(origin + '/api/backup')).json();
  const state = await (await fetch(origin + '/api/state')).json();
  const restored = await fetch(origin + '/api/restore', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ databaseId: state.databaseId, revision: state.revision, backup }) });
  assert.equal(restored.status, 200);
  await page.evaluate(() => client.reload());
  release.resolve();
  await writing;
  assert.equal(await page.evaluate(() => client.getState().snapshot.databaseId), (await restored.json()).databaseId);
  await assert.rejects(page.evaluate(() => client.retryPending()), /base/i);
  assert.equal(requests, 1);
  assert.deepEqual(await page.evaluate(() => client.getState().pending), pending);
});

test('a contact creation committed before disconnection is replayed once across tabs on the disposable database', async t => {
  const first = await tab(t);
  const packets = [];
  await first.context().route('**/api/clientes', async route => {
    const request = route.request();
    packets.push({ key: request.headers()['idempotency-key'], body: request.postData() });
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    return packets.length === 1 ? route.abort() : route.fulfill({ response });
  });
  await assert.rejects(first.evaluate(async () => {
    try {
      await client.writeOperation({ method: 'POST', path: '/api/clientes', databaseId: client.getState().snapshot.databaseId,
        payload: { nombre: 'Alta durable de prueba', correo: 'durable@ejemplo.test', limiteCredito: null } });
    } catch (error) { window.retryOriginal = error.retry; throw error; }
  }));
  const second = await open(first.context());
  const replay = await second.evaluate(() => client.retryPending());
  assert.deepEqual(packets, [packets[0], packets[0]]);
  const matches = replay.state.clientes.filter(c => c.nombre === 'Alta durable de prueba');
  assert.equal(matches.length, 1);
  assert.deepEqual(matches[0], { id: replay.result.id, version: 1, nombre: 'Alta durable de prueba',
    correo: 'durable@ejemplo.test', rnc: '', tel: '', direccion: '', esContado: false, limiteCredito: null, deuda: 0 });
  const [after] = (await pool.query('SELECT count(*)::int AS count FROM clientes WHERE nombre=$1', [matches[0].nombre])).rows;
  assert.equal(after.count, 1);
  await first.waitForFunction(() => client.getState().pending === null);
  await second.evaluate(({ databaseId, id, version }) => client.writeOperation({ method: 'DELETE',
    path: '/api/clientes/' + id, databaseId, payload: { version } }), { databaseId: replay.databaseId, ...matches[0] });
  const observed = await first.evaluate(() => client.reload());
  const recovered = await first.evaluate(() => retryOriginal());
  assert.equal(recovered.confirmation.replayed, true);
  assert.equal(recovered.revision, observed.revision);
  assert.equal(recovered.state.clientes.some(c => c.id === matches[0].id), false);
  assert.deepEqual(packets, Array(3).fill(packets[0]));
});

test('a legacy journal entry without a base revision recovers a committed write at the already observed revision', async t => {
  const page = await tab(t);
  const packets = [];
  await page.route('**/api/productos', async route => {
    const req = route.request();
    packets.push({ id: req.headers()['idempotency-key'], body: req.postData() });
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    return packets.length === 1 ? route.abort() : route.fulfill({ response });
  });
  await assert.rejects(createProduct(page, 'LEGACY-DIARIO'));
  const oldPacket = await page.evaluate(async () => {
    const { baseRevision, ...legacy } = client.getState().pending;
    const db = await new Promise(resolve => { const open = indexedDB.open('repuestos-felix-operaciones', 1); open.onsuccess = () => resolve(open.result); });
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('operaciones', 'readwrite');
        transaction.oncomplete = resolve;
        transaction.onabort = reject;
        transaction.objectStore('operaciones').put(legacy, 'pendiente');
      });
    } finally { db.close(); }
    return legacy;
  });
  await page.reload();
  await initialize(page);
  const before = await page.evaluate(() => client.getState());
  assert.deepEqual(before.pending, oldPacket);
  const confirmed = await page.evaluate(() => client.retryPending());
  assert.equal(confirmed.revision, before.snapshot.revision);
  assert.equal(confirmed.confirmation.replayed, true);
  assert.deepEqual(packets, [packets[0], packets[0]]);
  assert.equal(await page.evaluate(() => client.getState().pending), null);
  assert.equal((await pool.query("SELECT id FROM productos WHERE codigo='LEGACY-DIARIO'")).rowCount, 1);
});

for (const method of ['PUT', 'DELETE']) {
  test(method + ' retains inventory work if the bound new-write confirmation still contains the original active row', async t => {
    const page = await tab(t);
    const saved = await createProduct(page, 'CONFIRMACION-' + method);
    const product = saved.state.productos.find(p => p.id === saved.result.id);
    const path = '/api/productos/' + product.id;
    await page.route('**' + path, route => route.fulfill({
      json: acknowledged(route, { ...saved, revision: saved.revision + 1 }, product.id),
    }));
    const payload = method === 'DELETE' ? { version: product.version } : {
      codigo: product.codigo, nombre: 'Descripción nueva', costo: product.costo, stock: product.stock,
      precio1: product.precio1, precio2: product.precio2, precio3: product.precio3, version: product.version,
    };
    await assert.rejects(page.evaluate(op => client.writeOperation(op), { method, path, databaseId: saved.databaseId, payload }));
    const state = await page.evaluate(() => client.getState());
    assert.equal(state.pending.baseRevision, saved.revision);
    assert.deepEqual(state.snapshot, saved);
  });
}

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import pg from 'pg';
import { migrateDatabase } from '../src/db/migrations.js';
import { createApp } from '../src/server.js';
import { temporaryPostgres } from './postgres.js';

let database, pool, server, origin, browser, script;

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
  server = await createApp(pool);
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise(done => server.close(done));
  await pool?.end();
  await database?.stop();
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
    return route.continue();
  });
  await assert.rejects(createProduct(page, 'DURABLE'));
  await page.reload();
  await initialize(page);
  assert.equal(packets.length, 1);
  assert.equal(await page.evaluate(() => client.getState().pending.id), packets[0].id);
  await assert.rejects(page.evaluate(() => client.retryPending()), /Inicia sesión/);
  assert.equal(await page.evaluate(() => client.getState().pending.id), packets[0].id);
  await page.evaluate(() => client.retryPending());
  assert.deepEqual(packets, [packets[0], packets[0], packets[0]]);
  assert.equal(await page.evaluate(() => client.getState().pending), null);
  const rows = await pool.query("SELECT id FROM productos WHERE codigo='DURABLE'");
  assert.equal(rows.rowCount, 1);
  assert.equal((await pool.query('SELECT id FROM movimientos_inventario WHERE producto_id=$1', [rows.rows[0].id])).rowCount, 1);
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
      await route.fulfill({ json: { ...snapshot, revision: snapshot.revision + 1, result: { id: 8 } } });
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
      return route.fulfill({ status: 304 });
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

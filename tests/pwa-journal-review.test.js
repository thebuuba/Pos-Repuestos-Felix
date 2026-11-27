import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import pg from 'pg';
import { migrateDatabase } from '../src/db/migrations.js';
import { createApp } from '../src/server.js';
import { temporaryPostgres } from './postgres.js';
import { buildOperational } from '../scripts/build-operational.mjs';
import { openTestCash } from './fixtures/cash.js';

let database, pool, server, browser, assets, origin, script;
before(async () => {
  script = (await build({ entryPoints: ['frontend/src/data/pos-client.js'], bundle: true, write: false,
    format: 'iife', globalName: 'clientModule' })).outputFiles[0].text;
  database = await temporaryPostgres();
  const admin = new pg.Pool({ connectionString: database.connectionString });
  try { await migrateDatabase(admin); } finally { await admin.end(); }
  pool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app' });
  await openTestCash(pool);
  assets = await mkdtemp(path.join(tmpdir(), 'felix-journal-review-'));
  await buildOperational(assets);
  server = await createApp(pool, { assetsDirectory: pathToFileURL(assets + path.sep) });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  origin = 'http://127.0.0.1:' + server.address().port;
  const snapshot = await (await fetch(origin + '/api/state')).json();
  const product = await fetch(origin + '/api/productos', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ databaseId: snapshot.databaseId, codigo: 'BG-1', nombre: 'Artículo de prueba',
      costo: 1, precio1: 10, precio2: 9, precio3: 8, stock: 100, gravado: false }) });
  assert.equal(product.status, 200);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise(done => server.close(done));
  await pool?.end();
  await database?.stop();
  if (assets) {
    assert.equal(path.dirname(path.resolve(assets)), path.resolve(tmpdir()));
    assert.ok(path.basename(assets).startsWith('felix-journal-review-'));
    await rm(assets, { recursive: true, force: true });
  }
});

async function initialize(page) {
  await page.addScriptTag({ content: script });
  await page.evaluate(async () => { window.client = clientModule.createPosClient(); await client.reload(); });
}
async function open(context) {
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  await page.route(origin + '/fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
  await page.goto(origin + '/fixture');
  await initialize(page);
  return page;
}
async function tab(t) {
  const context = await browser.newContext();
  t.after(() => context.close());
  return open(context);
}
function writeProduct(page, codigo = randomUUID()) {
  return page.evaluate(codigo => client.writeOperation({ method: 'POST', path: '/api/productos',
    databaseId: client.getState().snapshot.databaseId,
    payload: { codigo, nombre: codigo, costo: 1, precio1: 2, precio2: 0, precio3: 0, stock: 4 },
  }), codigo);
}

for (const status of [503, 401]) test(`an older background ${status} cannot invalidate a newer confirmed write`, async t => {
  const page = await tab(t);
  const arrived = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve());
  await page.route('**/api/state', async route => {
    arrived.resolve();
    await release.promise;
    return route.fulfill({ status, json: { error: 'Lectura anterior fallida.' } });
  });
  const reading = page.evaluate(() => client.reload({ background: true }).catch(error => error.message));
  await arrived.promise;
  const saved = await writeProduct(page);
  release.resolve();
  await reading;
  const state = await page.evaluate(() => client.getState());
  assert.equal(state.error, null);
  assert.equal(state.authenticationRequired, false);
  assert.equal(state.connection, 'connected');
  assert.deepEqual(state.snapshot, saved);
});

test('a confirmed read preserves a meaningful unresolved write error', async t => {
  const page = await tab(t);
  await page.route('**/api/productos', route => route.fulfill({ status: 503, json: { error: 'Guardado sin confirmar.' } }));
  await assert.rejects(writeProduct(page), /Guardado sin confirmar/);
  await page.evaluate(() => client.reload({ background: true }));
  assert.equal(await page.evaluate(() => client.getState().error), 'Guardado sin confirmar.');
  assert.ok(await page.evaluate(() => client.getState().pending));
});

test('an older write 401 retains its uncertain packet without clearing a newer confirmed session', async t => {
  const page = await tab(t);
  const arrived = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve());
  await page.route('**/api/productos', async route => {
    arrived.resolve(); await release.promise;
    return route.fulfill({ status: 401, json: { error: 'Guardado sin sesión confirmada.' } });
  });
  const writing = writeProduct(page).then(() => null, error => error.message);
  await arrived.promise;
  const snapshot = await page.evaluate(() => client.reload({ background: true }));
  release.resolve();
  assert.match(await writing, /Guardado sin sesión/);
  const state = await page.evaluate(() => client.getState());
  assert.equal(state.authenticationRequired, false);
  assert.deepEqual(state.snapshot, snapshot);
  assert.ok(state.pending);
  assert.equal(state.error, 'Guardado sin sesión confirmada.');
});

test('the write response ETag permits the next refresh to preserve snapshot identity', async t => {
  const page = await tab(t);
  await page.route('**/api/productos', async route => {
    const response = await route.fetch();
    return route.fulfill({ response, headers: { ...response.headers(), etag: '"confirmed-write"' } });
  });
  await writeProduct(page);
  let receivedTag;
  await page.route('**/api/state', route => {
    receivedTag = route.request().headers()['if-none-match'];
    return route.fulfill({ status: 304, headers: { ETag: '"confirmed-write"' } });
  });
  const refreshed = await page.evaluate(async () => {
    const snapshot = client.getState().snapshot;
    try { await client.reload({ background: true }); return snapshot === client.getState().snapshot; }
    catch { return false; }
  });
  assert.equal(receivedTag, '"confirmed-write"');
  assert.equal(refreshed, true);
});

async function changedPending(t) {
  const page = await tab(t);
  await page.route('**/api/productos', route => route.abort());
  await page.evaluate(async () => {
    try { await client.writeOperation({ method: 'POST', path: '/api/productos', databaseId: client.getState().snapshot.databaseId,
      payload: { codigo: 'OLD-REVIEW', nombre: 'Artículo por revisar', costo: 1, precio1: 2, precio2: 0, precio3: 0, stock: 4 } }); }
    catch (error) { window.oldRetry = error.retry; }
  });
  const pending = await page.evaluate(() => client.getState().pending);
  const snapshot = await page.evaluate(() => client.getState().snapshot);
  const next = { ...snapshot, databaseId: randomUUID() };
  await page.context().route('**/api/state', route => route.fulfill({ json: next }));
  await page.evaluate(() => client.reload({ background: true }));
  return { page, pending, next };
}
function archive(page, pending, databaseId, acknowledged = true) {
  return page.evaluate(args => client.archivePending(args), { operationId: pending.id, databaseId, acknowledged });
}

test('another database packet requires acknowledgment and remains archived after reopening', async t => {
  const { page, pending, next } = await changedPending(t);
  await assert.rejects(archive(page, pending, next.databaseId, false), /revisión|revisado/i);
  assert.deepEqual(await page.evaluate(() => client.getState().pending), pending);
  const record = await archive(page, pending, next.databaseId);
  assert.deepEqual(record.packet, pending);
  assert.equal(record.currentDatabaseId, next.databaseId);
  assert.ok(Number.isFinite(Date.parse(record.archivedAt)));
  assert.equal(await page.evaluate(() => client.getState().pending), null);
  await page.reload();
  await initialize(page);
  assert.deepEqual(await page.evaluate(() => client.readArchives()), [record]);
  assert.equal(await page.evaluate(() => client.getState().pending), null);
});

test('archive commit abort preserves the exact pending packet without a partial archive', async t => {
  const { page, pending, next } = await changedPending(t);
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function(value, key) {
      const request = add.call(this, value, key);
      if (typeof key === 'string' && key.startsWith('archivo:')) request.addEventListener('success', () => this.transaction.abort());
      return request;
    };
  });
  await assert.rejects(archive(page, pending, next.databaseId));
  await page.evaluate(() => client.reload({ background: true }));
  assert.deepEqual(await page.evaluate(() => client.getState().pending), pending);
  assert.deepEqual(await page.evaluate(() => client.readArchives()), []);
});

test('an active sending lock prevents archival and a changed review target must be reviewed again', async t => {
  const { page, pending, next } = await changedPending(t);
  const other = await open(page.context());
  await other.evaluate(id => {
    window.unlock = null;
    navigator.locks.request('repuestos-felix-envio-' + id, () => new Promise(resolve => { window.unlock = resolve; }));
  }, pending.id);
  await other.waitForFunction(() => !!window.unlock);
  await assert.rejects(archive(page, pending, next.databaseId), /pestaña|enviando/i);
  assert.deepEqual(await page.evaluate(() => client.getState().pending), pending);
  await other.evaluate(() => window.unlock());
  const newest = { ...next, databaseId: randomUUID() };
  await page.context().route('**/api/state', route => route.fulfill({ json: newest }));
  await assert.rejects(archive(page, pending, next.databaseId), /base/i);
  assert.deepEqual(await page.evaluate(() => client.getState().pending), pending);
  assert.deepEqual(await page.evaluate(() => client.readArchives()), []);
});

test('archival cannot resurrect a packet from a stale tab or read history after session loss', async t => {
  const { page, pending, next } = await changedPending(t);
  const stale = await open(page.context());
  // Keep a pre-archive retry and its original confirmed generation in this tab.
  await stale.evaluate(async pending => {
    client.dispose();
    const fetchOriginal = window.fetch;
    const response = await fetchOriginal('/api/state');
    const original = await response.json();
    original.databaseId = pending.databaseId;
    window.fetch = (url, options) => url === '/api/state' ? Promise.resolve(Response.json(original)) : fetchOriginal(url, options);
    window.client = clientModule.createPosClient();
    await client.reload();
  }, pending);
  await stale.route('**/api/productos', route => route.abort());
  await stale.evaluate(() => client.retryPending().catch(error => { window.oldRetry = error.retry; }));
  await archive(page, pending, next.databaseId);
  await assert.rejects(stale.evaluate(() => window.oldRetry()), /archiv|pendiente/i);
  assert.deepEqual(await page.evaluate(() => client.readArchives()).then(rows => rows.map(row => row.packet)), [pending]);
  await page.context().route('**/api/state', route => route.fulfill({ status: 401, json: { error: 'Inicia sesión' } }));
  await page.evaluate(() => client.reload().catch(() => {}));
  await assert.rejects(page.evaluate(() => client.readArchives()), /sesión/i);
});

test('archival never releases the active generation or a journal replaced during the fresh read', async t => {
  const { page, pending, next } = await changedPending(t);
  await assert.rejects(archive(page, pending, pending.databaseId), /base/i);
  const arrived = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve());
  await page.route('**/api/state', async route => {
    arrived.resolve(); await release.promise;
    return route.fulfill({ json: next });
  });
  const archiving = archive(page, pending, next.databaseId).then(() => null, error => error.message);
  await arrived.promise;
  const replacement = { ...pending, id: randomUUID() };
  await page.evaluate(async packet => {
    const db = await new Promise(resolve => { const request = indexedDB.open('repuestos-felix-operaciones', 1); request.onsuccess = () => resolve(request.result); });
    try {
      await new Promise((resolve, reject) => {
        const transaction = db.transaction('operaciones', 'readwrite');
        transaction.oncomplete = resolve; transaction.onabort = reject;
        transaction.objectStore('operaciones').put(packet, 'pendiente');
      });
    } finally { db.close(); }
  }, replacement);
  release.resolve();
  assert.match(await archiving, /pendiente cambió/i);
  await page.evaluate(() => client.reload({ background: true }));
  assert.deepEqual(await page.evaluate(() => client.getState().pending), replacement);
  assert.deepEqual(await page.evaluate(() => client.readArchives()), []);
});

for (const width of [320, 390, 768, 1440]) for (const dark of [false, true]) test(`review uses an explicit acknowledgment and preserves downloadable history (${width}px ${dark ? 'dark' : 'light'})`, async t => {
  const { page, pending, next } = await changedPending(t);
  await page.setViewportSize({ width, height: width === 768 ? 1024 : width === 1440 ? 1000 : 844 });
  await page.evaluate(dark => { client.dispose(); localStorage.setItem('felix-theme', dark ? 'dark' : 'light'); }, dark);
  await page.goto(origin + '/ventas');
  await page.getByRole('button', { name: 'Revisar solicitud', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByText('Artículo por revisar', { exact: true }).waitFor();
  await dialog.getByText('Costo: RD$ 1.00', { exact: true }).waitFor();
  assert.doesNotMatch(await dialog.innerText(), /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|PostgreSQL/i);
  const confirm = dialog.getByRole('button', { name: 'Archivar y continuar', exact: true });
  assert.equal(await confirm.isDisabled(), true);
  await dialog.getByRole('checkbox').check();
  assert.equal(await confirm.isEnabled(), true);
  await dialog.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
  assert.ok((await confirm.boundingBox()).height >= 44, 'The archive confirmation must remain usable by touch');
  assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true);
  await mkdir('dist/verification/pwa-journal-review', { recursive: true });
  await page.screenshot({ path: `dist/verification/pwa-journal-review/review-${width}-${dark ? 'dark' : 'light'}.png` });
  await confirm.click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /Solicitudes archivadas/ }).click();
  await dialog.getByText('Artículo por revisar', { exact: true }).waitFor();
  assert.doesNotMatch(await dialog.innerText(), /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|PostgreSQL/i);
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Descargar registro', exact: true }).click();
  const downloaded = await downloading;
  assert.match(downloaded.suggestedFilename(), /^solicitud-.*\.json$/);
  const stream = await downloaded.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const record = JSON.parse(Buffer.concat(chunks).toString());
  assert.deepEqual(record.packet, pending);
  assert.equal(record.currentDatabaseId, next.databaseId);
});

test('archived history does not duplicate recovery controls for the current sale', async t => {
  const { page, pending, next } = await changedPending(t);
  await archive(page, pending, next.databaseId);
  await page.evaluate(() => client.dispose());
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route('**/api/ventas', route => route.abort());
  await page.goto(origin + '/ventas');
  const search = page.getByPlaceholder('Escanea o escribe código, referencia o nombre…');
  await search.fill('BG-1'); await search.press('Enter');
  await page.getByRole('button', { name: 'Tarjeta', exact: true }).click();
  await page.getByRole('button', { name: /Registrar venta/ }).click();
  await page.getByRole('button', { name: 'Reintentar venta', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Reintentar solicitud', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /Solicitudes archivadas/ }).count(), 1);
});

test('closing history returns focus to its own trigger while another changed-base request needs review', async t => {
  const { page, pending, next } = await changedPending(t);
  await archive(page, pending, next.databaseId);
  await assert.rejects(writeProduct(page, 'SECOND-REVIEW'));
  const newer = { ...next, databaseId: randomUUID() };
  await page.context().route('**/api/state', route => route.fulfill({ json: newer }));
  await page.evaluate(() => client.dispose());
  await page.goto(origin + '/ventas');
  await page.getByRole('button', { name: 'Revisar solicitud', exact: true }).waitFor();
  const history = page.getByRole('button', { name: /Solicitudes archivadas/ });
  await history.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await history.evaluate(element => element === document.activeElement), true);
});

test('review after a real restore unlocks a new confirmed write without replaying the old packet', async t => {
  const page = await tab(t);
  await page.route('**/api/productos', route => route.abort());
  await assert.rejects(writeProduct(page, 'RESTORE-PENDING'));
  const pending = await page.evaluate(() => client.getState().pending);
  const snapshot = await page.evaluate(() => client.getState().snapshot);
  await assert.rejects(archive(page, pending, snapshot.databaseId), /base actual/i);
  const backup = await (await fetch(origin + '/api/backup')).json();
  const restored = await fetch(origin + '/api/restore', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ databaseId: snapshot.databaseId, revision: snapshot.revision, backup }) });
  assert.equal(restored.status, 200);
  const next = await page.evaluate(() => client.reload());
  assert.notEqual(next.databaseId, snapshot.databaseId);
  await assert.rejects(writeProduct(page, 'RESTORE-NEXT'), /pendiente/i);
  await archive(page, pending, next.databaseId);
  await page.unroute('**/api/productos');
  const saved = await writeProduct(page, 'RESTORE-NEXT');
  assert.equal(saved.databaseId, next.databaseId);
  assert.equal(saved.state.productos.some(row => row.codigo === 'RESTORE-PENDING'), false);
  assert.equal(saved.state.productos.some(row => row.codigo === 'RESTORE-NEXT'), true);
  assert.deepEqual((await page.evaluate(() => client.readArchives()))[0].packet, pending);
});

test('desktop synchronization refreshes without disabling checkout while a confirmed catalog is available', async t => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  t.after(() => context.close());
  await context.addInitScript(() => { window.__FELIX_DESKTOP__ = true; });
  const page = await context.newPage();
  page.setDefaultTimeout(6000);
  let lastSync = '2026-11-22T12:00:00Z';
  await page.route('**/api/desktop/status', route => route.fulfill({ json: { initialized: true, connection: 'online',
    pending: 0, lastSync, error: null, conflict: null } }));
  await page.route('**/api/desktop/pending', route => route.fulfill({ json: [] }));
  await page.route('**/api/desktop/sync', route => { lastSync = '2026-11-22T12:01:00Z'; return route.fulfill({ json: {} }); });
  await page.goto(origin + '/ventas');
  const search = page.getByPlaceholder('Escanea o escribe código, referencia o nombre…');
  await search.fill('BG-1'); await search.press('Enter');
  await page.getByRole('button', { name: 'Tarjeta', exact: true }).click();
  const checkout = page.getByRole('button', { name: /Registrar venta/ });
  assert.equal(await checkout.isEnabled(), true);
  await page.clock.install(); await page.clock.pauseAt(new Date());
  const arrived = Promise.withResolvers();
  const release = Promise.withResolvers();
  t.after(() => release.resolve());
  await page.route('**/api/state', async route => { arrived.resolve(); await release.promise; return route.continue(); });
  await page.getByRole('button', { name: /^Sincronización:/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Sincronizar ahora' }).click();
  await arrived.promise;
  await dialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  assert.equal(await checkout.isEnabled(), true, 'Catalog refresh after synchronization must not lock the sale');
  release.resolve();
});

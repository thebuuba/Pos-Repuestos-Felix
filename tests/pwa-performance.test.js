import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { chromium } from 'playwright-core';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { createApp } from '../src/server.js';
import { buildOperational } from '../scripts/build-operational.mjs';
import { redactSnapshotForRole } from '../src/pos/roles.js';
import { searchTopProducts } from '../frontend/src/data/product-search.js';

test('búsqueda indexada en 8,000 productos mantiene prioridad exacta y responde en <15 ms', () => {
  const products = Array.from({ length: 8000 }, (_, i) => ({
    id: i + 1,
    code: `REP-${String(i + 1).padStart(5, '0')}`,
    altCodes: i === 7999 ? ['74600008000'] : [],
    name: `Repuesto de prueba número ${i + 1}`,
    brand: i % 2 === 0 ? 'Honda' : 'Yamaha',
  }));
  // Warm index once (happens once per snapshot change)
  const first = searchTopProducts(products, '74600008000', 6);
  assert.equal(first[0]?.id, 8000);
  const start = performance.now();
  for (let run = 0; run < 20; run++) {
    const res = searchTopProducts(products, 'REP-07999', 6);
    assert.equal(res[0]?.id, 7999);
  }
  const perSearch = (performance.now() - start) / 20;
  assert.ok(perSearch < 15, `Cada búsqueda debe ser rápida (<15 ms), tomó ${perSearch.toFixed(2)} ms`);
});

test('formato compacto X-Felix-Compact reduce tamaño, redacta cajero y caché IndexedDB reabre con 304 (0 bytes)', { timeout: 90000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'felix-perf-pwa-'));
  const db = await temporaryPostgres();
  const pool = new pg.Pool({ connectionString: db.connectionString });
  let server, browser;
  t.after(async () => {
    await browser?.close();
    if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
    await pool.end();
    await db.stop();
    await rm(dir, { recursive: true, force: true });
  });

  await migrateDatabase(pool);
  await buildOperational(dir);
  const stateReads = [];
  server = await createApp(pool, { assetsDirectory: pathToFileURL(dir + sep) });
  server.on('request', (req, res) => {
    if (req.url === '/api/state') {
      res.on('finish', () => stateReads.push({
        compact: req.headers['x-felix-compact'] || null,
        ifNoneMatch: req.headers['if-none-match'] || null,
        status: res.statusCode,
      }));
    }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;

  // Insert 50 products to verify compact savings & exact equivalence
  const base = await (await fetch(origin + '/api/state')).json();
  for (let i = 1; i <= 50; i++) {
    const r = await fetch(origin + '/api/productos', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({
        databaseId: base.databaseId, codigo: `PERF-${i}`, nombre: `Artículo veloz ${i}`,
        marca: 'OEM', categoria: 'Frenos', ubicacion: 'A1',
        costo: '125.5000', precio1: '250.0000', precio2: '220.0000', precio3: '200.0000', stock: '10',
        ...(i === 1 ? { codigosAlternativos: ['ALT-PERF-1'] } : {}),
      }),
    });
    assert.equal(r.status, 200);
  }

  const classicRes = await fetch(origin + '/api/state');
  const compactRes = await fetch(origin + '/api/state', { headers: { 'X-Felix-Compact': '1' } });
  const classicText = await classicRes.text();
  const compactText = await compactRes.text();
  assert.equal(classicRes.headers.get('etag'), compactRes.headers.get('etag'));
  assert.ok(compactText.length < classicText.length * 0.65,
    `Compacto debe ahorrar >35%: classic=${classicText.length}, compact=${compactText.length}`);

  const compactObj = JSON.parse(compactText);
  assert.equal(compactObj.compact, 1);
  const redactedCompact = redactSnapshotForRole(compactObj, 'cajero');
  assert.equal(redactedCompact.state.productos[0][11], '0.0000');

  // Verify real browser cold reload hits 304 Not Modified via IndexedDB cache!
  stateReads.length = 0;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-DO', serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  await page.goto(origin + '/ventas');
  await page.getByRole('heading', { name: 'Agregar productos', exact: true }).waitFor();
  // Wait briefly for debounced IndexedDB cache write (150ms)
  await new Promise(r => setTimeout(r, 350));
  assert.equal(stateReads.at(-1)?.compact, '1');
  assert.equal(stateReads.at(-1)?.status, 200);

  // Reopening PWA in a new tab/window (navigation.type === 'navigate') -> MUST send If-None-Match and get 304!
  stateReads.length = 0;
  await page.close();
  const reopened = await context.newPage();
  reopened.setDefaultTimeout(8000);
  reopened.on('pageerror', e => errors.push(e.message));
  await reopened.goto(origin + '/ventas');
  await reopened.getByRole('heading', { name: 'Agregar productos', exact: true }).waitFor();
  assert.ok(stateReads.length >= 1);
  assert.equal(stateReads[0].status, 304, `Reapertura debe revalidar con 304, recibió: ${JSON.stringify(stateReads[0])}`);
  assert.ok(stateReads[0].ifNoneMatch);
  // Verify product with alt code still works from cached snapshot
  const search = reopened.getByLabel('Código o nombre del producto', { exact: true });
  await search.fill('ALT-PERF-1');
  await reopened.getByText('Artículo veloz 1').first().waitFor();

  // Explicit browser reload (F5 / page.reload) -> fetches fresh compact 200 (escapes out-of-band SQL edits)
  stateReads.length = 0;
  await reopened.reload();
  await reopened.getByRole('heading', { name: 'Agregar productos', exact: true }).waitFor();
  assert.ok(stateReads.length >= 1);
  assert.equal(stateReads[0].compact, '1');
  assert.equal(stateReads[0].status, 200);
  assert.deepEqual(errors, []);
});

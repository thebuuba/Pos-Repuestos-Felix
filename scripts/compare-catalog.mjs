// Render the approved public inventory beside the real provider on a disposable
// PostgreSQL instance. Prototype fixtures here are test data, never business data.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { chromium } from 'playwright-core';
import { temporaryPostgres } from '../tests/postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { createApp } from '../src/server.js';
import { PRODUCTS } from '../frontend/src/reference/pos-data.js';

const reference = JSON.parse(await readFile(new URL('../docs/design/polymet-reference.json', import.meta.url), 'utf8'));
const html = await (await fetch(reference.preview, { signal: AbortSignal.timeout(30_000) })).text();
const scriptUrl = html.match(/<script id="user-main-js" src="([^"]+)"/)?.[1];
assert.ok(scriptUrl, 'No se pudo identificar la referencia pública.');
const source = await (await fetch(scriptUrl, { signal: AbortSignal.timeout(30_000) })).text();
assert.equal(createHash('sha256').update(source).digest('hex'), reference.bundleSha256, 'Polymet cambió: revisar antes de comparar.');
const label = process.argv[2] || 'current';
assert.match(label, /^[a-z0-9_-]+$/);
const directory = path.resolve(`dist/catalog-comparison-${label}`);
await mkdir(directory, { recursive: true });
let database, pool, server, browser;
const report = { checkedAt: new Date().toISOString(), version: reference.version, scope: 'Inventario main; same prototype products persisted through the real API on disposable PostgreSQL', screenshotStyle: 'Hide the sticky header only while capturing main, to prevent it painting over the top of the target during screenshot scrolling; visibility does not change layout', exclusions: ['Sidebar/operator, service status and accounts use real availability rather than prototype fixtures', 'Product formula dialog has no saved formulas yet; not covered by this comparison'], results: [] };
try {
  const { buildOperational } = await import('./build-operational.mjs');
  const compiled = await buildOperational(path.join(directory, 'app'));
  database = await temporaryPostgres();
  const admin = new pg.Pool({ connectionString: database.connectionString });
  try { await migrateDatabase(admin); } finally { await admin.end(); }
  pool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app' });
  server = await createApp(pool, { assetsDirectory: pathToFileURL(compiled + path.sep) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { databaseId } = await (await fetch(origin + '/api/state')).json();
  for (const p of PRODUCTS) {
    const response = await fetch(origin + '/api/productos', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ databaseId, codigo: p.code, nombre: p.name, marca: p.brand, categoria: p.category, ubicacion: p.location, costo: p.cost, stock: p.stock, stockMinimo: p.minStock, gravado: p.taxable, precio1: p.prices.p1, precio2: p.prices.p2, precio3: p.prices.p3 }) });
    assert.equal(response.status, 200, await response.clone().text());
    await response.arrayBuffer();
  }
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const viewport of reference.visualVerificationViewports) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport, locale: 'es-DO', timezoneId: 'America/Santo_Domingo', reducedMotion: 'reduce', deviceScaleFactor: 1 });
    const evidence = [];
    try {
      for (const [side, address] of [['reference', reference.preview], ['local', origin + '/inventario']]) {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(address);
        if (side === 'reference') {
          await page.locator('main h1').waitFor();
          const menu = page.getByRole('button', { name: 'Abrir menú', exact: true });
          if (await menu.isVisible()) {
            await menu.click();
            await page.getByRole('dialog').locator('a[href="/inventario"]').click();
            await page.getByRole('dialog').waitFor({ state: 'hidden' });
          } else await page.locator('aside a[href="/inventario"]').click();
        }
        await page.getByRole('heading', { name: 'Catálogo de artículos e inventario', exact: true }).waitFor();
        await page.getByRole('row').filter({ hasText: PRODUCTS[0].code }).waitFor();
        if (await page.locator('html').evaluate(el => el.classList.contains('dark')) !== (theme === 'dark')) await page.getByRole('button', { name: 'Cambiar tema', exact: true }).click();
        await page.evaluate(() => document.fonts.ready);
        await page.mouse.move(0, 0);
        const main = page.locator('main');
        const geometry = await main.evaluate(el => {
          const root = el.getBoundingClientRect();
          return [...el.querySelectorAll('h1,section,table')].map(node => {
            const r = node.getBoundingClientRect();
            return { tag: node.tagName, x: +(r.x - root.x).toFixed(2), y: +(r.y - root.y).toFixed(2), width: +r.width.toFixed(2), height: +r.height.toFixed(2) };
          });
        });
        const filename = `${viewport.width}-${theme}-${side}.png`;
        const screenshot = await main.screenshot({ path: path.join(directory, filename), animations: 'disabled', style: 'header { visibility: hidden !important; }' });
        evidence.push({ filename, screenshot, geometry, text: await main.innerText(), overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), errors });
      }
      const [a, b] = evidence;
      report.results.push({ viewport, theme, textMatches: a.text === b.text, geometryMatches: JSON.stringify(a.geometry) === JSON.stringify(b.geometry), pngBytesMatch: a.screenshot.equals(b.screenshot), reference: { file: a.filename, geometry: a.geometry, overflow: a.overflow, errors: a.errors }, local: { file: b.filename, geometry: b.geometry, overflow: b.overflow, errors: b.errors } });
      console.log(JSON.stringify({ viewport: viewport.width, theme, text: a.text === b.text, geometry: JSON.stringify(a.geometry) === JSON.stringify(b.geometry), pngBytes: a.screenshot.equals(b.screenshot) }));
    } finally { await context.close(); }
  }
} finally {
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await pool?.end();
  await database?.stop();
}

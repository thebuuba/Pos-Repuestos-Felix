import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import pg from 'pg';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { createApp } from '../src/server.js';

let database, pool, server, browser, context, page, origin, directory, productId;
const browserErrors = [];
const externalRequests = [];

before(async () => {
  const { buildOperational } = await import('../scripts/build-operational.mjs');
  directory = await mkdtemp(path.join(tmpdir(), 'felix-catalog-runtime-'));
  await buildOperational(directory);
  database = await temporaryPostgres();
  const admin = new pg.Pool({ connectionString: database.connectionString });
  try { await migrateDatabase(admin); } finally { await admin.end(); }
  pool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app' });
  server = await createApp(pool, { assetsDirectory: pathToFileURL(directory + path.sep) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'es-DO', timezoneId: 'America/Santo_Domingo' });
  page = await context.newPage();
  page.on('pageerror', error => browserErrors.push(error.message));
  page.on('request', request => {
    if (!request.url().startsWith(origin + '/') && !request.url().startsWith('data:')) externalRequests.push(request.url());
  });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await pool?.end();
  await database?.stop();
  if (directory) {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith('felix-catalog-runtime-'));
    await rm(resolved, { recursive: true, force: true });
  }
});

const snapshot = async () => (await fetch(origin + '/api/state')).json();
const confirmedProduct = async code => (await snapshot()).state.productos.find(p => p.codigo === code);
async function write(route, payload, method = 'POST') {
  return fetch(origin + '/api/' + route, {
    method,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ databaseId: (await snapshot()).databaseId, ...payload }),
  });
}
async function openInventory() {
  assert.equal((await page.goto(origin + '/inventario')).status(), 200);
  await page.getByRole('heading', { name: 'Catálogo de artículos e inventario', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Nuevo artículo', exact: true }).waitFor();
}
async function newProduct(code, description) {
  await page.getByRole('button', { name: 'Nuevo artículo', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Código', { exact: true }).fill(code);
  await sheet.getByLabel('Descripción', { exact: true }).fill(description);
  await sheet.getByLabel('Costo base RD$', { exact: true }).fill('95.50');
  await sheet.getByLabel('Existencia', { exact: true }).fill('10');
  await sheet.getByLabel('Mínimo', { exact: true }).fill('3');
  await sheet.getByLabel('Precio 1 · Detalle', { exact: true }).fill('118.99');
  return sheet;
}

test('rendered Polymet inventory stores all attributes and survives navigation and reload', { timeout: 60_000 }, async () => {
  await openInventory();
  assert.equal((await snapshot()).state.productos.length, 0, 'operational entry must not seed the database');
  const sheet = await newProduct('UI-CATALOGO', 'Artículo de integración');
  await sheet.getByLabel('Marca', { exact: true }).fill('Marca real de prueba');
  await sheet.getByLabel('Categoría', { exact: true }).click();
  await page.getByRole('option', { name: 'Eléctrico', exact: true }).click();
  await sheet.getByLabel('Ubicación', { exact: true }).fill('c-07');
  await sheet.getByLabel('Precio 2 · Por mayor', { exact: true }).fill('0');
  await sheet.getByLabel('Precio 3 · Taller', { exact: true }).fill('110.50');
  await sheet.getByRole('switch', { name: 'Aplica ITBIS', exact: true }).uncheck();
  await sheet.getByRole('button', { name: 'Guardar artículo', exact: true }).click();
  await sheet.waitFor({ state: 'hidden' });
  const product = await confirmedProduct('UI-CATALOGO');
  assert.ok(product);
  productId = product.id;
  assert.equal(product.nombre, 'Artículo de integración');
  assert.equal(product.marca, 'Marca real de prueba');
  assert.equal(product.categoria, 'Eléctrico');
  assert.equal(product.ubicacion, 'C-07');
  assert.equal(product.stockMinimo, 3);
  assert.equal(product.gravado, false);
  assert.equal(product.stock, 10);
  assert.equal(product.costo, 95.5);
  assert.equal(product.precio1, 118.99);
  assert.equal(product.precio2, 0, 'explicit zero is not a request to copy another price');
  assert.equal(product.precio3, 110.5);
  await page.reload();
  const row = page.getByRole('row').filter({ hasText: 'UI-CATALOGO' });
  await row.waitFor();
  await row.getByRole('button', { name: 'Editar', exact: true }).click();
  const reopened = page.getByRole('dialog');
  assert.equal(await reopened.getByLabel('Marca', { exact: true }).inputValue(), product.marca);
  assert.equal(await reopened.getByLabel('Mínimo', { exact: true }).inputValue(), '3');
  assert.equal(await reopened.getByLabel('Precio 2 · Por mayor', { exact: true }).inputValue(), '0');
  await reopened.getByRole('button', { name: 'Cancelar', exact: true }).click();
});

for (const cost of [10, 0]) test('metadata-only edit preserves empty attributes and amounts at cost ' + cost, async () => {
  const code = 'HISTORICO-' + cost;
  const created = await write('productos', { codigo: code, nombre: code, costo: cost, precio1: cost, precio2: 0, precio3: 0, stock: 0 });
  assert.equal(created.status, 200);
  const { result } = await created.json();
  await openInventory();
  const row = page.getByRole('row').filter({ hasText: code });
  await row.getByRole('button', { name: 'Editar', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Descripción', { exact: true }).fill('Descripción revisada');
  await sheet.getByRole('button', { name: 'Guardar cambios' }).click();
  await sheet.waitFor({ state: 'hidden', timeout: 5_000 });
  await page.reload();
  await row.getByText('Descripción revisada', { exact: true }).waitFor();
  const stored = (await pool.query('SELECT nombre, marca, categoria, ubicacion, costo, precio1, precio2, precio3 FROM productos WHERE id=$1', [result.id])).rows[0];
  assert.deepEqual(stored, { nombre: 'Descripción revisada', marca: '', categoria: '', ubicacion: '',
    costo: cost.toFixed(2), precio1: cost.toFixed(2), precio2: '0.00', precio3: '0.00' });
});

test('creating with blank optional attributes and zero amounts renders an empty ratio and progress', async () => {
  await openInventory();
  const sheet = await newProduct('UI-CEROS', 'Sin mínimo ni precios');
  for (const label of ['Costo base RD$', 'Precio 1 · Detalle', 'Existencia', 'Mínimo']) {
    await sheet.getByLabel(label, { exact: true }).fill('0');
  }
  await sheet.getByRole('button', { name: 'Guardar artículo' }).click();
  await sheet.waitFor({ state: 'hidden', timeout: 5_000 });
  await page.reload();
  const row = page.getByRole('row').filter({ hasText: 'UI-CEROS' });
  assert.equal(await row.getByRole('cell').nth(8).innerText(), '—');
  assert.equal(await row.locator('div.h-full.rounded-full').evaluate(el => el.style.width), '0%');
  const lowStockItem = page.getByRole('listitem').filter({ hasText: 'Sin mínimo ni precios' });
  assert.equal(await lowStockItem.locator('div.h-full.rounded-full').evaluate(el => el.style.width), '0%');
  const p = await confirmedProduct('UI-CEROS');
  assert.deepEqual([p.marca, p.ubicacion, p.costo, p.precio1, p.precio2, p.precio3], ['', '', 0, 0, 0, 0]);
});

test('a real concurrent edit rejects the stale version and retains the rendered draft', { timeout: 60_000 }, async () => {
  const original = await confirmedProduct('UI-CATALOGO');
  await page.getByRole('row').filter({ hasText: 'UI-CATALOGO' }).getByRole('button', { name: 'Editar', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Descripción', { exact: true }).fill('Mi borrador conservado');
  const response = await write(`productos/${productId}`, { ...original, nombre: 'Cambio confirmado en otro equipo' }, 'PUT');
  assert.equal(response.status, 200, await response.clone().text());
  await sheet.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await sheet.getByText(/El producto cambió/).waitFor();
  assert.equal(await sheet.getByLabel('Descripción', { exact: true }).inputValue(), 'Mi borrador conservado');
  const confirmed = await confirmedProduct('UI-CATALOGO');
  assert.equal(confirmed.nombre, 'Cambio confirmado en otro equipo');
  assert.equal(confirmed.version, original.version + 1);
  await sheet.getByRole('button', { name: 'Cancelar', exact: true }).click();
});

test('automatic refresh shows another connected equipment change without reloading the page', { timeout: 25_000 }, async () => {
  const created = await write('productos', { codigo: 'UI-ACTUALIZACION', nombre: 'Nombre anterior de otro equipo', costo: 10, precio1: 20, precio2: 15, precio3: 12, stock: 2 });
  assert.equal(created.status, 200, await created.clone().text());
  await created.arrayBuffer();
  await openInventory();
  const row = page.getByRole('row').filter({ hasText: 'UI-ACTUALIZACION' });
  await row.getByText('Nombre anterior de otro equipo', { exact: true }).waitFor();
  const previous = await confirmedProduct('UI-ACTUALIZACION');
  const updated = await write(`productos/${previous.id}`, { ...previous, nombre: 'Cambio recibido sin recargar' }, 'PUT');
  assert.equal(updated.status, 200, await updated.clone().text());
  await updated.arrayBuffer();
  await row.getByText('Cambio recibido sin recargar', { exact: true }).waitFor({ timeout: 12_000 });
});

test('a lost response after COMMIT is recovered after page reload with the same packet and one movement', { timeout: 60_000 }, async () => {
  const packets = [];
  let discard = true;
  let notifyDiscarded;
  const discarded = new Promise(resolve => { notifyDiscarded = resolve; });
  await page.route('**/api/productos', async route => {
    const request = route.request();
    if (request.method() !== 'POST') return route.continue();
    packets.push({ key: request.headers()['idempotency-key'], body: request.postData() });
    if (!discard) return route.continue();
    discard = false;
    const response = await route.fetch();
    assert.equal(response.status(), 200);
    await route.abort('failed');
    notifyDiscarded();
  });
  try {
    const sheet = await newProduct('UI-PERDIDA', 'Respuesta perdida después de confirmar');
    await sheet.getByRole('button', { name: 'Guardar artículo', exact: true }).click();
    await discarded;
    assert.ok(await confirmedProduct('UI-PERDIDA'));
    await page.reload();
    await page.getByRole('heading', { name: 'Catálogo de artículos e inventario', exact: true }).waitFor();
    const retry = page.getByRole('button', { name: /Reintentar/i }).first();
    const replayResponse = page.waitForResponse(response => response.url() === origin + '/api/productos' && response.request().method() === 'POST' && response.status() === 200);
    await retry.click();
    await replayResponse;
    await retry.waitFor({ state: 'hidden' });
    assert.equal(packets.length, 2);
    assert.ok(packets[0].key);
    assert.deepEqual(packets[1], packets[0], 'recovery must resend the exact original UUID and JSON body');
    const saved = (await snapshot()).state.productos.filter(p => p.codigo === 'UI-PERDIDA');
    assert.equal(saved.length, 1);
    assert.equal(saved[0].stock, 10);
    assert.equal(Number((await pool.query('SELECT count(*) AS n FROM movimientos_inventario WHERE producto_id=$1', [saved[0].id])).rows[0].n), 1);
  } finally { await page.unroute('**/api/productos'); }
});

test('deleting through the confirmed dialog deactivates the article and preserves its invoice history', { timeout: 60_000 }, async () => {
  const current = await snapshot();
  const response = await write('ventas', { clienteId: current.state.clientes[0].id, condicion: 'Contado', tipoComprobante: 'B02', items: [{ productoId: productId, cantidad: 1, nivelPrecio: 'precio1' }] });
  assert.equal(response.status, 200, await response.clone().text());
  const invoiceId = (await response.json()).result.id;
  const historical = (await pool.query('SELECT * FROM venta_detalles WHERE venta_id=$1', [invoiceId])).rows;
  await page.reload();
  await page.getByRole('row').filter({ hasText: 'UI-CATALOGO' }).getByRole('button', { name: 'Eliminar', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await confirmedProduct('UI-CATALOGO'), undefined);
  assert.equal((await pool.query('SELECT activo FROM productos WHERE id=$1', [productId])).rows[0].activo, false);
  assert.deepEqual((await pool.query('SELECT * FROM venta_detalles WHERE venta_id=$1', [invoiceId])).rows, historical);
});

test('restoring another generation rejects an open draft without rewriting its identity', { timeout: 60_000 }, async () => {
  const sheet = await newProduct('UI-GENERACION', 'Borrador de generación anterior');
  const beforeRestore = await snapshot();
  const backup = await (await fetch(origin + '/api/backup')).json();
  const response = await write('restore', { revision: beforeRestore.revision, backup });
  assert.equal(response.status, 200, await response.clone().text());
  assert.notEqual((await response.json()).databaseId, beforeRestore.databaseId);
  await sheet.getByRole('button', { name: 'Guardar artículo', exact: true }).click();
  await sheet.getByRole('alert').waitFor();
  assert.equal(await sheet.getByLabel('Descripción', { exact: true }).inputValue(), 'Borrador de generación anterior');
  assert.equal(await confirmedProduct('UI-GENERACION'), undefined);
});

test('inventory reflows on mobile and private paths and unavailable modules remain honest', { timeout: 60_000 }, async () => {
  await openInventory();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `horizontal overflow at ${width}px`);
  }
  assert.equal((await fetch(origin + '/.env')).status, 404);
  assert.equal((await fetch(origin + '/frontend/reference.jsx')).status, 404);
  assert.equal((await fetch(origin + '/desconocido')).status, 404);
  await page.goto(origin + '/ventas');
  assert.equal(await page.getByRole('button', { name: /Guardar factura|Facturar|Cobrar/ }).count(), 0, 'unconnected sales must not execute demo callbacks');
  assert.deepEqual(browserErrors, []);
  assert.deepEqual(externalRequests, []);
});

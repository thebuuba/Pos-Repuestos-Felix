import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import pg from 'pg';
import { countMatchingProducts, filterAndSortCatalog, searchTopProducts } from '../frontend/src/data/product-search.js';
import { buildOperational } from '../scripts/build-operational.mjs';
import { migrateDatabase } from '../src/db/migrations.js';
import { createApp } from '../src/server.js';
import { temporaryPostgres } from './postgres.js';

test('filterAndSortCatalog filtra por referencia exclusiva y ordena por existencia con miles de artículos', () => {
  const sample = [];
  for (let i = 1; i <= 1500; i++) {
    const isCtr = i <= 40;
    const isNameTrap = i === 41;
    sample.push({
      id: i,
      code: `COD-${String(i).padStart(4, '0')}`,
      reference: isCtr ? `CTR1 ${1000 + i}` : i <= 80 ? 'PERCOLI 2026' : 'ZR1 900',
      name: isNameTrap ? 'Pieza CTR1 solo en descripción' : `Repuesto #${i}`,
      brand: isCtr ? 'VIC' : 'SHIMIZU',
      category: 'Motor',
      location: 'A1',
      stock: isCtr ? (41 - i) % 15 : (i % 25),
      minStock: 3,
      notifyMinStock: true,
      cost: 100 + i,
      prices: { p1: 200 + i, p2: 180 + i, p3: 160 + i },
    });
  }

  assert.equal(countMatchingProducts(sample, 'CTR1', 'all'), 41);
  assert.equal(countMatchingProducts(sample, 'CTR1', 'reference'), 40);

  const byRefStockAsc = filterAndSortCatalog(sample, {
    query: 'CTR1',
    scope: 'reference',
    sortBy: 'stock',
    sortDir: 'asc',
  });
  assert.equal(byRefStockAsc.length, 40);
  assert.equal(byRefStockAsc[0].stock, 0);
  for (let i = 1; i < byRefStockAsc.length; i++) {
    assert.ok(byRefStockAsc[i].stock >= byRefStockAsc[i - 1].stock);
  }

  const byRefStockDesc = filterAndSortCatalog(sample, {
    query: 'CTR1',
    scope: 'reference',
    sortBy: 'stock',
    sortDir: 'desc',
  });
  assert.equal(byRefStockDesc[0].stock, 14);
  assert.equal(byRefStockDesc[byRefStockDesc.length - 1].stock, 0);

  const allUnfiltered = filterAndSortCatalog(sample, { query: '' });
  assert.equal(allUnfiltered.length, 1500);
});

test('búsqueda prioriza artículos que empiezan por "goma", admite multipalabra en cualquier orden e ignora tildes', () => {
  const catalog = [];
  // 30 piezas que mencionan "goma" en el medio al principio del catálogo
  for (let i = 1; i <= 30; i++) {
    catalog.push({
      id: i,
      code: `BJ-${i}`,
      reference: `REF-${i}`,
      name: `BUJE DE GOMA AMORTIGUADOR #${i}`,
      brand: 'GENERICO',
      category: 'Suspensión',
      stock: 15,
      minStock: 2,
      cost: 20,
      prices: { p1: 50, p2: 40, p3: 35 },
    });
  }
  // Las verdaderas GOMAS al final del catálogo (una agotada y dos disponibles) + artículos con tildes
  catalog.push(
    { id: 101, code: 'GM-300', reference: 'CTR1 901', name: 'GOMA TRASERA 300-18 SHIMIZU 6PR', brand: 'SHIMIZU', category: 'Gomas', stock: 0, minStock: 2, cost: 900, prices: { p1: 1400, p2: 1200, p3: 1100 } },
    { id: 102, code: 'GM-275', reference: 'CTR1 902', name: 'GOMA DELANTERA 275-18 COMANDO', brand: 'COMANDO', category: 'Gomas', stock: 8, minStock: 2, cost: 750, prices: { p1: 1150, p2: 1000, p3: 950 } },
    { id: 103, code: 'GM-9090', reference: 'PERCOLI 88', name: 'GOMA 90/90-18 TUBELESS', brand: 'VIC', category: 'Gomas', stock: 4, minStock: 2, cost: 1100, prices: { p1: 1650, p2: 1450, p3: 1350 } },
    { id: 104, code: 'BUJ-01', reference: 'ZR1 55', name: 'BUJÍA C7HSA NGK ORIGINAL', brand: 'NGK', category: 'Motor', stock: 20, minStock: 5, cost: 60, prices: { p1: 110, p2: 90, p3: 85 } },
    { id: 105, code: 'CAM-18', reference: 'CTR1 903', name: 'CÁMARA 300-18 REFORZADA', brand: 'SHIMIZU', category: 'Gomas', stock: 12, minStock: 4, cost: 150, prices: { p1: 260, p2: 220, p3: 200 } },
  );

  // 1. En Ventas (preferInStock: true): "goma" pone primero las GOMAS con stock, luego la goma agotada, luego los bujes de goma
  const saleTop = searchTopProducts(catalog, 'goma', 12, { preferInStock: true });
  assert.deepEqual(saleTop.slice(0, 3).map((p) => p.code), ['GM-275', 'GM-9090', 'GM-300']);

  // 2. En Catálogo completo (sortBy: 'default'): "goma" pone TODAS las GOMAS arriba antes de "BUJE DE GOMA" y por último categoría "Gomas"
  const browserGoma = filterAndSortCatalog(catalog, { query: 'goma', sortBy: 'default' });
  assert.deepEqual(browserGoma.slice(0, 3).map((p) => p.code), ['GM-300', 'GM-275', 'GM-9090']);
  assert.equal(browserGoma.length, 34);
  assert.equal(browserGoma[33].code, 'CAM-18');

  // 3. Multipalabra salteada y combinando nombre + referencia (GOMA siempre primero, categoría Gomas al final)
  assert.deepEqual(searchTopProducts(catalog, 'goma 300', 5).map((p) => p.code), ['GM-300', 'CAM-18']);
  assert.deepEqual(searchTopProducts(catalog, 'goma shimizu', 5).map((p) => p.code), ['GM-300', 'CAM-18']);
  assert.deepEqual(searchTopProducts(catalog, 'goma ctr1', 5).map((p) => p.code), ['GM-300', 'GM-275', 'CAM-18']);
  assert.deepEqual(searchTopProducts(catalog, 'goma 18', 5).map((p) => p.code), ['GM-300', 'GM-275', 'GM-9090', 'BJ-18', 'CAM-18']);

  // 4. Insensible a tildes ("bujia" -> "BUJÍA", "camara 300" -> "CÁMARA 300-18")
  assert.deepEqual(searchTopProducts(catalog, 'bujia', 5).map((p) => p.code), ['BUJ-01']);
  assert.deepEqual(searchTopProducts(catalog, 'camara 300', 5).map((p) => p.code), ['CAM-18']);
});

test('E2E Catálogo completo (F2 / Shift+F2): Compras multi-pedido por referencia, Ventas sin costo e Inventario ordenable', { timeout: 90_000 }, async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'felix-catalog-browser-'));
  const database = await temporaryPostgres();
  let server, pool, browser;
  t.after(async () => {
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    await pool?.end();
    await database.stop();
    await rm(directory, { recursive: true, force: true });
  });

  const admin = new pg.Pool({ connectionString: database.connectionString });
  try { await migrateDatabase(admin); } finally { await admin.end(); }
  await buildOperational(directory);

  pool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app' });
  server = await createApp(pool, { assetsDirectory: pathToFileURL(directory + path.sep) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const { databaseId } = await (await fetch(origin + '/api/state')).json();
  const post = async (resource, data) => {
    const res = await fetch(origin + '/api/' + resource, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ databaseId, ...data }),
    });
    assert.equal(res.status, 200, await res.clone().text());
    return (await res.json()).result.id;
  };

  await post('caja/abrir', { monto: 1000 });
  await post('suplidores', { nombre: 'DILLON IMPORT' });

  // 15 piezas con referencia CTR1 (más de 8 para probar que el catálogo completo las muestra todas) + 2 piezas ZR1
  for (let i = 1; i <= 15; i++) {
    await post('productos', {
      codigo: `CTR-${String(i).padStart(3, '0')}`,
      referencia: `CTR1 ${2000 + i}`,
      nombre: `Pieza Dillon #${i}`,
      marca: 'VIC',
      categoria: 'Motor',
      stock: i === 5 ? 0 : i * 2,
      stockMinimo: 4,
      costo: 100 + i * 10,
      precio1: 200 + i * 10,
      precio2: 180 + i * 10,
      precio3: 160 + i * 10,
    });
  }
  await post('productos', {
    codigo: 'ZR-100',
    referencia: 'ZR1 1001664',
    nombre: 'Tuerca 12 Ciega Larga ZR1',
    marca: 'SHIMIZU',
    categoria: 'Frenos',
    stock: 9,
    costo: 45,
    precio1: 95,
    precio2: 80,
    precio3: 75,
  });

  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 }, locale: 'es-DO' });
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));

  // 1. Compras: pulsar F2 abre Catálogo completo, filtrar por Solo referencia "CTR1", ordenar Exist. asc, pedir 2 ítems sin cerrar
  await page.goto(origin + '/compras');
  await page.getByRole('heading', { name: 'Subir factura de compra' }).waitFor();
  await page.keyboard.press('F2');

  const dialog = page.getByRole('dialog');
  await dialog.getByText('Catálogo · Compras').waitFor();
  await dialog.getByText('16 artículos').waitFor();

  const refFilterBtn = dialog.getByRole('group', { name: 'Buscar en campo' }).getByRole('button', { name: 'Referencia', exact: true });
  await refFilterBtn.click();
  assert.equal(await refFilterBtn.getAttribute('aria-pressed'), 'true');
  await dialog.getByLabel('Filtrar artículos del catálogo completo').fill('CTR1');
  await dialog.getByText('15 de 16').waitFor();

  // Ordenar por Existencia ascendente (CTR-005 tiene stock 0 y debe quedar primero)
  await dialog.getByRole('button', { name: 'Exist.', exact: true }).click();
  const firstOption = dialog.getByRole('option').first();
  await firstOption.getByText('CTR-005').waitFor();

  // Escribir cantidad 30 en la primera fila y pulsar Enter -> se agrega sin cerrar y aparece insignia de 30
  const qtyFirst = dialog.getByLabel('Cantidad a pedir para CTR-005');
  await qtyFirst.fill('30');
  await qtyFirst.press('Enter');
  await dialog.getByLabel('En compra: 30').waitFor();
  await dialog.getByText('1 en compra').waitFor();

  // Segunda fila (CTR-001 tiene stock 2): pedir 12 sin cerrar
  const qtySecond = dialog.getByLabel('Cantidad a pedir para CTR-001');
  await qtySecond.fill('12');
  await qtySecond.press('Enter');
  await dialog.getByLabel('En compra: 12').waitFor();
  await dialog.getByText('2 en compra').waitFor();

  // Cerrar con "Listo (2 añad.)" y confirmar que ambas líneas están en la tabla de compra
  await dialog.getByRole('button', { name: /Listo \(2 añad\.\)/ }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.locator('.purchase-lines-table').getByText('Pieza Dillon #5').waitFor();
  await page.locator('.purchase-lines-table').getByText('Pieza Dillon #1').waitFor();

  // 2. Punto de venta: pulsar F2 abre Catálogo completo SIN columna Costo, buscar ZR1 y agregar al carrito
  await page.goto(origin + '/ventas');
  await page.getByRole('heading', { name: 'Agregar productos' }).waitFor();
  await page.keyboard.press('F2');
  const saleDlg = page.getByRole('dialog');
  await saleDlg.getByText('Catálogo de artículos').waitFor();
  assert.equal(await saleDlg.getByRole('button', { name: 'Costo', exact: true }).count(), 0);
  await saleDlg.getByLabel('Filtrar artículos del catálogo completo').fill('ZR1');
  await saleDlg.getByText('1 de 16').waitFor();
  await page.keyboard.press('Enter');
  await saleDlg.waitFor({ state: 'hidden' });
  await page.locator('.sale-cart tbody tr', { hasText: 'Tuerca 12 Ciega Larga ZR1' }).waitFor();

  // 3. Inventario: ordenar por Existencia y confirmar CTR-005 (stock 0) aparece primero
  await page.goto(origin + '/inventario');
  await page.getByRole('button', { name: 'Existencia', exact: true }).click();
  await page.locator('tbody tr').first().getByText('CTR-005').waitFor();

  // 4. Global Shift+F2 desde Panel abre el catálogo completo
  await page.goto(origin + '/');
  await page.getByRole('heading', { name: 'Panel', exact: true }).waitFor();
  await page.keyboard.press('Shift+F2');
  await page.getByRole('dialog').getByText('Catálogo completo').waitFor();
  await page.keyboard.press('Escape');

  assert.deepEqual(errors, []);
});

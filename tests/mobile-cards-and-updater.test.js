import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { chromium } from 'playwright-core';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { readSnapshot, writeOperation } from '../src/pos/store.js';
import { createApp } from '../src/server.js';
import { buildOperational } from '../scripts/build-operational.mjs';
import { parseHostUpdateLine } from '../src/desktop/main.js';
import { DesktopLedger } from '../src/desktop/ledger.js';
import { DesktopEngine } from '../src/desktop/engine.js';
import { desktopServer } from '../src/desktop/server.js';
import { passwordRecord } from '../src/desktop/credentials.js';
import { readSyncBootstrap } from '../src/pos/sync-operations.js';
import { compactSearchText, indexedProducts, matchesIndexed, searchTopProducts } from '../frontend/src/data/product-search.js';
import { catalogCategories } from '../frontend/src/data/catalog-options.js';

test('búsqueda sin guion encuentra códigos con separadores y catalogCategories omite categorías sin uso', () => {
  const catalog = [
    { id: 1, code: 'Y-0858', name: 'Empaque tapa válvula', brand: 'Yamaha', altCodes: ['YAM-0858'] },
    { id: 2, code: 'BUJ-C7HSA', name: 'Bujía NGK', brand: 'NGK', altCodes: [] },
  ];
  const byCompact = searchTopProducts(catalog, 'y0858', 5);
  assert.equal(byCompact.length, 1);
  assert.equal(byCompact[0].code, 'Y-0858');
  const byAltCompact = searchTopProducts(catalog, 'yam0858', 5);
  assert.equal(byAltCompact[0]?.code, 'Y-0858');
  const idx = indexedProducts(catalog);
  assert.equal(matchesIndexed(idx[1], 'bujc7', compactSearchText('bujc7')), true);

  const cats = catalogCategories({
    catalogo: { categorias: ['1005', 'PECES', 'RATICIDA', 'VITAMINAS'] },
    productos: [{ categoria: 'Motor' }, { categoria: 'Frenos' }, { categoria: '' }],
  });
  assert.deepEqual(cats, ['Frenos', 'Motor']);
});

test('parseHostUpdateLine valida eventos FELIX_UPDATE del host Tauri', () => {
  assert.deepEqual(
    parseHostUpdateLine('FELIX_UPDATE={"state":"available","version":"1.2.9","error":null}'),
    { state: 'available', version: '1.2.9', error: null },
  );
  assert.deepEqual(
    parseHostUpdateLine('FELIX_UPDATE={"state":"error","version":"1.2.9","error":"Sin red"}'),
    { state: 'error', version: '1.2.9', error: 'Sin red' },
  );
  assert.deepEqual(
    parseHostUpdateLine('FELIX_UPDATE={"state":"checking","version":"1.2.11","error":null}'),
    { state: 'checking', version: '1.2.11', error: null },
  );
  assert.deepEqual(
    parseHostUpdateLine('FELIX_UPDATE={"state":"up_to_date","version":"1.2.11","error":null}'),
    { state: 'up_to_date', version: '1.2.11', error: null },
  );
  assert.deepEqual(
    parseHostUpdateLine('FELIX_UPDATE={"state":"check_error","version":"1.2.11","error":"Sin red"}'),
    { state: 'check_error', version: '1.2.11', error: 'Sin red' },
  );
  assert.equal(parseHostUpdateLine('FELIX_UPDATE={"state":"evil","version":"1.0.0"}'), null);
  assert.equal(parseHostUpdateLine('FELIX_UPDATE={invalido'), null);
  assert.equal(parseHostUpdateLine('otra linea'), null);
});

test('tarjetas móviles (<1024px) en Inventario, Compras y Reportes sin scroll horizontal + banner moderno de actualización Windows', { timeout: 120000 }, async t => {
  const db = await temporaryPostgres();
  const pool = new pg.Pool({ connectionString: db.connectionString });
  const tempDirs = [];
  let webServer, deskServer, deskEngine, browser;

  t.after(async () => {
    await browser?.close().catch(() => {});
    if (webServer) {
      webServer.closeAllConnections();
      if (webServer.listening) await new Promise(done => webServer.close(done));
    }
    if (deskServer) {
      deskServer.closeAllConnections();
      if (deskServer.listening) await new Promise(done => deskServer.close(done));
    }
    await deskEngine?.pool?.end().catch(() => {});
    deskEngine?.ledger?.close();
    await pool.end();
    await db.stop();
    for (const d of tempDirs) await rm(d, { recursive: true, force: true });
  });

  await migrateDatabase(pool);
  const actor = { id: 'owner-ui', name: 'felix', role: 'dueno' };
  const write = (method, path, body) => writeOperation(pool, method, path, body, randomUUID(), 'Prueba', actor);

  let snap = await readSnapshot(pool, 'Prueba');
  const dbId = snap.databaseId;
  const sup = await write('POST', '/api/suplidores', { databaseId: dbId, nombre: 'Importadora Móvil SRL', rnc: '130888777', diasCredito: 30 });
  const prod = await write('POST', '/api/productos', {
    databaseId: dbId, codigo: 'MOV-FIL-01', nombre: 'Filtro de aceite Corolla 2018',
    marca: 'Toyota', categoria: 'Filtros', ubicacion: 'A-12',
    costo: '210.0000', precio1: '450.0000', precio2: '400.0000', precio3: '360.0000', stock: '12', stockMinimo: '4',
  });
  await write('POST', '/api/compras', {
    databaseId: dbId, suplidorId: sup.result.id, numero: 'FAC-MOV-99', condicion: 'Credito', vencimiento: '2030-12-15',
    items: [{
      productoId: prod.result.id, versionProducto: 1, codigo: 'MOV-FIL-01', nombre: 'Filtro de aceite Corolla 2018',
      cantidad: '4', costo: '210.0000', precio1: '450.0000', precio2: '400.0000', precio3: '360.0000',
    }],
  });
  const turn = await write('POST', '/api/caja/abrir', { databaseId: dbId, monto: '1000' });
  snap = await readSnapshot(pool, 'Prueba');
  const contado = snap.state.clientes.find(c => c.esContado);
  const liveProd = snap.state.productos.find(p => p.id === prod.result.id);
  const sale = await write('POST', '/api/ventas', {
    databaseId: dbId, cajaId: turn.result.id, clienteId: contado.id,
    condicion: 'Contado', metodoPago: 'efectivo', tipoComprobante: 'B02',
    versionConfiguracion: snap.state.configuracion.version,
    items: [{ productoId: liveProd.id, versionProducto: liveProd.version, nivelPrecio: 'precio1', cantidad: '2' }],
  });
  const saleNum = 'F-' + String(sale.result.id).padStart(6, '0');

  const assetsDir = await mkdtemp(join(tmpdir(), 'felix-mobile-cards-'));
  tempDirs.push(assetsDir);
  await buildOperational(assetsDir);

  webServer = await createApp(pool, { assetsDirectory: pathToFileURL(assetsDir + sep) });
  await new Promise(done => webServer.listen(0, '127.0.0.1', done));
  const webOrigin = 'http://127.0.0.1:' + webServer.address().port;

  // 1. Verificar tarjetas móviles en 390x844 y 320x844 (claro y oscuro) sin desbordamiento horizontal
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'es-DO' });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));

  const evidenceDir = resolve('dist/verification/mobile-cards');
  await mkdir(evidenceDir, { recursive: true });

  for (const route of ['/inventario', '/compras', '/reportes']) {
    await page.goto(webOrigin + route);
    await page.locator('main h1').waitFor();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const dark of [false, true]) {
        await page.evaluate(d => document.documentElement.classList.toggle('dark', d), dark);
        await page.waitForTimeout(80);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        assert.equal(overflow, false, `Sin scroll horizontal en ${route} (${width}px, dark=${dark})`);
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(evidenceDir, `${route.slice(1)}-390-light.png`), fullPage: true, animations: 'disabled' });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(evidenceDir, `${route.slice(1)}-390-dark.png`), fullPage: true, animations: 'disabled' });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
  }

  // Verificar interacción táctil en tarjetas móviles:
  // Inventario -> Nuevo artículo: etiqueta Nombre, Categoría vacía y Existencia reemplaza el 0 al escribir 5
  await page.goto(webOrigin + '/inventario');
  await page.getByRole('button', { name: 'Nuevo artículo' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Nombre', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(await sheet.getByLabel('Categoría', { exact: true }).inputValue(), '', 'Categoría debe abrir vacía y no preseleccionada');
  const stockInput = sheet.getByLabel('Existencia', { exact: true });
  assert.equal(await stockInput.inputValue(), '0');
  await stockInput.focus();
  assert.equal(await stockInput.inputValue(), '', 'Al enfocar Existencia en 0 debe limpiarse para evitar 05');
  await page.keyboard.type('5');
  assert.equal(await stockInput.inputValue(), '5');
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'hidden' });

  // Compras -> buscar sin guiones ('movfil01') encuentra 'MOV-FIL-01', y tocar tarjeta abre PurchaseInvoiceDialog
  await page.goto(webOrigin + '/compras');
  await page.getByLabel('Código', { exact: true }).fill('movfil01');
  await page.getByRole('option', { name: /MOV-FIL-01/i }).waitFor({ state: 'visible' });
  await page.getByLabel('Código', { exact: true }).fill('');
  await page.getByRole('button', { name: /Ver factura de C-/i }).click();
  await page.getByRole('dialog').getByRole('heading', { name: /Factura de compra FAC-MOV-99/i }).waitFor({ state: 'visible' });
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click();

  // Reportes -> botón Imprimir en tarjeta abre ReceiptDialog
  await page.goto(webOrigin + '/reportes');
  await page.getByRole('button', { name: `Reimprimir ${saleNum}`, exact: true }).click();
  await page.getByRole('dialog').getByText('Factura de venta', { exact: true }).waitFor({ state: 'visible' });
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar' }).click();
  assert.deepEqual(errors, []);

  // 2. Verificar endpoint y banner moderno de actualización en Desktop (Windows Tauri)
  const deskDir = await mkdtemp(join(tmpdir(), 'felix-desk-updater-'));
  tempDirs.push(deskDir);
  const ledger = new DesktopLedger(deskDir);
  deskEngine = new DesktopEngine(ledger);
  await deskEngine.adopt(await readSyncBootstrap(pool, 'Prueba'));
  ledger.set('profile', {
    id: 'owner-ui', username: 'felix', name: 'felix', role: 'dueno',
    generation: randomUUID(), ...passwordRecord('clave-demo-123'), onlineAt: Date.now(), allowOffline: true,
  });

  let applyCalls = 0;
  let checkCalls = 0;
  let hostUpdate = null;
  const host = {
    updateStatus: () => (hostUpdate ? { ...hostUpdate } : null),
    checkUpdate: () => {
      checkCalls++;
      hostUpdate = { state: 'checking', version: '1.2.11', error: null };
      setTimeout(() => {
        hostUpdate = { state: 'available', version: '1.2.12', error: null };
      }, 150);
      return { ...hostUpdate };
    },
    applyUpdate: () => {
      applyCalls++;
      hostUpdate = { ...hostUpdate, state: 'downloading', error: null };
      return { ...hostUpdate };
    },
  };
  const fakeRemote = {
    cookie: null,
    invalidatePending() {},
    clear() {},
    async request() { throw Object.assign(new Error('Sin red'), { status: 503 }); },
  };
  deskServer = desktopServer(deskEngine, fakeRemote, assetsDir, host);
  await new Promise(done => deskServer.listen(0, '127.0.0.1', done));
  const deskOrigin = 'http://127.0.0.1:' + deskServer.address().port;

  const deskCtx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'es-DO' });
  const loginRes = await deskCtx.request.post(deskOrigin + '/login', {
    headers: { Origin: deskOrigin },
    data: { username: 'felix', password: 'clave-demo-123' },
  });
  assert.equal(loginRes.status(), 200);

  const deskPage = await deskCtx.newPage();
  const deskErrors = [];
  deskPage.on('pageerror', err => deskErrors.push(err.message));
  await deskPage.goto(deskOrigin + '/ventas');
  await deskPage.getByRole('button', { name: /Sincronización:/i }).waitFor({ state: 'visible' });
  // Sin cerrar el programa: abrir Sincronización y pulsar "Buscar actualizaciones" detecta v1.2.12 en caliente
  await deskPage.getByRole('button', { name: /Sincronización:/i }).click();
  await deskPage.getByRole('dialog').getByRole('button', { name: 'Buscar actualizaciones', exact: true }).click();
  await deskPage.getByRole('dialog').getByText('Actualización disponible (v1.2.12)', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(checkCalls, 1);
  await deskPage.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await deskPage.getByText('Actualización disponible (v1.2.12)', { exact: true }).waitFor({ state: 'visible' });
  await deskPage.screenshot({ path: join(evidenceDir, 'windows-update-banner-1366-light.png') });

  // Más tarde oculta el banner superior, pero sigue accesible en el diálogo de Sincronización
  await deskPage.getByRole('button', { name: 'Más tarde', exact: true }).click();
  assert.equal(await deskPage.getByText('Actualización disponible (v1.2.12)', { exact: true }).count(), 0);
  await deskPage.getByRole('button', { name: /Sincronización:/i }).click();
  await deskPage.getByRole('dialog').getByText('Actualización disponible (v1.2.12)', { exact: true }).waitFor({ state: 'visible' });

  // Pulsar "Actualizar ahora" envía POST /api/desktop/update y cambia a "Descargando actualización (v1.2.12)…"
  await deskPage.getByRole('dialog').getByRole('button', { name: 'Actualizar ahora', exact: true }).click();
  await deskPage.getByRole('dialog').getByText('Descargando actualización (v1.2.12)…', { exact: true }).waitFor({ state: 'visible' });
  assert.equal(applyCalls, 1);
  assert.deepEqual(deskErrors, []);
});

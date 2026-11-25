import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { chromium } from 'playwright-core';
import { temporaryPostgres } from './postgres.js';
import { testAuthService, loginCookie } from './fixtures/supabase-auth.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { readProductMovements, readSnapshot, writeOperation } from '../src/pos/store.js';
import { readSyncBootstrap } from '../src/pos/sync-operations.js';
import { DesktopLedger } from '../src/desktop/ledger.js';
import { DesktopEngine } from '../src/desktop/engine.js';
import { createApp } from '../src/server.js';
import { hostingConfig } from '../src/hosting.js';

test('Inventario: motivoAjuste, Kardex por rol, motor Windows SQLite y E2E UI (Limpiar, Ubicación, Kardex)', { timeout: 120000 }, async t => {
  const database = await temporaryPostgres();
  const admin = new pg.Pool({ connectionString: database.connectionString });
  await migrateDatabase(admin);
  const pool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app' });
  const authService = await testAuthService();
  const server = await createApp(pool, {
    hosting: hostingConfig(authService.env),
    databaseLabel: 'Pruebas Inventario',
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const desktopDir = await mkdtemp(path.join(tmpdir(), 'felix-inv-desktop-'));
  let engine, browser;
  t.after(async () => {
    await browser?.close();
    await engine?.close();
    await rm(desktopDir, { recursive: true, force: true });
    if (server.listening) await new Promise(done => server.close(done));
    await authService.close();
    await pool.end();
    await admin.end();
    await database.stop();
  });

  const actor = { id: 'owner-1', name: 'felix', role: 'dueno' };
  const snap0 = await readSnapshot(pool, 'Pruebas Inventario');
  const databaseId = snap0.databaseId;
  const write = (method, p, body) => writeOperation(pool, method, p, { databaseId, ...body }, randomUUID(), 'Pruebas Inventario', actor);

  const p1 = (await write('POST', '/api/productos', {
    codigo: 'BUJ-001', nombre: 'Bujía NGK', marca: 'NGK', categoria: 'Motor', ubicacion: 'A-1',
    costo: 80, precio1: 150, precio2: 140, precio3: 130, stock: 10, stockMinimo: 4, gravado: true,
  })).result.id;
  await write('POST', '/api/productos', {
    codigo: 'FIL-002', nombre: 'Filtro de Aceite', marca: 'Honda', categoria: 'Motor', ubicacion: 'B-2',
    costo: 100, precio1: 200, precio2: 190, precio3: 180, stock: 6, stockMinimo: 3, gravado: true,
  });
  const suppId = (await write('POST', '/api/suplidores', { nombre: 'Suplidor Prueba', rnc: '', tel: '' })).result.id;
  const beforeBuy = await readSnapshot(pool, 'Pruebas Inventario');
  const buj = beforeBuy.state.productos.find(x => x.id === p1);
  await write('POST', '/api/compras', {
    suplidorId: suppId, numero: 'FAC-900', condicion: 'Contado',
    items: [{ productoId: p1, versionProducto: buj.version, codigo: buj.codigo, nombre: buj.nombre, cantidad: 5, costo: 80, precio1: 150, precio2: 140, precio3: 130 }],
  });
  const cashId = (await write('POST', '/api/caja/abrir', { monto: 500 })).result.id;
  const beforeSale = await readSnapshot(pool, 'Pruebas Inventario');
  const buj2 = beforeSale.state.productos.find(x => x.id === p1);
  await write('POST', '/api/ventas', {
    cajaId: cashId, clienteId: beforeSale.state.clientes[0].id, condicion: 'Contado', metodoPago: 'efectivo',
    tipoComprobante: 'B02', versionConfiguracion: beforeSale.state.configuracionVersion,
    items: [{ productoId: p1, versionProducto: buj2.version, cantidad: 2, nivelPrecio: 'precio1' }],
  });

  // 1. Verificar Kardex por rol en backend (dueno ve compra; cajero no ve compra).
  const ownerKardex = await readProductMovements(pool, p1, { role: 'dueno' });
  assert.equal(ownerKardex.product.stock, 13);
  assert.deepEqual(ownerKardex.movements.map(m => m.type), ['venta', 'compra', 'apertura']);
  assert.equal(ownerKardex.movements[0].saleId, 1);
  assert.equal(ownerKardex.movements[1].purchaseNumber, 'FAC-900');

  const cashierKardex = await readProductMovements(pool, p1, { role: 'cajero' });
  assert.deepEqual(cashierKardex.movements.map(m => m.type), ['venta', 'apertura']);

  // 2. Verificar motor local Windows SQLite (DesktopEngine.productMovements + ajuste offline con motivo).
  engine = new DesktopEngine(new DesktopLedger(desktopDir));
  await engine.adopt(await readSyncBootstrap(pool, 'Pruebas Inventario'));
  const deskSnap = await engine.snapshot();
  const deskBuj = deskSnap.state.productos.find(x => x.id === p1);
  await engine.write('PUT', '/api/productos/' + p1, {
    databaseId: deskSnap.databaseId, version: deskBuj.version,
    codigo: deskBuj.codigo, nombre: deskBuj.nombre, marca: deskBuj.marca, categoria: deskBuj.categoria, ubicacion: deskBuj.ubicacion,
    costo: deskBuj.costoExacto, precio1: deskBuj.preciosExactos.p1, precio2: deskBuj.preciosExactos.p2, precio3: deskBuj.preciosExactos.p3,
    stock: 15, stockMinimo: deskBuj.stockMinimo, gravado: deskBuj.gravado, notificarMinimo: deskBuj.notificarMinimo,
    motivoAjuste: 'Conteo físico offline',
  }, randomUUID(), actor);
  const deskKardex = await engine.productMovements(p1, 'dueno');
  assert.equal(deskKardex.movements[0].type, 'ajuste');
  assert.equal(deskKardex.movements[0].quantity, 2);
  assert.equal(deskKardex.movements[0].reason, 'Conteo físico offline');

  // 3. E2E en navegador real: botón Limpiar sin error, filtro por ubicación, ajuste con motivo, aviso de mínimo y diálogo Kardex.
  const call = (p, options = {}, cookie = '') => fetch(origin + p, {
    ...options,
    headers: { ...options.headers, Origin: origin, ...(cookie && { Cookie: cookie }) },
  });
  const cookie = await loginCookie(call);
  const [cookieName, cookieValue] = cookie.split('=');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 950 }, locale: 'es-DO', timezoneId: 'America/Santo_Domingo' });
  await context.addCookies([{ name: cookieName, value: cookieValue, url: origin }]);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  await page.goto(origin + '/inventario');
  await page.getByRole('table').getByText('Bujía NGK', { exact: true }).waitFor();

  // 3a. Botón Limpiar en Nuevo artículo no debe lanzar ReferenceError.
  await page.getByRole('button', { name: 'Nuevo artículo' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Código', { exact: true }).fill('TEST-CLEAR');
  await sheet.getByLabel('Nombre', { exact: true }).fill('Artículo temporal');
  await sheet.getByRole('button', { name: 'Limpiar', exact: true }).click();
  assert.equal(await sheet.getByLabel('Código', { exact: true }).inputValue(), '');
  assert.equal(await sheet.getByLabel('Nombre', { exact: true }).inputValue(), '');
  assert.deepEqual(pageErrors, []);
  await page.keyboard.press('Escape');
  await sheet.waitFor({ state: 'hidden' });

  // 3b. Filtro por Ubicación (A-1 vs B-2).
  await page.getByLabel('Filtrar por ubicación').click();
  await page.getByRole('option', { name: 'A-1', exact: true }).click();
  await page.getByRole('table').getByText('Bujía NGK', { exact: true }).waitFor();
  assert.equal(await page.getByRole('table').getByText('Filtro de Aceite', { exact: true }).count(), 0);
  await page.getByLabel('Filtrar por ubicación').click();
  await page.getByRole('option', { name: 'Todas las ubicaciones', exact: true }).click();
  await page.getByRole('table').getByText('Filtro de Aceite', { exact: true }).waitFor();

  // 3c. Editar existencia -> aparece Motivo del ajuste + sugerencias + Avisar al bajar del mínimo.
  const bujRow = page.getByRole('table').locator('tr', { hasText: 'BUJ-001' });
  await bujRow.getByRole('button', { name: 'Editar', exact: true }).click();
  await sheet.waitFor();
  await sheet.getByLabel('Existencia').fill('16');
  await sheet.getByText('+3 uds.', { exact: true }).waitFor();
  await sheet.getByRole('button', { name: 'Conteo físico', exact: true }).click();
  assert.equal(await sheet.getByLabel('Motivo del ajuste (opcional)').inputValue(), 'Conteo físico');
  await sheet.getByLabel('Alertas de reposición', { exact: true }).click();
  await sheet.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
  await sheet.waitFor({ state: 'hidden' });
  await page.getByText('Artículo actualizado', { exact: true }).waitFor();

  // 3d. Abrir Historial (Kardex) y verificar que muestra el ajuste con "Conteo físico", venta, compra y apertura + evidencia visual.
  await bujRow.getByRole('button', { name: 'Historial', exact: true }).click();
  const kardexDialog = page.getByRole('dialog');
  await kardexDialog.getByText('Historial de movimientos', { exact: true }).waitFor();
  await kardexDialog.getByText('Conteo físico', { exact: true }).waitFor();
  await kardexDialog.getByText('F-000001', { exact: true }).waitFor();
  await kardexDialog.getByText('Compra FAC-900', { exact: true }).waitFor();
  await kardexDialog.getByText('Existencia inicial', { exact: true }).waitFor();

  const outDir = path.resolve('dist/verification/inventory-improvements');
  await mkdir(outDir, { recursive: true });
  for (const vp of [{ w: 1440, h: 950, dark: false }, { w: 1440, h: 950, dark: true }, { w: 390, h: 844, dark: false }, { w: 320, h: 720, dark: false }]) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.evaluate(isDark => document.documentElement.classList.toggle('dark', isDark), vp.dark);
    await page.waitForTimeout(80);
    const overflow = await kardexDialog.evaluate(el => el.scrollWidth - el.clientWidth);
    assert.ok(overflow <= 1, `Desbordamiento horizontal en Kardex ${vp.w}px: ${overflow}`);
    await kardexDialog.screenshot({ path: path.join(outDir, `kardex-${vp.w}-${vp.dark ? 'dark' : 'light'}.png`) });
  }
  await kardexDialog.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await kardexDialog.waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.screenshot({ path: path.join(outDir, 'inventario-1440-light.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(outDir, 'inventario-390-light.png'), fullPage: true });
  assert.deepEqual(pageErrors, []);
});

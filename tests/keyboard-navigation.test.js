import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { chromium } from 'playwright-core';
import { temporaryPostgres } from './postgres.js';
import { testAuthService } from './fixtures/supabase-auth.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { readSnapshot, writeOperation } from '../src/pos/store.js';
import { createApp } from '../src/server.js';
import { hostingConfig } from '../src/hosting.js';
import { buildOperational } from '../scripts/build-operational.mjs';

const ownerPassword = 'clave-navegador-sintetica-12345';

test('E2E operación completa por teclado: navegación, Ctrl+K, Inventario, Caja, Venta, Recibo, Compras y permisos de Cajero', { timeout: 180000 }, async () => {
  let database, pool, auth, directory, server, browser;
  try {
    database = await temporaryPostgres();
    pool = new pg.Pool({ connectionString: database.connectionString });
    await migrateDatabase(pool);
    const snap0 = await readSnapshot(pool, 'Test');
    const databaseId = snap0.databaseId;
    const actor = { id: 'fixture-user', name: 'felix', role: 'dueno' };

    // Sembrar 2 productos y 1 suplidor para probar flujos de teclado
    await writeOperation(pool, 'POST', '/api/productos', {
      databaseId, codigo: 'KB-001', nombre: 'Bujía Teclado NGK', marca: 'NGK',
      ubicacion: 'A-1', stock: 15, minimo: 2, costo: 100, precio1: 200, precio2: 180, precio3: 160, itbis: true,
    }, randomUUID(), 'Test', actor);
    await writeOperation(pool, 'POST', '/api/productos', {
      databaseId, codigo: 'KB-002', nombre: 'Filtro Aceite Teclado', marca: 'Yamaha',
      ubicacion: 'A-2', stock: 10, minimo: 2, costo: 150, precio1: 300, precio2: 270, precio3: 240, itbis: true,
    }, randomUUID(), 'Test', actor);
    await writeOperation(pool, 'POST', '/api/suplidores', {
      databaseId, nombre: 'Suplidor Teclado SRL', rnc: '131999888', tel: '8095550199', contacto: 'Pedro', diasCredito: 30,
    }, randomUUID(), 'Test', actor);

    auth = await testAuthService();
    directory = await mkdtemp(join(tmpdir(), 'felix-kbd-'));
    await buildOperational(directory);
    server = await createApp(pool, {
      hosting: hostingConfig({ ...auth.env, SUPABASE_SECRET_KEY: 'sb_secret_fixture' }),
      assetsDirectory: pathToFileURL(directory + sep),
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const appOrigin = 'http://127.0.0.1:' + server.address().port;

    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'es-DO' });
    const loginRes = await context.request.post(appOrigin + '/login', {
      headers: { Origin: appOrigin },
      data: { username: 'felix', password: ownerPassword },
    });
    assert.equal(loginRes.status(), 200);
    const createCashier = await context.request.post(appOrigin + '/api/usuarios', {
      headers: { Origin: appOrigin },
      data: { username: 'cajerokb', displayName: 'Cajero Teclado', password: 'clave-cajero-123', role: 'cajero' },
    });
    assert.equal(createCashier.status(), 201);

    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.addInitScript(() => {
      window.__printCalls = 0;
      window.print = () => { window.__printCalls += 1; };
    });

    const evidence = resolve('dist/verification/keyboard');
    await mkdir(evidence, { recursive: true });

    // 1. Entrar al Panel y abrir la guía rápida de atajos (Alt+H)
    await page.goto(appOrigin + '/');
    await page.getByRole('heading', { name: 'Panel', exact: true }).waitFor();
    await page.keyboard.press('Alt+h');
    const shortcutsDlg = page.getByRole('dialog');
    await shortcutsDlg.getByRole('heading', { name: 'Atajos de teclado', exact: true }).waitFor();
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(evidence, 'shortcuts-dialog-1366-light.png'), animations: 'disabled' });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(evidence, 'shortcuts-dialog-1366-dark.png'), animations: 'disabled' });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.keyboard.press('Alt+h');
    await shortcutsDlg.waitFor({ state: 'hidden' });

    // 2. Navegar a Caja con Alt+5 y abrir turno 100% con teclado (F2 -> escribir -> Enter)
    await page.keyboard.press('Alt+5');
    await page.getByRole('heading', { name: 'Caja', exact: true }).waitFor();
    await page.keyboard.press('F2');
    await page.keyboard.type('3500');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Cerrar caja', exact: true }).waitFor();

    // 3. Navegar a Inventario con Alt+3, abrir Nuevo artículo con Alt+N y guardar con Ctrl+Enter
    await page.keyboard.press('Alt+3');
    await page.getByRole('heading', { name: 'Catálogo de artículos e inventario', exact: true }).waitFor();
    await page.keyboard.press('Alt+n');
    const productSheet = page.getByRole('dialog');
    await productSheet.getByRole('heading', { name: 'Nuevo artículo', exact: true }).waitFor();
    await productSheet.getByLabel('Código', { exact: true }).fill('KB-NEW');
    await productSheet.getByLabel('Nombre', { exact: true }).fill('Cadena Teclado 428');
    await productSheet.getByLabel('Existencia', { exact: true }).fill('5');
    await productSheet.getByLabel('Costo base RD$', { exact: true }).fill('250');
    await productSheet.getByLabel('Precio 1 · Detalle', { exact: true }).fill('450');
    await page.keyboard.press('Control+Enter');
    await productSheet.waitFor({ state: 'hidden' });
    await page.keyboard.press('F2');
    await page.keyboard.type('kbnew');
    await page.getByRole('cell', { name: /Cadena Teclado 428/ }).waitFor();

    // 4. Ir a Punto de venta con F1 (autoenfoque en buscador de productos)
    await page.keyboard.press('F1');
    await page.getByRole('heading', { name: 'Agregar productos', exact: true }).waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-sale-search') === 'true');

    // Agregar 2 artículos por teclado (buscar -> ArrowDown -> Enter)
    await page.keyboard.type('kb001');
    await page.locator('.sale-search-result', { hasText: 'Bujía Teclado NGK' }).waitFor();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.locator('.sale-cart tbody tr', { hasText: 'Bujía Teclado NGK' }).waitFor();

    await page.keyboard.type('kb002');
    await page.locator('.sale-search-result', { hasText: 'Filtro Aceite Teclado' }).waitFor();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.sale-cart tbody tr').count(), 2);

    // F3 edita cantidad del último agregado (KB-002), ArrowDown baja a KB-001, Ctrl+Backspace quita KB-001
    await page.keyboard.press('F3');
    await page.keyboard.type('2');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Control+Backspace');
    assert.equal(await page.locator('.sale-cart tbody tr').count(), 1);
    assert.equal(await page.locator('.sale-cart-qty-input').first().inputValue(), '2');
    await page.waitForFunction(() => document.activeElement?.classList.contains('sale-cart-qty-input'));

    // Enter desde cantidad devuelve el foco al buscador de productos
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-sale-search') === 'true');

    // F4 cambia nivel de precio, F7 cambia método de pago, Alt+D aplica descuento, F8 -> F8 llena Exacto y Enter cobra
    await page.keyboard.press('F4');
    await page.keyboard.press('F7');
    await page.keyboard.press('F7');
    await page.keyboard.press('F7'); // vuelve a Efectivo
    await page.keyboard.press('Alt+d');
    await page.keyboard.type('10');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-sale-search') === 'true');

    await page.keyboard.press('F8');
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-sale-received') === 'true');
    await page.keyboard.press('F8'); // 2da vez llena Exacto
    const receivedVal = await page.getByLabel('Monto recibido').inputValue();
    assert.equal(receivedVal, '540', 'F8 dos veces debe llenar el monto exacto con 10% de descuento (600 - 60 = 540)');

    await page.keyboard.press('Enter'); // Cobra directo desde Monto recibido
    const receiptDialog = page.getByRole('dialog');
    await receiptDialog.getByText('Venta registrada', { exact: true }).waitFor();
    const receiptBg = await receiptDialog.locator('.pos-receipt-document').evaluate(el => getComputedStyle(el).backgroundColor);
    assert.equal(receiptBg, 'rgb(255, 255, 255)', 'El fondo de la factura debe ser blanco puro');
    await page.screenshot({ path: join(evidence, 'receipt-white-1366-light.png'), animations: 'disabled' });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.waitForTimeout(150);
    const receiptBgDark = await receiptDialog.locator('.pos-receipt-document').evaluate(el => getComputedStyle(el).backgroundColor);
    assert.equal(receiptBgDark, 'rgb(255, 255, 255)', 'El fondo de la factura debe mantenerse blanco en tema oscuro');
    await page.screenshot({ path: join(evidence, 'receipt-white-1366-dark.png'), animations: 'disabled' });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    // Imprimir está enfocado por defecto -> Enter imprime, N inicia nueva venta y devuelve foco al buscador
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.__printCalls), 1, 'Enter en el recibo debe imprimir');
    await page.keyboard.press('n');
    await receiptDialog.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-sale-search') === 'true');
    assert.equal(await page.locator('.sale-cart tbody tr').count(), 0);

    // 4b. Entrar a Punto de venta por clic en menú -> foco automático en buscador; Enter en buscador vacío salta a Monto recibido; clic afuera + Enter cobra
    await page.locator('aside').getByRole('link', { name: 'Panel', exact: true }).click();
    await page.getByRole('heading', { name: 'Panel', exact: true }).waitFor();
    await page.locator('aside').getByRole('link', { name: /Punto de venta/ }).click();
    await page.getByRole('heading', { name: 'Agregar productos', exact: true }).waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-sale-search') === 'true');
    await page.keyboard.type('KB-001');
    await page.keyboard.press('Enter');
    await page.locator('.sale-cart tbody tr', { hasText: 'Bujía Teclado NGK' }).waitFor();
    await page.waitForTimeout(450);
    // Segundo Enter con buscador vacío y efectivo pendiente -> salta a Monto recibido
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.getAttribute('data-sale-received') === 'true');
    await page.keyboard.type('200');
    // Deseleccionar (clic afuera en título) y dar Enter -> registra la venta sin volver a seleccionar el campo
    await page.getByRole('heading', { name: 'Detalle de la factura' }).click();
    await page.keyboard.press('Enter');
    const receiptDialog2 = page.getByRole('dialog');
    await receiptDialog2.getByText('Venta registrada', { exact: true }).waitFor();
    await page.keyboard.press('n');
    await receiptDialog2.waitFor({ state: 'hidden' });

    // 4c. Escribir parcial a mano ("kb0" sin tocar flechas) + Enter agrega el resaltado; luego doble Enter en tarjeta cobra directo
    await page.keyboard.press('F7'); // Tarjeta
    await page.keyboard.type('kb0', { delay: 60 });
    await page.locator('.sale-search-result', { hasText: 'Bujía Teclado NGK' }).waitFor();
    await page.keyboard.press('Enter');
    await page.locator('.sale-cart tbody tr', { hasText: 'Bujía Teclado NGK' }).waitFor();
    await page.waitForTimeout(450);
    await page.keyboard.press('Enter');
    const receiptDialog3 = page.getByRole('dialog');
    await receiptDialog3.getByText('Venta registrada', { exact: true }).waitFor();
    await page.keyboard.press('n');
    await receiptDialog3.waitFor({ state: 'hidden' });

    // 5. Ctrl+K con ArrowDown y Enter para saltar a Compras
    await page.keyboard.press('Control+k');
    await page.keyboard.type('compra');
    await page.getByRole('option', { name: /Compras/ }).waitFor();
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Subir factura de compra', exact: true }).waitFor();

    // 6. Compras por teclado: Alt+S suplidor -> Enter -> escribir factura -> Enter -> código -> Enter -> cant -> Enter -> F9 confirmar
    await page.keyboard.press('Alt+s');
    await page.getByLabel('Buscar suplidor').waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Buscar suplidor');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.id === 'purchase-invoice');
    await page.keyboard.type('FAC-KB-100');
    await page.keyboard.press('Enter');
    await page.keyboard.type('KB-001');
    await page.keyboard.press('Enter');
    await page.keyboard.type('4');
    await page.keyboard.press('Enter');
    await page.getByRole('cell', { name: /Bujía Teclado NGK/ }).waitFor();
    await page.keyboard.press('F9');
    await page.getByText(/subida al inventario/i).waitFor();

    // Verificar en DB que la compra subió stock (15 - 2 ventas de KB-001 + 4 compra = 17) y la venta descontó KB-002 (10 - 2 = 8)
    const snapAfter = await readSnapshot(pool, 'Test');
    assert.equal(snapAfter.state.productos.find(p => p.codigo === 'KB-001').stock, 17);
    assert.equal(snapAfter.state.productos.find(p => p.codigo === 'KB-002').stock, 8);

    await context.close();

    // 7. Rol Cajero: Alt+4 (Compras) y Alt+8 (Reportes) NO navegan a rutas de dueño
    const cashierCtx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'es-DO' });
    const cashierLogin = await cashierCtx.request.post(appOrigin + '/login', {
      headers: { Origin: appOrigin },
      data: { username: 'cajerokb', password: 'clave-cajero-123' },
    });
    assert.equal(cashierLogin.status(), 200);
    const cashierPage = await cashierCtx.newPage();
    cashierPage.on('pageerror', err => errors.push(err.message));
    await cashierPage.goto(appOrigin + '/ventas');
    await cashierPage.getByRole('heading', { name: 'Agregar productos', exact: true }).waitFor();
    await cashierPage.locator('aside').getByRole('link', { name: 'Compras', exact: true }).waitFor({ state: 'hidden' });
    await cashierPage.keyboard.press('Alt+4');
    await cashierPage.keyboard.press('Alt+8');
    await cashierPage.waitForTimeout(150);
    assert.equal(new URL(cashierPage.url()).pathname, '/ventas', 'Un cajero no puede saltar a rutas de dueño con Alt+4/Alt+8');
    await cashierPage.keyboard.press('Alt+3');
    await cashierPage.getByRole('heading', { name: 'Catálogo de artículos e inventario', exact: true }).waitFor();
    await cashierCtx.close();

    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (server) await new Promise(done => server.close(done));
    await auth?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
    await pool?.end();
    await database?.stop();
  }
});

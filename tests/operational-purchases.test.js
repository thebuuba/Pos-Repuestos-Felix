import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { chromium } from 'playwright-core';
import { buildOperational } from '../scripts/build-operational.mjs';
import { migrateDatabase } from '../src/db/migrations.js';
import { createApp } from '../src/server.js';
import { temporaryPostgres } from './postgres.js';

let database, pool, assets, server, origin, browser, databaseId, supplierId;
before(async () => {
  database = await temporaryPostgres();
  const admin = new pg.Pool({ connectionString: database.connectionString });
  try { await migrateDatabase(admin); } finally { await admin.end(); }
  pool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app' });
  assets = await mkdtemp(path.join(tmpdir(), 'felix-compras-'));
  await buildOperational(assets);
  server = await createApp(pool, { assetsDirectory: pathToFileURL(assets + path.sep) });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  origin = 'http://127.0.0.1:' + server.address().port;
  databaseId = (await (await fetch(origin + '/api/state')).json()).databaseId;
  const formula = await write('formulas', { nombre: 'Recargo registrado', factorCosto: 1, recargo1: 10, recargo2: 5, recargo3: 0 });
  supplierId = (await write('suplidores', { nombre: 'Suplidor de prueba', formulaId: formula.result.id })).result.id;
  const unit = { nombre: 'Artículo de prueba', costo: '0.0050', precio1: 1, precio2: 1, precio3: 1, stock: '0.25' };
  await write('productos', { ...unit, codigo: 'B-X' });
  await write('productos', { ...unit, codigo: 'b-x ' });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
});
after(async () => {
  await browser?.close();
  if (server) await new Promise(done => server.close(done));
  await pool?.end();
  await database?.stop();
  if (assets) {
    assert.equal(path.dirname(path.resolve(assets)), path.resolve(tmpdir()));
    assert.ok(path.basename(assets).startsWith('felix-compras-'));
    await rm(assets, { recursive: true, force: true });
  }
});
async function write(resource, payload, method = 'POST') {
  const response = await fetch(origin + '/api/' + resource, { method,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ ...payload, databaseId }) });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

test('la compra conserva códigos literales, precios exactos, totales por línea y reintenta el mismo documento', async t => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  t.after(() => page.close());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/compras');
  const main = page.getByRole('main');
  await main.getByRole('combobox', { name: 'Suplidor', exact: true }).click();
  await page.getByRole('option', { name: 'Suplidor de prueba' }).click();
  assert.match(await main.getByLabel('Fórmula de precios').textContent(), /Recargo registrado/);
  await main.getByLabel('No. factura del suplidor').fill('REC-004');
  for (let i = 0; i < 2; i++) {
    await main.getByLabel('Código', { exact: true }).fill('b-x ');
    assert.equal(await main.getByLabel('Costo unitario').inputValue(), '0.0050');
    await main.getByLabel('Cantidad', { exact: true }).fill('1.25');
    await main.getByRole('button', { name: 'Agregar', exact: true }).click();
  }
  await main.getByLabel('P1', { exact: true }).last().fill('999999999998.9876');
  const packets = [];
  await page.route('**/api/compras', async route => {
    packets.push([route.request().headers()['idempotency-key'], route.request().postData()]);
    const response = await route.fetch();
    assert.equal(response.status(), 200, await response.text());
    return packets.length === 1 ? route.abort() : route.fulfill({ response });
  });
  await main.getByRole('button', { name: 'Subir factura al inventario' }).click();
  const retry = main.getByRole('button', { name: 'Reintentar compra' });
  await retry.waitFor();
  assert.equal(await main.getByLabel('No. factura del suplidor').inputValue(), 'REC-004');
  assert.equal(await main.getByLabel('P1', { exact: true }).last().isDisabled(), true);
  await retry.click();
  const history = main.getByRole('row').filter({ hasText: 'REC-004' });
  await history.getByText('RD$ 0.02', { exact: true }).waitFor();
  await main.getByText('Sin artículos en esta compra', { exact: true }).waitFor();
  assert.deepEqual(packets, [packets[0], packets[0]]);
  assert.equal(await main.getByLabel('No. factura del suplidor').inputValue(), '');
  const snapshot = (await (await fetch(origin + '/api/state')).json()).state;
  assert.equal(snapshot.compras.length, 1);
  assert.deepEqual(snapshot.compras[0].items.map(row => [row.codigo, row.cant, row.costoExacto, row.subtotal]),
    [['b-x ', 1.25, '0.0050', 0.01], ['b-x ', 1.25, '0.0050', 0.01]]);
  assert.equal(snapshot.productos.find(p => p.codigo === 'b-x ').stock, 2.75);
  assert.equal(snapshot.productos.find(p => p.codigo === 'B-X').stock, 0.25);
  const supplier = snapshot.suplidores.find(s => s.id === supplierId);
  await write('suplidores/' + supplierId, { version: supplier.version, nombre: 'Nombre modificado' }, 'PUT');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await history.getByText('Suplidor de prueba', { exact: true }).waitFor();
  await history.getByRole('button').focus();
  await page.keyboard.press('Enter');
  await page.getByRole('dialog').getByText(/999,999,999,998\.9876/).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
});

test('una compra sin fórmula exige los tres precios y mantiene el borrador al rechazar una factura repetida', async t => {
  const supplier = await write('suplidores', { nombre: 'Suplidor sin fórmula' });
  const page = await browser.newPage({ viewport: { width: 768, height: 1024 } });
  t.after(() => page.close());
  await page.goto(origin + '/compras');
  const main = page.getByRole('main');
  await main.getByRole('combobox', { name: 'Suplidor', exact: true }).click();
  await page.getByRole('option', { name: 'Suplidor sin fórmula' }).click();
  assert.match(await main.getByLabel('Fórmula de precios').textContent(), /Precios manuales/);
  await main.getByLabel('No. factura del suplidor').fill('MAN-1');
  await main.getByLabel('Código', { exact: true }).fill('nuevo-manual');
  await main.getByLabel('Descripción', { exact: true }).fill('Primera entrada');
  await main.getByLabel('Costo unitario').fill('9.0005');
  await main.getByRole('button', { name: 'Agregar', exact: true }).click();
  const submit = main.getByRole('button', { name: 'Subir factura al inventario' });
  assert.equal(await submit.isDisabled(), true);
  assert.equal(await main.getByLabel('P1', { exact: true }).inputValue(), '');
  for (const price of ['P1', 'P2', 'P3']) await main.getByLabel(price, { exact: true }).fill('10.0088');
  const original = { suplidorId: supplier.result.id, numero: 'MAN-1', items: [
    { codigo: 'original', nombre: 'Original', cantidad: '1', costo: '2', precio1: '3', precio2: '3', precio3: '3' },
  ] };
  await write('compras', original);
  const rejected = page.waitForResponse(r => r.url().endsWith('/api/compras') && r.status() === 409);
  await submit.click();
  await rejected;
  await main.getByRole('alert').waitFor();
  assert.equal(await main.getByLabel('No. factura del suplidor').inputValue(), 'MAN-1');
  await main.getByLabel('No. factura del suplidor').fill('MAN-2');
  await submit.click();
  await main.getByRole('row').filter({ hasText: 'MAN-2' }).getByText('RD$ 9.00', { exact: true }).waitFor();
  const state = (await (await fetch(origin + '/api/state')).json()).state;
  assert.deepEqual(state.compras.filter(p => p.suplidorId === supplier.result.id).map(p => p.numero).sort(), ['MAN-1','MAN-2']);
  assert.equal(state.productos.find(p => p.codigo === 'nuevo-manual').preciosExactos.p3, '10.0088');
});

test('dos sesiones que crean o editan un código obligan a revisar la compra antes de actualizar el catálogo', async t => {
  const supplier = await write('suplidores', { nombre: 'Revisión de catálogo' });
  const old = { codigo: 'existente ', nombre: 'Descripción inicial', costo: '1.1100',
    precio1: '2.0000', precio2: '1.9000', precio3: '1.8000', stock: '3.75' };
  const initial = await write('productos', old);
  const oldProduct = initial.state.productos.find(p => p.id === initial.result.id);
  const page = await browser.newPage();
  const other = await browser.newPage();
  t.after(() => Promise.all([page.close(), other.close()]));
  await page.goto(origin + '/compras');
  const main = page.getByRole('main');
  await main.getByRole('combobox', { name: 'Suplidor', exact: true }).click();
  await page.getByRole('option', { name: 'Revisión de catálogo' }).click();
  const invoice = main.getByLabel('No. factura del suplidor');
  await invoice.fill('CONCURRENTE');
  const add = main.getByRole('button', { name: 'Agregar', exact: true });
  await main.getByLabel('Código', { exact: true }).fill(old.codigo);
  await main.getByLabel('Cantidad', { exact: true }).fill('1.50');
  await add.click();
  const newCode = 'creado-en-otra-caja';
  await main.getByLabel('Código', { exact: true }).fill(newCode);
  await main.getByLabel('Descripción', { exact: true }).fill('Nombre propuesto');
  await main.getByLabel('Costo unitario').fill('0.125');
  await add.click();
  for (const k of ['P1','P2','P3']) await main.getByLabel(k, { exact: true }).last().fill('2');

  const packets = [];
  await page.route('**/api/compras', async route => {
    packets.push(route.request().postDataJSON());
    if (packets.length === 1) {
      const competing = async (method, resource, data) => {
        const response = await other.request.fetch(origin + '/api/' + resource, { method,
          headers: { 'Idempotency-Key': randomUUID() }, data: { ...data, databaseId } });
        assert.equal(response.status(), 200, await response.text());
      };
      await competing('PUT', 'productos/' + oldProduct.id, { ...old, version: oldProduct.version,
        nombre: 'Descripción corregida', costo: '3.1234', precio1: '4.0001' });
      await competing('POST', 'productos', { ...old, codigo: newCode, nombre: 'Alta concurrente', precio1: '12.3456' });
    }
    await route.continue();
  });
  const submit = main.getByRole('button', { name: 'Subir factura al inventario' });
  const rejected = page.waitForResponse(r => r.url().endsWith('/api/compras') && r.status() === 409);
  await submit.click();
  await rejected;
  const review = main.getByRole('button', { name: 'Usar datos actuales' });
  await review.nth(1).waitFor();
  assert.equal(await submit.isDisabled(), true);
  assert.equal(await invoice.inputValue(), 'CONCURRENTE');
  assert.equal(await main.getByLabel('P1', { exact: true }).first().inputValue(), '2.0000');
  assert.deepEqual(packets[0].items.map(l => [l.productoId, l.versionProducto]), [[oldProduct.id, oldProduct.version], [null, null]]);
  const beforeReview = (await (await fetch(origin + '/api/state')).json()).state;
  assert.equal(beforeReview.compras.some(c => c.suplidorId === supplier.result.id), false);
  assert.equal(beforeReview.productos.find(p => p.codigo === old.codigo).stock, 3.75);
  await review.first().click();
  assert.equal(await submit.isDisabled(), true);
  await review.first().click();
  assert.equal(await main.getByLabel('P1', { exact: true }).first().inputValue(), '4.0001');
  assert.equal(await main.getByLabel('P1', { exact: true }).last().inputValue(), '12.3456');
  await submit.click();
  await main.getByRole('row').filter({ hasText: 'CONCURRENTE' }).getByText('RD$ 5.80', { exact: true }).waitFor();
  const saved = (await (await fetch(origin + '/api/state')).json()).state;
  const doc = saved.compras.find(c => c.suplidorId === supplier.result.id);
  assert.deepEqual(doc.items.map(l => [l.nombre, l.costoExacto, l.preciosExactos.p1]),
    [['Descripción corregida','3.1234','4.0001'], ['Alta concurrente','1.1100','12.3456']]);
  assert.deepEqual(doc.items.map(l => saved.productos.find(p => p.id === l.productoId).stock), [5.25, 4.75]);
});

test('dos altas simultáneas del mismo código solo confirman la compra que lo encontró ausente', async () => {
  const codigo = 'código en disputa ';
  const attempt = numero => fetch(origin + '/api/compras', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ databaseId, suplidorId: supplierId, numero, items: [{
      codigo, nombre: numero, cantidad: '0.50', costo: '1.0000', precio1: '2', precio2: '2', precio3: '2',
      productoId: null, versionProducto: null,
    }] }),
  });
  const responses = await Promise.all(['Disputa A', 'Disputa B'].map(attempt));
  assert.deepEqual(responses.map(r => r.status).sort(), [200,409]);
  const rejected = await responses.find(r => r.status === 409).json();
  assert.match(rejected.error, /cambió/);
  const confirmed = await responses.find(r => r.status === 200).json();
  const product = confirmed.state.productos.find(p => p.codigo === codigo);
  assert.equal(product.stock, 0.5);
  const all = (await (await fetch(origin + '/api/state')).json()).state;
  assert.deepEqual(all.compras.filter(row => row.numero.startsWith('Disputa ')).map(row => row.numero), [product.nombre]);
  assert.equal(all.movimientos.filter(m => m.productoId === product.id && m.tipo === 'compra').length, 1);
});

test('compras permite buscar suplidor, buscar pieza por nombre y subir cantidad de 1 en 1', async t => {
  await write('suplidores', { nombre: 'Importadora Cibao Express', rnc: '131444555', contacto: 'Ana' });
  await write('productos', {
    codigo: 'BUJ-NGK-9', nombre: 'Bujía NGK Punta Platino', marca: 'NGK',
    costo: '125.0000', precio1: '250.0000', precio2: '225.0000', precio3: '200.0000', stock: '6',
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  t.after(() => page.close());
  await page.goto(origin + '/compras');
  const main = page.getByRole('main');

  // 1. Buscar suplidor por RNC en el combobox y elegir con Enter
  await main.getByRole('combobox', { name: 'Suplidor', exact: true }).click();
  const supSearch = main.getByLabel('Buscar suplidor');
  await supSearch.fill('131444555');
  await supSearch.press('Enter');
  assert.match(await main.getByRole('combobox', { name: 'Suplidor', exact: true }).textContent(), /Importadora Cibao Express/);

  // 2. Sin escribir código nuevo, Descripción no estorba; buscar pieza por nombre en el buscador único
  assert.equal(await main.getByLabel('Descripción', { exact: true }).count(), 0);
  await main.getByLabel('Código', { exact: true }).fill('Platino');
  await main.getByRole('option', { name: /Bujía NGK Punta Platino/i }).click();
  assert.equal(await main.getByLabel('Código', { exact: true }).inputValue(), 'BUJ-NGK-9');
  assert.equal(await main.getByLabel('Costo unitario').inputValue(), '125.0000');
  assert.equal(await main.getByLabel('Descripción', { exact: true }).count(), 0);

  // 3. Flecha arriba en Cantidad debe subir 1 -> 2 -> 3 (no 1.01)
  const qty = main.getByLabel('Cantidad', { exact: true });
  assert.equal(await qty.inputValue(), '1');
  await qty.press('ArrowUp');
  assert.equal(await qty.inputValue(), '2');
  await qty.press('ArrowUp');
  assert.equal(await qty.inputValue(), '3');
});

test('ver factura de compra en modal, anular compra a crédito (restando inventario y deuda CxP) y re-subir con el mismo número', async t => {
  const sup = await write('suplidores', { nombre: 'Suplidor Anulable', rnc: '130999111', diasCredito: 30 });
  const prod = await write('productos', {
    codigo: 'ANUL-COMP-1', nombre: 'Amortiguador delantero',
    costo: '500.0000', precio1: '1000.0000', precio2: '900.0000', precio3: '800.0000', stock: '4',
  });
  const created = await write('compras', {
    suplidorId: sup.result.id, numero: 'FAC-ERR-01', condicion: 'Credito', vencimiento: '2030-12-01',
    items: [{
      productoId: prod.result.id, versionProducto: 1, codigo: 'ANUL-COMP-1', nombre: 'Amortiguador delantero',
      cantidad: '3', costo: '500.0000', precio1: '1000.0000', precio2: '900.0000', precio3: '800.0000',
    }],
  });
  assert.equal(created.state.productos.find(p => p.id === prod.result.id).stock, 7);
  assert.equal(created.state.suplidores.find(s => s.id === sup.result.id).deuda, 1500);

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  t.after(() => page.close());
  await page.goto(origin + '/compras');
  const main = page.getByRole('main');

  // 1. Tocar la fila de FAC-ERR-01 -> se abre el modal con forma de factura completa
  await main.getByRole('row').filter({ hasText: 'FAC-ERR-01' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', { name: /Factura de compra FAC-ERR-01/i }).waitFor({ state: 'visible' });
  await dialog.getByText('Suplidor Anulable').first().waitFor({ state: 'visible' });
  await dialog.getByText('130999111').waitFor({ state: 'visible' });
  await dialog.getByText('Amortiguador delantero').waitFor({ state: 'visible' });
  await dialog.getByRole('button', { name: 'Imprimir' }).waitFor({ state: 'visible' });

  // C1: verificar que en modo impresión (@media print) el documento es visible y no sale una hoja en blanco
  await page.emulateMedia({ media: 'print' });
  const printBox = await dialog.locator('.pos-receipt-document').boundingBox();
  assert.ok(printBox && printBox.width > 200 && printBox.height > 100, `Factura de compra debe imprimirse visible, box=${JSON.stringify(printBox)}`);
  assert.equal(await dialog.getByRole('heading', { name: /Factura de compra FAC-ERR-01/i }).isHidden(), true, 'El encabezado del modal debe ocultarse al imprimir');
  await page.emulateMedia({ media: 'screen' });

  // 2. Anular la compra desde el modal con motivo
  await dialog.getByRole('button', { name: 'Anular compra' }).click();
  await dialog.getByLabel('Motivo de anulación').fill('Cantidad equivocada en factura');
  await dialog.getByRole('button', { name: 'Confirmar anulación' }).click();
  await dialog.getByText('Compra anulada').waitFor({ state: 'visible' });
  await dialog.getByText(/Cantidad equivocada en factura/).waitFor({ state: 'visible' });
  await dialog.getByRole('button', { name: 'Cerrar' }).click();

  // 3. Verificar inventario revertido (7 -> 4), deuda CxP en 0 y que permite re-subir FAC-ERR-01
  const afterVoid = (await (await fetch(origin + '/api/state')).json()).state;
  const prodAfter = afterVoid.productos.find(p => p.id === prod.result.id);
  assert.equal(prodAfter.stock, 4);
  assert.equal(afterVoid.suplidores.find(s => s.id === sup.result.id).deuda, 0);
  assert.ok(afterVoid.movimientos.some(m => m.tipo === 'anulacion_compra' && m.cantidad === -3 && m.existencia_posterior === 4));

  // Re-subir FAC-ERR-01 corregida con 2 unidades debe permitirse sin conflicto 409
  const reuploaded = await write('compras', {
    suplidorId: sup.result.id, numero: 'FAC-ERR-01', condicion: 'Credito', vencimiento: '2030-12-01',
    items: [{
      productoId: prod.result.id, versionProducto: prodAfter.version, codigo: 'ANUL-COMP-1', nombre: 'Amortiguador delantero',
      cantidad: '2', costo: '500.0000', precio1: '1000.0000', precio2: '900.0000', precio3: '800.0000',
    }],
  });
  assert.equal(reuploaded.state.productos.find(p => p.id === prod.result.id).stock, 6);
  assert.equal(reuploaded.state.suplidores.find(s => s.id === sup.result.id).deuda, 1000);
});

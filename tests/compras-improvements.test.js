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
import { DesktopLedger } from '../src/desktop/ledger.js';
import { DesktopEngine } from '../src/desktop/engine.js';
import { readSyncBootstrap, writeSyncOperation } from '../src/pos/sync-operations.js';
import { temporaryPostgres } from './postgres.js';

let database, pool, assets, server, origin, browser, databaseId, supplierId;

before(async () => {
  database = await temporaryPostgres();
  const admin = new pg.Pool({ connectionString: database.connectionString });
  try { await migrateDatabase(admin); } finally { await admin.end(); }
  pool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app' });
  assets = await mkdtemp(path.join(tmpdir(), 'felix-compras-mejoras-'));
  await buildOperational(assets);
  server = await createApp(pool, { assetsDirectory: pathToFileURL(assets + path.sep) });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  origin = 'http://127.0.0.1:' + server.address().port;
  databaseId = (await (await fetch(origin + '/api/state')).json()).databaseId;
  const formula = await write('formulas', {
    nombre: 'Distribuidora Nacional (1.12 / 13% / 15%)',
    factorCosto: '1.12', recargo2: '13', recargo1: '15', recargo3: '0',
  });
  supplierId = (await write('suplidores', {
    nombre: 'Distribuidora Nacional de Repuestos', rnc: '101999888', diasCredito: 15, formulaId: formula.result.id,
  })).result.id;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise(done => server.close(done));
  await pool?.end();
  await database?.stop();
  if (assets) {
    assert.equal(path.dirname(path.resolve(assets)), path.resolve(tmpdir()));
    assert.ok(path.basename(assets).startsWith('felix-compras-mejoras-'));
    await rm(assets, { recursive: true, force: true });
  }
});

async function write(resource, payload, method = 'POST') {
  const response = await fetch(origin + '/api/' + resource, {
    method,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ ...payload, databaseId }),
  });
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

test('Puntos 1-5 de Compras: Referencia global, fecha de factura, descripción completa, cabecera compacta A crédito/Al contado y sin fórmula manual', { timeout: 120000 }, async t => {
  const longDesc = 'Kit completo de cadena de distribución reforzada con tensores hidráulicos para CG-150 / CG-200';
  // Dos marcas distintas pueden compartir la misma referencia OEM del fabricante
  const p1 = await write('productos', {
    codigo: 'CAD-001', referencia: 'OEM-94701-A', nombre: longDesc,
    marca: 'DID', categoria: 'Motor', ubicacion: 'A-12',
    costo: '450.0000', precio1: '900.0000', precio2: '800.0000', precio3: '750.0000', stock: '5',
  });
  await write('productos', {
    codigo: 'CAD-002', referencia: 'OEM-94701-A', nombre: 'Cadena alterna económica CG-150',
    marca: 'Genérica', categoria: 'Motor', ubicacion: 'A-13',
    costo: '250.0000', precio1: '500.0000', precio2: '450.0000', precio3: '420.0000', stock: '8',
  });

  // Validar respaldo v10 con referencia + compatibilidad hacia atrás con respaldo v9
  const backupV10 = await (await fetch(origin + '/api/backup')).json();
  assert.equal(backupV10.version, 10);
  assert.equal(backupV10.tables.productos.find(p => p.codigo === 'CAD-001').referencia, 'OEM-94701-A');
  const backupV9 = structuredClone(backupV10);
  backupV9.version = 9;
  for (const row of backupV9.tables.productos) delete row.referencia;
  // Rechazar fecha de vencimiento anterior a fecha de factura en API
  const badDateRes = await fetch(origin + '/api/compras', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({
      databaseId, suplidorId: supplierId, numero: 'FECH-ERR', fecha: '2026-10-20',
      condicion: 'Credito', vencimiento: '2026-10-10',
      items: [{ codigo: 'CAD-001', nombre: longDesc, cantidad: '1', costo: '450', precio1: '900', precio2: '800', precio3: '750' }],
    }),
  });
  assert.equal(badDateRes.status, 400);

  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  t.after(() => page.close());
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  // 1. Compras: validar cabecera (A crédito por defecto, Al contado, anchos compactos, sin fórmula manual, fecha factura)
  await page.goto(origin + '/compras');
  const main = page.getByRole('main');
  await main.getByRole('combobox', { name: 'Suplidor', exact: true }).waitFor();

  assert.equal(await main.getByLabel('Fórmula de precios').count(), 0, 'Fórmula de precios debe estar eliminada de Compras');
  const condTrigger = main.getByRole('combobox', { name: 'Condición' });
  assert.match(await condTrigger.textContent(), /A crédito/);
  await condTrigger.click();
  await page.getByRole('option', { name: 'Al contado', exact: true }).waitFor();
  assert.equal(await page.getByRole('option', { name: /Pagada/i }).count(), 0, 'No debe decir Pagada (contado)');
  await page.keyboard.press('Escape');

  const supBox = await main.getByRole('combobox', { name: 'Suplidor', exact: true }).boundingBox();
  const invBox = await main.getByLabel('No. factura del suplidor').boundingBox();
  const condBox = await condTrigger.boundingBox();
  assert.ok(invBox.width <= 145, `No. Fact. debe ser compacto (~60 %), width=${invBox.width}`);
  assert.ok(condBox.width <= 145, `Condición debe ser compacta (~60 %), width=${condBox.width}`);
  assert.ok(supBox.width >= 240, `Suplidor debe conservar espacio generoso, width=${supBox.width}`);

  // Seleccionar suplidor y cambiar fecha de factura -> vencimiento se recalcula (+15 días)
  await main.getByRole('combobox', { name: 'Suplidor', exact: true }).click();
  await page.getByRole('option', { name: 'Distribuidora Nacional de Repuestos' }).click();
  await main.getByLabel('No. factura del suplidor').fill('FAC-REF-100');
  const dateInput = main.getByLabel('Fecha de factura');
  await dateInput.fill('2026-10-15');
  assert.equal(await main.locator('#purchase-due-date').inputValue(), '2026-10-30');

  // Buscar por Referencia sin guiones ("oem94701a"), verificar descripción completa SIN truncate
  // y confirmar que Enter directo sobre el resultado sombreado lo selecciona y salta a Cantidad
  const codeInput = main.getByLabel('Código', { exact: true });
  await codeInput.fill('oem94701a');
  const firstOption = main.getByRole('option').filter({ hasText: 'CAD-001' });
  await firstOption.waitFor();
  await firstOption.getByText('Ref. OEM-94701-A').waitFor();
  const descMetrics = await firstOption.locator('span').nth(1).evaluate(el => {
    const cs = getComputedStyle(el);
    return { whiteSpace: cs.whiteSpace, textOverflow: cs.textOverflow, text: el.textContent };
  });
  assert.equal(descMetrics.text, longDesc);
  assert.notEqual(descMetrics.textOverflow, 'ellipsis', 'La descripción en Compras no debe cortarse con ellipsis');
  await codeInput.press('Enter');
  assert.equal(await codeInput.inputValue(), 'CAD-001', 'Enter debe seleccionar directamente el primer resultado sombreado');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Cantidad');

  // Confirmar referencia cargada, descripción completa y flujo exacto de teclado:
  // Cantidad (Enter) -> P/Lista (100 -> Costo 112, Enter) -> Costo (Enter) -> agrega línea abajo
  assert.equal(await main.getByLabel('Referencia', { exact: true }).inputValue(), 'OEM-94701-A');
  await main.getByText(longDesc, { exact: true }).waitFor();
  const qtyInput = main.getByLabel('Cantidad', { exact: true });
  await qtyInput.fill('5');
  await qtyInput.press('Enter');
  assert.equal(await main.locator('table.purchase-lines-table tbody tr').count(), 0, 'Enter en Cantidad no debe bajar la línea de una vez');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Precio de lista');
  await page.keyboard.type('100');
  assert.equal(await main.getByLabel('Costo unitario').inputValue(), '112');
  await page.keyboard.press('Enter');
  assert.equal(await main.locator('table.purchase-lines-table tbody tr').count(), 0, 'Enter en P/Lista debe pasar a Costo');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Costo unitario');
  await page.keyboard.press('Enter');
  assert.equal(await main.locator('table.purchase-lines-table tbody tr').count(), 1);
  assert.equal(await main.getByLabel('Cantidad de la línea').first().inputValue(), '5');
  // Volver a cantidad 1 para la comprobación del total final
  await main.getByLabel('Cantidad de la línea').first().fill('1');

  // Verificar a 1366×768 (laptop Dell) que Artículo NO se pone vertical y todos los inputs están alineados al mismo nivel
  await page.setViewportSize({ width: 1366, height: 768 });
  const layoutCheck = await page.evaluate(() => {
    const table = document.querySelector('table.purchase-lines-table');
    const articleCell = table?.querySelector('tbody td.purchase-col-article');
    const costEl = table?.querySelector('input[aria-label="Costo de la línea"]');
    const p2El = table?.querySelector('input[aria-label="P/Mayor"]');
    const p1El = table?.querySelector('input[aria-label="Detalle"]');
    const qtyEl = table?.querySelector('input[aria-label="Cantidad de la línea"]');
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      articleWidth: articleCell?.getBoundingClientRect().width ?? 0,
      qtyY: qtyEl?.getBoundingClientRect().y ?? 0,
      costY: costEl?.getBoundingClientRect().y ?? 0,
      p2Y: p2El?.getBoundingClientRect().y ?? 0,
      p1Y: p1El?.getBoundingClientRect().y ?? 0,
    };
  });
  assert.ok(layoutCheck.overflow <= 0, `Overflow a 1366px: ${layoutCheck.overflow}`);
  assert.ok(layoutCheck.articleWidth >= 230, `Artículo debe ser ancho y horizontal a 1366px, width=${layoutCheck.articleWidth}`);
  assert.ok(Math.abs(layoutCheck.costY - layoutCheck.p2Y) <= 2, `Desnivel Costo/P/Mayor: ${JSON.stringify(layoutCheck)}`);
  assert.ok(Math.abs(layoutCheck.costY - layoutCheck.p1Y) <= 2, `Desnivel Costo/Detalle: ${JSON.stringify(layoutCheck)}`);
  assert.ok(Math.abs(layoutCheck.qtyY - layoutCheck.costY) <= 2, `Desnivel Cantidad/Costo: ${JSON.stringify(layoutCheck)}`);
  await page.setViewportSize({ width: 1440, height: 960 });

  // Verificar orden exacto de columnas: [Artículo, Cantidad, P/Lista, Costo, P/Mayor, Detalle, Subtotal, ""]
  const headers = await main.locator('table.purchase-lines-table thead th').allTextContents();
  assert.match(headers[0], /Artículo/);
  assert.match(headers[1], /Cantidad/);
  assert.match(headers[2], /P\/Lista/);
  assert.match(headers[3], /Costo/);
  assert.match(headers[4], /P\/Mayor/);
  assert.match(headers[5], /Detalle/);
  assert.match(headers[6], /Subtotal/);

  // Verificar sugerencias encima de P/Mayor (126.56) y Detalle (145.54) SIN sobrescribir precios existentes (800.00 / 900.00)
  await main.getByRole('button', { name: 'Sugerencia P/Mayor: 126.56' }).waitFor();
  await main.getByRole('button', { name: 'Sugerencia Detalle: 145.54' }).waitFor();
  assert.equal(await main.getByLabel('P/Mayor', { exact: true }).first().inputValue(), '800.00');
  assert.equal(await main.getByLabel('Detalle', { exact: true }).first().inputValue(), '900.00');

  // Cambiar P/Lista en la tabla (100 -> 200) recalcula Costo (224) y sugerencias (253.12 / 291.09) sin tocar P/Mayor ni Detalle
  await main.getByLabel('P/Lista de la línea').first().fill('200');
  assert.equal(await main.getByLabel('Costo de la línea').first().inputValue(), '224');
  await main.getByRole('button', { name: 'Sugerencia P/Mayor: 253.12' }).waitFor();
  await main.getByRole('button', { name: 'Sugerencia Detalle: 291.09' }).waitFor();
  assert.equal(await main.getByLabel('P/Mayor', { exact: true }).first().inputValue(), '800.00');
  assert.equal(await main.getByLabel('Detalle', { exact: true }).first().inputValue(), '900.00');
  await main.getByLabel('P/Lista de la línea').first().fill('100');
  assert.equal(await main.getByLabel('Costo de la línea').first().inputValue(), '112');

  // Agregar un artículo NUEVO: P/Mayor y Detalle quedan VACÍAS para llenar manualmente, con sugerencias arriba
  await codeInput.fill('BUJ-NUEVA-1');
  await main.getByLabel('Referencia', { exact: true }).fill('NGK-CR7HSA');
  await main.getByLabel('Nombre', { exact: true }).fill('Bujía NGK Nueva con Referencia');
  await main.getByLabel('Precio de lista', { exact: true }).fill('100');
  assert.equal(await main.getByLabel('Costo unitario').inputValue(), '112');
  await main.getByRole('button', { name: 'Agregar', exact: true }).click();
  assert.equal(await main.getByLabel('P/Mayor', { exact: true }).last().inputValue(), '');
  assert.equal(await main.getByLabel('Detalle', { exact: true }).last().inputValue(), '');
  assert.equal(await main.getByRole('button', { name: 'Subir factura al inventario' }).isDisabled(), true);
  // Clic opcional en la sugerencia de P/Mayor copia 126.56; Detalle se llena manualmente en 150
  await main.getByRole('button', { name: 'Sugerencia P/Mayor: 126.56' }).last().click();
  assert.equal(await main.getByLabel('P/Mayor', { exact: true }).last().inputValue(), '126.56');
  await main.getByLabel('Detalle', { exact: true }).last().fill('150');

  await main.getByRole('button', { name: 'Subir factura al inventario' }).click();
  const row = main.getByRole('row').filter({ hasText: 'FAC-REF-100' });
  await row.waitFor();
  await row.getByText(/15.*oct.*2026/i).waitFor();

  // Verificar en /api/state: el total suma Costo (112 + 112 = 224), fecha exacta, referencia y p3 sincronizado con p2
  const snap = (await (await fetch(origin + '/api/state')).json()).state;
  const savedPurchase = snap.compras.find(c => c.numero === 'FAC-REF-100');
  assert.equal(savedPurchase.fechaISO, '2026-10-15');
  assert.equal(savedPurchase.vencimiento, '2026-10-30');
  assert.equal(savedPurchase.condicion, 'Credito');
  assert.equal(savedPurchase.total, 224);
  const newProd = snap.productos.find(p => p.codigo === 'BUJ-NUEVA-1');
  assert.equal(newProd.referencia, 'NGK-CR7HSA');
  assert.equal(newProd.costo, 112);
  assert.equal(newProd.precio2, 126.56);
  assert.equal(newProd.precio1, 150);
  assert.equal(newProd.precio3, 126.56);

  // 2. Ventas: buscar por Referencia, verla en resultados/carrito y confirmar que Precio 3 fue eliminado
  await page.goto(origin + '/ventas');
  await page.getByRole('combobox', { name: 'Nivel de precio' }).click();
  assert.equal(await page.getByRole('option', { name: /Precio 3|Taller/i }).count(), 0, 'Precio 3 debe estar eliminado en Ventas');
  await page.keyboard.press('Escape');
  const posSearch = page.getByLabel('Código o nombre del producto', { exact: true });
  await posSearch.fill('ngkcr7hsa');
  await page.getByRole('button', { name: /Bujía NGK Nueva con Referencia/i }).getByText('Ref. NGK-CR7HSA').waitFor();
  await page.getByRole('button', { name: /Bujía NGK Nueva con Referencia/i }).click();
  await page.getByRole('table').getByText('Ref. NGK-CR7HSA').waitFor();

  // 3. Inventario: buscar por Referencia, sin columna ni campo Precio 3, y editar Referencia
  await page.goto(origin + '/inventario');
  assert.equal(await page.getByRole('columnheader', { name: /Precio 3/i }).count(), 0, 'Precio 3 debe estar eliminado en Inventario');
  const invSearch = page.getByRole('textbox', { name: 'Buscar por código, nombre o marca' });
  await invSearch.fill('NGK-CR7HSA');
  const invRow = page.getByRole('row').filter({ hasText: 'BUJ-NUEVA-1' });
  await invRow.getByText('Ref. NGK-CR7HSA').waitFor();
  await invRow.getByRole('button', { name: 'Editar' }).click();
  assert.equal(await page.getByLabel(/Precio 3/i).count(), 0, 'Precio 3 debe estar eliminado del formulario de artículo');
  const refField = page.getByLabel('Referencia', { exact: true });
  assert.equal(await refField.inputValue(), 'NGK-CR7HSA');
  await refField.fill('NGK-CR7HSA-V2');
  await page.getByRole('button', { name: 'Guardar cambios' }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await invSearch.fill('NGK-CR7HSA-V2');
  await page.getByRole('row').filter({ hasText: 'BUJ-NUEVA-1' }).getByText('Ref. NGK-CR7HSA-V2').waitFor();

  // 4. Búsqueda global (Ctrl+K): encontrar y mostrar Referencia
  const globalSearch = page.getByLabel('Buscar en el sistema');
  await globalSearch.fill('NGK-CR7HSA-V2');
  await page.getByRole('option', { name: /Bujía NGK Nueva con Referencia/i }).getByText(/Ref\. NGK-CR7HSA-V2/).waitFor();

  // 5. Desktop SQLite offline sync: crear compra offline con fecha y referencia y sincronizar sin conflicto
  const dir = await mkdtemp(path.join(tmpdir(), 'felix-desktop-ref-'));
  const actor = { id: randomUUID(), name: 'Dueño Desktop' };
  const adminPool = new pg.Pool({ connectionString: database.connectionString });
  const remote = (reqPath, opts) => reqPath === '/api/sync/bootstrap'
    ? readSyncBootstrap(adminPool, 'Nube')
    : writeSyncOperation(adminPool, opts.body, 'Nube', actor);
  const engine = new DesktopEngine(new DesktopLedger(dir));
  t.after(async () => {
    await engine.close();
    await adminPool.end();
    await rm(dir, { recursive: true, force: true });
  });
  await engine.adopt(await remote('/api/sync/bootstrap'));
  const localSnap = await engine.snapshot();
  const localProd = localSnap.state.productos.find(p => p.codigo === 'CAD-001');
  assert.equal(localProd.referencia, 'OEM-94701-A');
  await engine.write('POST', '/api/compras', {
    databaseId: localSnap.databaseId, suplidorId: supplierId, numero: 'OFF-REF-1',
    fecha: '2026-10-18', condicion: 'Contado',
    items: [{
      productoId: localProd.id, versionProducto: localProd.version,
      codigo: 'CAD-001', referencia: 'OEM-94701-ACTUALIZADA', nombre: longDesc,
      cantidad: '2', costo: '450.0000', precio1: '900.0000', precio2: '800.0000', precio3: '750.0000',
    }],
  }, randomUUID(), actor);
  const syncStatus = await engine.synchronize(remote, actor);
  assert.equal(syncStatus.pending, 0, JSON.stringify(syncStatus));
  assert.equal(syncStatus.conflict, null);
  const afterSync = (await (await fetch(origin + '/api/state')).json()).state;
  assert.equal(afterSync.compras.find(c => c.numero === 'OFF-REF-1').fechaISO, '2026-10-18');
  assert.equal(afterSync.productos.find(p => p.id === p1.result.id).referencia, 'OEM-94701-ACTUALIZADA');

  // 6. Compatibilidad hacia atrás: restaurar respaldo v9 (sin columna referencia) rellena '' sin error
  const beforeRestore = await (await fetch(origin + '/api/state')).json();
  const restoreV9 = await fetch(origin + '/api/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
    body: JSON.stringify({ databaseId: beforeRestore.databaseId, revision: beforeRestore.revision, backup: backupV9 }),
  });
  assert.equal(restoreV9.status, 200, await restoreV9.clone().text());
  const afterRestore = await restoreV9.json();
  databaseId = afterRestore.databaseId;
  assert.equal(afterRestore.state.productos.find(p => p.codigo === 'CAD-001').referencia, '');

  // 7. Cero desbordamiento horizontal en móvil 390px, tablet 768px y escritorio 1024/1280/1366/1440px en Compras
  for (const width of [390, 768, 1024, 1280, 1366, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin + '/compras');
    await main.getByRole('combobox', { name: 'Suplidor', exact: true }).waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 0, `Desbordamiento en Compras a ${width}px: ${overflow}px`);
  }

  // 8. Suplidores: crear y editar cálculo del suplidor directo en la ficha y abrir Compras preseleccionado
  await page.setViewportSize({ width: 1366, height: 768 });
  const customSupp = await write('suplidores', { nombre: 'Suplidor Cálculo Directo', rnc: '131777888', diasCredito: 20 });
  await page.goto(origin + '/suplidores');
  await main.getByRole('button', { name: 'Editar cálculo de Suplidor Cálculo Directo' }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Factor de costo').fill('1.15');
  await sheet.getByLabel('Recargo P/Mayor %').fill('10');
  await sheet.getByLabel('Recargo Detalle %').fill('20');
  await sheet.getByText(/RD\$\s*115\.00/).waitFor();
  await sheet.getByText(/RD\$\s*126\.50/).waitFor();
  await sheet.getByText(/RD\$\s*151\.80/).waitFor();
  await sheet.getByRole('button', { name: 'Guardar cambios' }).click();
  await sheet.waitFor({ state: 'hidden' });

  const suppCard = main.getByRole('button', { name: 'Editar cálculo de Suplidor Cálculo Directo' }).locator('xpath=..');
  await suppCard.getByText(/×1\.15/).waitFor();
  await suppCard.getByRole('link', { name: 'Registrar compra' }).click();
  await page.waitForURL(new RegExp(`/compras\\?suplidor=${customSupp.result.id}$`));
  assert.match(await main.getByRole('combobox', { name: 'Suplidor', exact: true }).textContent(), /Suplidor Cálculo Directo/);
  await main.getByText('Costo (×1.15)').waitFor();

  // Editar el mismo cálculo desde Suplidores actualiza la fórmula existente sin duplicar
  await page.goto(origin + '/suplidores');
  // Cambiar a vista de Lista y confirmar tabla, persistencia al recargar, edición de cálculo y enlace a Compras
  await main.getByRole('button', { name: 'Lista', exact: true }).click();
  await main.getByRole('table').waitFor();
  await page.reload();
  await main.getByRole('table').waitFor();
  const listRow = main.getByRole('row').filter({ hasText: 'Suplidor Cálculo Directo' });
  await listRow.getByText(/×1\.15/).waitFor();
  await listRow.getByRole('button', { name: 'Editar cálculo de Suplidor Cálculo Directo' }).click();
  await sheet.getByLabel('Factor de costo').fill('1.1092');
  await sheet.getByRole('button', { name: 'Guardar cambios' }).click();
  await sheet.waitFor({ state: 'hidden' });
  await listRow.getByText(/×1\.1092/).waitFor();
  await listRow.getByRole('link', { name: 'Registrar compra con Suplidor Cálculo Directo' }).click();
  await page.waitForURL(new RegExp(`/compras\\?suplidor=${customSupp.result.id}$`));
  await page.goto(origin + '/suplidores');
  await main.getByRole('button', { name: 'Tarjetas', exact: true }).click();
  assert.equal(await main.getByRole('table').count(), 0);
  const finalState = (await (await fetch(origin + '/api/state')).json()).state;
  const linkedFormula = finalState.formulas.find(f => f.nombre === 'Fórmula Suplidor Cálculo Directo');
  assert.ok(linkedFormula, 'Debe existir la fórmula creada desde Suplidores');
  assert.equal(linkedFormula.factorCosto, 1.1092);
  assert.equal(finalState.formulas.filter(f => f.nombre === 'Fórmula Suplidor Cálculo Directo').length, 1);
  assert.equal(finalState.suplidores.find(s => s.id === customSupp.result.id).formulaId, linkedFormula.id);
  assert.deepEqual(errors, []);
});

test('migración 20261125160000 rellena public.productos.referencia desde pos_privado.netpos_catalogo sin pisar ediciones manuales', async () => {
  const { readFile } = await import('node:fs/promises');
  const tempDb = await temporaryPostgres();
  const admin = new pg.Pool({ connectionString: tempDb.connectionString });
  try {
    await migrateDatabase(admin);
    const sys = (await admin.query('SELECT database_id, revision FROM pos_privado.sistema WHERE id=1')).rows[0];
    const pEmpty = (await admin.query(
      "INSERT INTO public.productos(codigo,nombre,costo,precio1,precio2,precio3,stock,referencia) VALUES('NP-1','Goma 2.75-18','100','200','180','180','10','') RETURNING id",
    )).rows[0].id;
    const pManual = (await admin.query(
      "INSERT INTO public.productos(codigo,nombre,costo,precio1,precio2,precio3,stock,referencia) VALUES('NP-2','Mica stop','50','100','90','90','5','REF-MANUAL') RETURNING id",
    )).rows[0].id;
    const huella = 'a'.repeat(64);
    await admin.query(
      "INSERT INTO pos_privado.netpos_importaciones(huella,database_id,categorias,marcas,ubicaciones,unidades) VALUES($1,$2,'{}','{}','{}','{}')",
      [huella, sys.database_id],
    );
    await admin.query(
      `INSERT INTO pos_privado.netpos_catalogo(huella,fila,codigo_original,codigo,evidencia,sugerencia,original,producto_id)
       VALUES ($1,1,'NP-1','NP-1','texto-exacto','', $2::jsonb, $3),
              ($1,2,'NP-2','NP-2','texto-exacto','', $4::jsonb, $5)`,
      [
        huella,
        JSON.stringify({ REFERENCIA: { valor: '  T08-OEM-99  ', tipo: 's', estilo: 0 } }),
        pEmpty,
        JSON.stringify({ REFERENCIA: { valor: 'VIEJA-NETPOS', tipo: 's', estilo: 0 } }),
        pManual,
      ],
    );
    const sql = await readFile(new URL('../supabase/migrations/20261125160000_rellenar_referencia_netpos.sql', import.meta.url), 'utf8');
    await admin.query(sql);
    const rows = (await admin.query('SELECT codigo, referencia FROM public.productos WHERE codigo IN (\'NP-1\', \'NP-2\') ORDER BY codigo')).rows;
    assert.deepEqual(rows, [
      { codigo: 'NP-1', referencia: 'T08-OEM-99' },
      { codigo: 'NP-2', referencia: 'REF-MANUAL' },
    ]);
    const revAfter = Number((await admin.query('SELECT revision FROM pos_privado.sistema WHERE id=1')).rows[0].revision);
    assert.equal(revAfter, Number(sys.revision) + 1);
    // Re-ejecutar es 100% idempotente y no vuelve a subir revisión
    await admin.query(sql);
    const revAfterSecond = Number((await admin.query('SELECT revision FROM pos_privado.sistema WHERE id=1')).rows[0].revision);
    assert.equal(revAfterSecond, revAfter);
  } finally {
    await admin.end();
    await tempDb.stop();
  }
});

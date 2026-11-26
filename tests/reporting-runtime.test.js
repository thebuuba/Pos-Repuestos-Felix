import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import pg from 'pg';
import { businessDay, monthlyActivity, peakHoursActivity, reportData, salesCsv, salesTotal } from '../frontend/src/lib/sales-analytics.js';
import { buildOperational } from '../scripts/build-operational.mjs';
import { migrateDatabase } from '../src/db/migrations.js';
import { createApp } from '../src/server.js';
import { temporaryPostgres } from './postgres.js';

test('reports respect documentary dates, business midnight, missing historical cost and CSV literals', () => {
  const sale = { number: 'Registro 1', customerName: '=Cliente, "A"', date: '2026-01-01', condition: 'contado',
    comprobante: 'B02', subtotal: 0.25, total: 0.30, itbis: 0.05, lines: [] };
  const prior = { ...sale, date: '2026-01-01T03:59:59Z' };
  const tomorrow = { ...sale, date: '2026-01-02' };
  assert.equal(businessDay(prior.date), '2025-12-31');
  const result = reportData([sale, prior, tomorrow], [], 'hoy', '2026-01-01', true);
  assert.deepEqual(result.inPeriod, [sale]);
  assert.equal(result.profit, null);
  assert.deepEqual(result.fiscal, [{ type: 'Sin NCF', count: 1, base: '0.25', itbis: '0.05' }]);
  assert.equal(result.series[0].total, '0.30');
  assert.equal(result.methods[0].total, '0.30');
  const chart = monthlyActivity([sale, prior, tomorrow], '2026-01-01');
  assert.deepEqual(chart.lastSix.map(row => row.total), ['0.00', '0.00', '0.00', '0.00', '0.30', '0.30']);
  assert.equal(salesTotal(Array(100).fill({ total: 999999999999.99 })), '99999999999999.00');
  assert.match(salesCsv([sale]), /"'=Cliente, ""A"""/);
});

test('real reports export a confirmed sale and versioned settings and formulas survive reload', { timeout: 90_000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'felix-reports-settings-'));
  const database = await temporaryPostgres();
  let server, pool, browser;
  t.after(async () => {
    await browser?.close();
    if (server) await new Promise(resolve => server.close(resolve));
    await pool?.end();
    await database.stop();
    assert.equal(path.dirname(directory), path.resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  });
  const admin = new pg.Pool({ connectionString: database.connectionString });
  try { await migrateDatabase(admin); } finally { await admin.end(); }
  await buildOperational(directory);
  pool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app' });
  server = await createApp(pool, { assetsDirectory: pathToFileURL(directory + path.sep) });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const snapshot = async () => (await fetch(origin + '/api/state')).json();
  const { databaseId } = await snapshot();
  const post = async (resource, data) => {
    const response = await fetch(origin + '/api/' + resource, { method: 'POST', headers: {
      'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() }, body: JSON.stringify({ databaseId, ...data }) });
    assert.equal(response.status, 200, await response.clone().text());
    return (await response.json()).result.id;
  };
  const productoId = await post('productos', { nombre: 'Arandela', codigo: 'REP-1', stock: 3,
    costo: 40, precio1: 118, precio2: 118, precio3: 118, gravado: true });
  const clienteId = await post('clientes', { nombre: 'Cliente de reportes', limiteCredito: 500 });
  const suplidorId = await post('suplidores', { nombre: 'Suplidor de prueba' });
  const cajaId = await post('caja/abrir', { monto: 0 });
  await post('ventas', { cajaId, metodoPago: 'credito', clienteId, condicion: 'Credito', tipoComprobante: 'B02',
    items: [{ productoId, cantidad: 1, nivelPrecio: 'precio1' }] });
  // Una compra posterior que cambia el costo en catálogo NO debe alterar el costo histórico de la venta anterior.
  const prodAfterSale = (await snapshot()).state.productos.find(p => p.id === productoId);
  await post('compras', {
    suplidorId, numero: 'FAC-COSTO-2',
    items: [{ productoId, versionProducto: prodAfterSale.version, codigo: 'REP-1', nombre: 'Arandela', cantidad: 2, costo: 85, precio1: 118, precio2: 118, precio3: 118 }],
  });
  const afterBuy = await snapshot();
  assert.equal(afterBuy.state.facturas[0].items[0].costoUnitario, 40);
  assert.equal(afterBuy.state.facturas[0].items[0].costoUnitarioExacto, '40.0000');
  assert.ok(afterBuy.state.facturas[0].creadoEn);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ timezoneId: 'Asia/Tokyo', locale: 'es-DO' });
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole('main').getByText('Cliente de reportes').waitFor();
  await page.getByText('1 cliente con saldo pendiente').waitFor();
  await page.goto(origin + '/reportes');
  await page.getByRole('button', { name: 'Hoy', exact: true }).click();
  // Venta neta RD$ 100.00 - costo histórico congelado RD$ 40.00 = Ganancia bruta RD$ 60.00 (Margen 60.0%)
  await page.getByText('RD$ 60.00').first().waitFor();
  await page.getByText('Margen 60.0% sobre venta neta').waitFor();
  const search = page.getByLabel('Buscar facturas');
  await search.fill('inexistente');
  await page.getByText('Sin facturas', { exact: true }).waitFor();
  await search.fill('Cliente de reportes');
  await page.getByRole('row').filter({ hasText: 'Cliente de reportes' }).getByText('pendiente').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Anular', exact: true }).count(), 1);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Exportar' }).click()]);
  assert.match(await readFile(await download.path(), 'utf8'), /"Crédito","100.00","18.00","118.00"/);
  await page.goto(origin + '/configuracion');
  await page.getByLabel('Nombre comercial').fill('Taller de prueba');
  const save = page.getByRole('button', { name: 'Guardar cambios', exact: true });
  const waitSave = (resource, method) => page.waitForResponse(response => new URL(response.url()).pathname === '/api/' + resource && response.request().method() === method);
  const [response] = await Promise.all([waitSave('configuracion', 'PUT'), save.click()]);
  assert.equal(response.status(), 200);
  await page.reload();
  assert.equal(await page.getByLabel('Nombre comercial').inputValue(), 'Taller de prueba');
  await page.getByRole('tab', { name: 'Facturación', exact: true }).click();
  await page.getByLabel('ITBIS %').fill('18.125');
  const [tax] = await Promise.all([waitSave('configuracion', 'PUT'), save.click()]);
  assert.equal(tax.status(), 200);
  assert.equal((await snapshot()).state.configuracion.itbisPorcentaje, 18.125);
  assert.equal(await page.getByRole('switch').isDisabled(), true);
  await page.getByRole('tab', { name: 'Fórmulas de precios' }).click();
  await page.getByRole('button', { name: 'Agregar fórmula' }).click();
  const formulaName = page.getByLabel('Nombre de la fórmula').last();
  await formulaName.fill('Prueba con guardado');
  assert.equal((await snapshot()).state.formulas.some(f => f.nombre === 'Prueba con guardado'), false);
  const [created] = await Promise.all([waitSave('formulas', 'POST'), page.getByRole('button', { name: 'Guardar fórmula' }).click()]);
  assert.equal(created.status(), 200);
  const stored = (await snapshot()).state.formulas.find(f => f.nombre === 'Prueba con guardado');
  assert.ok(stored);
  await page.reload();
  await page.getByRole('tab', { name: 'Fórmulas de precios' }).click();
  const row = page.locator('div.rounded-2xl').filter({ has: page.locator('input[value="Prueba con guardado"]') }).last();
  await row.getByLabel('Ajuste costo').fill('1.125');
  const [edited] = await Promise.all([waitSave('formulas/' + stored.id, 'PUT'), row.getByRole('button', { name: 'Guardar fórmula' }).click()]);
  assert.equal(edited.status(), 200);
  assert.equal((await snapshot()).state.formulas.find(f => f.id === stored.id).factorCosto, 1.125);
  await row.getByRole('button', { name: 'Eliminar fórmula' }).click();
  const [removed] = await Promise.all([waitSave('formulas/' + stored.id, 'DELETE'), page.getByRole('alertdialog').getByRole('button', { name: 'Eliminar', exact: true }).click()]);
  assert.equal(removed.status(), 200);
  await page.getByRole('tab', { name: 'Comprobantes NCF' }).click();
  await page.getByText(/las secuencias inician vacías e inactivas/).waitFor();
  await page.goto(origin + '/ayuda');
  await page.getByRole('button', { name: /Me equivoqué/ }).click();
  await page.getByText(/anular indicando el motivo/).waitFor();
  assert.deepEqual(errors, []);
});

test('peakHoursActivity agrupa facturas activas de los últimos 30 días en horario America/Santo_Domingo', () => {
  // 2026-11-25 es miércoles; 2026-11-25T14:30:00Z = 10:30 a. m. RD (Mié índice 2, hora 10a índice 2)
  // 2026-11-26T02:15:00Z = 2026-11-25 10:15 p. m. RD (Mié índice 2, hora >= 6p clamp índice 10)
  // 2026-11-22T15:00:00Z = Domingo 11:00 a. m. RD (Dom índice 6, hora 11a índice 3)
  const empty = peakHoursActivity([{ date: '2026-11-25', status: 'activa' }], '2026-11-25');
  assert.equal(empty.values, null);
  assert.equal(empty.days.length, 6);

  const monSat = peakHoursActivity([
    { date: '2026-11-25T14:30:00.000Z', status: 'activa' },
    { date: '2026-11-25T14:50:00.000Z', status: 'activa' },
    { date: '2026-11-25T14:55:00.000Z', status: 'anulada' }, // excluida
    { date: '2026-10-01T14:30:00.000Z', status: 'activa' },  // fuera de 30 días
    { date: '2026-11-26T02:15:00.000Z', status: 'activa' },  // Mié 22:15 RD -> borde 6p
  ], '2026-11-25');
  assert.equal(monSat.days.length, 6);
  assert.equal(monSat.values[2][2], 2);
  assert.equal(monSat.values[2][10], 1);

  const withSun = peakHoursActivity([
    { date: '2026-11-22', createdAt: '2026-11-22T15:00:00.000Z', status: 'activa' },
  ], '2026-11-25');
  assert.equal(withSun.days.length, 7);
  assert.equal(withSun.days[6], 'Dom');
  assert.equal(withSun.values[6][3], 1);
});

test('reportData calcula ganancia bruta exacta desde costUnit histórico y cubre ventas parciales', () => {
  const s1 = {
    number: 'F-000001', customerName: 'Taller A', date: '2026-11-25', createdAt: '2026-11-25T15:00:00.000Z',
    condition: 'contado', comprobante: 'B02', subtotal: 200, netBase: 200, discount: 0, itbis: 36, total: 236,
    lines: [{ productId: 1, name: 'Bujía', code: 'BUJ-1', quantity: 2, base: 200, subtotal: 236, costUnit: '62.5000' }],
  };
  const s2 = {
    number: 'F-000002', customerName: 'Taller B', date: '2026-11-25', createdAt: '2026-11-25T16:00:00.000Z',
    condition: 'contado', comprobante: 'B02', subtotal: 100, netBase: 100, discount: 0, itbis: 18, total: 118,
    lines: [{ productId: 2, name: 'Filtro', code: 'FIL-1', quantity: 1, base: 100, subtotal: 118, costUnit: null }],
  };
  // Solo s1 tiene costo histórico: 200 - (62.50 * 2 = 125) = 75.00
  const full = reportData([s1], [], 'hoy', '2026-11-25', true);
  assert.equal(full.profit, '75.00');
  assert.equal(Number(full.profitMargin.toFixed(1)), 37.5);
  assert.deepEqual(full.profitCoverage, { costed: 1, total: 1 });
  assert.equal(full.top[0].profit, '75.00');

  // Parcial: 1 de 2 facturas con costo
  const partial = reportData([s1, s2], [], 'hoy', '2026-11-25', true);
  assert.equal(partial.profit, '75.00');
  assert.deepEqual(partial.profitCoverage, { costed: 1, total: 2 });
  assert.equal(partial.top.find(r => r.id === 1).profit, '75.00');
  assert.equal(partial.top.find(r => r.id === 2).profit, null);

  // Sin ventas en el período
  const none = reportData([], [], 'hoy', '2026-11-25', true);
  assert.equal(none.profit, '0.00');
  assert.deepEqual(none.profitCoverage, { costed: 0, total: 0 });
});

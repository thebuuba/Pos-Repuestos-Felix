import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright-core';
import { buildDesign } from '../scripts/build-design.mjs';
import { serveDesign } from '../scripts/serve-design.mjs';

const prefix = 'felix-pricing-';
let outdir, server, browser;
before(async () => {
  outdir = await mkdtemp(path.join(tmpdir(), prefix));
  await buildDesign(outdir);
  server = await serveDesign(outdir, 0);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
});
after(async () => {
  await browser?.close();
  await server?.close();
  if (!outdir) return;
  const resolved = path.resolve(outdir);
  assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
  assert.ok(path.basename(resolved).startsWith(prefix));
  await rm(resolved, { recursive: true, force: true });
});

async function open(t, route) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  t.after(async () => {
    await page.close();
    assert.deepEqual(errors, []);
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.setDefaultTimeout(4000);
  await page.goto(server.origin + route, { timeout: 30_000 });
  return page;
}

test('product previews reject invalid and overflowing suggestions and allow valid manual prices', async (t) => {
  const page = await open(t, '/inventario');
  await page.getByRole('button', { name: 'Nuevo artículo', exact: true }).click();
  const sheet = page.getByRole('dialog');
  const cost = sheet.getByLabel('Costo base RD$', { exact: true });
  const firstPrice = sheet.getByLabel('Precio 1 · Detalle', { exact: true });
  const calculate = sheet.getByRole('button', { name: 'Calcular', exact: true });

  await cost.fill('100');
  await calculate.click();
  assert.equal(await firstPrice.inputValue(), '170');
  await cost.fill('1.00001');
  assert.equal(await calculate.isDisabled(), true);
  await sheet.getByRole('alert').getByText(/hasta cuatro decimales/).waitFor();
  await cost.fill('999999999999.99');
  assert.equal(await calculate.isDisabled(), true);
  await sheet.getByRole('alert').getByText(/límite permitido/).waitFor();

  await sheet.getByLabel('Código', { exact: true }).fill('MANUAL-PRUEBA');
  await sheet.getByLabel('Nombre', { exact: true }).fill('Artículo manual de prueba');
  await firstPrice.fill('140');
  await sheet.getByRole('button', { name: 'Guardar artículo', exact: true }).click();
  await sheet.waitFor({ state: 'hidden' });
  await page.getByRole('row').getByText('MANUAL-PRUEBA', { exact: true }).waitFor();
});

test('purchase suggestions guard entry and editable rows against invalid and overflowing costs', async (t) => {
  const page = await open(t, '/compras');
  const main = page.getByRole('main');
  const cost = main.getByLabel('Costo unitario', { exact: true });
  const add = main.getByRole('button', { name: 'Agregar', exact: true });
  const upload = main.getByRole('button', { name: 'Subir factura al inventario' });
  const name = 'Artículo de compra de prueba';
  await main.getByRole('combobox', { name: 'Suplidor', exact: true }).click();
  await page.getByRole('option', { name: /Arias Piezas y Gomas/ }).click();
  await main.getByPlaceholder('Código, referencia o nombre…', { exact: true }).fill('COMPRA-PRUEBA');
  await main.getByPlaceholder('Nombre del artículo', { exact: true }).fill(name);

  await cost.fill('1e2');
  assert.equal(await add.isDisabled(), true);
  await main.getByRole('alert').getByText(/hasta (?:4|cuatro) decimales/).waitFor();
  await cost.fill('999999999999.99');
  assert.equal(await add.isDisabled(), true);
  await main.getByRole('alert').getByText(/límite permitido/).waitFor();
  await cost.press('Enter');
  assert.equal(await main.getByRole('row').filter({ hasText: name }).count(), 0);
  await cost.fill('.5');
  assert.equal(await add.isEnabled(), true);
  await cost.fill('100');
  await add.click();

  const row = main.getByRole('row').filter({ hasText: name });
  const rowCost = row.getByLabel('Costo de la línea', { exact: true });
  const wholesalePrice = row.getByLabel('P/Mayor', { exact: true });
  const firstPrice = row.getByLabel('Detalle', { exact: true });
  assert.equal(await firstPrice.inputValue(), '');
  await row.getByRole('button', { name: /Sugerencia P\/Mayor: 115\.00/ }).click();
  await row.getByRole('button', { name: /Sugerencia Detalle: 150\.00/ }).click();
  assert.equal(await wholesalePrice.inputValue(), '115.00');
  assert.equal(await firstPrice.inputValue(), '150.00');
  await rowCost.fill('-1');
  await row.getByRole('alert').getByText(/hasta (?:4|cuatro) decimales/).waitFor();
  assert.equal(await upload.isDisabled(), true);
  await rowCost.fill('999999999999.99');
  await row.getByRole('alert').getByText(/límite permitido/).waitFor();
  assert.equal(await upload.isDisabled(), true);
  await rowCost.fill('100');
  assert.equal(await upload.isEnabled(), true);
});

test('a purchase row accepts explicit zero and rejects a blank cost', async (t) => {
  const page = await open(t, '/compras');
  const main = page.getByRole('main');
  const cost = main.getByLabel('Costo unitario', { exact: true });
  const add = main.getByRole('button', { name: 'Agregar', exact: true });
  const upload = main.getByRole('button', { name: 'Subir factura al inventario' });
  const name = 'Artículo de costo cero';

  await main.getByRole('combobox', { name: 'Suplidor', exact: true }).click();
  await page.getByRole('option', { name: /Arias Piezas y Gomas/ }).click();
  await main.getByPlaceholder('Ej. FAC-4589').fill('CERO-PRUEBA');
  await main.getByPlaceholder('Código, referencia o nombre…', { exact: true }).fill('COSTO-CERO');
  await main.getByPlaceholder('Nombre del artículo', { exact: true }).fill(name);
  await cost.fill('0');
  assert.equal(await add.isDisabled(), true);
  await cost.fill('100');
  await add.click();

  const row = main.getByRole('row').filter({ hasText: name });
  const rowCost = row.getByLabel('Costo de la línea', { exact: true });
  const wholesalePrice = row.getByLabel('P/Mayor', { exact: true });
  const firstPrice = row.getByLabel('Detalle', { exact: true });
  await wholesalePrice.fill('0');
  await firstPrice.fill('0');
  await rowCost.fill('');
  await row.getByRole('alert').getByText(/costo/).waitFor();
  assert.equal(await upload.isDisabled(), true);

  await rowCost.fill('0');
  assert.equal(await upload.isEnabled(), true);
  await upload.click();
  const history = main.getByRole('row').filter({ hasText: 'CERO-PRUEBA' });
  await history.getByText('RD$ 0.00', { exact: true }).waitFor();
});

test('the formula editor reports invalid or overflowing previews and recovers on correction', async (t) => {
  const page = await open(t, '/configuracion');
  await page.getByRole('tab', { name: 'Fórmulas de precios', exact: true }).click();
  const panel = page.getByRole('tabpanel', { name: 'Fórmulas de precios', exact: true });
  const standard = panel.locator('div.rounded-2xl').filter({ has: page.locator('input[value="Estándar"]') });
  const factor = standard.getByLabel('Ajuste costo', { exact: true });
  const firstMargin = standard.getByLabel('P1 ganancia %', { exact: true });
  const originalPrice = standard.getByText('RD$ 170.00', { exact: true });
  await originalPrice.waitFor();

  await factor.fill('1.0000001');
  await standard.getByRole('alert').getByText(/factor de costo/).waitFor();
  assert.equal(await originalPrice.count(), 0);
  await factor.fill('1');
  await originalPrice.waitFor();

  const secondMargin = standard.getByLabel('P2 ganancia %', { exact: true });
  await factor.fill('999999.999');
  await secondMargin.fill('99999.9999');
  await firstMargin.fill('99999.9999');
  await standard.getByRole('alert').getByText(/límite permitido/).waitFor();
  await firstMargin.fill('35');
  await secondMargin.fill('25');
  await factor.fill('1');
  await originalPrice.waitFor();
  assert.equal(await standard.getByRole('alert').count(), 0);
});

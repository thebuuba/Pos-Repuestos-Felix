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
  await page.goto(server.origin + route);
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
  assert.equal(await firstPrice.inputValue(), '135');
  await cost.fill('1.001');
  assert.equal(await calculate.isDisabled(), true);
  await sheet.getByRole('alert').getByText(/hasta dos decimales/).waitFor();
  await cost.fill('999999999999.99');
  assert.equal(await calculate.isDisabled(), true);
  await sheet.getByRole('alert').getByText(/límite permitido/).waitFor();

  await sheet.getByLabel('Código', { exact: true }).fill('MANUAL-PRUEBA');
  await sheet.getByLabel('Descripción', { exact: true }).fill('Artículo manual de prueba');
  await firstPrice.fill('140');
  await sheet.getByRole('button', { name: 'Guardar artículo', exact: true }).click();
  await sheet.waitFor({ state: 'hidden' });
  await page.getByRole('row').getByText('MANUAL-PRUEBA', { exact: true }).waitFor();
});

test('purchase suggestions guard entry and editable rows against invalid and overflowing costs', async (t) => {
  const page = await open(t, '/compras');
  const main = page.getByRole('main');
  const cost = main.getByPlaceholder('0.00', { exact: true });
  const add = main.getByRole('button', { name: 'Agregar', exact: true });
  const upload = main.getByRole('button', { name: 'Subir factura al inventario' });
  const name = 'Artículo de compra de prueba';
  await main.getByPlaceholder('Código', { exact: true }).fill('COMPRA-PRUEBA');
  await main.getByPlaceholder('Descripción', { exact: true }).fill(name);

  await cost.fill('1e2');
  assert.equal(await add.isDisabled(), true);
  await main.getByRole('alert').getByText(/hasta 2 decimales/).waitFor();
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
  const rowCost = row.getByRole('spinbutton').nth(1);
  const firstPrice = row.getByRole('spinbutton').nth(2);
  assert.equal(await firstPrice.inputValue(), '135');
  await rowCost.fill('-1');
  await row.getByRole('alert').getByText(/hasta 2 decimales/).waitFor();
  assert.equal(await firstPrice.inputValue(), '');
  assert.equal(await upload.isDisabled(), true);
  await rowCost.fill('999999999999.99');
  await row.getByRole('alert').getByText(/límite permitido/).waitFor();
  assert.equal(await upload.isDisabled(), true);
  await rowCost.fill('100');
  assert.equal(await firstPrice.inputValue(), '135');
  assert.equal(await upload.isEnabled(), true);
});

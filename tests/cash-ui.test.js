import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

let browser, script;
const summary = { opening: 100, cashSales: 0, cardSales: 0, transferSales: 0, creditSales: 0,
  entradas: 0, salidas: 0, cobros: 0, pagos: 0, expected: 100, invoices: 0 };
const session = { id: 7, version: 3, open: true, openedAt: '2026-11-22T12:00:00.000Z', cashier: 'Cajero', openingAmount: 100 };
before(async () => {
  script = (await build({ stdin: { contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { MemoryRouter } from 'react-router-dom'; import { Toaster } from 'sonner';
    import { PosStoreContext } from './frontend/src/data/pos-context.jsx';
    import { CashRegisterPage } from './frontend/src/polymet/pages/cash-register-page.jsx';
    import { OperationalPointOfSalePage } from './frontend/src/polymet/pages/point-of-sale-page.jsx';
    import { SaleDraftProvider } from './frontend/src/data/sale-draft.jsx';
    const root = createRoot(document.getElementById('root'));
    window.calls = []; window.mode = 'deferred';
    const action = name => async dto => { calls.push({ name, dto });
      return new Promise((resolve, reject) => { window.confirm = resolve; window.reject = reject; }); };
    window.render = (fields, sale = false) => {
      window.store = { ...window.store, ...fields, openCash: action('open'), closeCash: action('close'), addCashMovement: action('movement') };
      root.render(<MemoryRouter><PosStoreContext.Provider value={store}>
        {sale ? <SaleDraftProvider><OperationalPointOfSalePage /></SaleDraftProvider> : <CashRegisterPage />}<Toaster />
      </PosStoreContext.Provider></MemoryRouter>);
    };`, resolveDir: process.cwd(), loader: 'jsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"test"' } })).outputFiles[0].text;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
});
after(() => browser?.close());
async function open(t, fields = {}, sale = false) {
  const page = await browser.newPage();
  page.setDefaultTimeout(2000);
  t.after(() => page.close());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: script });
  await page.evaluate(({ fields, sale }) => render(fields, sale), { fields: {
    runtime: { databaseId: 'isolated', connection: 'connected', busy: false, pending: null },
    cashSession: session, cashSummary: summary, cashMovements: [], closures: [], ...fields }, sale });
  await page.getByRole('heading', { level: 1 }).waitFor();
  return page;
}
test('opening waits for confirmation and blocks duplicate requests', async t => {
  const page = await open(t, { cashSession: { open: false } });
  const amount = page.getByRole('spinbutton');
  assert.equal(await amount.isEnabled(), true);
  await amount.fill('0.01');
  await page.getByRole('button', { name: 'Abrir caja', exact: true }).click();
  await page.getByText('Confirmando la apertura…', { exact: true }).waitFor();
  assert.equal(await amount.isDisabled(), true);
  assert.equal(await page.getByText('Caja abierta', { exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(() => calls), [{ name: 'open', dto: { databaseId: 'isolated', monto: '0.01' } }]);
  await page.evaluate(() => { render({ cashSession: { id: 7, version: 1, open: true, openedAt: '2026-11-22T12:00:00Z', cashier: 'Cajero' } }); confirm({ result: { id: 7 } }); });
  await page.getByText('Caja abierta', { exact: true }).waitFor();
  await page.getByText(/Caja 01 abierta por Cajero a las/).waitFor();
});
test('uncertain movements preserve input and retry the original operation without success', async t => {
  const page = await open(t);
  await page.getByRole('button', { name: 'Entrada / salida' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('spinbutton').fill('12.50');
  await dialog.getByPlaceholder('¿Para qué es?').fill('Repuesto');
  await dialog.getByRole('button', { name: 'Registrar salida' }).click();
  await page.evaluate(() => reject(Object.assign(new Error('Confirmación pendiente'), {
    retry: async () => { window.retries = (window.retries ?? 0) + 1; return { result: { id: 8 } }; }
  })));
  await dialog.getByRole('alert').waitFor();
  assert.equal(await dialog.getByRole('spinbutton').isDisabled(), true);
  assert.equal(await dialog.getByRole('button', { name: 'Close', exact: true }).isDisabled(), true);
  assert.equal(await page.getByText('Salida registrada', { exact: true }).count(), 0);
  await page.keyboard.press('Escape');
  assert.equal(await dialog.isVisible(), true);
  await dialog.getByRole('button', { name: 'Reintentar movimiento' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByText('Salida registrada', { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => calls), [{ name: 'movement', dto: {
    databaseId: 'isolated', cajaId: 7, version: 3, tipo: 'salida', monto: '12.50', concepto: 'Repuesto' } }]);
  assert.equal(await page.evaluate(() => retries), 1);
});
test('cash count rejects fractional notes and retains a failed count for correction', async t => {
  const page = await open(t);
  await page.getByRole('button', { name: 'Cerrar caja', exact: true }).click();
  const dialog = page.getByRole('dialog'), first = dialog.getByRole('spinbutton').first();
  await first.fill('0.5');
  assert.equal(await dialog.getByRole('button', { name: /Cerrar caja con/ }).isDisabled(), true);
  await first.fill('1');
  await dialog.getByRole('button', { name: /Cerrar caja con/ }).click();
  await page.evaluate(() => reject(Object.assign(new Error('La caja cambió. Actualiza los datos.'), { definitive: true })));
  await dialog.getByRole('alert').waitFor();
  assert.equal(await first.isEditable(), true);
  assert.equal(await first.inputValue(), '1');
  assert.equal(await page.getByText('Caja cerrada', { exact: true }).count(), 0);
});
test('one cent discrepancy is never shown as a balanced closure', async t => {
  const page = await open(t, { closures: [{ id: 4, closedAt: '2026-11-22T13:00:00Z', cashier: 'Cajero', sales: 0, expected: 100.01, counted: 100 }] });
  assert.equal(await page.getByText('Cuadrada', { exact: true }).count(), 0);
  assert.match(await page.getByRole('row').last().innerText(), /0\.01/);
});
test('disconnected cash cannot submit and the sale payment selector is enabled', async t => {
  const disconnected = await open(t, { runtime: { databaseId: 'isolated', connection: 'offline' } });
  assert.equal(await disconnected.getByRole('button', { name: 'Entrada / salida' }).isDisabled(), true);
  const page = await open(t, { products: [], categories: [], customers: [{ id: 1, name: 'Contado', isCashCustomer: true }],
    settings: { defaultPriceLevel: 'p1', itbisRate: 18 } }, true);
  const card = page.getByRole('button', { name: 'Tarjeta', exact: true });
  assert.equal(await card.isEnabled(), true);
  await card.click();
  assert.equal(await page.getByText('Monto recibido', { exact: true }).count(), 0);
});

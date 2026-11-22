import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const databaseId = randomUUID();
const config = { version: 2, empresa: 'Negocio', rnc: 'RN', tel: 'TEL', correo: 'e@ej.test', direccion: 'Calle',
  itbisPorcentaje: 18.1234, redondeo: 0, nivelPrecioPredeterminado: null, formatoImpresion: null,
  pieTicket: '', permitirStockNegativo: false };
const formula = { id: 3, version: 1, nombre: 'Tarifa', factorCosto: 1.18, recargo1: 10, recargo2: 5, recargo3: 0 };
const customer = { id: 6, version: 2, nombre: 'Cliente', rnc: 'C', tel: '01', correo: 'c@ej.test', direccion: 'Casa',
  esContado: false, limiteCredito: null, deuda: 15 };
const supplier = { id: 7, version: 1, nombre: 'Proveedor', rnc: 'S', tel: '02', correo: 's@ej.test',
  contacto: 'Contacto', diasCredito: 0, formulaId: 3 };
const detail = { id: 1, productoId: 22, codigo: 'PR', nombre: 'Artículo', cant: 1, subtotal: 15 };
const sale = { id: 9, clienteId: 6, cliente: 'Cliente', clienteRnc: 'C', ncf: null, tipoComprobante: 'B02',
  condicion: 'Credito', fecha: '20/11/2026', fechaISO: '2026-11-20', total: 15, base: 15, itbis: 0,
  items: [{ ...detail, precio: 15, base: 15, itbis: 0 }] };
const purchase = { id: 10, suplidorId: 7, suplidor: 'Proveedor', numero: 'FC-34', total: 15,
  fecha: '21/11/2026', fechaISO: '2026-11-21', items: [{ ...detail, costo: 15, p1: 18, p2: 16, p3: 15 }] };
const initial = { databaseId, databaseLabel: 'Prueba', revision: 7, state: {
  empresa: 'Negocio', itbisRate: 0.181234, configuracionVersion: 2, configuracion: config, formulas: [formula],
  productos: [], movimientos: [], clientes: [customer, { ...customer, id: 8, esContado: true, deuda: 0, limiteCredito: 0 },
    { ...customer, id: 11, deuda: -3.25 }],
  suplidores: [supplier, { ...supplier, id: 2, diasCredito: null, formulaId: null }], facturas: [sale], compras: [purchase],
} };
let browser, script;
before(async () => {
  const bundle = await build({ stdin: { contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { createPosClient } from './frontend/src/data/pos-client.js';
    import { OperationalStoreProvider } from './frontend/src/data/operational-store.jsx';
    import { usePosStore } from './frontend/src/data/pos-context.jsx';
    window.client = createPosClient();
    function Probe(){ window.store = usePosStore(); return <output>{store.runtime.revision ?? 'pendiente'}</output>; }
    createRoot(document.body).render(<OperationalStoreProvider client={client}><Probe/></OperationalStoreProvider>);
  `, loader: 'jsx', resolveDir: process.cwd() }, jsx: 'automatic', bundle: true, write: false,
    define: { 'process.env.NODE_ENV': '"production"' } });
  script = bundle.outputFiles[0].text;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
});
after(() => browser?.close());
async function open(t, options = {}) {
  const context = options.context || await browser.newContext();
  if (!options.context) t.after(() => context.close());
  const page = await context.newPage();
  await page.route('http://127.0.0.1/fixture', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
  await page.route('**/api/state', route => route.fulfill({ json: options.snapshot ?? initial }));
  await page.goto('http://127.0.0.1/fixture');
  await page.addScriptTag({ content: script });
  await page.waitForFunction(() => window.store && !store.runtime.busy && store.runtime.connection !== 'checking');
  return page;
}
test('provider maps confirmed contacts, formula relationships, documentary dates and known settings', async t => {
  const page = await open(t);
  const view = await page.evaluate(() => {
    const { customers, suppliers, formulas, settings, sales, purchases, receivables, runtime } = store;
    return { customers, suppliers, formulas, settings, sales, purchases, receivables, available: runtime.accountDetailsAvailable };
  });
  assert.deepEqual(view.customers[0], { id: 6, version: 2, databaseId, name: 'Cliente', rnc: 'C', phone: '01',
    email: 'c@ej.test', address: 'Casa', creditLimit: null, balance: 15, isCashCustomer: false });
  assert.equal(view.customers[1].creditLimit, 0);
  assert.equal(view.customers[1].isCashCustomer, true);
  assert.equal(view.customers[2].balance, -3.25);
  assert.deepEqual(view.suppliers[0], { id: 7, version: 1, databaseId, name: 'Proveedor', rnc: 'S', phone: '02',
    email: 's@ej.test', contact: 'Contacto', creditDays: 0, formulaId: 3, balance: null });
  assert.equal(view.suppliers[1].creditDays, null);
  assert.equal(view.suppliers[1].formulaId, null);
  assert.deepEqual(view.formulas[0], { id: 3, version: 1, databaseId, name: 'Tarifa', costFactor: 1.18, margins: { p1: 10, p2: 5, p3: 0 } });
  assert.deepEqual(view.settings, { databaseId, version: 2, business: { name: 'Negocio', rnc: 'RN', phone: 'TEL',
    email: 'e@ej.test', address: 'Calle' }, itbisRate: 18.1234, rounding: 0, defaultPriceLevel: null, printer: null,
    ticketFooter: '', allowNegativeStock: false, ncf: [] });
  assert.equal(view.sales.length, 1);
  assert.equal(view.sales[0].customerId, 6);
  assert.equal(view.sales[0].date, sale.fechaISO);
  assert.equal(view.sales[0].total, 15);
  assert.match(view.sales[0].number, /registro.*9/i);
  assert.ok(view.sales[0].status == null);
  assert.equal(view.purchases.length, 1);
  assert.equal(view.purchases[0].supplierId, 7);
  assert.equal(view.purchases[0].date, purchase.fechaISO);
  assert.equal(view.purchases[0].total, 15);
  assert.deepEqual(view.receivables, []);
  assert.equal(view.available, false);
});
test('failed initial load exposes complete unloaded settings without a writable generation', async t => {
  const page = await open(t, { snapshot: { ...initial, state: { productos: [] } } });
  const { settings, connection } = await page.evaluate(() => ({ settings: store.settings, connection: store.runtime.connection }));
  assert.equal(connection, 'unavailable');
  assert.equal(settings.databaseId, null);
  assert.equal(settings.version, null);
  assert.equal(settings.rounding, null);
  assert.equal(settings.itbisRate, null);
  assert.deepEqual(settings.ncf, []);
  assert.ok(settings.business);
  await assert.rejects(page.evaluate(() => store.updateSettings({ version: null, databaseId: null, rounding: 5 })), /antes de guardar/);
});
test('all provider writes produce finite flat per-resource packets', async t => {
  const page = await open(t);
  const packets = [];
  await page.route('**/api/**', route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (path === '/api/state') return route.fallback();
    packets.push([req.method(), path, req.postDataJSON()]);
    const id = path === '/api/configuracion' ? 1 : Number(path.split('/').pop()) || 15;
    return route.fulfill({ json: { ...initial, result: { id } } });
  });
  const cases = [
    ['Customer','clientes', { name: 'Ana', rnc: '', phone: '', email: 'a@ej.test', address: '', creditLimit: null },
      { nombre: 'Ana', rnc: '', tel: '', correo: 'a@ej.test', direccion: '', limiteCredito: null }],
    ['Supplier','suplidores', { name: 'Almacén', rnc: '', phone: '', email: '', contact: '', creditDays: 0, formulaId: null },
      { nombre: 'Almacén', rnc: '', tel: '', correo: '', contacto: '', diasCredito: 0, formulaId: null }],
    ['Formula','formulas', { name: 'Tarifa', costFactor: 1.25, margins: { p1: 1, p2: 2, p3: 3 } },
      { nombre: 'Tarifa', factorCosto: 1.25, recargo1: 1, recargo2: 2, recargo3: 3 }],
  ];
  for (const [kind, resource, fields, payload] of cases) {
    await page.evaluate(async ({ kind, fields, databaseId }) => {
      await store['save' + kind]({ id: crypto.randomUUID(), databaseId, ...fields });
      await store['save' + kind]({ id: 15, version: 2, databaseId, ...fields });
      await store['delete' + kind]({ id: 15, version: 3, databaseId });
    }, { kind, fields, databaseId });
    assert.deepEqual(packets.splice(0), [
      ['POST', '/api/' + resource, { ...payload, databaseId }],
      ['PUT', '/api/' + resource + '/15', { ...payload, databaseId, version: 2 }],
      ['DELETE', '/api/' + resource + '/15', { databaseId, version: 3 }],
    ]);
  }
  await page.evaluate(async databaseId => {
    await store.updateSettings({ databaseId, version: 2, business: store.settings.business });
    await store.updateSettings({ databaseId, version: 3, itbisRate: 17.125, rounding: 5, defaultPriceLevel: null, printer: 'Térmica 58 mm', ticketFooter: 'Gracias' });
  }, databaseId);
  assert.deepEqual(packets, [
    ['PUT','/api/configuracion',{ databaseId, version: 2, empresa: 'Negocio', rnc: 'RN', tel: 'TEL', correo: 'e@ej.test', direccion: 'Calle' }],
    ['PUT','/api/configuracion',{ databaseId, version: 3, itbisPorcentaje: 17.125, redondeo: 5, nivelPrecioPredeterminado: null, formatoImpresion: 'Térmica 58 mm', pieTicket: 'Gracias' }],
  ]);
});
test('invalid targets, settings limits, nullable values and nonfinite numbers never enter the journal', async t => {
  const page = await open(t);
  let writes = 0;
  await page.route('**/api/**', route => { if (route.request().method() === 'GET') return route.fallback(); writes++; return route.abort(); });
  const results = await page.evaluate(async databaseId => {
    const cases = [
      ['POST','/api/restore',{}], ['POST','https://example.test/api/clientes',{}], ['POST','/api/configuracion',{}],
      ['PUT','/api/configuracion',{version:2}], ['PUT','/api/configuracion',{version:2,ncf:[]}],
      ['PUT','/api/configuracion',{version:2,itbisPorcentaje:100.0001}], ['PUT','/api/configuracion',{version:2,redondeo:3}],
      ['PUT','/api/configuracion',{version:2,redondeo:NaN}], ['PUT','/api/configuracion',{version:2,formatoImpresion:'Otro'}],
      ['PUT','/api/configuracion',{version:2,nivelPrecioPredeterminado:'otro'}], ['PUT','/api/configuracion',{version:2,permitirStockNegativo:true}],
      ['PUT','/api/configuracion',{version:2,empresa:null}], ['PUT','/api/configuracion',{version:2,correo:{anidado:1}}],
      ['POST','/api/clientes',{nombre:'A',deuda:4}], ['POST','/api/clientes',{nombre:'A',limiteCredito:NaN}],
      ['POST','/api/suplidores',{nombre:'S',diasCredito:Infinity}], ['POST','/api/suplidores',{nombre:'S',formulaId:0}],
      ['DELETE','/api/formulas/1',{version:1,nombre:'A'}], ['POST','/api/formulas',{nombre:'F',factorCosto:null}],
    ];
    const rejected = [];
    for (const [method, path, payload] of cases) {
      try { await client.writeOperation({ method, path, payload, databaseId }); rejected.push(false); }
      catch { rejected.push(client.getState().pending === null); }
    }
    return rejected;
  }, databaseId);
  assert.ok(results.every(Boolean));
  assert.equal(writes, 0);
});
test('malformed contact or settings snapshots on read and replay preserve the last confirmed data and packet', async t => {
  const page = await open(t);
  let ack;
  await page.route('**/api/state', route => route.fulfill({ json: ack }));
  await page.route('**/api/configuracion', route => route.fulfill({ json: ack }));
  const variants = [
    { configuracion: { ...config, permitirStockNegativo: true } }, { configuracion: { ...config, redondeo: 4 } },
    { configuracion: { ...config, formatoImpresion: 'Fake' } }, { configuracion: { ...config, itbisPorcentaje: 101 } },
    { clientes: [{ ...customer, esContado: 'false' }] }, { clientes: [{ ...customer, limiteCredito: -1 }] },
    { suplidores: [{ ...supplier, formulaId: '3' }] }, { suplidores: [{ ...supplier, diasCredito: 1.5 }] },
    { formulas: [{ ...formula, recargo1: 100000 }] }, { facturas: [{ ...sale, fechaISO: '2026-02-30' }] },
    { compras: [{ ...purchase, total: null }] }, { facturas: false }, { movimientos: null },
    { facturas: [{ ...sale, items: [{ ...sale.items[0], precio: '15' }] }] },
    { suplidores: [{ ...supplier, formulaId: 79 }] }, { itbisRate: 0.18 },
  ];
  let pending;
  for (const [i, fields] of variants.entries()) {
    ack = { ...initial, revision: 8, result: { id: 1 }, state: { ...initial.state, ...fields } };
    await assert.rejects(page.evaluate(() => client.reload()));
    await assert.rejects(page.evaluate(first => first ? store.updateSettings({ databaseId:store.settings.databaseId, version:2, rounding:5 }) : client.retryPending(), i === 0));
    const state = await page.evaluate(() => client.getState());
    assert.deepEqual(state.snapshot, initial);
    assert.ok(state.pending);
    pending ??= state.pending;
    assert.deepEqual(state.pending, pending);
  }
  ack = { ...initial, result: { id: 2 } };
  await assert.rejects(page.evaluate(() => client.retryPending()));
  assert.deepEqual(await page.evaluate(() => client.getState().pending), pending);
});
test('the original form object retries its exact packet after a second tab reloads and confirms', async t => {
  const page = await open(t);
  const packets = [];
  await page.context().route('**/api/suplidores/7', route => {
    const req = route.request();
    packets.push({ id: req.headers()['idempotency-key'], body: req.postData() });
    return packets.length === 1 ? route.abort() : route.fulfill({ json: { ...initial, result: { id: 7 } } });
  });
  assert.equal(await page.evaluate(async () => {
    window.dto = { ...store.suppliers[0], name: 'Original' };
    try { await store.saveSupplier(dto); } catch (e) { return !!e.uncertain; }
  }), true);
  const other = await open(t, { context: page.context() });
  await other.reload();
  await other.addScriptTag({ content: script });
  await other.waitForFunction(() => window.store?.runtime.connection === 'connected');
  await other.evaluate(() => client.retryPending());
  await page.waitForFunction(() => client.getState().pending === null);
  await page.evaluate(async () => { dto.name = 'Otra edición'; dto.formulaId = Infinity; await store.saveSupplier(dto); });
  assert.equal(packets.length, 3);
  assert.deepEqual(packets, Array(3).fill(packets[0]));
  assert.equal(JSON.parse(packets[0].body).nombre, 'Original');
});
test('a proven same-generation rejection unlocks the original DTO for a corrected settings packet', async t => {
  const page = await open(t);
  const packets = [];
  await page.route('**/api/configuracion', route => {
    const req = route.request(), operationId = req.headers()['idempotency-key'];
    packets.push({ operationId, body:req.postDataJSON() });
    if (packets.length === 1) return route.abort();
    if (packets.length === 2) return route.fulfill({ status: 409, json: { error: 'Versión vencida',
      rejection: { operationId, databaseId, method: 'PUT', path: '/api/configuracion' } } });
    return route.fulfill({ json: { ...initial, result: { id: 1 } } });
  });
  await page.evaluate(async () => {
    window.dto = { databaseId: store.settings.databaseId, version: 1, rounding: 5 };
    try { await store.updateSettings(dto); } catch (e) { if (!e.uncertain) throw e; }
    try { await store.updateSettings(dto); } catch (e) { if (!e.definitive) throw e; }
    dto.version = 2;
    await store.updateSettings(dto);
  });
  assert.deepEqual(packets[0], packets[1]);
  assert.notEqual(packets[1].operationId, packets[2].operationId);
  assert.equal(packets[2].body.version, 2);
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import pg from 'pg';
import { temporaryPostgres } from './postgres.js';
import { createApp } from '../server.js';
import { initialState } from '../state.js';

let database, pool, server, base, dom, interval;
const nativeFetch = globalThis.fetch;
const nativeInterval = globalThis.setInterval;
const alerts = [];
let prints = 0;
const $ = (id) => dom.window.document.getElementById(id);
const fill = (fields) => Object.entries(fields).forEach(([id, value]) => { $(id).value = String(value); });
const saved = async () => (await nativeFetch(base + '/api/state')).json();

before(async () => {
  database = await temporaryPostgres();
  pool = new pg.Pool({ connectionString: database.connectionString });
  server = await createApp(pool);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;
  dom = new JSDOM(await readFile(new URL('../index.html', import.meta.url), 'utf8'), { url: base });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.alert = (message) => alerts.push(message);
  globalThis.confirm = () => true;
  globalThis.fetch = (path, options) => nativeFetch(new URL(path, base), options);
  globalThis.setInterval = (...args) => { interval = nativeInterval(...args); return interval; };
  window.open = () => ({ document: { write() {}, close() {} }, focus() {}, print() { prints++; } });
  await import('../app.js');
});
after(async () => {
  clearInterval(interval);
  globalThis.fetch = nativeFetch;
  globalThis.setInterval = nativeInterval;
  dom?.window.close();
  if (server) await new Promise((done) => server.close(done));
  if (pool) await pool.end();
  if (database) await database.stop();
});

test('carga clientes, inventario y reportes vacíos desde PostgreSQL', () => {
  assert.equal($('fac-cliente').value, 'Cliente Contado');
  assert.equal($('tabla-inventario').rows.length, 2);
  assert.equal($('tabla-facturas').rows.length, 0);
  assert.match($('database-status').textContent, /Conectado/);
});

test('el carrito impide exceder existencias y permite quitar líneas', () => {
  fill({ 'fac-buscar-prod': 'BUJ-01', 'fac-cantidad': 2 });
  window.agregarLineaFactura();
  assert.equal($('fac-total').textContent, '300.00');
  assert.equal($('fac-subtotal').textContent, '254.24');
  assert.equal($('fac-itbis').textContent, '45.76');
  fill({ 'fac-buscar-prod': 'BUJ-01', 'fac-cantidad': 49 });
  window.agregarLineaFactura();
  assert.match(alerts.at(-1), /Stock insuficiente/);
  assert.equal($('fac-total').textContent, '300.00');
  window.quitarLineaFactura(0);
  assert.equal($('tabla-detalle-factura').rows.length, 0);
  assert.equal($('fac-total').textContent, '0.00');
});

test('una venta a crédito guarda factura, stock y balance antes de imprimir', async () => {
  fill({ 'fac-buscar-prod': 'BUJ-01', 'fac-cantidad': 2, 'fac-condicion': 'Credito' });
  window.agregarLineaFactura();
  await window.procesarFactura();
  const { state } = await saved();
  assert.equal(state.facturas.length, 1);
  assert.equal(state.facturas[0].total, 300);
  assert.equal(state.productos[0].stock, 48);
  assert.equal(state.clientes[0].deuda, 300);
  assert.equal(prints, 1);
  assert.equal($('tabla-facturas').rows.length, 1);
  assert.equal($('fac-total').textContent, '0.00');
});

test('un conflicto conserva el formulario y recarga los cambios de la otra sesión', async () => {
  const current = await saved();
  current.state.empresa = 'Otra caja';
  assert.equal((await nativeFetch(base + '/api/state', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(current),
  })).status, 200);
  fill({ 'cli-nombre': "Cliente O'Neil", 'cli-rnc': '123', 'cli-tel': '809-555-0100' });
  await window.guardarCliente();
  assert.equal($('cli-nombre').value, "Cliente O'Neil");
  assert.equal((await saved()).state.clientes.length, 1);
  assert.equal($('nombre-negocio').textContent, 'Otra caja');
  await window.guardarCliente();
  assert.equal($('cli-nombre').value, '');
  assert.equal((await saved()).state.clientes.length, 2);
});

test('un fallo de conexión conserva el carrito y no imprime ni descuenta stock', async () => {
  fill({ 'fac-buscar-prod': 'BUJ-02', 'fac-cantidad': 1 });
  window.agregarLineaFactura();
  globalThis.fetch = (path, options) => {
    if (options?.method === 'PUT') return Promise.reject(new TypeError('Conexión interrumpida'));
    return nativeFetch(new URL(path, base), options);
  };
  try { await window.procesarFactura(); }
  finally { globalThis.fetch = (path, options) => nativeFetch(new URL(path, base), options); }
  assert.equal($('fac-total').textContent, '150.00');
  assert.equal(prints, 1);
  const { state } = await saved();
  assert.equal(state.facturas.length, 1);
  assert.equal(state.productos[1].stock, 50);
  assert.match(alerts.at(-1), /No se confirmó/);
  await window.actualizarDatos();
  window.quitarLineaFactura(0);
});

test('una compra guarda su número, aumenta inventario y rechaza duplicados', async () => {
  fill({
    'comp-suplidor': 'Super Gato', 'comp-num-factura': 'COMP-TEST-1', 'comp-codigo': 'BUJ-01',
    'comp-nombre': 'Bujía NGK C7HSA', 'comp-cantidad': 3, 'comp-costo': 80,
    'comp-p1': 120, 'comp-p2': 110, 'comp-p3': 100,
  });
  window.agregarLineaCompra();
  await window.procesarFacturaCompra();
  const { state } = await saved();
  assert.equal(state.productos[0].stock, 51);
  assert.equal(state.compras.length, 1);
  assert.equal(state.compras[0].numero, 'COMP-TEST-1');
  assert.equal(state.compras[0].total, 240);
  assert.equal($('tabla-compras').rows.length, 1);
  assert.equal($('comp-total').textContent, '0.00');
  fill({
    'comp-num-factura': 'COMP-TEST-1', 'comp-codigo': 'BUJ-01', 'comp-nombre': 'Bujía NGK C7HSA',
    'comp-cantidad': 1, 'comp-costo': 80, 'comp-p1': 120, 'comp-p2': 110, 'comp-p3': 100,
  });
  window.agregarLineaCompra();
  await window.procesarFacturaCompra();
  assert.match(alerts.at(-1), /ya fue registrada/);
  assert.equal((await saved()).state.productos[0].stock, 51);
  window.quitarLineaCompra(0);
});

test('el inventario muestra texto guardado sin ejecutarlo como HTML', async () => {
  fill({
    'prod-codigo': "TEST-'1", 'prod-nombre': '<img src=x onerror=alert(1)>', 'prod-costo': 10,
    'prod-stock': 1, 'prod-p1': 15, 'prod-p2': 14, 'prod-p3': 13,
  });
  await window.guardarProducto();
  assert.equal($('tabla-inventario').querySelector('img'), null);
  assert.match($('tabla-inventario').textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal((await saved()).state.productos.length, 3);
});

test('restaura un archivo JSON y rechaza un respaldo inválido sin cambiar los datos', async () => {
  const target = (value) => ({ files: [{ size: 1000, text: async () => JSON.stringify(value) }], value: 'archivo.json' });
  const bad = target({});
  await window.importarRespaldo({ target: bad });
  assert.equal((await saved()).state.productos.length, 3);
  assert.match(alerts.at(-1), /No se pudo restaurar/);
  const backup = structuredClone(initialState);
  delete backup.facturas;
  delete backup.compras;
  const good = target(backup);
  await window.importarRespaldo({ target: good });
  const { state } = await saved();
  assert.equal(state.empresa, 'REPUESTOS FELIX');
  assert.equal(state.productos.length, 2);
  assert.deepEqual(state.facturas, []);
  assert.deepEqual(state.compras, []);
  assert.equal(good.value, '');
});

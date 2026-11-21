import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import pg from 'pg';
import { temporaryPostgres } from './postgres.js';
import { createApp } from '../src/server.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { initialState } from './fixtures/legacy-state.js';

let database, pool, server, base, dom, interval;
const nativeFetch = globalThis.fetch;
const nativeInterval = globalThis.setInterval;
const alerts = [];
let prints = 0;
const $ = (id) => dom.window.document.getElementById(id);
const fill = (fields) => Object.entries(fields).forEach(([id, value]) => { $(id).value = String(value); });
const saved = async () => (await nativeFetch(base + '/api/state')).json();
const write = async (method, path, body) => {
  const current = await saved();
  const response = await nativeFetch(base + path, { method,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ ...body, databaseId: current.databaseId }),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result;
};

before(async () => {
  database = await temporaryPostgres();
  pool = new pg.Pool({ connectionString: database.connectionString });
  await migrateDatabase(pool);
  server = await createApp(pool);
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const product of initialState.productos) await write('POST', '/api/productos', product);
  for (const supplier of initialState.suplidores) await write('POST', '/api/suplidores', supplier);
  dom = new JSDOM(await readFile(new URL('../public/index.html', import.meta.url), 'utf8'), { url: base });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.alert = (message) => alerts.push(message);
  globalThis.confirm = () => true;
  globalThis.fetch = (path, options) => nativeFetch(new URL(path, base), options);
  globalThis.setInterval = (...args) => { interval = nativeInterval(...args); return interval; };
  window.open = () => ({ document: { write() {}, close() {} }, focus() {}, print() { prints++; } });
  await import('../public/app.js');
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
  assert.equal($('fac-cliente').value, String(window.db.clientes[0].id));
  assert.equal($('tabla-inventario').rows.length, 2);
  assert.equal($('tabla-facturas').rows.length, 0);
  assert.match($('database-status').textContent, /Conectado/);
});

test('la navegación funciona por toque y cierra el menú al elegir una pantalla', () => {
  const navigation = document.querySelector('nav');
  assert.ok(navigation, 'Falta navegación semántica');
  const menu = navigation.querySelector('.menu-item');
  assert.ok(menu, 'El menú debe abrirse sin depender de hover');
  menu.open = true;
  window.abrirVentana('win-inventario');
  assert.equal(menu.open, false);
  assert.equal($('win-inventario').classList.contains('activa'), true);
  assert.equal($('win-facturacion').classList.contains('activa'), false);
  window.abrirVentana('win-facturacion');
});

test('cada campo tiene etiqueta y las tablas pueden desplazarse con teclado', () => {
  for (const input of document.querySelectorAll('input:not([type=file]), select')) {
    assert.ok(document.querySelector(`label[for="${input.id}"]`), `Falta etiqueta para ${input.id}`);
  }
  for (const table of document.querySelectorAll('table')) {
    assert.equal(table.parentElement.getAttribute('role'), 'region');
    assert.equal(table.parentElement.tabIndex, 0);
    assert.ok(table.parentElement.getAttribute('aria-label'));
  }
});

test('ofrece instrucciones de instalación cuando el navegador no muestra un aviso nativo', async () => {
  assert.ok(document.querySelector('link[rel=manifest]'));
  assert.equal(typeof window.instalarApp, 'function');
  await window.instalarApp();
  assert.equal($('install-help').hidden, false);
  assert.match($('install-help').textContent, /iPhone/);
  assert.match($('install-help').textContent, /Android/);
  await window.instalarApp();
  assert.equal($('install-help').hidden, true);
});

test('usa el aviso nativo de instalación y oculta el botón cuando se acepta', async () => {
  const event = new window.Event('beforeinstallprompt', { cancelable: true });
  event.prompt = async () => {};
  event.userChoice = Promise.resolve({ outcome: 'accepted' });
  window.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  await window.instalarApp();
  assert.equal($('install-app').hidden, true);
  assert.equal($('install-help').hidden, true);
});

test('muestra el aviso sin conexión y lo retira al recuperar red', () => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
  window.dispatchEvent(new window.Event('offline'));
  assert.equal($('offline-notice').hidden, false);
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  window.dispatchEvent(new window.Event('online'));
  assert.equal($('offline-notice').hidden, true);
});

test('un acceso vencido conserva la venta y permite volver a iniciar sesión', async () => {
  fill({ 'fac-buscar-prod': 'BUJ-01', 'fac-cantidad': 1 });
  window.agregarLineaFactura();
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'Inicia sesión' }), {
    status: 401, headers: { 'Content-Type': 'application/json' },
  });
  try { await window.procesarFactura(); }
  finally { globalThis.fetch = (path, options) => nativeFetch(new URL(path, base), options); }
  assert.equal($('login-again').hidden, false);
  assert.equal($('login-again').getAttribute('target'), '_blank');
  assert.equal($('fac-total').textContent, '150.00');
  assert.equal(prints, 0);
  assert.equal((await saved()).state.facturas.length, 0);
  await window.actualizarDatos();
  assert.equal($('login-again').hidden, true);
  window.quitarLineaFactura(0);
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
  const product = current.state.productos.find((p) => p.codigo === 'BUJ-01');
  window.editarProducto(product.id);
  await write('PUT', `/api/productos/${product.id}`, { ...product, nombre: 'Cambio otra caja' });
  fill({ 'prod-nombre': 'Mi edición pendiente' });
  await window.guardarProducto();
  assert.equal($('prod-nombre').value, 'Mi edición pendiente');
  assert.equal((await saved()).state.productos.find((p) => p.id === product.id).nombre, 'Cambio otra caja');
  assert.equal(window.db.productos.find((p) => p.id === product.id).nombre, 'Cambio otra caja');
  window.cancelarEdicionProducto();
  fill({ 'cli-nombre': "Cliente O'Neil", 'cli-rnc': '123', 'cli-tel': '809-555-0100' });
  await window.guardarCliente();
  assert.equal($('cli-nombre').value, '');
  assert.equal((await saved()).state.clientes.length, 2);
});

test('un fallo conserva el carrito y solo imprime al confirmar el reintento', async () => {
  fill({ 'fac-buscar-prod': 'BUJ-02', 'fac-cantidad': 1 });
  window.agregarLineaFactura();
  globalThis.fetch = (path, options) => {
    if (options?.method === 'POST') return Promise.reject(new TypeError('Conexión interrumpida'));
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
  await window.reintentarOperacion();
  assert.equal((await saved()).state.facturas.length, 2);
  assert.equal(prints, 2);
  assert.equal($('fac-total').textContent, '0.00');
});

test('una compra guarda su número, aumenta inventario y rechaza duplicados', async () => {
  fill({
    'comp-suplidor': window.db.suplidores.find((s) => s.nombre === 'Super Gato').id, 'comp-num-factura': 'COMP-TEST-1', 'comp-codigo': 'BUJ-01',
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
  assert.match(alerts.at(-1), /registrada|duplicad|Ya existe/i);
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
  assert.match(alerts.at(-1), /empresa|respaldo/i);
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

test('un artículo exento muestra el mismo ITBIS y total antes y después de confirmar', async () => {
  await write('POST', '/api/productos', { codigo: 'EXENTO', nombre: 'Artículo exento', stock: 2, costo: 10,
    precio1: 118, precio2: 110, precio3: 100, gravado: false });
  await window.actualizarDatos();
  while ($('tabla-detalle-factura').rows.length) window.quitarLineaFactura(0);
  fill({ 'fac-buscar-prod': 'EXENTO', 'fac-cantidad': 1, 'fac-nivel-precio': 'precio1',
    'fac-cliente': window.db.clientes[0].id, 'fac-ncf': 'B02', 'fac-condicion': 'Contado' });
  window.agregarLineaFactura();
  assert.equal($('fac-itbis').textContent, '0.00');
  assert.equal($('fac-subtotal').textContent, '118.00');
  assert.equal($('fac-total').textContent, '118.00');
  await window.procesarFactura();
  const invoice = (await saved()).state.facturas.at(-1);
  assert.equal(invoice.itbis, 0);
  assert.equal(invoice.base, 118);
  assert.equal(invoice.total, 118);
});

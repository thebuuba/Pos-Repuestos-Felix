import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

test('envía IDs y conserva la misma operación al perder la respuesta, incluso después de actualizar', async () => {
  const dom = new JSDOM(await readFile(new URL('../public/index.html', import.meta.url), 'utf8'), { url: 'http://127.0.0.1' });
  const original = { fetch: globalThis.fetch, setInterval: globalThis.setInterval };
  const state = { empresa: 'Félix', itbisRate: .18, configuracionVersion: 1,
    productos: [{ id: 8, version: 3, codigo: 'P1', nombre: 'Pieza', costo: 10, stock: 2, precio1: 118, precio2: 110, precio3: 100 }],
    clientes: [{ id: 5, version: 1, nombre: 'Contado', rnc: '', tel: '', deuda: 0 }], suplidores: [], facturas: [], compras: [], movimientos: [] };
  let identity = '11111111-1111-4111-8111-111111111111', expired = false;
  const snapshot = () => ({ state: structuredClone(state), databaseId: identity, revision: state.facturas.length, databaseLabel: 'Prueba' });
  const requests = [], alerts = [];
  let prints = 0;
  globalThis.window = dom.window; globalThis.document = dom.window.document;
  globalThis.alert = (message) => alerts.push(message); globalThis.confirm = () => true;
  globalThis.setInterval = () => 0;
  window.open = () => ({ document: { write() {}, close() {} }, focus() {}, print() { prints++; } });
  globalThis.fetch = async (path, options) => {
    if (!options?.body) return Response.json(snapshot());
    requests.push({ path, key: options.headers['Idempotency-Key'], body: JSON.parse(options.body) });
    if (expired) return Response.json({ error: 'Inicia sesión' }, { status: 401 });
    if (requests.length === 1) {
      state.productos[0].stock--;
      state.facturas.push({ id: 31, clienteId: 5, cliente: 'Contado', fecha: '21/11/2026', ncf: null, condicion: 'Contado', total: 118, items: [{ cant: 1, nombre: 'Pieza', subtotal: 118 }] });
      throw new TypeError('Respuesta perdida después de confirmar en el servidor');
    }
    return Response.json({ ...snapshot(), result: { id: 31 } });
  };
  try {
    await import('../public/app.js');
    document.getElementById('fac-buscar-prod').value = 'P1';
    window.agregarLineaFactura();
    await window.procesarFactura();
    assert.equal(requests[0].path, '/api/ventas');
    assert.deepEqual(requests[0].body.items, [{ productoId: 8, cantidad: 1, nivelPrecio: 'precio1' }]);
    assert.equal(requests[0].body.clienteId, 5);
    assert.match(requests[0].key, /^[0-9a-f-]{36}$/);
    assert.equal(document.getElementById('pending-operation').hidden, false);
    assert.equal(document.getElementById('workspace').inert, true);
    assert.equal(prints, 0);
    expired = true;
    await window.reintentarOperacion();
    assert.equal(document.getElementById('pending-operation').hidden, false);
    assert.equal(document.getElementById('login-again').hidden, false);
    expired = false;
    await window.actualizarDatos();
    await window.reintentarOperacion();
    assert.deepEqual(requests[1], requests[0]);
    assert.deepEqual(requests[2], requests[0]);
    assert.equal(state.facturas.length, 1);
    assert.equal(prints, 1);
    assert.equal(document.getElementById('fac-total').textContent, '0.00');
    assert.equal(document.getElementById('pending-operation').hidden, true);
    assert.equal(document.getElementById('workspace').inert, false);
    assert.equal(document.querySelector('[onclick="reiniciarSistema()"]'), null);
    window.editarProducto(8);
    document.getElementById('fac-buscar-prod').value = 'P1';
    window.agregarLineaFactura();
    identity = '22222222-2222-4222-8222-222222222222';
    state.productos[0].nombre = 'Otro producto con el mismo ID';
    await window.actualizarDatos();
    await window.procesarFactura();
    assert.match(alerts.at(-1), /base.*cambi|restaur/i);
    await window.guardarProducto();
    assert.match(alerts.at(-1), /base.*cambi|restaur/i);
    assert.equal(requests.length, 3, 'No debe enviar referencias del borrador a otra identidad de base');
  } finally {
    globalThis.fetch = original.fetch; globalThis.setInterval = original.setInterval; dom.window.close();
  }
});

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { historicalBackup } from './fixtures/relational-backup.js';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { createApp } from '../src/server.js';

let database, pool, server, origin;
before(async () => {
  database = await temporaryPostgres();
  const admin = new pg.Pool({ connectionString: database.connectionString });
  try { await migrateDatabase(admin); } finally { await admin.end(); }
  pool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app' });
  server = await createApp(pool);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = 'http://127.0.0.1:' + server.address().port + '/api/';
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await pool?.end();
  await database?.stop();
});
const get = async (path = 'state') => (await fetch(origin + path)).json();
async function write(path, body, method = 'POST', key = randomUUID()) {
  return fetch(origin + path, { method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify({ databaseId: (await get()).databaseId, ...body }) });
}
async function confirmed(...args) {
  const response = await write(...args);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}
async function rejected(status, ...args) {
  const key = randomUUID();
  const [path, body, method = 'POST'] = args;
  const response = await write(path, body, method, key);
  assert.equal(response.status, status, path + ' ' + await response.clone().text());
  assert.equal((await response.json()).rejection.operationId, key);
}
const formula = { nombre: 'Fórmula general', factorCosto: 1.234, recargo1: 35.1234, recargo2: 0, recargo3: 12.03 };
const lookup = async (table, id) => (await get()).state[table].find(row => row.id === id);

test('contacts round trip every field, preserve omissions, and distinguish unknown from zero', async () => {
  const customer = { nombre: 'María', rnc: '123', tel: '555', correo: 'm@example.test', direccion: 'Calle 1', limiteCredito: 1250.5 };
  const id = (await confirmed('clientes', { ...customer, limiteCredito: '1250.50' })).result.id;
  assert.deepEqual(await lookup('clientes', id), { ...customer, id, version: 1, deuda: 0, esContado: false });
  const route = 'clientes/' + id;
  const change = { nombre: 'Nuevo nombre', rnc: '', tel: '', version: 1 };
  const key = randomUUID();
  const replay = await Promise.all([confirmed(route, change, 'PUT', key), confirmed(route, change, 'PUT', key)]);
  assert.equal(replay[0].revision, replay[1].revision);
  assert.deepEqual(await lookup('clientes', id), { ...customer, ...change, id, version: 2, deuda: 0, esContado: false });
  await rejected(409, route, change, 'PUT');
  await confirmed(route, { ...change, version: 2, limiteCredito: 0 }, 'PUT');
  assert.equal((await lookup('clientes', id)).limiteCredito, 0);
  const basic = (await confirmed('clientes', { nombre: 'Desconocido' })).result.id;
  assert.equal((await lookup('clientes', basic)).limiteCredito, null);
  const legacy = (await confirmed('clientes', { nombre: 'Contacto anterior', rnc: null, tel: null })).result.id;
  assert.equal((await lookup('clientes', legacy)).rnc, '');
  assert.equal((await lookup('clientes', legacy)).tel, '');
  const fid = (await confirmed('formulas', formula)).result.id;
  const supplier = { nombre: 'Proveedor', rnc: '231', tel: '555', correo: 'p@example.test', contacto: 'Juan', diasCredito: 0, formulaId: fid };
  const sid = (await confirmed('suplidores', supplier)).result.id;
  assert.deepEqual(await lookup('suplidores', sid), { ...supplier, id: sid, version: 1 });
  await confirmed('suplidores/' + sid, { nombre: 'Otro', rnc: '', tel: '', version: 1 }, 'PUT');
  assert.deepEqual(await lookup('suplidores', sid), { ...supplier, nombre: 'Otro', rnc: '', tel: '', id: sid, version: 2 });
  await confirmed('suplidores/' + sid, { ...supplier, version: 2, diasCredito: null, formulaId: null }, 'PUT');
  assert.equal((await lookup('suplidores', sid)).diasCredito, null);
  assert.equal((await lookup('suplidores', sid)).formulaId, null);
});

test('invalid contact, formula and settings fields have proven rejections and leave revision untouched', async () => {
  const before = await get();
  for (const bad of [{ esContado: false }, { deuda: 0 }, { saldo_apertura: 0 }, { desconocido: true },
    { limiteCredito: -1 }, { limiteCredito: '1.001' }, { correo: null }, { direccion: ' '.repeat(2001) }])
    await rejected(400, 'clientes', { nombre: 'Inválido', ...bad });
  for (const bad of [{ diasCredito: -1 }, { diasCredito: 2147483648 }, { diasCredito: 1.1 }, { formulaId: '1' }, { formulaId: 90000 }])
    await rejected(400, 'suplidores', { nombre: 'Inválido', ...bad });
  for (const bad of [{ factorCosto: 0 }, { recargo3: '0.00001' }, { nombre: ' ' }, { costo: 1 }])
    await rejected(400, 'formulas', { ...formula, ...bad });
  for (const bad of [{}, { ncf: [] }, { permitirStockNegativo: true }, { redondeo: 2 },
    { nivelPrecioPredeterminado: 'P4' }, { formatoImpresion: 'otro' }, { itbisPorcentaje: '18.12345' }])
    await rejected(400, 'configuracion', { version: before.state.configuracionVersion, ...bad }, 'PUT');
  assert.deepEqual(await get(), before);
});

test('configuration patches preserve other sections, exact percentages and legacy aliases', async () => {
  const initial = (await get()).state;
  const business = { empresa: 'Tienda', rnc: '123', tel: '809', correo: 'pos@example.test', direccion: 'Calle 2' };
  await confirmed('configuracion', { ...business, version: initial.configuracionVersion }, 'PUT');
  await rejected(409, 'configuracion', { redondeo: 5, version: initial.configuracionVersion }, 'PUT');
  const preferences = { itbisPorcentaje: 18.1234, redondeo: 25, nivelPrecioPredeterminado: 'p2',
    formatoImpresion: 'Térmica 58 mm', pieTicket: 'Gracias', permitirStockNegativo: false };
  await confirmed('configuracion', { ...preferences, version: initial.configuracionVersion + 1 }, 'PUT');
  const { state } = await get();
  assert.deepEqual(state.configuracion, { ...business, ...preferences, version: initial.configuracionVersion + 2 });
  assert.equal(state.itbisRate, 0.181234);
  assert.equal(state.empresa, business.empresa);
  assert.equal(state.configuracionVersion, state.configuracion.version);
});

test('deactivation preserves document history and refuses customers with outstanding debt', async () => {
  const sid = (await confirmed('suplidores', { nombre: 'Suplidor histórico' })).result.id;
  await confirmed('compras', { suplidorId: sid, numero: 'C1', items: [
    { codigo: 'H1', nombre: 'Repuesto', cantidad: 4, costo: 1, precio1: 10, precio2: 9, precio3: 8 }] });
  const productId = (await get()).state.productos.find(p => p.codigo === 'H1').id;
  await confirmed('suplidores/' + sid, { version: 1 }, 'DELETE');
  for (const condicion of ['Contado', 'Credito']) {
    const id = (await confirmed('clientes', { nombre: 'Histórico ' + condicion, limiteCredito: 20 })).result.id;
    const sale = await confirmed('ventas', { clienteId: id, condicion, tipoComprobante: 'B02',
      items: [{ productoId: productId, cantidad: 1, nivelPrecio: 'precio1' }] });
    if (condicion === 'Credito') await rejected(409, 'clientes/' + id, { version: 1 }, 'DELETE');
    else await confirmed('clientes/' + id, { version: 1 }, 'DELETE');
    assert.deepEqual((await get()).state.facturas, sale.state.facturas);
  }
  const { state } = await get();
  assert.equal(state.compras.find(c => c.suplidorId === sid).suplidor, 'Suplidor histórico');
  assert.equal(state.clientes.find(c => c.nombre === 'Histórico Credito').deuda, 10);
  assert.ok(!state.clientes.some(c => c.nombre === 'Histórico Contado'));
  assert.ok(!state.suplidores.some(s => s.id === sid));
});

test('formulas validate assignments, including an inactive supplier, and serialize concurrent removal', async () => {
  const id = (await confirmed('formulas', formula)).result.id;
  assert.deepEqual(await lookup('formulas', id), { id, version: 1, ...formula });
  await confirmed('formulas/' + id, { ...formula, version: 1, recargo2: 8 }, 'PUT');
  const sid = (await confirmed('suplidores', { nombre: 'Vinculado', formulaId: id })).result.id;
  await confirmed('suplidores/' + sid, { version: 1 }, 'DELETE');
  await rejected(409, 'formulas/' + id, { version: 2 }, 'DELETE');
  const other = (await confirmed('formulas', formula)).result.id;
  const [saved, removed] = await Promise.all([write('suplidores', { nombre: 'En carrera', formulaId: other }),
    write('formulas/' + other, { version: 1 }, 'DELETE')]);
  assert.ok((saved.status === 200 && removed.status === 409) || (saved.status === 400 && removed.status === 200));
  const unused = (await confirmed('formulas', formula)).result.id;
  await confirmed('formulas/' + unused, { version: 1 }, 'DELETE');
  await rejected(400, 'suplidores', { nombre: 'Inválido', formulaId: unused });
});

const restore = async backup => confirmed('restore', { revision: (await get()).revision, backup });

test('v5 restores inactive records, references and cash identity while archiving pre-restore data', async () => {
  const formulaId = (await confirmed('formulas', formula)).result.id;
  const supplierId = (await confirmed('suplidores', { nombre: 'Archivado', formulaId })).result.id;
  await confirmed('suplidores/' + supplierId, { version: 1 }, 'DELETE');
  const backup = await get('backup');
  assert.equal(backup.version, 5);
  assert.deepEqual(Object.keys(backup.tables), ['configuracion', 'clientes', 'formulas_precios', 'suplidores', 'productos', 'ventas', 'venta_detalles', 'compras', 'compra_detalles', 'movimientos_inventario']);
  const marked = backup.tables.clientes.find(c => c.es_contado);
  marked.id = '8500';
  backup.tables.clientes.sort((a, b) => Number(a.id) - Number(b.id));
  const original = await get();
  const restored = await restore(backup);
  assert.notEqual(restored.databaseId, original.databaseId);
  assert.deepEqual((await get('backup')).tables, backup.tables);
  const archived = (await pool.query("SELECT datos FROM pos_privado.respaldos WHERE motivo='Antes de restaurar' ORDER BY id DESC LIMIT 1")).rows[0].datos;
  assert.equal(archived.version, 5);
  assert.notEqual(archived.tables.clientes.find(c => c.es_contado).id, '8500');
  for (const method of ['PUT', 'DELETE'])
    await rejected(409, 'clientes/8500', method === 'PUT' ? { nombre: 'Cambio', version: 1 } : { version: 1 }, method);
});

test('malformed v5 rows, relations and per-version layouts roll back without rotating or archiving', async () => {
  const unused = (await confirmed('formulas', formula)).result.id;
  await confirmed('formulas/' + unused, { version: 1 }, 'DELETE');
  await confirmed('suplidores', { nombre: 'Disponible' });
  await confirmed('clientes', { nombre: 'Otro' });
  const original = await get();
  const backup = await get('backup');
  const archiveCount = async () => (await pool.query('SELECT count(*) FROM pos_privado.respaldos')).rows[0].count;
  const count = await archiveCount();
  for (const edit of [
    b => { delete b.tables.formulas_precios; }, b => { b.version = 3; }, b => { b.tables.otro = []; },
    b => { delete b.tables.clientes[0].correo; }, b => { b.tables.configuracion[0].ncf = []; },
    b => { b.tables.suplidores[0].formula_id = '88888'; }, b => { b.tables.clientes[0].limite_credito = '0.001'; },
    b => { b.tables.formulas_precios[0].factor_costo = '0'; }, b => { b.tables.formulas_precios[0].recargo1 = '3.00001'; },
    b => { b.tables.suplidores[0].formula_id = b.tables.formulas_precios.find(f => !f.activo).id; },
    b => { b.tables.configuracion[0].permitir_stock_negativo = true; },
    b => { b.tables.clientes.find(c => !c.es_contado).es_contado = true; },
    b => { b.tables.clientes.find(c => c.es_contado).activo = false; },
  ]) {
    const invalid = structuredClone(backup);
    edit(invalid);
    await rejected(400, 'restore', { backup: invalid, revision: original.revision });
  }
  assert.deepEqual(await get(), original);
  assert.equal(await archiveCount(), count);
});

test('v3, v2 and legacy imports have neutral metadata and infer only the unique canonical cash customer', async () => {
  const backup = await get('backup');
  for (const version of [3, 2]) {
    const old = historicalBackup(backup, version);
    const candidate = old.tables.clientes.find(row => row.nombre === 'Cliente Contado');
    if (version === 2) old.tables.clientes.push({ ...candidate, id: '9100', nombre: 'CLIENTE CONTADO', rnc: '123', activo: false });
    const { state } = await restore(old);
    assert.deepEqual(state.formulas, []);
    assert.ok(state.clientes.every(c => c.limiteCredito === null && c.correo === ''));
    assert.ok(state.suplidores.every(s => s.diasCredito === null && s.formulaId === null));
    assert.equal(state.clientes.filter(c => c.esContado).length, version === 3 ? 1 : 0);
    assert.equal(state.configuracion.nivelPrecioPredeterminado, null);
    assert.equal(state.configuracion.redondeo, 0);
  }
  const legacy = { empresa: 'Archivo', itbisRate: 0.18, clientes: [{ nombre: 'Primero', deuda: 0 }, { nombre: 'Cliente Contado', deuda: 0 }] };
  const { state } = await restore(legacy);
  assert.ok(state.clientes.find(c => c.nombre === 'Cliente Contado').esContado);
  assert.ok(!state.clientes.find(c => c.nombre === 'Primero').esContado);
  assert.equal(state.configuracion.formatoImpresion, null);
});

test('restricted application role can maintain formulas and cannot alter their schema', async () => {
  const id = (await confirmed('formulas', formula)).result.id;
  assert.equal((await lookup('formulas', id)).factorCosto, 1.234);
  await assert.rejects(pool.query('ALTER TABLE public.formulas_precios ADD COLUMN no_autorizada integer'), { code: '42501' });
});

test('legacy restore uses the raw contact before trimming to protect an initializer', async () => {
  for (const [source, protect] of [
    [{ nombre: ' Cliente Contado ', rnc: ' ', tel: ' ', deuda: 0 }, false],
    [{ nombre: ' Cliente Contado ', rnc: '', tel: '', deuda: 0 }, false],
    [{ nombre: 'Cliente Contado', rnc: ' ', tel: '', deuda: 0 }, false],
    [{ nombre: 'Cliente Contado', rnc: '', tel: ' ', deuda: 0 }, false],
    [{ nombre: 'Cliente Contado', rnc: '', tel: '', deuda: 0 }, true],
    [{ nombre: 'Cliente Contado', tel: null, deuda: 0 }, true],
    [null, true], // El importador crea el contacto si no hay clientes ni facturas.
  ]) {
    const { state } = await restore({ empresa: 'Original', itbisRate: 0.18, clientes: source ? [source] : [] });
    const [contact] = state.clientes;
    assert.equal(contact.nombre, 'Cliente Contado');
    assert.equal(contact.esContado, protect, JSON.stringify(source));
    const args = ['clientes/' + contact.id, { nombre: 'Nombre corregido', version: contact.version }, 'PUT'];
    if (protect) await rejected(409, ...args);
    else {
      await confirmed(...args);
      assert.equal((await lookup('clientes', contact.id)).nombre, 'Nombre corregido');
    }
  }
});

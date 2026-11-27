import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { temporaryPostgres } from './postgres.js';
import { contactOperation } from '../src/pos/contact-operations.js';

let database, pool, legacyMigration, migration, schema;
const tables = ['clientes','compra_detalles','compras','configuracion','movimientos_inventario','productos','suplidores','venta_detalles','ventas'];
const legacy = {
  empresa: 'Repuestos con historia', itbisRate: 0.18,
  productos: [{ codigo:'P1', nombre:'Producto actual', costo:50, stock:3, precio1:118, precio2:100, precio3:90 }],
  clientes: [{ nombre:'Cliente Contado', rnc:'', tel:'', deuda:0 }, { nombre:'María', rnc:'001', tel:'809', deuda:120 }],
  suplidores: [{ nombre:'Proveedor actual', rnc:'002', tel:'' }],
  facturas: [{ id:7, fecha:'21/11/2026', cliente:'María', ncf:'B02-00000007', condicion:'Credito', total:118,
    items:[{ codigo:'P1', nombre:'Nombre histórico', cant:1, precio:118, itbis:18, subtotal:118 }] }],
  compras: [{ id:9, fecha:'20/11/2026', suplidor:'Proveedor eliminado', numero:'ANT-1', total:100,
    items:[{ codigo:'ANT', nombre:'Artículo eliminado', cant:2, costo:50, p1:75, p2:70, p3:60, subtotal:100 }] }],
};

before(async () => {
  legacyMigration = await readFile(new URL('../supabase/migrations/20261121150000_inicializar_pos.sql', import.meta.url), 'utf8');
  schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  migration = await readFile(new URL('../supabase/migrations/20261121190000_normalizar_pos.sql', import.meta.url), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return ''; throw error;
  });
  database = await temporaryPostgres();
  pool = new pg.Pool({ connectionString: database.connectionString });
  await pool.query(legacyMigration);
  await pool.query('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS');
  // Reproduce los grants de Supabase para detectar exposición accidental de tablas nuevas.
  await pool.query('ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES GRANT ALL ON SEQUENCES TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role');
});
after(async () => { await pool?.end(); await database?.stop(); });

async function migrated(run, state) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (state) await client.query('UPDATE pos_privado.estado SET datos=$1::jsonb, revision=13 WHERE id=1', [JSON.stringify(state)]);
    await client.query(migration);
    await run(client);
  } finally { await client.query('ROLLBACK'); client.release(); }
}

test('schema.sql crea toda la estructura en una base sin esquema previo', async () => {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DROP SCHEMA pos_privado CASCADE');
    await client.query(schema);
    assert.equal((await client.query("SELECT count(*) FROM pg_tables WHERE schemaname='public'")).rows[0].count,'18');
    assert.equal((await client.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.formulas_precios'::regclass")).rows[0].relrowsecurity, true);
    assert.equal((await client.query("SELECT relrowsecurity FROM pg_class WHERE oid='public.recordatorios'::regclass")).rows[0].relrowsecurity, true);
    await client.query('SET LOCAL ROLE pos_app');
    const inventory = await client.query(`INSERT INTO productos(codigo,nombre,costo,precio1,precio2,precio3,stock,stock_minimo)
      VALUES ('sku ','Prueba',12.3456,23.45,0,0,1.25,0.50), ('SKU ','Prueba',0,0,0,0,0,0)
      RETURNING codigo,costo,stock,stock_minimo,notificar_minimo`);
    assert.deepEqual(inventory.rows, [
      { codigo: 'sku ', costo: '12.3456', stock: '1.25', stock_minimo: '0.50', notificar_minimo: true },
      { codigo: 'SKU ', costo: '0.0000', stock: '0.00', stock_minimo: '0.00', notificar_minimo: true },
    ]);
    await client.query('RESET ROLE');
    for (const role of ['anon','authenticated','service_role']) {
      const { rows } = await client.query(`SELECT has_table_privilege($1,'public.formulas_precios','SELECT') AS tabla,
        has_sequence_privilege($1,'public.formulas_precios_id_seq','USAGE') AS secuencia,
        has_function_privilege($1,'pos_privado.marcar_contado_historico(jsonb)','EXECUTE') AS funcion`, [role]);
      assert.deepEqual(rows[0], { tabla: false, secuencia: false, funcion: false });
    }
    await client.query("INSERT INTO pos_privado.estado(id,datos) VALUES(1,'{}')").then(
      () => assert.fail('El archivo histórico debe ser inmutable'),
      error => assert.equal(error.code,'55000'),
    );
  } finally { await client.query('ROLLBACK'); client.release(); }
});

test('crea tablas relacionadas visibles y una base limpia sin demostración', async () => migrated(async client => {
  const { rows } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
  assert.deepEqual(rows.map(row => row.tablename), tables);
  assert.equal((await client.query('SELECT empresa, tasa_itbis FROM configuracion')).rows[0].empresa, 'REPUESTOS FELIX');
  assert.equal((await client.query('SELECT count(*) FROM productos')).rows[0].count, '0');
  assert.equal((await client.query('SELECT nombre FROM clientes')).rows[0].nombre, 'Cliente Contado');
}));

test('contact migration uses the raw contact from the same generation before protecting it', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261122000000_contactos_configuracion.sql', import.meta.url), 'utf8');
  const exact = { nombre: 'Cliente Contado', rnc: '', tel: '', deuda: 0 };
  for (const [source, restoredPreviously, protect] of [
    [{ ...exact, nombre: ' Cliente Contado ', rnc: ' ', tel: ' ' }, false, false],
    [exact, false, true], [null, false, true], [exact, true, false],
  ]) {
    await migrated(async client => {
      if (restoredPreviously) {
        await client.query("INSERT INTO pos_privado.respaldos(motivo,datos) VALUES('Antes de restaurar','{}')");
        await client.query('UPDATE pos_privado.sistema SET database_id=gen_random_uuid()');
      }
      await client.query(sql);
      await client.query('SET LOCAL ROLE pos_app');
      const [contact] = (await client.query('SELECT * FROM clientes')).rows;
      assert.equal(contact.nombre, 'Cliente Contado');
      assert.equal(contact.es_contado, protect);
      const change = () => contactOperation(client, 'clientes', 'PUT', Number(contact.id), { nombre: 'Editable', version: 1 });
      if (protect) await assert.rejects(change(), { status: 409 });
      else {
        await change();
        assert.equal((await client.query('SELECT nombre FROM clientes')).rows[0].nombre, 'Editable');
      }
    }, { empresa: 'Archivo', itbisRate: 0.18, clientes: source ? [source] : [] });
  }
});

test('convierte históricos preservando documentos, saldos y existencias al corte', async () => migrated(async client => {
  const sale = (await client.query('SELECT * FROM ventas')).rows[0];
  assert.equal(sale.id, '7'); assert.equal(sale.total, '118.00'); assert.equal(sale.base, '100.00');
  assert.equal(sale.ncf, 'B02-00000007');
  assert.equal((await client.query("SELECT saldo_apertura FROM clientes WHERE nombre='María'")).rows[0].saldo_apertura, '2.00');
  assert.equal((await client.query("SELECT activo FROM suplidores WHERE nombre='Proveedor eliminado'")).rows[0].activo, false);
  assert.equal((await client.query("SELECT activo,stock FROM productos WHERE codigo='ANT'")).rows[0].activo, false);
  assert.equal((await client.query('SELECT nombre FROM venta_detalles')).rows[0].nombre, 'Nombre histórico');
  const movements = (await client.query('SELECT tipo,cantidad,existencia_posterior FROM movimientos_inventario')).rows;
  assert.deepEqual(movements, [{tipo:'apertura',cantidad:3,existencia_posterior:3}]);
  assert.equal((await client.query('SELECT revision FROM pos_privado.sistema')).rows[0].revision, '13');
  assert.equal((await client.query('SELECT datos FROM pos_privado.respaldos')).rows[0].datos.empresa, legacy.empresa);
  assert.equal((await client.query("SELECT nextval(pg_get_serial_sequence('ventas','id'))")).rows[0].nextval, '8');
  assert.equal((await client.query("SELECT nextval(pg_get_serial_sequence('compras','id'))")).rows[0].nextval, '10');
}, legacy));

test('normaliza ITBIS fraccionario y residuos flotantes generados por el POS anterior', async () => {
  for (const [price, quantity, total, debt, expectedTax, expectedBase, expectedOpening] of [
    [150,1,150,152,'22.88','127.12','2.00'],
    [0.1,3,0.3,0.32,'0.05','0.25','0.02'],
  ]) {
    const state=structuredClone(legacy);
    state.clientes[1].deuda=debt;
    Object.assign(state.facturas[0],{total,items:[{codigo:'P1',nombre:'Artículo',cant:quantity,precio:price,subtotal:price*quantity,itbis:price*quantity-(price*quantity)/(1+0.18)}]});
    await migrated(async client => {
      const sale=(await client.query('SELECT base,itbis,total FROM ventas')).rows[0];
      assert.equal(sale.base,expectedBase); assert.equal(sale.itbis,expectedTax);
      assert.equal((await client.query("SELECT saldo_apertura FROM clientes WHERE nombre='María'")).rows[0].saldo_apertura,expectedOpening);
    },state);
  }
});

test('rechaza datos históricos ambiguos o incoherentes sin tocar el estado original', async () => {
  for (const modify of [
    data => data.clientes.push({...data.clientes[1]}),
    data => { data.facturas[0].total=119; },
    data => { data.productos[0].stock=-1; },
    data => { data.facturas[0].fecha='31/02/2026'; },
  ]) {
    const client = await pool.connect();
    const state = structuredClone(legacy); modify(state);
    try {
      await client.query('BEGIN');
      await client.query('UPDATE pos_privado.estado SET datos=$1::jsonb WHERE id=1', [JSON.stringify(state)]);
      await client.query('SAVEPOINT migration');
      await assert.rejects(client.query(migration));
      await client.query('ROLLBACK TO SAVEPOINT migration');
      assert.equal((await client.query("SELECT to_regclass('public.productos') AS relation")).rows[0].relation, null);
      assert.deepEqual((await client.query('SELECT datos FROM pos_privado.estado WHERE id=1')).rows[0].datos, state);
    } finally { await client.query('ROLLBACK'); client.release(); }
  }
});

test('integridad impide códigos duplicados, stock negativo, detalles huérfanos y documentos descuadrados', async () => migrated(async client => {
  async function rejects(sql, code) {
    await client.query('SAVEPOINT invalid');
    await assert.rejects(client.query(sql), {code});
    await client.query('ROLLBACK TO SAVEPOINT invalid');
  }
  await rejects("INSERT INTO productos(codigo,nombre,costo,precio1,precio2,precio3,stock) VALUES('p1','Duplicado',1,1,1,1,0)", '23505');
  await rejects('UPDATE productos SET stock=-1', '23514');
  await rejects('UPDATE ventas SET total=119', '23514');
  await rejects('UPDATE venta_detalles SET producto_id=999', '23503');
  await rejects('DELETE FROM clientes', '23503');
  await rejects("UPDATE pos_privado.estado SET revision=14 WHERE id=1", '55000');
}, legacy));

test('RLS bloquea roles ajenos y pos_app opera datos sin DDL ni acceso al archivo legacy', async () => migrated(async client => {
  for (const role of ['anon','authenticated','service_role']) {
    assert.equal((await client.query("SELECT has_table_privilege($1,'public.productos','SELECT') AS allowed", [role])).rows[0].allowed, false);
    assert.equal((await client.query("SELECT has_function_privilege($1,'pos_privado.importar_estado_legacy(jsonb)','EXECUTE') AS allowed", [role])).rows[0].allowed, false);
  }
  await client.query('CREATE ROLE lector_no_autorizado NOLOGIN');
  await client.query('GRANT USAGE ON SCHEMA public TO lector_no_autorizado');
  await client.query('GRANT SELECT ON productos TO lector_no_autorizado');
  await client.query('SET LOCAL ROLE lector_no_autorizado');
  assert.deepEqual((await client.query('SELECT * FROM productos')).rows, []);
  await client.query('RESET ROLE');
  await client.query('SET LOCAL ROLE pos_app');
  assert.equal((await client.query('SELECT count(*) FROM productos')).rows[0].count, '2');
  await client.query("INSERT INTO clientes(nombre) VALUES('Cliente aplicación')");
  for (const sql of ['CREATE TABLE public.no_autorizada(id integer)', 'SELECT * FROM pos_privado.estado']) {
    await client.query('SAVEPOINT denied');
    await assert.rejects(client.query(sql), {code:'42501'});
    await client.query('ROLLBACK TO SAVEPOINT denied');
  }
  await client.query('RESET ROLE');
}, legacy));

test('el rol de aplicación restaura el formato anterior sin ejecutar DDL', async () => migrated(async client => {
  await client.query('SET LOCAL ROLE pos_app');
  await client.query('DELETE FROM movimientos_inventario; DELETE FROM venta_detalles; DELETE FROM compra_detalles; DELETE FROM ventas; DELETE FROM compras; DELETE FROM productos; DELETE FROM clientes; DELETE FROM suplidores; DELETE FROM configuracion');
  await client.query('SELECT pos_privado.importar_estado_legacy($1::jsonb)',[JSON.stringify(legacy)]);
  assert.equal((await client.query('SELECT total FROM ventas WHERE id=7')).rows[0].total,'118.00');
  assert.equal((await client.query("SELECT nextval(pg_get_serial_sequence('ventas','id'))")).rows[0].nextval,'8');
  await client.query('RESET ROLE');
}));

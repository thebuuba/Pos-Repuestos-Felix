import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdtemp, readFile, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { readSnapshot, writeOperation } from '../src/pos/store.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (cmd, args, env = process.env) => spawnSync(cmd, args, { encoding: 'utf8', env, windowsHide: true });
const empty = { categorias: [], marcas: [], ubicaciones: [], unidades: [] };

test('carga NetPOS atómica, privada, repetible y ligada a la generación', async t => {
  const root = await mkdtemp(join(tmpdir(), 'felix-netpos-test-'));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const source = join(root, 'source'), pkg = join(root, 'batch');
  const fixture = run('python', ['tests/netpos-prepare.py', '--fixture', source]);
  assert.equal(fixture.status, 0, fixture.stderr);
  const prepare = path => run('python', ['scripts/netpos/prepare.py', '--source', source, '--output', path]);
  const prepared = prepare(pkg);
  assert.equal(prepared.status, 0, prepared.stderr);
  const database = await temporaryPostgres();

  const admin = new pg.Pool({ connectionString: database.connectionString });
  const app = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app' });
  t.after(async () => { await app.end(); await admin.end(); await database.stop(); });
  await admin.query('CREATE ROLE anon; CREATE ROLE authenticated; ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon,authenticated; ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon,authenticated');
  await migrateDatabase(admin);
  const load = path => run(process.execPath, ['scripts/netpos/import.mjs', '--package', path],
    { ...process.env, NETPOS_DATABASE_URL: database.connectionString });
  const counts = async () => (await admin.query('SELECT (SELECT count(*)::int FROM productos) AS productos, (SELECT count(*)::int FROM pos_privado.netpos_importaciones) AS lotes')).rows[0];
  const beforeImport = JSON.parse(JSON.stringify(await readSnapshot(app, 'Prueba', true)));
  assert.deepEqual((await readSnapshot(app, 'Prueba')).state.catalogo, empty);
  const products = join(pkg, 'products.csv'), manifestPath = join(pkg, 'manifest.json');
  const good = await readFile(products), manifest = await readFile(manifestPath);
  await appendFile(products, 'corrupto\n');
  const damaged = load(pkg);
  assert.notEqual(damaged.status, 0);
  assert.match(damaged.stderr, /verificar/);
  assert.deepEqual(await counts(), { productos: 0, lotes: 0 });
  // Verificación íntegra del artefacto, pero COPY inválido después de crear el histórico.
  const bad = JSON.parse(manifest);
  bad.artifacts['products.csv'] = hash(await readFile(products));
  await writeFile(manifestPath, JSON.stringify(bad));
  const rejected = load(pkg);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /PostgreSQL.*22P04/);
  assert.deepEqual(await counts(), { productos: 0, lotes: 0 });
  assert.equal((await admin.query("SELECT to_regclass('netpos_historico.pagos') AS tabla")).rows[0].tabla, null);
  await writeFile(products, good); await writeFile(manifestPath, manifest);
  await admin.query("INSERT INTO productos(codigo,nombre,costo,precio1,precio2,precio3) VALUES('X','Prueba',0,0,0,0)");
  assert.notEqual(load(pkg).status, 0);
  await admin.query('DELETE FROM productos');
  await admin.query('ALTER TABLE public.venta_detalles ALTER COLUMN precio TYPE numeric(14,2)');
  assert.notEqual(load(pkg).status, 0);
  assert.deepEqual(await counts(), { productos:0, lotes:0 });
  await admin.query('ALTER TABLE public.venta_detalles ALTER COLUMN precio TYPE numeric(16,4)');
  const first = load(pkg);
  assert.equal(first.status, 0, first.stderr);
  const state = await readSnapshot(app, 'Prueba');
  const replay = load(pkg);
  assert.equal(replay.status, 0, replay.stderr);
  assert.deepEqual(await readSnapshot(app, 'Prueba'), state);
  assert.deepEqual(await counts(), { productos: 5, lotes: 1 });
  assert.deepEqual(state.state.catalogo, { categorias: ['Opción CATEGORIA'], marcas: ['Opción MARCA'], ubicaciones: ['Opción UBICACION'], unidades: ['Opción UNIDAD'] });
  assert.equal(state.state.movimientos.length, 1);
  assert.equal(state.state.movimientos[0].cantidad, 0.25);
  const product = state.state.productos.find(p => p.codigo === '0012');
  assert.deepEqual([product.stock, product.stockMinimo, product.notificarMinimo, product.gravado, product.costoExacto, product.categoria],
    [0.25, 0.5, false, false, '12.3456', 'Opción CATEGORIA']);
  assert.equal(state.state.clientes.length, 2);
  assert.deepEqual(state.state.clientes.map(c => c.deuda), [0,0]);
  assert.equal(state.state.clientes.filter(c => c.esContado).length, 1);
  assert.equal(state.state.suplidores[0].diasCredito, null);
  assert.equal(state.state.empresa, 'Negocio de prueba');
  assert.doesNotMatch(JSON.stringify(state), /PRIVADO-SINTETICO|extra privado/);
  assert.doesNotMatch(first.stdout+first.stderr, /PRIVADO-SINTETICO|postgresql:|INSERT INTO/);
  const archives = (await admin.query('SELECT nombre,sha256,original_gzip,filas,columnas FROM pos_privado.netpos_archivos')).rows;
  assert.equal(archives.length, 10);
  for (const file of archives) {
    const bytes = gunzipSync(file.original_gzip);
    assert.equal(hash(bytes), file.sha256);
    assert.deepEqual(bytes, await readFile(join(source, file.nombre)));
    if (file.nombre.endsWith('.csv')) {
      const table = file.nombre.slice(0,-4).toLowerCase();
      const historic = await admin.query('SELECT * FROM netpos_historico.' + table);
      assert.equal(historic.rowCount, Number(file.filas));
      assert.deepEqual(historic.fields.map(f => f.name), ['_fila', ...file.columnas]);
    }
  }
  const payments = (await admin.query('SELECT * FROM netpos_historico.pagos ORDER BY _fila')).rows;
  assert.deepEqual(payments.map(p => [p.TARJETA,p.NOTA]), [['PRIVADO-SINTETICO','texto,"á"\r\nsegunda línea'],['','']]);
  const origin = (await admin.query('SELECT codigo_original,codigo,original FROM pos_privado.netpos_catalogo WHERE producto_id=$1',[product.id])).rows[0];
  assert.deepEqual([origin.codigo_original,origin.codigo,origin.original.EXTRA.valor],['12','0012','extra privado']);
  assert.equal((await admin.query('SELECT count(*) FROM pos_privado.netpos_contactos')).rows[0].count, '2');
  for (const role of ['pos_app','anon','authenticated']) {
    const permissions = (await admin.query("SELECT has_schema_privilege($1,'netpos_historico','USAGE') AS history, has_table_privilege($1,'netpos_historico.pagos','SELECT') AS pagos, has_table_privilege($1,'pos_privado.netpos_archivos','SELECT') AS raw, has_function_privilege($1,'pos_privado.netpos_opciones()','EXECUTE') AS options",[role])).rows[0];
    assert.deepEqual(permissions,{ history:false, pagos:false, raw:false, options:role === 'pos_app' });
  }
  await appendFile(join(source,'PAGOS.csv'), 'otro,valor\n');
  const different = join(root,'other');
  assert.equal(prepare(different).status,0);
  assert.notEqual(load(different).status,0);
  assert.deepEqual(await counts(),{ productos:5, lotes:1 });
  const restored = await writeOperation(app, 'POST','/api/restore', { databaseId:state.databaseId, revision:state.revision, backup:beforeImport }, randomUUID(), 'Prueba');
  assert.notEqual(restored.databaseId, state.databaseId);
  assert.deepEqual(restored.state.catalogo, empty);
  assert.deepEqual(await counts(), { productos:0, lotes:1 });
  assert.equal((await admin.query('SELECT count(*) FROM pos_privado.netpos_archivos')).rows[0].count,'10');
  assert.notEqual(load(pkg).status,0);
});

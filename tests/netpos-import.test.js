import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdtemp, readFile, writeFile, appendFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { readSnapshot, writeOperation } from '../src/pos/store.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (cmd, args, env = process.env) => spawnSync(cmd, args, { encoding: 'utf8', env, windowsHide: true });
const empty = { importada:false, categorias: [], marcas: [], ubicaciones: [], unidades: [] };

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

  const bootstrap = new pg.Pool({ connectionString: database.connectionString });
  await bootstrap.query('CREATE ROLE netpos_owner LOGIN SUPERUSER');
  await bootstrap.query("ALTER DATABASE postgres SET log_statement = 'ddl'");
  const ownerUrl = new URL(database.connectionString);
  ownerUrl.username = 'netpos_owner';
  const admin = new pg.Pool({ connectionString: ownerUrl.href });
  const app = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app' });
  t.after(async () => { await app.end(); await admin.end(); await bootstrap.end(); await database.stop(); });
  await admin.query('CREATE ROLE anon; CREATE ROLE authenticated; ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO anon,authenticated; ALTER DEFAULT PRIVILEGES GRANT EXECUTE ON FUNCTIONS TO anon,authenticated');
  await migrateDatabase(admin);
  const serverLog = join(dirname((await admin.query('SHOW data_directory')).rows[0].data_directory), 'postgres.log');
  await bootstrap.query('GRANT pos_app TO netpos_owner; ALTER ROLE netpos_owner NOSUPERUSER');
  assert.deepEqual((await admin.query("SELECT rolsuper, has_parameter_privilege(current_user,'log_error_verbosity','SET') AS log_set FROM pg_roles WHERE rolname=current_user")).rows[0], { rolsuper:false,log_set:false });
  assert.deepEqual((await admin.query("SELECT current_setting('log_error_verbosity') AS verbosity,current_setting('log_min_error_statement') AS errors,current_setting('log_statement') AS statements")).rows[0],
    { verbosity:'default',errors:'error',statements:'ddl' });
  const load = path => run(process.execPath, ['scripts/netpos/import.mjs', '--package', path],
    { ...process.env, NETPOS_DATABASE_URL: ownerUrl.href });
  const counts = async () => (await admin.query('SELECT (SELECT count(*)::int FROM productos) AS productos, (SELECT count(*)::int FROM pos_privado.netpos_importaciones) AS lotes')).rows[0];
  const beforeImport = JSON.parse(JSON.stringify(await readSnapshot(app, 'Prueba', true)));
  assert.deepEqual((await readSnapshot(app, 'Prueba')).state.catalogo, empty);
  const products = join(pkg, 'history-pagos.bin'), manifestPath = join(pkg, 'manifest.json');
  const good = await readFile(products), manifest = await readFile(manifestPath);
  const marker = 'PRIVADO-SINTETICO';
  assert.ok(good.includes(Buffer.from(marker)));
  await writeFile(products, good.subarray(0, good.indexOf(marker) + marker.length + 6));
  const damaged = load(pkg);
  assert.notEqual(damaged.status, 0);
  assert.match(damaged.stderr, /verificar/);
  assert.deepEqual(await counts(), { productos: 0, lotes: 0 });
  // Verificación íntegra del artefacto, pero COPY inválido después de crear el histórico.
  const bad = JSON.parse(manifest);
  bad.artifacts['history-pagos.bin'] = hash(await readFile(products));
  await writeFile(manifestPath, JSON.stringify(bad));
  const rejected = load(pkg);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /PostgreSQL.*22P0[34]/);
  assert.ok(!(rejected.stdout+rejected.stderr).includes(marker));
  const log = await readFile(serverLog,'utf8');
  assert.ok(/COPY .*pagos/i.test(log), 'El servidor debe registrar el fallo de COPY');
  assert.ok(!log.includes(marker), 'El registro debe omitir los campos privados');
  assert.deepEqual(await counts(), { productos: 0, lotes: 0 });
  assert.equal((await admin.query("SELECT to_regclass('netpos_historico.pagos') AS tabla")).rows[0].tabla, null);
  await writeFile(products, good); await writeFile(manifestPath, manifest);
  // Un error de conversión después del transporte tampoco debe registrar el valor.
  const productBinary = join(pkg, 'products.bin'), validProductBinary = await readFile(productBinary);
  const invalidProduct = Buffer.from(validProductBinary);
  const costField = Buffer.concat([Buffer.from([0,0,0,7]),Buffer.from('12.3456')]);
  const costIndex = invalidProduct.indexOf(costField);
  assert.ok(costIndex >= 0);
  invalidProduct.write('XYZDATA',costIndex+4,'ascii');
  await writeFile(productBinary,invalidProduct);
  const invalidManifest = JSON.parse(manifest);
  invalidManifest.artifacts['products.bin'] = hash(invalidProduct);
  await writeFile(manifestPath,JSON.stringify(invalidManifest));
  const invalidResult = load(pkg);
  assert.notEqual(invalidResult.status,0);
  assert.match(invalidResult.stderr,/22P02/);
  assert.ok(!(invalidResult.stdout+invalidResult.stderr).includes('XYZDATA'));
  assert.ok(!(await readFile(serverLog,'utf8')).includes('XYZDATA'));
  assert.deepEqual(await counts(), { productos:0, lotes:0 });
  await writeFile(productBinary,validProductBinary); await writeFile(manifestPath,manifest);
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
  assert.deepEqual(state.state.catalogo, { importada:true, categorias: ['Opción CATEGORIA'], marcas: ['Opción MARCA'], ubicaciones: ['Opción UBICACION'], unidades: ['Opción UNIDAD'] });
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

test('TLS administrativo verifica certificados y host para conexiones remotas', async () => {
  const { connectionEnvironment } = await import('../scripts/netpos/import.mjs');
  const remoto = 'postgresql://usuario@db.example.invalid/prueba';
  assert.equal(connectionEnvironment(remoto).PGSSLMODE, 'verify-full');
  assert.equal(connectionEnvironment(remoto+'?sslmode=verify-full&sslrootcert=system').PGSSLROOTCERT,'system');
  for (const mode of ['disable','allow','prefer','require','verify-ca'])
    assert.throws(() => connectionEnvironment(remoto+'?sslmode='+mode));
  for (const host of ['127.0.0.1','localhost','[::1]'])
    assert.equal(connectionEnvironment('postgresql://usuario@'+host+'/prueba?sslmode=disable').PGSSLMODE,'disable');
});

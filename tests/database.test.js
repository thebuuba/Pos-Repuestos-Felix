import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { temporaryPostgres } from './postgres.js';
import { validateState } from '../state.js';
import { createApp } from '../server.js';

let database, pool, migration;
before(async () => {
  migration = await readFile(new URL('../supabase/migrations/20261121150000_inicializar_pos.sql', import.meta.url), 'utf8');
  database = await temporaryPostgres();
  pool = new pg.Pool({ connectionString: database.connectionString });
  await pool.query(migration);
  await pool.query('CREATE ROLE lector_no_autorizado NOLOGIN');
});
after(async () => {
  if (pool) await pool.end();
  if (database) await database.stop();
});

test('inicializa una base compatible con el POS sin existencias ni operaciones inventadas', async () => {
  const { rows } = await pool.query('SELECT datos, revision FROM pos_privado.estado WHERE id = 1');
  const state = validateState(rows[0].datos);
  assert.equal(state.empresa, 'REPUESTOS FELIX');
  assert.equal(state.itbisRate, 0.18);
  assert.equal(state.clientes[0].nombre, 'Cliente Contado');
  assert.equal(rows[0].revision, 0);
  for (const key of ['productos', 'suplidores', 'facturas', 'compras']) assert.deepEqual(state[key], []);
});

test('reaplicar la migración o iniciar el servidor conserva los datos existentes', async () => {
  await pool.query("UPDATE pos_privado.estado SET datos = jsonb_set(datos, '{empresa}', $1::jsonb), revision = 7 WHERE id = 1", [JSON.stringify('Empresa guardada')]);
  await pool.query(migration);
  const server = await createApp(pool);
  server.close();
  const { rows } = await pool.query('SELECT datos, revision FROM pos_privado.estado WHERE id = 1');
  assert.equal(rows[0].datos.empresa, 'Empresa guardada');
  assert.equal(rows[0].revision, 7);
  assert.deepEqual(rows[0].datos.productos, []);
});

test('rechaza revisiones negativas y filas de estado adicionales', async () => {
  await assert.rejects(pool.query('UPDATE pos_privado.estado SET revision = -1 WHERE id = 1'), { code: '23514' });
  await assert.rejects(pool.query("INSERT INTO pos_privado.estado (id, datos) VALUES (2, '{}'::jsonb)"), { code: '23514' });
});

test('un rol sin autorización no puede leer el esquema privado', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE lector_no_autorizado');
    await assert.rejects(client.query('SELECT * FROM pos_privado.estado'), { code: '42501' });
  } finally { await client.query('ROLLBACK'); client.release(); }
});

test('RLS impide leer filas incluso si un rol recibe permisos de lectura', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('GRANT USAGE ON SCHEMA pos_privado TO lector_no_autorizado');
    await client.query('GRANT SELECT ON pos_privado.estado TO lector_no_autorizado');
    await client.query('SET LOCAL ROLE lector_no_autorizado');
    const { rows } = await client.query('SELECT * FROM pos_privado.estado');
    assert.deepEqual(rows, []);
  } finally { await client.query('ROLLBACK'); client.release(); }
});

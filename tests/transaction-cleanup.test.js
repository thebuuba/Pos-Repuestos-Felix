import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { readSnapshot, writeOperation } from '../src/pos/store.js';
import { handleRequest } from '../src/http/app.js';

let database, admin;
before(async () => {
  database = await temporaryPostgres();
  admin = new pg.Pool({ connectionString: database.connectionString });
  await migrateDatabase(admin);
});
after(async () => { await admin?.end(); await database?.stop(); });

test('a timed-out conditional identity probe releases its slot for a clean connection', async () => {
  const pool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app', max: 1, query_timeout: 200 });
  const blocker = await admin.connect();
  try {
    const { pid } = (await pool.query('SELECT pg_backend_pid() AS pid')).rows[0];
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE pos_privado.sistema IN ACCESS EXCLUSIVE MODE');
    await assert.rejects(readSnapshot(pool, 'Catálogo', false, () => true), /Query read timeout/);
    assert.equal(pool.idleCount, 0);
    const clean = (await pool.query('SELECT 1 AS ok, pg_backend_pid() AS pid')).rows[0];
    assert.equal(clean.ok, 1);
    assert.notEqual(clean.pid, pid);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await pool.end();
  }
});

test('only a confirmed rollback of a new business rejection carries proof', async t => {
  const pool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app', max: 1 });
  t.after(() => pool.end());
  const { databaseId } = await readSnapshot(pool, 'Pruebas');
  const operationId = randomUUID();
  const method = 'POST', path = '/api/productos';
  const body = { databaseId, codigo: 'ACREDITACION', nombre: 'Producto', stock: 0, costo: 0, precio1: 0, precio2: 0, precio3: 0 };
  let fault, discard;
  const interrupted = { async connect() {
    const client = await pool.connect();
    return {
      async query(sql, ...args) {
        if (fault === 'rollback' && sql === 'ROLLBACK') throw new Error('Fallo de rollback simulado');
        if (fault === 'contention' && sql.startsWith('INSERT INTO productos')) {
          return client.query("DO $$ BEGIN RAISE EXCEPTION 'Interrupción' USING ERRCODE='40001'; END $$");
        }
        const result = await client.query(sql, ...args);
        if (fault === 'afterCommit' && sql === 'COMMIT' || fault === 'replay' && sql.endsWith('WHERE id=1 FOR SHARE')) {
          throw Object.assign(new Error('Respuesta de consulta interrumpida'), { code: '23505' });
        }
        return result;
      },
      release(reason) { discard = reason; client.release(reason); },
    };
  } };
  async function call(payload, status, { key = operationId, hosting } = {}) {
    const request = new Request('http://localhost' + path, {
      method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(payload),
    });
    const response = await handleRequest(request, { pool: interrupted, hosting });
    assert.equal(response.status, status);
    return response.json();
  }
  const bad = { ...body, nombre: '' };
  assert.equal((await call(bad, 401, { hosting: { credentialsHash: Buffer.alloc(32) } })).rejection, undefined);
  assert.equal((await call(bad, 400, { key: 'invalid' })).rejection, undefined);
  assert.equal((await call({ ...bad, databaseId: randomUUID() }, 409)).rejection, undefined);
  const rejected = await call(bad, 400);
  assert.deepEqual(rejected.rejection, { operationId, databaseId, method, path });
  fault = 'rollback';
  const incomplete = await call(bad, 400);
  assert.equal(incomplete.error, rejected.error);
  assert.equal(incomplete.rejection, undefined);
  assert.match(discard.message, /Fallo de rollback/);
  fault = 'contention';
  assert.equal((await call(body, 409)).rejection, undefined);
  fault = 'afterCommit';
  assert.equal((await call(body, 409)).rejection, undefined);
  fault = 'replay';
  assert.equal((await call(body, 409)).rejection, undefined);
  fault = null;
  assert.equal((await call(bad, 409)).rejection, undefined);
  const replay = await call(body, 200);
  assert.equal(replay.rejection, undefined);
  assert.equal(replay.state.productos.filter(p => p.codigo === body.codigo).length, 1);
});

for (const kind of ['snapshot', 'write']) test(`a timed-out ${kind} discards a connection when its queued rollback also times out`, async () => {
  // A real server lock keeps the query executing after pg's client timeout.
  // pg removes the queued ROLLBACK when that second client timeout expires.
  const pool = new pg.Pool({ connectionString: database.connectionString, options: '-c role=pos_app', max: 1, query_timeout: 150 });
  const blocker = await admin.connect();
  let blocked = false;
  try {
    const initial = await readSnapshot(pool, 'Prueba de recuperación');
    const oldPid = (await pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await blocker.query('BEGIN');
    blocked = true;
    if (kind === 'snapshot') await blocker.query('LOCK TABLE public.configuracion IN ACCESS EXCLUSIVE MODE');
    else await blocker.query('SELECT pg_advisory_xact_lock($1)', [74198232]);
    const operation = kind === 'snapshot'
      ? readSnapshot(pool, 'Prueba de recuperación')
      : writeOperation(pool, 'POST', '/api/clientes', { databaseId: initial.databaseId, nombre: 'No debe insertarse' }, randomUUID(), 'Prueba de recuperación');
    await assert.rejects(operation, /Query read timeout/);
    await blocker.query('ROLLBACK');
    blocked = false;
    const newPid = (await pool.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    assert.notEqual(newPid, oldPid, 'an unclean connection must be destroyed rather than returned to the pool');
    const latest = await readSnapshot(pool, 'Prueba de recuperación');
    assert.deepEqual(latest, initial, 'the timed-out operation cannot leave an abandoned transaction or mutate business data');
    const activity = (await admin.query('SELECT state FROM pg_stat_activity WHERE pid=$1', [newPid])).rows[0];
    assert.equal(activity.state, 'idle');
  } finally {
    if (blocked) await blocker.query('ROLLBACK');
    blocker.release();
    await pool.end();
  }
});

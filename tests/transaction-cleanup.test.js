import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { readSnapshot, writeOperation } from '../src/pos/store.js';

let database, admin;
before(async () => {
  database = await temporaryPostgres();
  admin = new pg.Pool({ connectionString: database.connectionString });
  await migrateDatabase(admin);
});
after(async () => { await admin?.end(); await database?.stop(); });

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

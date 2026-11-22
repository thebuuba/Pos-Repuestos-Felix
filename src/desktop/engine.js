import { createHash, randomUUID } from 'node:crypto';
import { memoryPool } from './memory-pool.js';
import { migrateDatabase } from '../db/migrations.js';
import { readSnapshot, writeOperation } from '../pos/store.js';
import { tables } from '../pos/relational-backup.js';
import { cashHeadFromBackup, operationEffect } from '../pos/sync-operations.js';

const label = 'Este equipo · almacenamiento local';
const canonical = value => value && typeof value === 'object' ? Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const failure = (message, status = 409) => Object.assign(new Error(message), { status });
const createdRows = (before, after) => Object.fromEntries(Object.keys(tables).map(table => {
  const ids = new Set(before.tables[table].map(row => String(row.id)));
  return [table, after.tables[table].filter(row => !ids.has(String(row.id))).map(row => Number(row.id))];
}));

export class DesktopEngine {
  constructor(ledger) { this.ledger = ledger; this.tail = Promise.resolve(); this.pool = null; this.connection = 'offline'; this.lastError = null; }
  serial(action) { const result = this.tail.then(action); this.tail = result.catch(() => {}); return result; }
  async rebuild() {
    await this.pool?.end(); this.pool = null;
    if (!this.ledger.get('databaseId')) return;
    const pool = await memoryPool();
    try {
      await migrateDatabase(pool);
      const initial = await readSnapshot(pool, label);
      await writeOperation(pool, 'POST', '/api/restore', { databaseId: initial.databaseId, revision: initial.revision, backup: this.ledger.backup() }, randomUUID(), label);
      const client = await pool.connect();
      try {
        await client.query('UPDATE pos_privado.sistema SET database_id=$1,revision=$2 WHERE id=1', [this.ledger.get('databaseId'), this.ledger.get('revision')]);
        await client.query('DELETE FROM pos_privado.solicitudes; DELETE FROM pos_privado.respaldos;');
        await client.query("SELECT set_config('pos.desktop_catalog',$1,false)", [JSON.stringify(this.ledger.get('catalogo'))]);
        await client.query("CREATE OR REPLACE FUNCTION pos_privado.netpos_opciones() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT current_setting('pos.desktop_catalog')::jsonb $$");
        for (const table of Object.keys(tables).filter(table => table !== 'configuracion')) {
          const maximum = this.ledger.maxId(table);
          await client.query(`SELECT setval(pg_get_serial_sequence('public.${table}','id'),$1,$2)`, [maximum || 1, maximum > 0]);
        }
      } finally { client.release(); }
      this.pool = pool;
    } catch (error) { await pool.end(); throw error; }
  }
  status() {
    const pending = this.ledger.pending();
    return { initialized: Boolean(this.pool), connection: this.connection, lastSync: this.ledger.get('lastSync'),
      pending: pending.length, conflict: pending.find(row => row.status === 'conflict')?.error || null,
      error: this.lastError, deviceId: this.ledger.get('deviceId') };
  }
  async snapshot() {
    if (!this.pool) throw failure('Conecta este equipo e inicia sesión una vez para descargar los datos del negocio.', 503);
    return { ...await readSnapshot(this.pool, label), desktop: this.status() };
  }
  async adopt(download) {
    if (this.ledger.pending().length) throw failure('Hay operaciones locales pendientes; la descarga no puede reemplazarlas.');
    this.ledger.transaction(() => {
      if (this.ledger.get('databaseId') && this.ledger.get('databaseId') !== download.snapshot.databaseId)
        this.ledger.database.exec('DELETE FROM identities');
      this.ledger.importRemote(download.backup);
      this.ledger.set('databaseId', download.snapshot.databaseId);
      this.ledger.set('revision', download.snapshot.revision);
      this.ledger.set('remoteRevision', download.snapshot.revision);
      this.ledger.set('needsRefresh', false);
      this.ledger.set('catalogo', download.catalogo);
      this.ledger.set('lastSync', new Date().toISOString());
    });
    await this.rebuild();
  }
  async write(method, path, body, operationId, actor) {
    return this.serial(async () => {
      if (typeof actor === 'function') actor = actor();
      if (!this.pool) throw failure('Primero conecta este equipo para descargar el negocio.', 503);
      if (path === '/api/restore') throw failure('La restauración administrativa se realiza en el servidor con las operaciones sincronizadas.');
      if (body.databaseId !== this.ledger.get('databaseId')) throw failure('La base cambió. Actualiza antes de continuar.');
      const fingerprint = createHash('sha256').update(canonical({ method, path, body, actor: actor.id })).digest('hex');
      const previous = this.ledger.operation(operationId);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw failure('Esta clave ya corresponde a otra operación.');
        return { ...await this.snapshot(), result: previous.record.result,
          confirmation: { operationId, databaseId: body.databaseId, method, path, replayed: true }, localReceipt: operationId };
      }
      const before = await readSnapshot(this.pool, label, true);
      const occurredAt = new Date().toISOString();
      let response;
      try {
        response = await writeOperation(this.pool, method, path, body, operationId, label, actor, { occurredAt });
        const after = await readSnapshot(this.pool, label, true);
        const record = { operationId, method, path, body, occurredAt, actor, result: response.result, created: createdRows(before, after),
          expected: { effect: operationEffect(method, path, body, response.result, after),
            cashHead: path === '/api/ventas' || path.startsWith('/api/caja/') ? cashHeadFromBackup(before) : null } };
        // This is the sole durable commit: all relational changes, the receipt and outbox.
        this.ledger.transaction(() => {
          this.ledger.projection(after); this.ledger.add(record, fingerprint);
          this.ledger.set('revision', response.revision);
        });
      } catch (error) {
        // Discard any in-memory commit that was not committed by SQLite.
        await this.rebuild();
        throw error;
      }
      return { ...response, desktop: this.status(), localReceipt: operationId };
    });
  }
  mappedEnvelope(operation) {
    if (operation.wire) return operation.wire;
    const record = operation.record;
    const body = structuredClone(record.body);
    const map = (table, value) => this.ledger.remoteId(table, value);
    let path = record.path;
    const resource = path.match(/^\/api\/(productos|clientes|suplidores|formulas)\/(\d+)$/);
    if (resource) path = `/api/${resource[1]}/${map(resource[1] === 'formulas' ? 'formulas_precios' : resource[1], resource[2])}`;
    for (const [key, table] of Object.entries({ clienteId: 'clientes', suplidorId: 'suplidores', formulaId: 'formulas_precios', cajaId: 'turnos_caja' })) {
      if (body[key] !== undefined && body[key] !== null) body[key] = map(table, body[key]);
    }
    for (const item of body.items || []) if (item.productoId !== null && item.productoId !== undefined) item.productoId = map('productos', item.productoId);
    const expected = structuredClone(record.expected);
    if (expected.cashHead?.id !== null && expected.cashHead?.id !== undefined) expected.cashHead.id = map('turnos_caja', expected.cashHead.id);
    const sequence = this.ledger.database.prepare("SELECT count(*) AS count FROM operations WHERE sequence<=? AND json_extract(record,'$.actor.id')=? AND json_extract(record,'$.body.databaseId')=?")
      .get(operation.sequence, record.actor.id, body.databaseId).count;
    return { deviceId: this.ledger.get('deviceId'), sequence, operationId: record.operationId,
      method: record.method, path, body, occurredAt: record.occurredAt, expected };
  }
  async synchronize(remote, actor) {
    return this.serial(async () => {
      try {
        if (typeof actor === 'function') actor = actor();
        const queue = this.ledger.pending();
        for (const operation of queue) {
          if (operation.record.actor.id !== actor.id) throw failure('Inicia sesión con la cuenta que registró las operaciones pendientes.', 401);
          const envelope = this.mappedEnvelope(operation);
          // Freeze bytes before sending: an unknown outcome always retries the same envelope.
          this.ledger.wire(operation.operation_id, envelope);
          let reply;
          try { reply = await remote('/api/sync/operations', { method: 'POST', body: envelope, key: envelope.operationId }); }
          catch (error) {
            if ([400, 409].includes(error.status)) this.ledger.conflict(operation.operation_id, error.message);
            throw error;
          }
          if (reply.receipt?.operationId !== envelope.operationId || reply.receipt.deviceId !== envelope.deviceId || reply.receipt.sequence !== envelope.sequence)
            throw failure('El servidor no confirmó la identidad de la operación.', 503);
          this.ledger.transaction(() => {
            for (const [table, localIds] of Object.entries(operation.record.created)) {
              const remoteIds = reply.receipt.created[table] || [];
              if (localIds.length !== remoteIds.length) throw failure('El servidor confirmó un conjunto distinto de registros.', 503);
              localIds.forEach((local, index) => this.ledger.bind(table, local, remoteIds[index]));
            }
            this.ledger.database.prepare("UPDATE operations SET status='synced',receipt=?,error=NULL WHERE operation_id=?")
              .run(JSON.stringify(reply.receipt), operation.operation_id);
            this.ledger.set('remoteRevision', reply.snapshot.revision);
            this.ledger.set('needsRefresh', true);
            this.ledger.set('lastSync', new Date().toISOString());
          });
        }
        const download = await remote('/api/sync/bootstrap');
        // The serial lock excludes local writes during projection refresh.
        if (!this.pool || this.ledger.get('needsRefresh') || download.snapshot.databaseId !== this.ledger.get('databaseId') || download.snapshot.revision !== this.ledger.get('remoteRevision') || queue.length)
          await this.adopt(download);
        this.ledger.set('lastSync', new Date().toISOString());
        this.connection = 'online'; this.lastError = null;
      } catch (error) {
        this.connection = error.status === 401 ? 'authentication' : error.status === 409 || error.status === 400 ? 'conflict' : 'offline';
        this.lastError = error.status && error.status < 500 ? error.message : 'Sin conexión al servidor. Las operaciones confirmadas quedan guardadas en este equipo.';
      }
      return this.status();
    });
  }
  async close() { await this.tail; await this.pool?.end(); this.ledger.close(); }
}

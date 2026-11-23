import { createHash, randomUUID } from 'node:crypto';
import { memoryPool } from './memory-pool.js';
import { migrateDatabase } from '../db/migrations.js';
import { canonical, readSnapshot, snapshotVersion, writeOperation } from '../pos/store.js';
import { tables, rows as exportRows } from '../pos/relational-backup.js';
import { cashHeadFromBackup, isCashSyncOperation, operationEffect } from '../pos/sync-operations.js';
import { stateTag } from '../pos/state-tag.js';

const label = 'Este equipo · almacenamiento local';
const failure = (message, status = 409) => Object.assign(new Error(message), { status });
const createdRows = (beforeIds, after) => Object.fromEntries(Object.keys(tables).map(table => {
  const ids = beforeIds[table];
  return [table, (after.tables[table] || []).filter(row => !ids.has(String(row.id))).map(row => Number(row.id))];
}));

async function exportSaleSlice(pool, saleId, body) {
  const client = await pool.connect();
  try {
    const data = Object.fromEntries(Object.keys(tables).map(name => [name, []]));
    data.ventas = await exportRows(client, 'ventas', true, { sql: 'id=$1', values: [saleId] });
    data.venta_detalles = await exportRows(client, 'venta_detalles', true, { sql: 'venta_id=$1', values: [saleId] });
    const detailIds = data.venta_detalles.map(r => r.id);
    if (detailIds.length) {
      data.movimientos_inventario = await exportRows(client, 'movimientos_inventario', true, {
        sql: 'venta_detalle_id=ANY($1::bigint[])', values: [detailIds],
      });
    }
    const productIds = [...new Set((body.items || []).map(item => Number(item.productoId)))];
    if (productIds.length) {
      data.productos = await exportRows(client, 'productos', true, { sql: 'id=ANY($1::bigint[])', values: [productIds] });
    }
    if (body.cajaId != null) {
      data.turnos_caja = await exportRows(client, 'turnos_caja', true, { sql: 'id=$1', values: [body.cajaId] });
    }
    return { tables: data };
  } finally { client.release(); }
}

export class DesktopEngine {
  constructor(ledger) { this.ledger = ledger; this.tail = Promise.resolve(); this.syncFlight = null; this.pool = null; this.connection = 'offline'; this.lastError = null; }
  serial(action) { const result = this.tail.then(action); this.tail = result.catch(() => {}); return result; }
  async rebuild({ reuse = false } = {}) {
    const previous = this.pool;
    this.pool = null;
    const databaseId = this.ledger.get('databaseId');
    if (!reuse || !databaseId) await previous?.end();
    if (!databaseId) return;
    const pool = reuse && previous || await memoryPool();
    try {
      if (pool !== previous) await migrateDatabase(pool);
      const client = await pool.connect();
      let initial;
      try { initial = await snapshotVersion(client, label); }
      finally { client.release(); }
      await writeOperation(pool, 'POST', '/api/restore', { databaseId: initial.databaseId, revision: initial.revision, backup: this.ledger.backup() }, randomUUID(), label, undefined, {
        versionOnly: true,
        // Restore the authoritative rows and desktop metadata in the same transaction.
        // The executor becomes available only after every step commits successfully.
        represent: async (client, response) => {
          await client.query('UPDATE pos_privado.sistema SET database_id=$1,revision=$2 WHERE id=1', [databaseId, this.ledger.get('revision')]);
          await client.query('DELETE FROM pos_privado.solicitudes; DELETE FROM pos_privado.respaldos;');
          await client.query("SELECT set_config('pos.desktop_catalog',$1,false)", [JSON.stringify(this.ledger.get('catalogo'))]);
          await client.query("CREATE OR REPLACE FUNCTION pos_privado.netpos_opciones() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT current_setting('pos.desktop_catalog')::jsonb $$");
          for (const table of Object.keys(tables).filter(table => table !== 'configuracion')) {
            const maximum = this.ledger.maxId(table);
            await client.query(`SELECT setval(pg_get_serial_sequence('public.${table}','id'),$1,$2)`, [maximum || 1, maximum > 0]);
          }
          return response;
        },
      });
      this.pool = pool;
    } catch (error) { await pool.end(); throw error; }
  }
  status() {
    const pending = this.ledger.pending();
    return { initialized: Boolean(this.pool), connection: this.connection, lastSync: this.ledger.get('lastSync'),
      pending: pending.length, conflict: pending.find(row => row.status === 'conflict')?.error || null,
      error: this.lastError, deviceId: this.ledger.get('deviceId'), reconciling: Boolean(this.ledger.get('reconciliation')),
      archived: this.ledger.database.prepare("SELECT count(*) AS count FROM operations WHERE status='archived'").get().count };
  }
  async snapshot(options = {}) {
    if (!this.pool) throw failure('Conecta este equipo e inicia sesión una vez para descargar los datos del negocio.', 503);
    return { ...await readSnapshot(this.pool, label, false, undefined, options), desktop: this.status() };
  }
  snapshotTag() { return stateTag({ databaseId: this.ledger.get('databaseId'), revision: this.ledger.get('revision'), databaseLabel: label }); }
  async adopt(download) {
    if (this.ledger.pending().length) throw failure('Hay operaciones locales pendientes; la descarga no puede reemplazarlas.');
    this.ledger.transaction(() => this.saveDownload(download));
    await this.rebuild({ reuse: true });
  }
  saveDownload(download) {
    const revision = this.ledger.get('databaseId') === download.snapshot.databaseId
      ? Math.max(this.ledger.get('revision') + 1, download.snapshot.revision) : download.snapshot.revision;
    if (this.ledger.get('databaseId') && this.ledger.get('databaseId') !== download.snapshot.databaseId)
      this.ledger.database.exec('DELETE FROM identities');
    this.ledger.importRemote(download.backup);
    this.ledger.set('databaseId', download.snapshot.databaseId);
    this.ledger.set('revision', revision);
    this.ledger.set('remoteRevision', download.snapshot.revision);
    this.ledger.set('bootstrapEtag', download.etag || null);
    this.ledger.set('needsRefresh', false);
    this.ledger.set('catalogo', download.catalogo);
    this.ledger.set('lastSync', new Date().toISOString());
  }
  async write(method, path, body, operationId, actor, options = {}) {
    const source = actor;
    return this.serial(async () => {
      if (typeof actor === 'function') actor = actor();
      if (!this.pool) throw failure('Primero conecta este equipo para descargar el negocio.', 503);
      if (path === '/api/restore') throw failure('La restauración administrativa se realiza en el servidor con las operaciones sincronizadas.');
      if (body.databaseId !== this.ledger.get('databaseId')) throw failure('La base cambió. Actualiza antes de continuar.');
      const fingerprint = createHash('sha256').update(canonical({ method, path, body, actor: actor.id })).digest('hex');
      const previous = this.ledger.operation(operationId);
      if (previous) {
        if (previous.status === 'archived') throw failure('Esta operación fue archivada para revisión; consulta el historial conservado.');
        if (previous.fingerprint !== fingerprint) throw failure('Esta clave ya corresponde a otra operación.');
        return { ...await this.snapshot({ compact: Boolean(options.compact) }), result: previous.record.result,
          confirmation: { operationId, databaseId: body.databaseId, method, path, replayed: true }, localReceipt: operationId };
      }
      if (this.ledger.get('reconciliation')) throw failure('Hay una revisión de pendientes en curso. Reanúdala antes de registrar nuevas operaciones.');
      const beforeIds = this.ledger.tableIds();
      const beforeCashHead = isCashSyncOperation(path, body) ? cashHeadFromBackup(this.ledger.cashTables()) : null;
      const occurredAt = new Date().toISOString();
      const writeContext = {
        occurredAt,
        allowNcf: false,
        ...(Number.isSafeInteger(options.deltaBaseRevision) ? { deltaBaseRevision: options.deltaBaseRevision } : {}),
        ...(options.compact ? { compact: true } : {}),
      };
      let response;
      try {
        response = await writeOperation(this.pool, method, path, body, operationId, label, actor, writeContext);
        const fastSale = method === 'POST' && path === '/api/ventas';
        const after = fastSale
          ? await exportSaleSlice(this.pool, response.result.id, body)
          : await readSnapshot(this.pool, label, true);
        if (typeof source === 'function') {
          const current = source();
          if (current.id !== actor.id || current.generation !== actor.generation) throw failure('La sesión cambió antes de confirmar la operación.', 401);
        }
        const record = { operationId, method, path, body, occurredAt, actor, result: response.result, created: createdRows(beforeIds, after),
          expected: { effect: operationEffect(method, path, body, response.result, after),
            cashHead: beforeCashHead } };
        // This is the sole durable commit: all relational changes, the receipt and outbox.
        this.ledger.transaction(() => {
          if (fastSale) {
            for (const [table, list] of Object.entries(after.tables)) this.ledger.upsertTableRows(table, list);
          } else {
            this.ledger.projection(after);
          }
          this.ledger.add(record, fingerprint);
          this.ledger.set('revision', response.revision);
        });
      } catch (error) {
        // Discard any in-memory commit that was not committed by SQLite.
        if (response || !error.rejection) await this.rebuild();
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
    const voidMatch = path.match(/^\/api\/ventas\/(\d+)\/anular$/);
    if (voidMatch) path = `/api/ventas/${map('ventas', voidMatch[1])}/anular`;
    const resource = path.match(/^\/api\/(productos|clientes|suplidores|formulas)\/(\d+)$/);
    if (resource) path = `/api/${resource[1]}/${map(resource[1] === 'formulas' ? 'formulas_precios' : resource[1], resource[2])}`;
    for (const [key, table] of Object.entries({ clienteId: 'clientes', suplidorId: 'suplidores', formulaId: 'formulas_precios', cajaId: 'turnos_caja', ventaId: 'ventas', compraId: 'compras' })) {
      if (body[key] !== undefined && body[key] !== null) body[key] = map(table, body[key]);
    }
    for (const item of body.items || []) if (item.productoId !== null && item.productoId !== undefined) item.productoId = map('productos', item.productoId);
    const expected = structuredClone(record.expected);
    if (expected.cashHead?.id !== null && expected.cashHead?.id !== undefined) expected.cashHead.id = map('turnos_caja', expected.cashHead.id);
    const sequence = this.ledger.database.prepare("SELECT count(*) AS count FROM operations WHERE sequence>? AND sequence<=? AND json_extract(record,'$.actor.id')=? AND json_extract(record,'$.body.databaseId')=?")
      .get(this.ledger.get('streamStart') || 0, operation.sequence, record.actor.id, body.databaseId).count;
    return { deviceId: this.ledger.get('deviceId'), sequence, operationId: record.operationId,
      method: record.method, path, body, occurredAt: record.occurredAt, expected };
  }
  synchronize(remote, actor, { retryConflicts = false } = {}) {
    if (this.reconciliationFlight || this.ledger.get('reconciliation')) return Promise.resolve(this.status());
    if (!this.syncFlight) this.syncFlight = this.runSynchronization(remote, actor, retryConflicts).finally(() => { this.syncFlight = null; });
    return this.syncFlight;
  }
  async runSynchronization(remote, source, retryConflicts) {
    let actor;
    const assertActor = () => {
      const current = typeof source === 'function' ? source() : source;
      if (actor && (current.id !== actor.id || current.generation !== actor.generation))
        throw failure('La sesión cambió durante la sincronización. Vuelve a intentarlo.', 401);
      return current;
    };
    try {
      const queue = await this.serial(() => { actor = { ...assertActor() }; return this.ledger.pending(); });
      for (const operation of queue) {
        const envelope = await this.serial(() => {
          assertActor();
          if (operation.record.actor.id !== actor.id) throw failure('Inicia sesión con la cuenta que registró las operaciones pendientes.', 401);
          if (operation.status === 'conflict' && !retryConflicts) throw failure(operation.error || 'Revisa la operación pendiente antes de continuar.');
          const envelope = this.mappedEnvelope(operation);
          // Freeze bytes before sending: an unknown outcome always retries the same envelope.
          this.ledger.wire(operation.operation_id, envelope);
          return envelope;
        });
        let reply;
        try { reply = await remote('/api/sync/operations', { method: 'POST', body: envelope, key: envelope.operationId, receiptOnly: true }); }
        catch (error) {
          await this.serial(() => {
            assertActor();
            if ([400, 403, 404, 409].includes(error.status)) this.ledger.conflict(operation.operation_id, error.message);
          });
          throw error;
        }
        await this.serial(() => {
          assertActor();
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
        });
      }
      const checkpoint = await this.serial(() => {
        assertActor();
        return { pending: this.ledger.pending().length, etag: this.pool && !this.ledger.get('needsRefresh') && this.ledger.get('bootstrapEtag') };
      });
      if (!checkpoint.pending) {
        const download = await remote('/api/sync/bootstrap', { ...(checkpoint.etag && { etag: checkpoint.etag }) });
        await this.serial(async () => {
          assertActor();
          // Local writes remain available during the download. Never replace their durable projection.
          if (this.ledger.pending().length) return;
          if (download.notModified) {
            if (!checkpoint.etag || download.etag !== checkpoint.etag || this.ledger.get('needsRefresh'))
              throw failure('El servidor no confirmó la versión descargada.', 503);
          } else if (!this.pool || this.ledger.get('needsRefresh') || download.snapshot.databaseId !== this.ledger.get('databaseId') || download.snapshot.revision !== this.ledger.get('remoteRevision') || (download.etag && download.etag !== this.ledger.get('bootstrapEtag'))) {
            await this.adopt(download);
          } else if (download.etag) this.ledger.set('bootstrapEtag', download.etag);
          this.ledger.set('lastSync', new Date().toISOString());
        });
      }
      await this.serial(() => { assertActor(); this.connection = 'online'; this.lastError = null; });
    } catch (error) {
      await this.serial(() => {
        try { assertActor(); } catch { return; }
        this.connection = error.status === 401 ? 'authentication' : [400, 403, 404, 409].includes(error.status) ? 'conflict' : 'offline';
        this.lastError = error.status && error.status < 500 ? error.message : 'Sin conexión al servidor. Las operaciones confirmadas quedan guardadas en este equipo.';
      });
    }
    return this.status();
  }
  reconcile(remote, actor, target) {
    if (!this.reconciliationFlight) this.reconciliationFlight = this.runReconciliation(remote, actor, target).finally(() => { this.reconciliationFlight = null; });
    return this.reconciliationFlight;
  }
  async runReconciliation(remote, source, target) {
    await this.syncFlight;
    let actor;
    const assertActor = () => {
      const current = typeof source === 'function' ? source() : source;
      if (actor && (actor.id !== current.id || actor.generation !== current.generation)) throw failure('La sesión cambió durante la revisión. Reanúdala con la cuenta original.', 401);
      return current;
    };
    const intent = await this.serial(() => {
      actor = { ...assertActor() };
      const prior = this.ledger.get('reconciliation');
      const operations = this.ledger.pending();
      const expected = prior || { deviceId: this.ledger.get('deviceId'), databaseId: this.ledger.get('databaseId'), operationIds: operations.map(row => row.operation_id) };
      if (target?.acknowledged !== true || target.deviceId !== expected.deviceId || target.databaseId !== expected.databaseId || canonical(target.operationIds) !== canonical(expected.operationIds))
        throw failure('La lista de operaciones cambió. Revisa los pendientes antes de confirmar.');
      if (!operations.length || operations.some(row => row.record.actor.id !== actor.id) || prior && prior.actorId !== actor.id)
        throw failure('Inicia sesión con la cuenta que registró las operaciones pendientes.', 401);
      if (prior) return prior;
      const record = { ...expected, id: randomUUID(), date: new Date().toISOString(), actorId: actor.id, operations, checkpoint: this.ledger.backup() };
      this.ledger.set('reconciliation', record);
      return record;
    });
    const body = { deviceId: intent.deviceId, databaseId: intent.databaseId, operationIds: intent.operationIds };
    let download;
    try { download = await remote('/api/sync/retire', { method: 'POST', body }); }
    catch (error) {
      await this.serial(() => {
        assertActor();
        const proof = error.retirementRejection;
        if (proof?.actorId === actor.id && proof.deviceId === body.deviceId && proof.databaseId === body.databaseId && canonical(proof.operationIds) === canonical(body.operationIds))
          this.ledger.set('reconciliation', null);
        this.lastError = error.status && error.status < 500 ? error.message : 'La revisión espera confirmación del servidor. Los originales permanecen guardados; reanuda la revisión al reconectar.';
      });
      throw error;
    }
    return this.serial(async () => {
      assertActor();
      const receipt = download.retirement;
      if (receipt?.actorId !== actor.id || receipt.deviceId !== body.deviceId || receipt.databaseId !== body.databaseId || canonical(receipt.operationIds) !== canonical(body.operationIds))
        throw failure('El servidor no confirmó las operaciones seleccionadas para revisión.', 503);
      this.ledger.transaction(() => {
        this.ledger.database.prepare('INSERT INTO reconciliation_archives VALUES(?,?)').run(intent.id, JSON.stringify({ ...intent, retirement: receipt }));
        const archive = this.ledger.database.prepare("UPDATE operations SET status='archived' WHERE operation_id=?");
        for (const id of intent.operationIds) archive.run(id);
        this.ledger.set('streamStart', this.ledger.database.prepare('SELECT COALESCE(max(sequence),0) AS n FROM operations').get().n);
        this.ledger.set('deviceId', randomUUID());
        this.saveDownload(download);
        this.ledger.set('reconciliation', null);
      });
      await this.rebuild({ reuse: true });
      this.connection = 'online'; this.lastError = null;
      return this.status();
    });
  }
  async close() { await this.reconciliationFlight?.catch(() => {}); await this.syncFlight; await this.tail; await this.pool?.end(); this.ledger.close(); }
}

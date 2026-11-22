import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tables, backupLayout } from '../pos/relational-backup.js';

const booleans = new Set(['activo', 'gravado', 'es_contado', 'notificar_minimo', 'permitir_stock_negativo']);
export const references = {
  suplidores: { formula_id: 'formulas_precios' }, ventas: { cliente_id: 'clientes', caja_id: 'turnos_caja' },
  venta_detalles: { venta_id: 'ventas', producto_id: 'productos' }, compras: { suplidor_id: 'suplidores' },
  compra_detalles: { compra_id: 'compras', producto_id: 'productos' },
  movimientos_inventario: { producto_id: 'productos', venta_detalle_id: 'venta_detalles', compra_detalle_id: 'compra_detalles' },
  movimientos_caja: { caja_id: 'turnos_caja' },
};
const encoded = value => typeof value === 'boolean' ? Number(value) : value;

export class DesktopLedger {
  constructor(directory) {
    mkdirSync(directory, { recursive: true });
    this.database = new DatabaseSync(join(directory, 'pos.sqlite'));
    this.database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    this.database.exec(`CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS operations(sequence INTEGER PRIMARY KEY AUTOINCREMENT,operation_id TEXT NOT NULL UNIQUE,
        fingerprint TEXT NOT NULL,record TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',wire TEXT,receipt TEXT,error TEXT) STRICT;
      CREATE TABLE IF NOT EXISTS identities(table_name TEXT NOT NULL,local_id INTEGER NOT NULL,remote_id INTEGER NOT NULL,
        PRIMARY KEY(table_name,local_id),UNIQUE(table_name,remote_id)) STRICT;
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL) STRICT;`);
    this.database.exec(`CREATE TABLE IF NOT EXISTS reconciliation_archives(id TEXT PRIMARY KEY,record TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS remembered_sessions(token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE) STRICT;`);
    for (const [table, columns] of Object.entries(tables)) {
      this.database.exec(`CREATE TABLE IF NOT EXISTS local_${table}(${columns.map(column => `${column} ANY${column === 'id' ? ' PRIMARY KEY' : ''}`).join(',')}) STRICT;`);
    }
    if (!this.get('deviceId')) this.set('deviceId', randomUUID());
  }
  get(key) { const row = this.database.prepare('SELECT value FROM metadata WHERE key=?').get(key); return row ? JSON.parse(row.value) : null; }
  set(key, value) { this.database.prepare('INSERT INTO metadata VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  transaction(action) {
    this.database.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.database.exec('COMMIT'); return result; }
    catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  backup() {
    const data = {};
    for (const [table, columns] of Object.entries(tables)) {
      data[table] = this.database.prepare(`SELECT * FROM local_${table} ORDER BY CAST(id AS INTEGER)`).all().map(row =>
        Object.fromEntries(columns.map(column => [column, row[column] !== null && booleans.has(column) ? Boolean(row[column]) : row[column]])));
    }
    return { version: 6, format: 'repuestos-felix-relacional', exportedAt: new Date().toISOString(), tables: data };
  }
  // Fixed relational columns retain NUMERIC strings; no JSON snapshot is the business authority.
  projection(backup) {
    backupLayout(backup);
    for (const [table, columns] of Object.entries(tables)) {
      const previous = new Map(this.database.prepare(`SELECT * FROM local_${table}`).all().map(row => [String(row.id), row]));
      const upsert = this.database.prepare(`INSERT INTO local_${table}(${columns}) VALUES(${columns.map(() => '?')})
        ON CONFLICT(id) DO UPDATE SET ${columns.filter(column => column !== 'id').map(column => `${column}=excluded.${column}`)}`);
      for (const row of backup.tables[table]) {
        const old = previous.get(String(row.id));
        const values = columns.map(column => column === 'id' || column.endsWith('_id') && row[column] !== null ? String(row[column]) : encoded(row[column]));
        if (!old || columns.some((column, index) => old[column] !== values[index])) upsert.run(...values);
        previous.delete(String(row.id));
      }
      const remove = this.database.prepare(`DELETE FROM local_${table} WHERE id=?`);
      for (const row of previous.values()) remove.run(row.id);
    }
  }
  operation(id) { const row = this.database.prepare('SELECT * FROM operations WHERE operation_id=?').get(id); return row && { ...row, record: JSON.parse(row.record), wire: row.wire && JSON.parse(row.wire) }; }
  pending() { return this.database.prepare("SELECT operation_id FROM operations WHERE status IN ('pending','conflict') ORDER BY sequence").all().map(row => this.operation(row.operation_id)); }
  archives() { return this.database.prepare('SELECT record FROM reconciliation_archives ORDER BY rowid').all().map(row => JSON.parse(row.record)); }
  add(record, fingerprint) {
    this.database.prepare('INSERT INTO operations(operation_id,fingerprint,record) VALUES(?,?,?)').run(record.operationId, fingerprint, JSON.stringify(record));
    return this.operation(record.operationId);
  }
  wire(id, value) { this.database.prepare('UPDATE operations SET wire=? WHERE operation_id=? AND wire IS NULL').run(JSON.stringify(value), id); }
  conflict(id, error) { this.database.prepare("UPDATE operations SET status='conflict',error=? WHERE operation_id=?").run(error, id); }
  bind(table, local, remote) {
    if (!tables[table]) throw new Error('Tabla de sincronización desconocida.');
    const existing = this.remoteId(table, local, false);
    if (existing !== null && existing !== Number(remote)) throw new Error('La identidad recibida no coincide con la operación local.');
    this.database.prepare('INSERT INTO identities VALUES(?,?,?) ON CONFLICT(table_name,local_id) DO NOTHING').run(table, Number(local), Number(remote));
  }
  remoteId(table, local, required = true) {
    if (local === null || local === undefined) return local;
    const value = this.database.prepare('SELECT remote_id FROM identities WHERE table_name=? AND local_id=?').get(table, Number(local))?.remote_id;
    if (value === undefined && required) throw new Error('Una operación anterior debe sincronizarse primero.');
    return value ?? null;
  }
  maxId(table) {
    return Math.max(Number(this.database.prepare(`SELECT max(CAST(id AS INTEGER)) AS n FROM local_${table}`).get().n || 0),
      Number(this.database.prepare('SELECT max(local_id) AS n FROM identities WHERE table_name=?').get(table).n || 0));
  }
  importRemote(backup) {
    backupLayout(backup);
    const localIds = new Map();
    for (const [table, rows] of Object.entries(backup.tables)) {
      const existing = new Map(this.database.prepare('SELECT local_id,remote_id FROM identities WHERE table_name=?').all(table).map(row => [String(row.remote_id), row.local_id]));
      const occupied = new Set(this.database.prepare('SELECT local_id FROM identities WHERE table_name=?').all(table).map(row => row.local_id));
      let next = this.maxId(table);
      for (const row of rows) {
        let local = existing.get(String(row.id));
        if (local === undefined) {
          local = occupied.has(Number(row.id)) ? ++next : Number(row.id);
          next = Math.max(next, local); occupied.add(local); this.bind(table, local, row.id);
        }
        localIds.set(table + ':' + row.id, String(local));
      }
    }
    const translated = { ...backup, tables: {} };
    for (const [table, rows] of Object.entries(backup.tables)) translated.tables[table] = rows.map(row => {
      const result = { ...row, id: localIds.get(table + ':' + row.id) };
      for (const [column, target] of Object.entries(references[table] || {})) {
        if (row[column] !== null) {
          result[column] = localIds.get(target + ':' + row[column]);
          if (!result[column]) throw new Error('La descarga tiene una referencia incompleta.');
        }
      }
      return result;
    });
    this.projection(translated);
    return translated;
  }
  close() { this.database.close(); }
}

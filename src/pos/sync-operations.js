import { canonical, maintenanceLock, snapshot, writeOperation } from './store.js';
import { exportBackup } from './relational-backup.js';
import { fail, id, text } from './operation-fields.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const instant = value => value === null ? null : new Date(value).toISOString();
const sameId = (a, b) => String(a) === String(b);
const cashOperation = path => path === '/api/ventas' || path.startsWith('/api/caja/');
const tableFor = resource => ({ formulas: 'formulas_precios', 'caja/abrir': 'turnos_caja',
  'caja/cerrar': 'turnos_caja', 'caja/movimiento': 'movimientos_caja' })[resource] ?? resource;
function resourceFor(path) { return path.slice('/api/'.length).replace(/\/\d+$/, ''); }

/** Stable values only: local and remote generated identifiers are mapped separately. */
export function operationEffect(method, path, body, result, backup) {
  const resource = resourceFor(path);
  if (method === 'DELETE') return { resource, deleted: true };
  const table = tableFor(resource);
  const row = backup.tables[table]?.find(row => sameId(row.id, result.id));
  if (!row) fail('No se encontró el resultado durable de la operación.', 503);
  const immutable = ['ventas', 'compras', 'turnos_caja', 'movimientos_caja'].includes(table);
  const values = (source, dates) => Object.fromEntries(Object.entries(source)
    .filter(([key]) => key !== 'id' && key !== 'version' && !key.endsWith('_id') &&
      (dates || !key.endsWith('_en')))
    .map(([key, value]) => [key, key.endsWith('_en') && value !== null ? instant(value) : value]));
  const effect = values(row, immutable);
  if (resource === 'ventas' || resource === 'compras') {
    const sale = resource === 'ventas';
    effect.items = backup.tables[sale ? 'venta_detalles' : 'compra_detalles']
      .filter(line => sameId(line[sale ? 'venta_id' : 'compra_id'], result.id)).map(line => values(line, true));
  }
  return effect;
}

export function cashHeadFromBackup(backup) {
  const order = row => String(row.abierto_en instanceof Date ? instant(row.abierto_en) : row.abierto_en)
    .replace(/\.(\d+)Z$/, (_, fraction) => '.' + fraction.padEnd(6, '0') + 'Z');
  const turn = backup.tables.turnos_caja.reduce((last, row) => !last || order(row) > order(last) ||
    order(row) === order(last) && Number(row.id) > Number(last.id) ? row : last, null);
  if (!turn) return { id: null, version: null, open: false, latestAt: null };
  const events = [turn.abierto_en, turn.cerrado_en,
    ...backup.tables.ventas.filter(row => sameId(row.caja_id, turn.id)).map(row => row.creado_en),
    ...backup.tables.movimientos_caja.filter(row => sameId(row.caja_id, turn.id)).map(row => row.creado_en)].filter(Boolean);
  return { id: Number(turn.id), version: Number(turn.version), open: turn.cerrado_en === null,
    latestAt: new Date(events.reduce((latest, value) => Math.max(latest, new Date(value).getTime()), 0)).toISOString() };
}

async function bootstrap(client, databaseLabel, observed) {
  const current = observed ?? await snapshot(client, databaseLabel);
  const backup = await exportBackup(client);
  return { snapshot: current, backup, catalogo: current.state.catalogo, cashHead: cashHeadFromBackup(backup) };
}
export async function readSyncBootstrap(pool, databaseLabel) {
  const client = await pool.connect();
  let discard;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query('SELECT pg_advisory_xact_lock_shared($1)', [maintenanceLock]);
    const response = await bootstrap(client, databaseLabel);
    await client.query('COMMIT');
    return response;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (failure) { discard = failure; }
    throw error;
  } finally { client.release(discard); }
}

function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
      Object.keys(envelope).sort().join(',') !== 'body,deviceId,expected,method,occurredAt,operationId,path,sequence' ||
      !uuid.test(envelope.deviceId) || !uuid.test(envelope.operationId)) fail('El sobre de sincronización no es válido.');
  id(envelope.sequence, 'la secuencia del equipo');
  const { method, path, body, occurredAt, expected } = envelope;
  const validRoute = method === 'POST' && /^\/api\/(productos|clientes|suplidores|formulas|ventas|compras|caja\/(abrir|cerrar|movimiento))$/.test(path) ||
    ['PUT', 'DELETE'].includes(method) && /^\/api\/(productos|clientes|suplidores|formulas)\/[1-9]\d*$/.test(path) ||
    method === 'PUT' && path === '/api/configuracion';
  if (!validRoute || !body || typeof body !== 'object' || Array.isArray(body) || !uuid.test(body.databaseId)) fail('La operación no se puede sincronizar.');
  if (typeof occurredAt !== 'string' || !Number.isFinite(Date.parse(occurredAt)) || instant(occurredAt) !== occurredAt ||
      Date.parse(occurredAt) > Date.now() + 300000) fail('Revisa la fecha y la hora del equipo antes de sincronizar.', 409);
  if (!expected || Object.keys(expected).sort().join(',') !== 'cashHead,effect' || !expected.effect ||
      typeof expected.effect !== 'object' || Array.isArray(expected.effect)) fail('Falta el resultado local confirmado.');
  if (cashOperation(path)) {
    const head = expected.cashHead;
    if (!head || Object.keys(head).sort().join(',') !== 'id,latestAt,open,version' || typeof head.open !== 'boolean' ||
        (head.id === null ? head.version !== null || head.open || head.latestAt !== null :
          !Number.isSafeInteger(head.id) || head.id < 1 || !Number.isSafeInteger(head.version) || head.version < 1 ||
          typeof head.latestAt !== 'string' || !Number.isFinite(Date.parse(head.latestAt)) || instant(head.latestAt) !== head.latestAt)) {
      fail('Falta la versión de caja observada por el equipo.');
    }
  } else if (expected.cashHead !== null) fail('La operación no admite una versión de caja.');
  if (path === '/api/ventas') {
    id(body.versionConfiguracion, 'la versión de configuración');
    if (!Array.isArray(body.items)) fail('Faltan las líneas de venta.');
    body.items.forEach(line => id(line.versionProducto, 'la versión del artículo'));
  }
  if (path === '/api/compras') {
    if (!Array.isArray(body.items)) fail('Faltan las líneas de compra.');
    for (const line of body.items) {
      if (line.productoId === null && line.versionProducto === null) continue;
      id(line.productoId, 'el artículo'); id(line.versionProducto, 'la versión del artículo');
    }
  }
}

async function verifyCashHead(client, expected, occurredAt) {
  // Same first lock as every ordinary sale, opening, movement and closing.
  await client.query('SELECT pg_advisory_xact_lock(74198233)');
  const turn = (await client.query(`SELECT c.id,c.version,c.cerrado_en,
    greatest(c.abierto_en,c.cerrado_en,(SELECT max(creado_en) FROM ventas WHERE caja_id=c.id),
      (SELECT max(creado_en) FROM movimientos_caja WHERE caja_id=c.id)) AS ultimo,
    $1::timestamptz >= greatest(c.abierto_en,c.cerrado_en,(SELECT max(creado_en) FROM ventas WHERE caja_id=c.id),
      (SELECT max(creado_en) FROM movimientos_caja WHERE caja_id=c.id)) AS fecha_valida
    FROM turnos_caja c ORDER BY c.abierto_en DESC,c.id DESC LIMIT 1`, [occurredAt])).rows[0];
  const current = turn ? { id: Number(turn.id), version: Number(turn.version), open: turn.cerrado_en === null, latestAt: instant(turn.ultimo) } :
    { id: null, version: null, open: false, latestAt: null };
  if (canonical(current) !== canonical(expected)) fail('Conflicto de caja: hubo actividad en otro equipo. La operación local se conserva para conciliar.', 409);
  if (turn && !turn.fecha_valida) fail('La fecha local precede un movimiento de caja confirmado. La operación se conserva para conciliar.', 409);
}

function createdRows(method, path, body, result, backup, priorProducts, priorMovement) {
  const resource = resourceFor(path), tables = backup.tables;
  const created = {};
  const add = (table, rows) => { if (rows.length) created[table] = rows.map(row => Number(row.id)); };
  const selected = table => tables[table].filter(row => sameId(row.id, result.id));
  if (method === 'POST' && ['clientes', 'suplidores', 'productos', 'formulas'].includes(resource)) add(tableFor(resource), selected(tableFor(resource)));
  if (resource === 'productos' && method !== 'DELETE') add('movimientos_inventario', tables.movimientos_inventario
    .filter(row => Number(row.id) > priorMovement && sameId(row.producto_id, result.id)));
  if (resource === 'caja/abrir') add('turnos_caja', selected('turnos_caja'));
  if (resource === 'caja/movimiento') add('movimientos_caja', selected('movimientos_caja'));
  if (resource === 'ventas' || resource === 'compras') {
    const sale = resource === 'ventas', detailTable = sale ? 'venta_detalles' : 'compra_detalles';
    const details = tables[detailTable].filter(row => sameId(row[sale ? 'venta_id' : 'compra_id'], result.id));
    const detailIds = new Set(details.map(row => String(row.id)));
    add(resource, selected(resource)); add(detailTable, details);
    add('movimientos_inventario', tables.movimientos_inventario.filter(row => detailIds.has(String(row[sale ? 'venta_detalle_id' : 'compra_detalle_id']))));
    if (!sale) {
      const products = new Set(details.map(row => String(row.producto_id)));
      add('productos', tables.productos.filter(row => products.has(String(row.id)) && !priorProducts.has(String(row.id))));
    }
  }
  return created;
}

export async function writeSyncOperation(pool, envelope, databaseLabel, actor) {
  validateEnvelope(envelope);
  const actorId = text(actor?.id, 'el usuario autenticado');
  const { deviceId, sequence, operationId, method, path, body, occurredAt, expected } = envelope;
  let priorProducts = new Set(), priorMovement = 0;
  return writeOperation(pool, method, path, body, operationId, databaseLabel, actor, {
    occurredAt, requestType: `sync:${actorId}:${method} ${path}`, fingerprintPayload: envelope,
    async beforeExecute(client) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`sync:${actorId}:${deviceId}`]);
      // ponytail: one indexed-key journal already exists; add a device index only if history size warrants it.
      const previous = (await client.query(`SELECT resultado->'metadata' AS metadata FROM pos_privado.solicitudes
        WHERE resultado->'metadata'->>'deviceId'=$1 AND resultado->'metadata'->>'actorId'=$2
          AND resultado->>'databaseId'=$3
        ORDER BY (resultado->'metadata'->>'sequence')::bigint DESC LIMIT 1`, [deviceId, actorId, body.databaseId])).rows[0]?.metadata;
      if (sequence !== (previous ? previous.sequence + 1 : 1)) fail('La secuencia del equipo no coincide. Sincroniza primero la operación pendiente anterior.', 409);
      if (previous && occurredAt < previous.occurredAt) fail('La fecha del equipo retrocedió. La operación local se conserva para revisar.', 409);
      if (cashOperation(path)) await verifyCashHead(client, expected.cashHead, occurredAt);
      if (path === '/api/compras') priorProducts = new Set((await client.query('SELECT id FROM productos WHERE codigo=ANY($1::text[])',
        [body.items.map(line => line.codigo)])).rows.map(row => String(row.id)));
      if (resourceFor(path) === 'productos') priorMovement = Number((await client.query('SELECT COALESCE(max(id),0) AS id FROM movimientos_inventario')).rows[0].id);
    },
    async afterExecute(client, result) {
      const backup = await exportBackup(client);
      const effect = operationEffect(method, path, body, result, backup);
      if (canonical(effect) !== canonical(expected.effect)) fail('Conflicto de sincronización: el resultado difiere del confirmado localmente. Revisa la operación conservada en el equipo.', 409);
      return { actorId, deviceId, sequence, operationId, occurredAt, result, effect,
        created: createdRows(method, path, body, result, backup, priorProducts, priorMovement) };
    },
    async represent(client, observed, metadata, replayed) {
      const { result: _result, ...current } = observed;
      const { actorId: _actor, occurredAt: _instant, ...receipt } = metadata;
      return { ...await bootstrap(client, databaseLabel, current), receipt: { ...receipt, replayed } };
    },
  });
}

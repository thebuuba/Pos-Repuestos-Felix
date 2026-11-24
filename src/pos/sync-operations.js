import { createHash } from 'node:crypto';
import { canonical, maintenanceLock, snapshot, snapshotVersion, writeOperation } from './store.js';
import { exportBackup, rows, tables } from './relational-backup.js';
import { fail, id, text } from './operation-fields.js';
import { bootstrapTag } from './state-tag.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const instant = value => value === null ? null : new Date(value).toISOString();
const sameId = (a, b) => String(a) === String(b);
export const isCashSyncOperation = (path, body) =>
  path === '/api/ventas' || path.startsWith('/api/caja/') ||
  /^\/api\/ventas\/\d+\/anular$/.test(path) ||
  /^\/api\/taller\/\d+\/facturar$/.test(path) ||
  (['/api/cuentas/cobros', '/api/cuentas/pagos'].includes(path) && body?.metodoPago === 'efectivo');
const tableFor = resource => ({
  formulas: 'formulas_precios', 'caja/abrir': 'turnos_caja',
  'caja/cerrar': 'turnos_caja', 'caja/movimiento': 'movimientos_caja',
  'ventas/anular': 'ventas', 'compras/anular': 'compras', 'cuentas/cobros': 'abonos_cuentas',
  'cuentas/pagos': 'abonos_cuentas', ncf: 'secuencias_ncf',
  taller: 'cuentas_taller', 'taller/despachar': 'cuentas_taller',
  'taller/devolver': 'cuentas_taller', 'taller/cancelar': 'cuentas_taller',
  'taller/facturar': 'cuentas_taller',
})[resource] ?? resource;
function resourceFor(path) {
  if (/^\/api\/ventas\/\d+\/anular$/.test(path)) return 'ventas/anular';
  if (/^\/api\/compras\/\d+\/anular$/.test(path)) return 'compras/anular';
  const workshopMatch = path.match(/^\/api\/taller\/\d+\/(despachar|devolver|cancelar|facturar)$/);
  if (workshopMatch) return `taller/${workshopMatch[1]}`;
  return path.slice('/api/'.length).replace(/\/\d+$/, '');
}

/** Stable values only: local and remote generated identifiers are mapped separately. */
export function operationEffect(method, path, body, result, backup) {
  const resource = resourceFor(path);
  if (method === 'DELETE') return { resource, deleted: true };
  const table = tableFor(resource);
  const row = backup.tables[table]?.find(row => sameId(row.id, result.id));
  if (!row) fail('No se encontró el resultado durable de la operación.', 503);
  const immutable = ['ventas', 'compras', 'turnos_caja', 'movimientos_caja', 'abonos_cuentas', 'cuentas_taller'].includes(table);
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
  if (resource === 'taller' || resource.startsWith('taller/')) {
    effect.items = (backup.tables.cuentas_taller_items || [])
      .filter(line => sameId(line.cuenta_id, result.id)).map(line => values(line, true));
    if (resource === 'taller/facturar') {
      const saleRow = (backup.tables.ventas || []).find(v => sameId(v.id, result.ventaId));
      if (!saleRow) fail('No se encontró la factura generada para la cuenta de taller.', 503);
      effect.venta = values(saleRow, true);
      effect.ventaItems = (backup.tables.venta_detalles || [])
        .filter(line => sameId(line.venta_id, result.ventaId)).map(line => values(line, true));
      effect.total = saleRow.total;
    }
  }
  if (resource === 'productos' && backup.tables.productos_codigos) {
    effect.altCodes = backup.tables.productos_codigos
      .filter(code => sameId(code.producto_id, result.id)).map(code => code.codigo).sort();
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
    ...backup.tables.ventas.filter(row => sameId(row.caja_id, turn.id)).flatMap(row => [row.creado_en, row.anulada_en]),
    ...backup.tables.movimientos_caja.filter(row => sameId(row.caja_id, turn.id)).map(row => row.creado_en),
    ...(backup.tables.abonos_cuentas || []).filter(row => sameId(row.caja_id, turn.id)).map(row => row.creado_en),
  ].filter(Boolean);
  return { id: Number(turn.id), version: Number(turn.version), open: turn.cerrado_en === null,
    latestAt: new Date(events.reduce((latest, value) => Math.max(latest, new Date(value).getTime()), 0)).toISOString() };
}

async function bootstrap(client, databaseLabel, observed) {
  const current = observed ?? await snapshot(client, databaseLabel);
  const backup = await exportBackup(client);
  return { snapshot: current, backup, catalogo: current.state.catalogo, cashHead: cashHeadFromBackup(backup), etag: bootstrapTag(current) };
}
export async function readSyncBootstrap(pool, databaseLabel, isNotModified) {
  const client = await pool.connect();
  let discard;
  try {
    if (isNotModified) {
      const version = await snapshotVersion(client, databaseLabel);
      if (isNotModified(version)) return { notModified: version };
    }
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
  const validRoute = method === 'POST' && (
      /^\/api\/(productos|clientes|suplidores|formulas|ventas|compras|taller|caja\/(abrir|cerrar|movimiento)|cuentas\/(cobros|pagos))$/.test(path) ||
      /^\/api\/ventas\/[1-9]\d*\/anular$/.test(path) ||
      /^\/api\/compras\/[1-9]\d*\/anular$/.test(path) ||
      /^\/api\/taller\/[1-9]\d*\/(despachar|devolver|cancelar|facturar)$/.test(path)
    ) ||
    ['PUT', 'DELETE'].includes(method) && /^\/api\/(productos|clientes|suplidores|formulas)\/[1-9]\d*$/.test(path) ||
    method === 'PUT' && ['/api/configuracion', '/api/ncf'].includes(path);
  if (!validRoute || !body || typeof body !== 'object' || Array.isArray(body) || !uuid.test(body.databaseId)) fail('La operación no se puede sincronizar.');
  if (typeof occurredAt !== 'string' || !Number.isFinite(Date.parse(occurredAt)) || instant(occurredAt) !== occurredAt ||
      Date.parse(occurredAt) > Date.now() + 300000) fail('Revisa la fecha y la hora del equipo antes de sincronizar.', 409);
  if (!expected || Object.keys(expected).sort().join(',') !== 'cashHead,effect' || !expected.effect ||
      typeof expected.effect !== 'object' || Array.isArray(expected.effect)) fail('Falta el resultado local confirmado.');
  if (isCashSyncOperation(path, body)) {
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
  if (path === '/api/taller' && body.items !== undefined) {
    if (!Array.isArray(body.items)) fail('Las líneas de despacho no son válidas.');
    body.items.forEach(line => id(line.versionProducto, 'la versión del artículo'));
  }
  if (/^\/api\/taller\/[1-9]\d*\/despachar$/.test(path)) {
    if (!Array.isArray(body.items)) fail('Faltan las líneas de despacho.');
    body.items.forEach(line => id(line.versionProducto, 'la versión del artículo'));
  }
  if (/^\/api\/taller\/[1-9]\d*\/facturar$/.test(path)) {
    id(body.versionConfiguracion, 'la versión de configuración');
  }
  if (path === '/api/compras') {
    if (!Array.isArray(body.items)) fail('Faltan las líneas de compra.');
    for (const line of body.items) {
      if (line.productoId === null && line.versionProducto === null) continue;
      id(line.productoId, 'el artículo'); id(line.versionProducto, 'la versión del artículo');
    }
  }
}

async function verifyCashHead(client, expected, occurredAt, saleBody) {
  // Same first lock as every ordinary sale, opening, movement and closing.
  await client.query('SELECT pg_advisory_xact_lock(74198233)');
  const turn = (await client.query(`SELECT c.id,c.version,c.cerrado_en,
    $1::timestamptz >= c.abierto_en AS dentro_del_turno,
    greatest(c.abierto_en,c.cerrado_en,
      (SELECT max(greatest(creado_en,anulada_en)) FROM ventas WHERE caja_id=c.id),
      (SELECT max(creado_en) FROM movimientos_caja WHERE caja_id=c.id),
      (SELECT max(creado_en) FROM abonos_cuentas WHERE caja_id=c.id)) AS ultimo,
    $1::timestamptz >= greatest(c.abierto_en,c.cerrado_en,
      (SELECT max(greatest(creado_en,anulada_en)) FROM ventas WHERE caja_id=c.id),
      (SELECT max(creado_en) FROM movimientos_caja WHERE caja_id=c.id),
      (SELECT max(creado_en) FROM abonos_cuentas WHERE caja_id=c.id)) AS fecha_valida
    FROM turnos_caja c ORDER BY c.abierto_en DESC,c.id DESC LIMIT 1`, [occurredAt])).rows[0];
  const current = turn ? { id: Number(turn.id), version: Number(turn.version), open: turn.cerrado_en === null, latestAt: instant(turn.ultimo) } :
    { id: null, version: null, open: false, latestAt: null };
  // Sales add to an open turn. Other sales can change its version while this
  // device is offline; the exact invoice effect and current stock still have
  // to pass inside this same transaction. Open/close/movement stay strict.
  if (saleBody && expected.open && current.open && expected.id === current.id &&
      current.id === saleBody.cajaId && current.version >= expected.version && turn.dentro_del_turno) return;
  if (canonical(current) !== canonical(expected)) fail('Conflicto de caja: hubo actividad en otro equipo. La operación local se conserva para conciliar.', 409);
  if (turn && !turn.fecha_valida) fail('La fecha local precede un movimiento de caja confirmado. La operación se conserva para conciliar.', 409);
}

function streamKey(kind, actorId, deviceId, databaseId) {
  const hash = createHash('sha256').update(JSON.stringify(['felix-sync', kind, actorId, deviceId, databaseId])).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

// A retired stream is a durable server-side barrier, not deletion of invoices.
export async function retireSyncStream(pool, body, databaseLabel, actor) {
  if (!body || Object.keys(body).sort().join(',') !== 'databaseId,deviceId,operationIds' ||
      !uuid.test(body.deviceId) || !uuid.test(body.databaseId) || !Array.isArray(body.operationIds) ||
      !body.operationIds.length || body.operationIds.length > 10000 || body.operationIds.some(key => !uuid.test(key)) ||
      new Set(body.operationIds).size !== body.operationIds.length) fail('Revisa las operaciones seleccionadas para archivar.');
  const actorId = text(actor?.id, 'el usuario autenticado');
  const key = streamKey('retired', actorId, body.deviceId, body.databaseId);
  const fingerprint = createHash('sha256').update(canonical(body)).digest('hex');
  const client = await pool.connect();
  let discard;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock_shared($1)', [maintenanceLock]);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`sync:${actorId}:${body.deviceId}`]);
    const previous = (await client.query('SELECT tipo,huella,resultado FROM pos_privado.solicitudes WHERE clave=$1', [key])).rows[0];
    let retirement;
    if (previous) {
      if (previous.tipo !== 'sync:retired' || previous.huella !== fingerprint) fail('Este flujo ya fue archivado con otra lista de operaciones. Revisa el historial.', 409);
      retirement = previous.resultado.retirement;
    } else {
      const generation = (await snapshotVersion(client, databaseLabel)).databaseId;
      const confirmed = await client.query('SELECT clave,resultado FROM pos_privado.solicitudes WHERE clave=ANY($1::uuid[])', [body.operationIds]);
      if (confirmed.rowCount && generation === body.databaseId) throw Object.assign(new Error('Hay operaciones ya confirmadas. Sincroniza para recuperar sus recibos antes de archivar las restantes.'),
        { status: 409, retirementRejection: { ...body, actorId } });
      if (confirmed.rows.some(row => row.resultado.databaseId !== body.databaseId || row.resultado.metadata?.actorId !== actorId || row.resultado.metadata?.deviceId !== body.deviceId))
        fail('La lista contiene una operación de otro flujo. Revisa las operaciones locales.', 409);
      retirement = { ...body, actorId, retiredAt: new Date().toISOString(),
        previouslyConfirmed: confirmed.rows.map(row => ({ operationId: row.clave, ...row.resultado })) };
      await client.query('INSERT INTO pos_privado.solicitudes(clave,tipo,huella,resultado) VALUES($1,$2,$3,$4)',
        [key, 'sync:retired', fingerprint, { databaseId: body.databaseId, retirement }]);
    }
    await client.query('SELECT database_id FROM pos_privado.sistema WHERE id=1 FOR SHARE');
    const download = await bootstrap(client, databaseLabel);
    await client.query('COMMIT');
    return { ...download, retirement };
  } catch (cause) {
    try { await client.query('ROLLBACK'); } catch (failure) { discard = failure; }
    throw cause;
  } finally { client.release(discard); }
}

async function operationBackup(client, method, path, result, priorMovement, priorAltCode, createdMovements = null) {
  const resource = resourceFor(path), table = tableFor(resource);
  const data = Object.fromEntries(Object.keys(tables).map(name => [name, []]));
  if (method === 'DELETE') return { tables: data };
  data[table] = await rows(client, table, true, { sql: 'id=$1', values: [result.id] });
  if (resource === 'ventas' || resource === 'compras') {
    const sale = resource === 'ventas', detail = sale ? 'venta_detalles' : 'compra_detalles';
    data[detail] = await rows(client, detail, true, { sql: (sale ? 'venta_id' : 'compra_id') + '=$1', values: [result.id] });
    data.movimientos_inventario = await rows(client, 'movimientos_inventario', true, {
      sql: (sale ? 'venta_detalle_id' : 'compra_detalle_id') + '=ANY($1::bigint[])', values: [data[detail].map(row => row.id)],
    });
    if (!sale) data.productos = await rows(client, 'productos', true, { sql: 'id=ANY($1::bigint[])', values: [data[detail].map(row => row.producto_id)] });
  } else if (resource === 'ventas/anular') {
    data.movimientos_inventario = createdMovements?.length
      ? await rows(client, 'movimientos_inventario', true, { sql: 'id=ANY($1::bigint[])', values: [createdMovements] })
      : [];
  } else if (resource === 'compras/anular') {
    data.movimientos_inventario = createdMovements?.length
      ? await rows(client, 'movimientos_inventario', true, { sql: 'id=ANY($1::bigint[])', values: [createdMovements] })
      : [];
  } else if (resource === 'productos') {
    data.movimientos_inventario = await rows(client, 'movimientos_inventario', true, {
      sql: 'producto_id=$1 AND id>$2', values: [result.id, priorMovement],
    });
    data.productos_codigos = await rows(client, 'productos_codigos', true, {
      sql: 'producto_id=$1', values: [result.id],
    });
  } else if (resource === 'taller' || resource.startsWith('taller/')) {
    data.cuentas_taller_items = await rows(client, 'cuentas_taller_items', true, {
      sql: 'cuenta_id=$1', values: [result.id],
    });
    if (resource === 'taller/facturar') {
      data.ventas = await rows(client, 'ventas', true, { sql: 'id=$1', values: [result.ventaId] });
      data.venta_detalles = await rows(client, 'venta_detalles', true, { sql: 'venta_id=$1', values: [result.ventaId] });
    } else {
      data.movimientos_inventario = createdMovements?.length
        ? await rows(client, 'movimientos_inventario', true, { sql: 'id=ANY($1::bigint[])', values: [createdMovements] })
        : [];
    }
  }
  return { tables: data };
}

function createdRows(method, path, body, result, backup, priorProducts, priorMovement, priorAltCode, hadNcf, priorWorkshopItem = 0, createdMovements = null, createdWorkshopItems = null) {
  const resource = resourceFor(path), tbl = backup.tables;
  const created = {};
  const add = (table, list) => { if (list.length) created[table] = list.map(row => Number(row.id)); };
  const selected = table => tbl[table].filter(row => sameId(row.id, result.id));
  if (method === 'POST' && ['clientes', 'suplidores', 'productos', 'formulas'].includes(resource)) add(tableFor(resource), selected(tableFor(resource)));
  if (resource === 'productos' && method !== 'DELETE') {
    add('movimientos_inventario', tbl.movimientos_inventario.filter(row => Number(row.id) > priorMovement && sameId(row.producto_id, result.id)));
    add('productos_codigos', tbl.productos_codigos.filter(row => Number(row.id) > priorAltCode && sameId(row.producto_id, result.id)));
  }
  if (resource === 'caja/abrir') add('turnos_caja', selected('turnos_caja'));
  if (resource === 'caja/movimiento') add('movimientos_caja', selected('movimientos_caja'));
  if (resource === 'cuentas/cobros' || resource === 'cuentas/pagos') add('abonos_cuentas', selected('abonos_cuentas'));
  if (resource === 'ncf' && !hadNcf) add('secuencias_ncf', selected('secuencias_ncf'));
  if (resource === 'ventas/anular' || resource === 'compras/anular') {
    if (createdMovements?.length) created.movimientos_inventario = [...createdMovements];
  }
  if (resource === 'taller') {
    add('cuentas_taller', selected('cuentas_taller'));
    add('cuentas_taller_items', tbl.cuentas_taller_items.filter(row => sameId(row.cuenta_id, result.id)));
    if (createdMovements?.length) created.movimientos_inventario = [...createdMovements];
  }
  if (resource === 'taller/despachar') {
    if (createdWorkshopItems?.length) created.cuentas_taller_items = [...createdWorkshopItems];
    else add('cuentas_taller_items', tbl.cuentas_taller_items.filter(row => Number(row.id) > priorWorkshopItem && sameId(row.cuenta_id, result.id)));
    if (createdMovements?.length) created.movimientos_inventario = [...createdMovements];
  }
  if (resource === 'taller/devolver' || resource === 'taller/cancelar') {
    if (createdMovements?.length) created.movimientos_inventario = [...createdMovements];
  }
  if (resource === 'taller/facturar') {
    add('ventas', tbl.ventas.filter(row => sameId(row.id, result.ventaId)));
    add('venta_detalles', tbl.venta_detalles.filter(row => sameId(row.venta_id, result.ventaId)));
  }
  if (resource === 'ventas' || resource === 'compras') {
    const sale = resource === 'ventas', detailTable = sale ? 'venta_detalles' : 'compra_detalles';
    const details = tbl[detailTable].filter(row => sameId(row[sale ? 'venta_id' : 'compra_id'], result.id));
    const detailIds = new Set(details.map(row => String(row.id)));
    add(resource, selected(resource)); add(detailTable, details);
    add('movimientos_inventario', tbl.movimientos_inventario.filter(row => detailIds.has(String(row[sale ? 'venta_detalle_id' : 'compra_detalle_id']))));
    if (!sale) {
      const products = new Set(details.map(row => String(row.producto_id)));
      add('productos', tbl.productos.filter(row => products.has(String(row.id)) && !priorProducts.has(String(row.id))));
    }
  }
  return created;
}

export async function writeSyncOperation(pool, envelope, databaseLabel, actor, { receiptOnly = false } = {}) {
  validateEnvelope(envelope);
  const actorId = text(actor?.id, 'el usuario autenticado');
  const { deviceId, sequence, operationId, method, path, body, occurredAt, expected } = envelope;
  const executionBody = structuredClone(body);
  const retiredKey = streamKey('retired', actorId, deviceId, body.databaseId);
  const cursorKey = streamKey('cursor', actorId, deviceId, body.databaseId);
  let priorProducts = new Set(), priorMovement = 0, priorAltCode = 0, hadNcf = false, priorWorkshopItem = 0;
  const createdMovements = [];
  const createdWorkshopItems = [];
  return writeOperation(pool, method, path, executionBody, operationId, databaseLabel, actor, {
    occurredAt, allowNcf: false, requestType: `sync:${actorId}:${method} ${path}`, fingerprintPayload: envelope, versionOnly: receiptOnly,
    createdMovements, createdWorkshopItems,
    async beforeExecute(client) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`sync:${actorId}:${deviceId}`]);
      const markers = (await client.query('SELECT clave,tipo,resultado FROM pos_privado.solicitudes WHERE clave=ANY($1::uuid[])', [[retiredKey, cursorKey]])).rows;
      if (markers.some(row => row.clave === retiredKey)) fail('Este flujo fue archivado para revisión. La operación original se conserva y no puede reenviarse.', 409);
      let previous = markers.find(row => row.clave === cursorKey)?.resultado.cursor;
      const version = await snapshotVersion(client, databaseLabel);
      if (!previous || previous.revision !== version.revision || sequence > previous.sequence + 1) previous = (await client.query(`SELECT resultado->'metadata' AS metadata FROM pos_privado.solicitudes
        WHERE resultado->'metadata'->>'deviceId'=$1 AND resultado->'metadata'->>'actorId'=$2
          AND resultado->>'databaseId'=$3
        ORDER BY (resultado->'metadata'->>'sequence')::bigint DESC LIMIT 1`, [deviceId, actorId, body.databaseId])).rows[0]?.metadata;
      if (sequence !== (previous ? previous.sequence + 1 : 1)) fail('La secuencia del equipo no coincide. Sincroniza primero la operación pendiente anterior.', 409);
      if (previous && occurredAt < previous.occurredAt) fail('La fecha del equipo retrocedió. La operación local se conserva para revisar.', 409);
      const resource = resourceFor(path);
      if (isCashSyncOperation(path, body)) {
        const voidMatch = path.match(/^\/api\/ventas\/(\d+)\/anular$/);
        if (voidMatch) {
          const targetSale = (await client.query('SELECT metodo_pago,caja_id FROM ventas WHERE id=$1', [Number(voidMatch[1])])).rows[0];
          if (targetSale?.metodo_pago === 'efectivo' && targetSale.caja_id !== null) {
            // Anular una venta en efectivo resta dinero de caja: exige orden estricto (igual que salidas).
            await verifyCashHead(client, expected.cashHead, occurredAt, null);
          }
        } else {
          await verifyCashHead(client, expected.cashHead, occurredAt, (path === '/api/ventas' || resource === 'taller/facturar') ? body : null);
        }
      }
      if (path === '/api/ventas' || ((resource === 'taller' || resource === 'taller/despachar') && Array.isArray(body.items) && body.items.length)) {
        const versions = new Map((await client.query('SELECT id,version FROM productos WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE',
          [body.items.map(line => line.productoId)])).rows.map(row => [Number(row.id), Number(row.version)]));
        executionBody.items.forEach(line => { if (versions.has(line.productoId)) line.versionProducto = versions.get(line.productoId); });
      }
      if (path === '/api/compras') priorProducts = new Set((await client.query('SELECT id FROM productos WHERE codigo=ANY($1::text[])',
        [body.items.map(line => line.codigo)])).rows.map(row => String(row.id)));
      if (resource === 'productos') {
        priorMovement = Number((await client.query('SELECT COALESCE(max(id),0) AS id FROM movimientos_inventario')).rows[0].id);
        priorAltCode = Number((await client.query('SELECT COALESCE(max(id),0) AS id FROM productos_codigos')).rows[0].id);
      }
      if (resource === 'ncf') {
        hadNcf = Boolean((await client.query('SELECT 1 FROM secuencias_ncf WHERE tipo=$1 LIMIT 1', [body.tipo])).rowCount);
      }
    },
    async afterExecute(client, result) {
      const backup = await operationBackup(client, method, path, result, priorMovement, priorAltCode, createdMovements);
      const effect = operationEffect(method, path, body, result, backup);
      if (canonical(effect) !== canonical(expected.effect)) fail('Conflicto de sincronización: el resultado difiere del confirmado localmente. Revisa la operación conservada en el equipo.', 409);
      return { actorId, deviceId, sequence, operationId, occurredAt, result, effect,
        created: createdRows(method, path, body, result, backup, priorProducts, priorMovement, priorAltCode, hadNcf, priorWorkshopItem, createdMovements, createdWorkshopItems) };
    },
    async represent(client, observed, metadata, replayed) {
      const { result: _result, ...current } = observed;
      if (!replayed) await client.query(`INSERT INTO pos_privado.solicitudes(clave,tipo,huella,resultado) VALUES($1,'sync:cursor',$2,$3)
        ON CONFLICT(clave) DO UPDATE SET resultado=excluded.resultado WHERE pos_privado.solicitudes.tipo='sync:cursor'`,
        [cursorKey, cursorKey, { databaseId: body.databaseId, cursor: { sequence, occurredAt, revision: current.revision } }]);
      const { actorId: _actor, occurredAt: _instant, ...receipt } = metadata;
      return { ...(receiptOnly ? { snapshot: current } : await bootstrap(client, databaseLabel, current)), receipt: { ...receipt, replayed } };
    },
  });
}

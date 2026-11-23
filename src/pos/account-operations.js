import { cents, decimalUnits, fail, id, money, quantityUnits, text } from './operation-fields.js';
import { lockCash, turnTotals } from './cash-operations.js';

const quantityText = value => decimalUnits(value, 2);

function validDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value + 'T00:00:00Z')) ||
      new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) {
    fail(`Revisa ${label}.`);
  }
  return value;
}

export function addDaysIso(isoDate, days) {
  const date = new Date(isoDate + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function voidSale(client, saleId, body, actor, occurredAt = null) {
  const expectedVersion = id(body.version, 'la versión de la factura');
  const reason = text(body.motivo, 'el motivo de anulación');
  const user = text(actor?.name || actor?.id, 'el usuario');
  // Adquirir bloqueo de caja primero para mantener el orden global de bloqueos.
  await client.query('SELECT pg_advisory_xact_lock(74198233)');
  const sale = (await client.query('SELECT * FROM ventas WHERE id=$1 FOR UPDATE', [saleId])).rows[0];
  if (!sale) fail('La factura no existe.', 404);
  if (sale.estado === 'anulada') fail('Esta factura ya fue anulada.', 409);
  if (Number(sale.version) !== expectedVersion) fail('La factura cambió. Actualiza antes de anular.', 409);

  const payments = (await client.query('SELECT 1 FROM abonos_cuentas WHERE venta_id=$1 LIMIT 1', [saleId])).rowCount;
  if (payments) fail('Esta factura tiene abonos registrados y no puede anularse.', 409);

  let closedTurnAt = null;
  if (sale.metodo_pago === 'efectivo' && sale.caja_id !== null) {
    const turn = (await client.query('SELECT * FROM turnos_caja WHERE id=$1 FOR UPDATE', [sale.caja_id])).rows[0];
    if (!turn || turn.cerrado_en !== null) {
      fail('No se puede anular una venta en efectivo de un turno de caja ya cerrado.', 409);
    }
    const summary = await turnTotals(client, turn);
    if (summary.expected < cents(sale.total)) {
      fail('La anulación dejaría el efectivo esperado de la caja en negativo.', 409);
    }
    await client.query('UPDATE turnos_caja SET version=version+1 WHERE id=$1', [turn.id]);
  } else if (sale.caja_id !== null) {
    const turn = (await client.query('SELECT cerrado_en FROM turnos_caja WHERE id=$1 FOR SHARE', [sale.caja_id])).rows[0];
    if (turn?.cerrado_en !== null && turn?.cerrado_en !== undefined) {
      closedTurnAt = turn.cerrado_en;
      if (occurredAt && new Date(occurredAt).getTime() <= new Date(closedTurnAt).getTime()) {
        fail('No se puede registrar una anulación con fecha anterior o igual al cierre de su turno de caja.', 409);
      }
    }
  }

  const details = (await client.query('SELECT * FROM venta_detalles WHERE venta_id=$1 ORDER BY producto_id, id', [saleId])).rows;
  const productIds = [...new Set(details.map(d => Number(d.producto_id)))].sort((a, b) => a - b);
  const products = new Map((await client.query('SELECT * FROM productos WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE', [productIds]))
    .rows.map(p => [Number(p.id), { ...p, stock: quantityUnits(p.stock, 'las existencias') }]));

  await client.query(
    `UPDATE ventas SET estado='anulada',
      anulada_en=CASE WHEN $5::timestamptz IS NOT NULL AND $2::timestamptz IS NULL
        THEN GREATEST(clock_timestamp(), $5::timestamptz + interval '1 millisecond')
        ELSE COALESCE($2::timestamptz,clock_timestamp()) END,
      anulada_por=$3, motivo_anulacion=$4, version=version+1 WHERE id=$1`,
    [saleId, occurredAt, user, reason, closedTurnAt],
  );

  for (const detail of details) {
    const product = products.get(Number(detail.producto_id));
    if (!product) fail('Falta el producto asociado a la factura.', 409);
    const qty = quantityUnits(detail.cantidad, 'la cantidad', 0.01);
    product.stock += qty;
    const stockText = quantityText(product.stock);
    await client.query('UPDATE productos SET stock=$2, version=version+1, actualizado_en=now() WHERE id=$1', [product.id, stockText]);
    await client.query(
      `INSERT INTO movimientos_inventario(producto_id,cantidad,existencia_posterior,tipo,venta_detalle_id,compra_detalle_id,motivo,creado_en)
       VALUES($1,$2,$3,'anulacion',NULL,NULL,$4,COALESCE($5::timestamptz,clock_timestamp()))`,
      [product.id, quantityText(qty), stockText, `Anulación factura #${saleId}: ${reason}`.slice(0, 2000), occurredAt],
    );
  }
  return { id: saleId, voided: true };
}

export async function voidPurchase(client, purchaseId, body, actor, occurredAt = null) {
  const expectedVersion = id(body.version, 'la versión de la compra');
  const reason = text(body.motivo, 'el motivo de anulación');
  const user = text(actor?.name || actor?.id, 'el usuario');

  const purchase = (await client.query('SELECT * FROM compras WHERE id=$1 FOR UPDATE', [purchaseId])).rows[0];
  if (!purchase) fail('La compra no existe.', 404);
  if (purchase.estado === 'anulada') fail('Esta compra ya fue anulada.', 409);
  if (Number(purchase.version) !== expectedVersion) fail('La compra cambió. Actualiza antes de anular.', 409);

  const payments = (await client.query('SELECT 1 FROM abonos_cuentas WHERE compra_id=$1 LIMIT 1', [purchaseId])).rowCount;
  if (payments) fail('Esta compra tiene pagos registrados y no puede anularse.', 409);

  const details = (await client.query('SELECT * FROM compra_detalles WHERE compra_id=$1 ORDER BY producto_id, id', [purchaseId])).rows;
  const needed = new Map();
  for (const d of details) {
    const pid = Number(d.producto_id);
    const qty = quantityUnits(d.cantidad, 'la cantidad', 0.01);
    needed.set(pid, (needed.get(pid) ?? 0n) + qty);
  }
  const productIds = [...needed.keys()].sort((a, b) => a - b);
  const products = new Map((await client.query('SELECT * FROM productos WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE', [productIds]))
    .rows.map(p => [Number(p.id), { ...p, stock: quantityUnits(p.stock, 'las existencias') }]));

  for (const [pid, qty] of needed) {
    const product = products.get(pid);
    if (!product) fail('Falta un producto asociado a la compra.', 409);
    if (product.stock < qty) {
      fail(`No hay existencias suficientes de «${product.nombre}» para revertir esta compra (parte de la mercancía ya salió del inventario).`, 409);
    }
  }

  await client.query(
    `UPDATE compras SET estado='anulada',
      anulada_en=COALESCE($2::timestamptz,clock_timestamp()),
      anulada_por=$3, motivo_anulacion=$4, version=version+1 WHERE id=$1`,
    [purchaseId, occurredAt, user, reason],
  );

  for (const detail of details) {
    const product = products.get(Number(detail.producto_id));
    const qty = quantityUnits(detail.cantidad, 'la cantidad', 0.01);
    product.stock -= qty;
    const stockText = quantityText(product.stock);
    await client.query('UPDATE productos SET stock=$2, version=version+1, actualizado_en=now() WHERE id=$1', [product.id, stockText]);
    await client.query(
      `INSERT INTO movimientos_inventario(producto_id,cantidad,existencia_posterior,tipo,venta_detalle_id,compra_detalle_id,motivo,creado_en)
       VALUES($1,$2,$3,'anulacion_compra',NULL,NULL,$4,COALESCE($5::timestamptz,clock_timestamp()))`,
      [product.id, quantityText(-qty), stockText, `Anulación compra #${purchaseId}: ${reason}`.slice(0, 2000), occurredAt],
    );
  }
  return { id: purchaseId, voided: true };
}

export async function accountPayment(client, kind, body, actor, occurredAt = null) {
  if (!['cobro', 'pago'].includes(kind)) fail('Tipo de abono inválido.');
  const amount = cents(body.monto, 'el monto');
  if (!amount) fail('El abono debe ser mayor que cero.');
  if (!['efectivo', 'tarjeta', 'transferencia'].includes(body.metodoPago)) fail('Selecciona un método de pago válido.');
  const reference = text(body.referencia ?? '', 'la referencia', false);
  const note = text(body.nota ?? '', 'la nota', false);
  const user = text(actor?.id, 'el usuario');
  const isCash = body.metodoPago === 'efectivo';
  if (!isCash && body.cajaId !== undefined && body.cajaId !== null) fail('Solo los abonos en efectivo se vinculan a un turno de caja.');

  let turn = null, cashSummary = null;
  if (isCash) {
    turn = await lockCash(client, body.cajaId);
    cashSummary = await turnTotals(client, turn);
  }

  let docId;
  if (kind === 'cobro') {
    docId = id(body.ventaId, 'la factura');
    const expectedVersion = id(body.version, 'la versión de la factura');
    const sale = (await client.query('SELECT id,total,condicion,estado,version FROM ventas WHERE id=$1 FOR UPDATE', [docId])).rows[0];
    if (!sale) fail('La factura no existe.', 404);
    if (sale.estado !== 'activa' || sale.condicion !== 'Credito') fail('Solo se pueden registrar cobros en facturas activas a crédito.', 409);
    if (Number(sale.version) !== expectedVersion) fail('La factura cambió. Actualiza antes de registrar el cobro.', 409);
    const paidRow = (await client.query('SELECT COALESCE(sum(monto),0)::text AS pagado FROM abonos_cuentas WHERE venta_id=$1', [docId])).rows[0];
    const remaining = cents(sale.total) - cents(paidRow.pagado);
    if (amount > remaining) fail('El abono supera el saldo pendiente de esta factura.', 409);
    if (isCash) money(cashSummary.expected + amount);
    await client.query('UPDATE ventas SET version=version+1 WHERE id=$1', [docId]);
  } else {
    docId = id(body.compraId, 'la compra');
    const expectedVersion = id(body.version, 'la versión de la compra');
    const purchase = (await client.query('SELECT id,total,condicion,estado,version FROM compras WHERE id=$1 FOR UPDATE', [docId])).rows[0];
    if (!purchase) fail('La compra no existe.', 404);
    if (purchase.estado !== 'activa' || purchase.condicion !== 'Credito') fail('Solo se pueden registrar pagos en compras activas a crédito.', 409);
    if (Number(purchase.version) !== expectedVersion) fail('La compra cambió. Actualiza antes de registrar el pago.', 409);
    const paidRow = (await client.query('SELECT COALESCE(sum(monto),0)::text AS pagado FROM abonos_cuentas WHERE compra_id=$1', [docId])).rows[0];
    const remaining = cents(purchase.total) - cents(paidRow.pagado);
    if (amount > remaining) fail('El pago supera el saldo pendiente de esta compra.', 409);
    if (isCash && amount > cashSummary.expected) fail('El pago en efectivo supera el efectivo esperado en caja.', 409);
    await client.query('UPDATE compras SET version=version+1 WHERE id=$1', [docId]);
  }

  const row = (await client.query(
    `INSERT INTO abonos_cuentas(tipo,venta_id,compra_id,caja_id,metodo_pago,monto,referencia,nota,usuario,creado_en)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::timestamptz,clock_timestamp())) RETURNING id`,
    [kind, kind === 'cobro' ? docId : null, kind === 'pago' ? docId : null, turn?.id ?? null, body.metodoPago, money(amount), reference, note, user, occurredAt],
  )).rows[0];
  if (turn) await client.query('UPDATE turnos_caja SET version=version+1 WHERE id=$1', [turn.id]);
  return { id: Number(row.id) };
}

export async function ncfSequenceOperation(client, body) {
  const allowed = new Set(['databaseId', 'tipo', 'inicio', 'fin', 'actual', 'vencimiento', 'activa', 'version']);
  if (Object.keys(body).some(key => !allowed.has(key))) fail('El formulario de NCF contiene campos no admitidos.');
  const tipo = body.tipo;
  if (!['B01', 'B02', 'B14'].includes(tipo)) fail('Tipo de comprobante NCF inválido.');
  const inicio = Number(body.inicio), fin = Number(body.fin), actual = Number(body.actual);
  if (!Number.isSafeInteger(inicio) || inicio < 1 || inicio > 99999999) fail('Revisa el número inicial de la secuencia NCF.');
  if (!Number.isSafeInteger(fin) || fin < inicio || fin > 99999999) fail('Revisa el número final de la secuencia NCF.');
  if (!Number.isSafeInteger(actual) || actual < inicio - 1 || actual > fin) fail('La secuencia actual debe estar entre inicio - 1 y fin.');
  const vencimiento = validDate(body.vencimiento, 'la fecha de vencimiento del NCF');
  if (typeof body.activa !== 'boolean') fail('Indica si la secuencia NCF está activa.');

  const existing = (await client.query('SELECT * FROM secuencias_ncf WHERE tipo=$1 FOR UPDATE', [tipo])).rows[0];
  if (existing) {
    const version = id(body.version, 'la versión de la secuencia NCF');
    if (Number(existing.version) !== version) fail('La secuencia NCF cambió. Actualiza antes de guardar.', 409);
    const updated = (await client.query(
      `UPDATE secuencias_ncf SET inicio=$2,fin=$3,actual=$4,vencimiento=$5,activa=$6,version=version+1,actualizado_en=now()
       WHERE id=$1 RETURNING id`,
      [existing.id, inicio, fin, actual, vencimiento, body.activa],
    )).rows[0];
    return { id: Number(updated.id), tipo };
  }
  if (body.version !== undefined && body.version !== null) fail('La secuencia NCF ya no coincide. Actualiza antes de guardar.', 409);
  const inserted = (await client.query(
    `INSERT INTO secuencias_ncf(tipo,prefijo,inicio,fin,actual,vencimiento,activa)
     VALUES($1,$1,$2,$3,$4,$5,$6) RETURNING id`,
    [tipo, inicio, fin, actual, vencimiento, body.activa],
  )).rows[0];
  return { id: Number(inserted.id), tipo };
}

export async function nextNcfIfActive(client, tipo, saleDateIso) {
  const seq = (await client.query('SELECT id,prefijo,fin,actual,vencimiento::text AS vencimiento FROM secuencias_ncf WHERE tipo=$1 AND activa FOR UPDATE', [tipo])).rows[0];
  if (!seq) return null;
  if (saleDateIso > seq.vencimiento) fail(`La secuencia NCF ${tipo} está vencida (${seq.vencimiento}). Actualízala en Configuración.`, 409);
  const next = Number(seq.actual) + 1;
  if (next > Number(seq.fin)) fail(`La secuencia NCF ${tipo} está agotada. Configura un nuevo rango en Configuración.`, 409);
  const ncf = seq.prefijo + String(next).padStart(8, '0');
  const exists = (await client.query('SELECT 1 FROM ventas WHERE ncf=$1 LIMIT 1', [ncf])).rowCount;
  if (exists) fail(`El comprobante ${ncf} ya fue emitido. Revisa la secuencia NCF en Configuración.`, 409);
  await client.query('UPDATE secuencias_ncf SET actual=$2, version=version+1, actualizado_en=now() WHERE id=$1', [seq.id, next]);
  return ncf;
}

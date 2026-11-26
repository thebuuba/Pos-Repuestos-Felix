import { saleDocumentTotals, saleLineAmounts } from '../domain/sale-pricing.js';
import { cents, costUnits, decimalUnits, fail, id, money, quantityUnits, text } from './operation-fields.js';
import { lockCash } from './cash-operations.js';
import { addDaysIso, nextNcfIfActive } from './account-operations.js';

const quantityText = value => decimalUnits(value, 2);
const iso = value => value instanceof Date ? value.toISOString() : (typeof value === 'string' && value ? new Date(value).toISOString() : value);

function validOptionalDate(value, label) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value + 'T00:00:00Z')) ||
      new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) {
    fail(`Revisa ${label}.`);
  }
  return value;
}

export function presentWorkshopAccount(account, items = []) {
  const mappedItems = items.map(item => {
    const qty = quantityUnits(item.cantidad, 'la cantidad');
    const returned = quantityUnits(item.cantidad_devuelta ?? 0, 'la cantidad devuelta');
    const net = qty - returned;
    return {
      id: Number(item.id),
      productoId: Number(item.producto_id),
      codigo: item.codigo,
      nombre: item.nombre,
      gravado: Boolean(item.gravado),
      nivelPrecio: item.nivel_precio,
      precio: Number(item.precio),
      precioExacto: String(item.precio),
      costoUnitario: item.costo_unitario === null || item.costo_unitario === undefined ? null : Number(item.costo_unitario),
      costoUnitarioExacto: item.costo_unitario === null || item.costo_unitario === undefined ? null : String(item.costo_unitario),
      cantidad: Number(decimalUnits(qty, 2)),
      cantidadDevuelta: Number(decimalUnits(returned, 2)),
      cantidadNeta: Number(decimalUnits(net, 2)),
      despachadoPor: item.despachado_por,
      retiradoPor: item.retirado_por || '',
      creadoEn: iso(item.creado_en),
    };
  });
  return {
    id: Number(account.id),
    version: Number(account.version),
    clienteId: Number(account.cliente_id),
    cliente: account.cliente_nombre,
    mecanico: account.mecanico || '',
    vehiculo: account.vehiculo || '',
    nota: account.nota || '',
    estado: account.estado,
    ventaId: account.venta_id === null || account.venta_id === undefined ? null : Number(account.venta_id),
    abiertaPor: account.abierta_por,
    abiertaEn: iso(account.abierta_en),
    cerradaEn: account.cerrada_en ? iso(account.cerrada_en) : null,
    items: mappedItems,
  };
}

async function dispatchLines(client, accountId, label, rawItems, withdrawnBy, user, occurredAt, context = null) {
  if (!Array.isArray(rawItems) || !rawItems.length || rawItems.length > 1000) {
    fail('Indica entre 1 y 1000 artículos para despachar.');
  }
  const quantities = new Map();
  const items = rawItems.map(item => {
    const productoId = id(item.productoId, 'el artículo');
    const quantity = quantityUnits(item.cantidad, 'la cantidad', 0.01);
    if (!['precio1', 'precio2', 'precio3'].includes(item.nivelPrecio)) fail('Nivel de precio inválido.');
    const total = (quantities.get(productoId) ?? 0n) + quantity;
    quantities.set(productoId, quantityUnits(quantityText(total), 'la cantidad total'));
    return { ...item, productoId, quantity };
  });
  const sortedIds = [...quantities.keys()].sort((a, b) => a - b);
  const products = new Map((await client.query(
    'SELECT * FROM productos WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE',
    [sortedIds],
  )).rows.map(p => [Number(p.id), { ...p, stock: quantityUnits(p.stock, 'las existencias') }]));

  for (const [productId, quantity] of quantities) {
    const p = products.get(productId);
    if (!p?.activo || p.stock < quantity) {
      fail('Producto no disponible o existencias insuficientes para despachar.', 409);
    }
  }
  const reasonPrefix = `Despacho cuenta taller #${accountId}${label ? ` (${label})` : ''}`;
  for (const item of items) {
    const p = products.get(item.productoId);
    if (item.versionProducto !== undefined && id(item.versionProducto) !== Number(p.version)) {
      fail('El artículo cambió. Actualiza antes de despachar para confirmar su precio y existencia.', 409);
    }
    const frozenPrice = decimalUnits(costUnits(p[item.nivelPrecio], 'el precio'), 4);
    const frozenCost = decimalUnits(costUnits(p.costo, 'el costo'), 4);
    p.stock -= item.quantity;
    const stockText = quantityText(p.stock);
    await client.query(
      'UPDATE productos SET stock=$2, version=version+1, actualizado_en=now() WHERE id=$1',
      [p.id, stockText],
    );
    const workshopItem = await client.query(
      `INSERT INTO cuentas_taller_items(cuenta_id,producto_id,codigo,nombre,gravado,nivel_precio,precio,costo_unitario,cantidad,cantidad_devuelta,despachado_por,retirado_por,creado_en)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,0,$10,$11,COALESCE($12::timestamptz,clock_timestamp())) RETURNING id`,
      [accountId, p.id, p.codigo, p.nombre, Boolean(p.gravado), item.nivelPrecio, frozenPrice, frozenCost, quantityText(item.quantity), user, withdrawnBy, occurredAt ?? null],
    );
    context?.createdWorkshopItems?.push(Number(workshopItem.rows[0].id));
    const reason = (withdrawnBy ? `${reasonPrefix} · Retiró: ${withdrawnBy}` : reasonPrefix).slice(0, 2000);
    const movement = await client.query(
      `INSERT INTO movimientos_inventario(producto_id,cantidad,existencia_posterior,tipo,venta_detalle_id,compra_detalle_id,motivo,creado_en)
       VALUES($1,$2,$3,'despacho',NULL,NULL,$4,COALESCE($5::timestamptz,clock_timestamp())) RETURNING id`,
      [p.id, quantityText(-item.quantity), stockText, reason, occurredAt ?? null],
    );
    context?.createdMovements?.push(Number(movement.rows[0].id));
  }
}

export async function openWorkshopAccount(client, body, actor, occurredAt = null, context = null) {
  const customer = (await client.query('SELECT * FROM clientes WHERE id=$1 AND activo FOR SHARE', [id(body.clienteId, 'el cliente')])).rows[0];
  if (!customer) fail('Selecciona un cliente activo.');
  const customName = typeof body.clienteNombre === 'string' && body.clienteNombre.trim()
    ? text(body.clienteNombre, 'el nombre del cliente')
    : customer.nombre;
  const mechanic = text(body.mecanico ?? '', 'el mecánico', false);
  const vehicle = text(body.vehiculo ?? '', 'el vehículo o referencia', false);
  const note = text(body.nota ?? '', 'la nota', false);
  const withdrawnBy = text(body.retiradoPor ?? '', 'quién retira', false);
  const user = text(actor?.name || actor?.id, 'el usuario');
  if (customer.es_contado && !customName.trim() && !mechanic && !vehicle) {
    fail('Indica el cliente, mecánico o vehículo de la cuenta abierta.');
  }

  const row = (await client.query(
    `INSERT INTO cuentas_taller(cliente_id,cliente_nombre,mecanico,vehiculo,nota,estado,abierta_por,abierta_en)
     VALUES($1,$2,$3,$4,$5,'abierta',$6,COALESCE($7::timestamptz,clock_timestamp())) RETURNING id`,
    [customer.id, customName, mechanic, vehicle, note, user, occurredAt ?? null],
  )).rows[0];
  const accountId = Number(row.id);

  if (Array.isArray(body.items) && body.items.length > 0) {
    const label = [mechanic, vehicle].filter(Boolean).join(' · ') || customName;
    await dispatchLines(client, accountId, label, body.items, withdrawnBy, user, occurredAt, context);
  }
  return { id: accountId };
}

export async function dispatchWorkshopItems(client, accountId, body, actor, occurredAt = null, context = null) {
  const expectedVersion = id(body.version, 'la versión de la cuenta de taller');
  const withdrawnBy = text(body.retiradoPor ?? '', 'quién retira', false);
  const user = text(actor?.name || actor?.id, 'el usuario');

  const account = (await client.query('SELECT * FROM cuentas_taller WHERE id=$1 FOR UPDATE', [accountId])).rows[0];
  if (!account) fail('La cuenta de taller no existe.', 404);
  if (account.estado !== 'abierta') fail('Esta cuenta de taller ya está cerrada.', 409);
  if (Number(account.version) !== expectedVersion) fail('La cuenta de taller cambió. Actualiza antes de despachar.', 409);

  const label = [account.mecanico, account.vehiculo].filter(Boolean).join(' · ') || account.cliente_nombre;
  await dispatchLines(client, accountId, label, body.items, withdrawnBy, user, occurredAt, context);
  await client.query('UPDATE cuentas_taller SET version=version+1 WHERE id=$1', [accountId]);
  return { id: accountId };
}

export async function returnWorkshopItem(client, accountId, body, actor, occurredAt = null, context = null) {
  const expectedVersion = id(body.version, 'la versión de la cuenta de taller');
  const itemId = id(body.itemId, 'el artículo despachado');
  const qty = quantityUnits(body.cantidad, 'la cantidad a devolver', 0.01);
  const reasonNote = text(body.motivo ?? '', 'el motivo', false);
  text(actor?.name || actor?.id, 'el usuario');

  const account = (await client.query('SELECT * FROM cuentas_taller WHERE id=$1 FOR UPDATE', [accountId])).rows[0];
  if (!account) fail('La cuenta de taller no existe.', 404);
  if (account.estado !== 'abierta') fail('Esta cuenta de taller ya está cerrada.', 409);
  if (Number(account.version) !== expectedVersion) fail('La cuenta de taller cambió. Actualiza antes de devolver.', 409);

  const item = (await client.query(
    'SELECT * FROM cuentas_taller_items WHERE id=$1 AND cuenta_id=$2 FOR UPDATE',
    [itemId, accountId],
  )).rows[0];
  if (!item) fail('El artículo despachado no pertenece a esta cuenta.', 404);

  const dispatched = quantityUnits(item.cantidad, 'la cantidad despachada', 0.01);
  const alreadyReturned = quantityUnits(item.cantidad_devuelta, 'la cantidad devuelta');
  const pending = dispatched - alreadyReturned;
  if (qty > pending) fail('La cantidad a devolver supera lo pendiente en esta línea.', 409);

  const product = (await client.query('SELECT * FROM productos WHERE id=$1 FOR UPDATE', [item.producto_id])).rows[0];
  if (!product) fail('Falta el producto asociado al despacho.', 409);
  const nextStock = quantityUnits(product.stock, 'las existencias') + qty;
  const stockText = quantityText(nextStock);

  await client.query(
    'UPDATE cuentas_taller_items SET cantidad_devuelta=$2 WHERE id=$1',
    [itemId, quantityText(alreadyReturned + qty)],
  );
  await client.query(
    'UPDATE productos SET stock=$2, version=version+1, actualizado_en=now() WHERE id=$1',
    [product.id, stockText],
  );
  const reason = `Devolución cuenta taller #${accountId}${reasonNote ? `: ${reasonNote}` : ''}`.slice(0, 2000);
  const movement = await client.query(
    `INSERT INTO movimientos_inventario(producto_id,cantidad,existencia_posterior,tipo,venta_detalle_id,compra_detalle_id,motivo,creado_en)
     VALUES($1,$2,$3,'devolucion_despacho',NULL,NULL,$4,COALESCE($5::timestamptz,clock_timestamp())) RETURNING id`,
    [product.id, quantityText(qty), stockText, reason, occurredAt ?? null],
  );
  context?.createdMovements?.push(Number(movement.rows[0].id));
  await client.query('UPDATE cuentas_taller SET version=version+1 WHERE id=$1', [accountId]);
  return { id: accountId };
}

export async function cancelWorkshopAccount(client, accountId, body, actor, occurredAt = null, context = null) {
  const expectedVersion = id(body.version, 'la versión de la cuenta de taller');
  const reasonNote = text(body.motivo ?? '', 'el motivo', false);
  text(actor?.name || actor?.id, 'el usuario');

  const account = (await client.query('SELECT * FROM cuentas_taller WHERE id=$1 FOR UPDATE', [accountId])).rows[0];
  if (!account) fail('La cuenta de taller no existe.', 404);
  if (account.estado !== 'abierta') fail('Esta cuenta de taller ya está cerrada.', 409);
  if (Number(account.version) !== expectedVersion) fail('La cuenta de taller cambió. Actualiza antes de cancelar.', 409);

  const items = (await client.query(
    'SELECT * FROM cuentas_taller_items WHERE cuenta_id=$1 ORDER BY producto_id, id FOR UPDATE',
    [accountId],
  )).rows;
  const pendingItems = items
    .map(item => ({
      item,
      pending: quantityUnits(item.cantidad, 'la cantidad', 0.01) - quantityUnits(item.cantidad_devuelta, 'la cantidad devuelta'),
    }))
    .filter(entry => entry.pending > 0n);

  if (pendingItems.length) {
    const productIds = [...new Set(pendingItems.map(e => Number(e.item.producto_id)))].sort((a, b) => a - b);
    const products = new Map((await client.query(
      'SELECT * FROM productos WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE',
      [productIds],
    )).rows.map(p => [Number(p.id), { ...p, stock: quantityUnits(p.stock, 'las existencias') }]));

    const reason = `Cancelación cuenta taller #${accountId}${reasonNote ? `: ${reasonNote}` : ''}`.slice(0, 2000);
    for (const { item, pending } of pendingItems) {
      const product = products.get(Number(item.producto_id));
      if (!product) fail('Falta el producto asociado al despacho.', 409);
      product.stock += pending;
      const stockText = quantityText(product.stock);
      await client.query('UPDATE cuentas_taller_items SET cantidad_devuelta=cantidad WHERE id=$1', [item.id]);
      await client.query('UPDATE productos SET stock=$2, version=version+1, actualizado_en=now() WHERE id=$1', [product.id, stockText]);
      const movement = await client.query(
        `INSERT INTO movimientos_inventario(producto_id,cantidad,existencia_posterior,tipo,venta_detalle_id,compra_detalle_id,motivo,creado_en)
         VALUES($1,$2,$3,'devolucion_despacho',NULL,NULL,$4,COALESCE($5::timestamptz,clock_timestamp())) RETURNING id`,
        [product.id, quantityText(pending), stockText, reason, occurredAt ?? null],
      );
      context?.createdMovements?.push(Number(movement.rows[0].id));
    }
  }

  await client.query(
    `UPDATE cuentas_taller SET estado='cancelada', cerrada_en=COALESCE($2::timestamptz,clock_timestamp()), version=version+1 WHERE id=$1`,
    [accountId, occurredAt ?? null],
  );
  return { id: accountId, cancelled: true };
}

export async function billWorkshopAccount(client, accountId, body, actor, occurredAt = null, allowNcf = true) {
  // Orden global de bloqueos: caja primero, luego cuenta, cliente e ítems.
  const turn = await lockCash(client, body.cajaId);
  const expectedVersion = id(body.version, 'la versión de la cuenta de taller');
  if (body.condicion === 'Credito' ? body.metodoPago !== 'credito' : !['efectivo', 'tarjeta', 'transferencia'].includes(body.metodoPago)) {
    fail('Selecciona un método de pago válido para cobrar la cuenta.');
  }
  if (!['Contado', 'Credito'].includes(body.condicion) || !['B01', 'B02', 'B14'].includes(body.tipoComprobante)) {
    fail('Condición o tipo de comprobante inválido.');
  }

  const account = (await client.query('SELECT * FROM cuentas_taller WHERE id=$1 FOR UPDATE', [accountId])).rows[0];
  if (!account) fail('La cuenta de taller no existe.', 404);
  if (account.estado !== 'abierta') fail('Esta cuenta de taller ya fue facturada o cancelada.', 409);
  if (Number(account.version) !== expectedVersion) fail('La cuenta de taller cambió. Actualiza antes de cobrar.', 409);

  const customerId = body.clienteId !== undefined && body.clienteId !== null ? id(body.clienteId, 'el cliente') : Number(account.cliente_id);
  const customer = (await client.query('SELECT * FROM clientes WHERE id=$1 AND activo FOR UPDATE', [customerId])).rows[0];
  if (!customer) fail('Selecciona un cliente activo.');
  if (body.tipoComprobante !== 'B02' && !(customer.rnc || '').trim()) {
    fail('Este comprobante requiere un cliente con RNC o cédula.');
  }

  const hasPct = body.descuentoPorcentaje !== undefined && body.descuentoPorcentaje !== null;
  const hasAmt = body.descuentoMonto !== undefined && body.descuentoMonto !== null;
  if (hasPct && hasAmt) fail('Indica el descuento en porcentaje o en monto, no ambos.');
  const discountBps = hasPct ? cents(body.descuentoPorcentaje, 'el porcentaje de descuento') : 0n;
  if (discountBps > 10000n) fail('El descuento no puede superar el 100 %.');
  const discountAmount = hasAmt ? cents(body.descuentoMonto, 'el monto de descuento') : null;
  const requestedDue = validOptionalDate(body.vencimiento, 'la fecha de vencimiento');
  if (body.condicion === 'Contado' && requestedDue !== null) fail('Solo las ventas a crédito admiten fecha de vencimiento.');

  const rawItems = (await client.query(
    'SELECT * FROM cuentas_taller_items WHERE cuenta_id=$1 ORDER BY id FOR UPDATE',
    [accountId],
  )).rows;
  const billable = rawItems
    .map(item => ({
      item,
      netQty: quantityUnits(item.cantidad, 'la cantidad', 0.01) - quantityUnits(item.cantidad_devuelta, 'la cantidad devuelta'),
    }))
    .filter(entry => entry.netQty > 0n);
  if (!billable.length) {
    fail('Esta cuenta no tiene artículos pendientes por cobrar. Puedes cancelarla.', 409);
  }

  const config = (await client.query('SELECT tasa_itbis,version FROM configuracion WHERE id=1 FOR SHARE')).rows[0];
  if (body.versionConfiguracion !== undefined && id(body.versionConfiguracion) !== Number(config.version)) {
    fail('La configuración cambió. Actualiza antes de cobrar.', 409);
  }
  const rate = BigInt(config.tasa_itbis.replace('.', ''));

  const lines = billable.map(({ item, netQty }) => {
    const price = costUnits(item.precio, 'el precio');
    const taxable = Boolean(item.gravado);
    return { item, netQty, price, taxable, ...saleLineAmounts(price, netQty, taxable ? rate : 0n) };
  });

  let totals;
  try {
    totals = saleDocumentTotals(lines, discountBps, rate, discountAmount);
  } catch (error) {
    if (error instanceof RangeError) fail(error.message);
    throw error;
  }

  if (body.condicion === 'Credito') {
    if (customer.es_contado || customer.limite_credito === null) {
      fail('Configura el límite de crédito de este cliente antes de pasar la cuenta a crédito.');
    }
    const debt = (await client.query(`SELECT (c.saldo_apertura
      + COALESCE((SELECT sum(v.total) FROM ventas v WHERE v.cliente_id=c.id AND v.condicion='Credito' AND v.estado='activa'),0)
      - COALESCE((SELECT sum(a.monto) FROM abonos_cuentas a JOIN ventas v ON v.id=a.venta_id WHERE v.cliente_id=c.id AND v.condicion='Credito' AND v.estado='activa'),0)
    )::text AS deuda FROM clientes c WHERE c.id=$1`, [customer.id])).rows[0].deuda;
    const debtCents = debt.startsWith('-') ? -cents(debt.slice(1)) : cents(debt);
    if (debtCents + totals.total > cents(customer.limite_credito)) {
      fail('La venta supera el crédito disponible del cliente.', 409);
    }
  }

  const saleDate = (await client.query(
    "SELECT (COALESCE($1::timestamptz,clock_timestamp()) AT TIME ZONE 'America/Santo_Domingo')::date::text AS d",
    [occurredAt ?? null],
  )).rows[0].d;
  const dueDate = body.condicion === 'Credito' ? (requestedDue ?? addDaysIso(saleDate, 30)) : null;
  if (dueDate && dueDate < saleDate) fail('La fecha de vencimiento no puede ser anterior a la fecha de la factura.');

  const ncf = allowNcf && !occurredAt ? await nextNcfIfActive(client, body.tipoComprobante, saleDate) : null;
  const billedName = Number(customer.id) === Number(account.cliente_id) && customer.es_contado && (account.cliente_nombre || '').trim()
    ? account.cliente_nombre
    : customer.nombre;
  const header = (await client.query(
    `INSERT INTO ventas(cliente_id,cliente_nombre,cliente_rnc,condicion,tipo_comprobante,ncf,descuento_porcentaje,descuento,base,itbis,total,caja_id,metodo_pago,vencimiento,creado_en,fecha)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15::timestamptz,clock_timestamp()),$16::date) RETURNING id`,
    [
      customer.id, billedName, customer.rnc, body.condicion, body.tipoComprobante, ncf,
      money(totals.discountBps), money(totals.discount), money(totals.base), money(totals.tax), money(totals.total),
      turn.id, body.metodoPago, dueDate, occurredAt ?? null, saleDate,
    ],
  )).rows[0];
  const saleId = Number(header.id);

  // El inventario ya se descontó en cada despacho; solo se generan las líneas de la factura.
  const missingCostIds = [...new Set(
    lines
      .filter(({ item }) => item.costo_unitario === null || item.costo_unitario === undefined)
      .map(({ item }) => Number(item.producto_id)),
  )];
  const fallbackCosts = missingCostIds.length
    ? new Map((await client.query('SELECT id, costo FROM productos WHERE id=ANY($1::bigint[])', [missingCostIds])).rows.map(r => [Number(r.id), r.costo]))
    : new Map();
  for (const line of lines) {
    const { item, netQty } = line;
    const rawCost = item.costo_unitario ?? fallbackCosts.get(Number(item.producto_id)) ?? null;
    const unitCost = rawCost === null || rawCost === undefined ? null : decimalUnits(costUnits(rawCost, 'el costo'), 4);
    await client.query(
      `INSERT INTO venta_detalles(venta_id,producto_id,codigo,nombre,cantidad,nivel_precio,precio,costo_unitario,base,itbis,total)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        saleId, item.producto_id, item.codigo, item.nombre, quantityText(netQty),
        item.nivel_precio, decimalUnits(line.price, 4), unitCost, money(line.base), money(line.tax), money(line.total),
      ],
    );
  }

  await client.query(
    `UPDATE cuentas_taller SET cliente_id=$2, cliente_nombre=$3, estado='facturada', venta_id=$4,
      cerrada_en=COALESCE($5::timestamptz,clock_timestamp()), version=version+1 WHERE id=$1`,
    [accountId, customer.id, billedName, saleId, occurredAt ?? null],
  );
  await client.query('UPDATE turnos_caja SET version=version+1 WHERE id=$1', [turn.id]);
  return { id: accountId, ventaId: saleId };
}

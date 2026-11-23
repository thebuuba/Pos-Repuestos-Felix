import { createHash, randomUUID } from 'node:crypto';
import { saleDocumentTotals, saleLineAmounts } from '../domain/sale-pricing.js';
import { validateState } from './legacy-state.js';
import { OperationError, fail, text, productCode, id, money, cents, quantityUnits, costUnits, decimalUnits } from './operation-fields.js';
import { contactOperation, settingsOperation } from './contact-operations.js';
import { backupLayout, exportBackup, rows, tables } from './relational-backup.js';
import { cashOperation, cashPresentation, lockCash, validateCashRestore } from './cash-operations.js';
import { accountPayment, addDaysIso, ncfSequenceOperation, nextNcfIfActive, voidSale } from './account-operations.js';
export { fail } from './operation-fields.js';

export const maintenanceLock = 74198232;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function prices(body, cost = costUnits(body.costo, 'el costo')) {
  return [decimalUnits(cost, 4), ...['precio1', 'precio2', 'precio3'].map(key => decimalUnits(costUnits(body[key], key), 4))];
}
const exactPrices = row => ({ p1: row.precio1, p2: row.precio2, p3: row.precio3 });
const quantityText = value => decimalUnits(value, 2);
const lineCents = (price, quantity, divisor) => (price * quantity + divisor / 2n) / divisor;
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const number = value => {
  const result = Number(value);
  if (!Number.isFinite(result) || (typeof value === 'string' && /^\d+$/.test(value) && !Number.isSafeInteger(result))) fail('Identificador fuera del límite admitido.', 503);
  return result;
};
const date = value => String(value).slice(0, 10);
const displayDate = value => { const [year, month, day] = date(value).split('-'); return `${Number(day)}/${Number(month)}/${year}`; };
const iso = value => value instanceof Date ? value.toISOString() : value;
// The operational catalogue does not use audit timestamps; backups retain them.
const productColumns = tables.productos.filter(key => !['creado_en', 'actualizado_en'].includes(key)).join(',');

function validOptionalDate(value, label) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value + 'T00:00:00Z')) ||
      new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) {
    fail(`Revisa ${label}.`);
  }
  return value;
}

function itemsByDocument(details, key, present) {
  const grouped = new Map();
  for (const detail of details) {
    const docId = detail[key];
    if (!grouped.has(docId)) grouped.set(docId, []);
    grouped.get(docId).push(present(detail));
  }
  return grouped;
}
const lineFields = d => ({ id: number(d.id), productoId: number(d.producto_id), codigo: d.codigo,
  nombre: d.nombre, cant: Number(d.cantidad), subtotal: Number(d.total) });

export async function snapshotVersion(client, databaseLabel) {
  const system = (await client.query('SELECT database_id,revision FROM pos_privado.sistema WHERE id=1')).rows[0];
  if (!system) fail('Ejecuta las migraciones de la base antes de iniciar.', 503);
  return { databaseId: system.database_id, revision: number(system.revision), databaseLabel };
}
export async function snapshot(client, databaseLabel) {
  const version = await snapshotVersion(client, databaseLabel);
  const data = {};
  for (const table of Object.keys(tables)) data[table] = table === 'productos'
    ? (await client.query(`SELECT ${productColumns} FROM public.productos WHERE activo ORDER BY id`)).rows
    : await rows(client, table);
  const config = data.configuracion[0];
  if (!config) fail('La configuración de la base está incompleta.', 503);
  const saleItems = itemsByDocument(data.venta_detalles, 'venta_id', d => ({ ...lineFields(d), precio: Number(d.precio), precioExacto: d.precio, base: Number(d.base), itbis: Number(d.itbis) }));
  const purchaseItems = itemsByDocument(data.compra_detalles, 'compra_id', d => ({ ...lineFields(d), costo: Number(d.costo),
    costoExacto: d.costo, preciosExactos: exactPrices(d), p1: Number(d.precio1), p2: Number(d.precio2), p3: Number(d.precio3) }));
  const altCodes = new Map();
  for (const row of data.productos_codigos) {
    const list = altCodes.get(row.producto_id) ?? [];
    list.push(row.codigo);
    altCodes.set(row.producto_id, list);
  }
  const paidBySale = new Map();
  const paidByPurchase = new Map();
  for (const payment of data.abonos_cuentas) {
    const amountCents = cents(payment.monto);
    if (payment.venta_id !== null) paidBySale.set(payment.venta_id, (paidBySale.get(payment.venta_id) ?? 0n) + amountCents);
    if (payment.compra_id !== null) paidByPurchase.set(payment.compra_id, (paidByPurchase.get(payment.compra_id) ?? 0n) + amountCents);
  }
  const balances = new Map((await client.query(`SELECT c.id,(c.saldo_apertura
      + COALESCE((SELECT sum(v.total) FROM ventas v WHERE v.cliente_id=c.id AND v.condicion='Credito' AND v.estado='activa'),0)
      - COALESCE((SELECT sum(a.monto) FROM abonos_cuentas a JOIN ventas v ON v.id=a.venta_id WHERE v.cliente_id=c.id AND v.condicion='Credito' AND v.estado='activa'),0)
    )::text AS deuda FROM clientes c`)).rows.map(row => [row.id, Number(row.deuda)]));
  const supplierBalances = new Map((await client.query(`SELECT s.id,(
      COALESCE((SELECT sum(c.total) FROM compras c WHERE c.suplidor_id=s.id AND c.condicion='Credito'),0)
      - COALESCE((SELECT sum(a.monto) FROM abonos_cuentas a JOIN compras c ON c.id=a.compra_id WHERE c.suplidor_id=s.id AND c.condicion='Credito'),0)
    )::text AS deuda FROM suplidores s`)).rows.map(row => [row.id, Number(row.deuda)]));
  return {
    ...version,
    state: {
      caja: cashPresentation(data),
      catalogo: (await client.query('SELECT pos_privado.netpos_opciones() AS opciones')).rows[0].opciones,
      empresa: config.empresa, itbisRate: Number(config.tasa_itbis), configuracionVersion: number(config.version),
      configuracion: { version: number(config.version), empresa: config.empresa, rnc: config.rnc, tel: config.tel,
        correo: config.correo, direccion: config.direccion, itbisPorcentaje: Number((Number(config.tasa_itbis) * 100).toFixed(4)),
        redondeo: config.redondeo, nivelPrecioPredeterminado: config.nivel_precio_predeterminado, formatoImpresion: config.formato_impresion,
        pieTicket: config.pie_ticket, permitirStockNegativo: config.permitir_stock_negativo,
        metaDiaria: config.meta_diaria === null ? null : Number(config.meta_diaria) },
      secuenciasNcf: data.secuencias_ncf.map(s => ({ id: number(s.id), tipo: s.tipo, prefijo: s.prefijo,
        inicio: number(s.inicio), fin: number(s.fin), actual: number(s.actual), vencimiento: date(s.vencimiento),
        activa: s.activa, version: number(s.version) })),
      formulas: data.formulas_precios.filter(f => f.activo).map(f => ({ id: number(f.id), version: number(f.version), nombre: f.nombre,
        factorCosto: Number(f.factor_costo), recargo1: Number(f.recargo1), recargo2: Number(f.recargo2), recargo3: Number(f.recargo3) })),
      productos: data.productos.map(p => ({ id: number(p.id), version: number(p.version), codigo: p.codigo,
        codigosAlternativos: altCodes.get(p.id) ?? [], nombre: p.nombre,
        marca: p.marca, categoria: p.categoria, ubicacion: p.ubicacion, gravado: p.gravado, activo: p.activo,
        stock: Number(p.stock), stockMinimo: Number(p.stock_minimo),
        notificarMinimo: p.notificar_minimo, costo: Number(p.costo), costoExacto: p.costo,
        preciosExactos: exactPrices(p), precio1: Number(p.precio1), precio2: Number(p.precio2), precio3: Number(p.precio3) })),
      clientes: data.clientes.filter(c => c.activo).map(c => ({ id: number(c.id), version: number(c.version), nombre: c.nombre, rnc: c.rnc, tel: c.tel,
        correo: c.correo, direccion: c.direccion, limiteCredito: c.limite_credito === null ? null : Number(c.limite_credito),
        esContado: c.es_contado, deuda: balances.get(c.id) })),
      suplidores: data.suplidores.filter(s => s.activo).map(s => ({ id: number(s.id), version: number(s.version), nombre: s.nombre, rnc: s.rnc, tel: s.tel,
        correo: s.correo, contacto: s.contacto, diasCredito: s.dias_credito, formulaId: s.formula_id === null ? null : number(s.formula_id),
        deuda: supplierBalances.get(s.id) ?? 0 })),
      facturas: data.ventas.map(v => ({ id: number(v.id), version: number(v.version), cajaId: v.caja_id === null ? null : number(v.caja_id),
        metodoPago: v.metodo_pago, clienteId: number(v.cliente_id), cliente: v.cliente_nombre, clienteRnc: v.cliente_rnc,
        ncf: v.ncf, tipoComprobante: v.tipo_comprobante, fecha: displayDate(v.fecha), fechaISO: date(v.fecha),
        vencimiento: v.vencimiento ? date(v.vencimiento) : null, condicion: v.condicion,
        descuentoPorcentaje: Number(v.descuento_porcentaje), descuento: Number(v.descuento),
        base: Number(v.base), itbis: Number(v.itbis), total: Number(v.total),
        pagado: Number(money(paidBySale.get(v.id) ?? 0n)),
        estado: v.estado, anuladaEn: v.anulada_en ? iso(v.anulada_en) : null, anuladaPor: v.anulada_por, motivoAnulacion: v.motivo_anulacion,
        items: saleItems.get(v.id) ?? [] })),
      compras: data.compras.map(c => ({ id: number(c.id), version: number(c.version), suplidorId: number(c.suplidor_id),
        suplidor: c.suplidor_nombre, numero: c.numero, fecha: displayDate(c.fecha), fechaISO: date(c.fecha),
        condicion: c.condicion, vencimiento: c.vencimiento ? date(c.vencimiento) : null,
        total: Number(c.total), pagado: Number(money(paidByPurchase.get(c.id) ?? 0n)),
        items: purchaseItems.get(c.id) ?? [] })),
      abonos: data.abonos_cuentas.map(a => ({ id: number(a.id), tipo: a.tipo,
        ventaId: a.venta_id === null ? null : number(a.venta_id),
        compraId: a.compra_id === null ? null : number(a.compra_id),
        cajaId: a.caja_id === null ? null : number(a.caja_id),
        metodoPago: a.metodo_pago, monto: Number(a.monto), referencia: a.referencia, nota: a.nota,
        usuario: a.usuario, creadoEn: iso(a.creado_en) })),
      movimientos: data.movimientos_inventario.map(m => ({ ...m, id: number(m.id), productoId: number(m.producto_id),
        cantidad: Number(m.cantidad), existencia_posterior: Number(m.existencia_posterior) })),
    },
  };
}
async function rollbackFailure(client) {
  try { await client.query('ROLLBACK'); }
  catch (error) { return error; }
}
export async function readSnapshot(pool, databaseLabel, backup = false, matchesVersion) {
  const client = await pool.connect();
  let discardReason;
  try {
    if (!backup && matchesVersion) {
      let version;
      try { version = await snapshotVersion(client, databaseLabel); }
      catch (error) { discardReason = error; throw error; }
      if (matchesVersion(version)) return { notModified: version };
    }
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query('SELECT pg_advisory_xact_lock_shared($1)', [maintenanceLock]);
      const result = backup ? await exportBackup(client) : await snapshot(client, databaseLabel);
      await client.query('COMMIT'); return result;
    } catch (error) { discardReason = await rollbackFailure(client); throw error; }
  } finally { client.release(discardReason); }
}
async function movement(client, productId, quantity, stock, type, detailId = null, reason = '', occurredAt = null) {
  if (!quantity) return;
  await client.query(`INSERT INTO movimientos_inventario(producto_id,cantidad,existencia_posterior,tipo,venta_detalle_id,compra_detalle_id,motivo,creado_en)
    VALUES($1,$2,$3,$4,$5,$6,$7,COALESCE($8::timestamptz,clock_timestamp()))`, [productId, quantityText(quantity), quantityText(stock), type, type === 'venta' ? detailId : null, type === 'compra' ? detailId : null, reason, occurredAt]);
}
function parseAltCodes(raw, mainCode) {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length > 20) fail('Los códigos alternativos deben ser una lista de hasta 20 códigos.');
  const seen = new Set();
  const list = [];
  const mainLower = mainCode.toLowerCase();
  for (const item of raw) {
    const code = productCode(item);
    const key = code.toLowerCase();
    if (key === mainLower) fail('Un código alternativo no puede ser igual al código principal.');
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(code);
  }
  return list;
}
async function productOperation(client, method, productId, body, occurredAt) {
  let code, stock, amounts, altCodes;
  if (method !== 'DELETE') {
    code = productCode(body.codigo);
    altCodes = parseAltCodes(body.codigosAlternativos, code);
    stock = quantityUnits(body.stock, 'las existencias'); amounts = prices(body);
    const oldCode = productId ? (await client.query('SELECT codigo FROM productos WHERE id=$1', [productId])).rows[0]?.codigo : null;
    const oldAlts = productId ? (await client.query('SELECT codigo FROM productos_codigos WHERE producto_id=$1', [productId])).rows.map(r => r.codigo) : [];
    const locks = [...new Set([code, oldCode, ...(altCodes ?? []), ...oldAlts].filter(Boolean).map(c => c.toLowerCase()))].sort();
    for (const lockCode of locks) {
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['producto:' + lockCode]);
    }
  }
  let previous;
  if (productId) {
    previous = (await client.query('SELECT * FROM productos WHERE id=$1 FOR UPDATE', [productId])).rows[0];
    if (!previous || !previous.activo || number(previous.version) !== id(body.version, 'la versión')) fail('El producto cambió. Actualiza los datos antes de editar.', 409);
  }
  if (method === 'DELETE') {
    await client.query('DELETE FROM productos_codigos WHERE producto_id=$1', [productId]);
    await client.query('UPDATE productos SET activo=false,version=version+1,actualizado_en=now() WHERE id=$1', [productId]);
    return { id: productId };
  }
  const clashWithAlt = (await client.query(
    'SELECT 1 FROM productos_codigos WHERE lower(codigo)=lower($1) AND ($2::bigint IS NULL OR producto_id<>$2) LIMIT 1',
    [code, productId],
  )).rowCount;
  if (clashWithAlt) fail('Ese código ya está asignado como código alternativo de otro artículo.', 409);
  if (altCodes?.length) {
    const lowers = altCodes.map(c => c.toLowerCase());
    const clashProduct = (await client.query(
      'SELECT 1 FROM productos WHERE lower(codigo)=ANY($1::text[]) AND ($2::bigint IS NULL OR id<>$2) LIMIT 1',
      [lowers, productId],
    )).rowCount;
    if (clashProduct) fail('Uno de los códigos alternativos ya pertenece al código principal de otro artículo.', 409);
    const clashOtherAlt = (await client.query(
      'SELECT 1 FROM productos_codigos WHERE lower(codigo)=ANY($1::text[]) AND ($2::bigint IS NULL OR producto_id<>$2) LIMIT 1',
      [lowers, productId],
    )).rowCount;
    if (clashOtherAlt) fail('Uno de los códigos alternativos ya pertenece a otro artículo.', 409);
  }
  const attribute = (key, column, fallback) => body[key] === undefined ? previous?.[column] ?? fallback : body[key];
  const attributeText = (key, label = key, required = false) => {
    const value = required ? body[key] : attribute(key, key, '');
    const trimmed = text(value, label, required);
    return value === previous?.[key] ? value : trimmed;
  };
  const name = attributeText('nombre', 'la descripción', true);
  const metadata = ['marca', 'categoria'].map(key => attributeText(key));
  metadata.push(quantityText(quantityUnits(attribute('stockMinimo', 'stock_minimo', 0), 'la existencia mínima')));
  const taxable = attribute('gravado', 'gravado', true);
  const notify = attribute('notificarMinimo', 'notificar_minimo', true);
  if (typeof taxable !== 'boolean') fail('La gravabilidad debe ser booleana.');
  if (typeof notify !== 'boolean') fail('La notificación de mínimo debe ser booleana.');
  metadata.push(taxable, attributeText('ubicacion', 'la ubicación'), notify);
  // Code locks precede row locks, matching purchases and protecting new codes.
  const result = productId
    ? await client.query(`UPDATE productos SET codigo=$2,nombre=$3,costo=$4,precio1=$5,precio2=$6,precio3=$7,stock=$8,marca=$9,categoria=$10,stock_minimo=$11,gravado=$12,ubicacion=$13,notificar_minimo=$14,version=version+1,actualizado_en=now() WHERE id=$1 RETURNING id`, [productId, code, name, ...amounts, quantityText(stock), ...metadata])
    : await client.query(`INSERT INTO productos(codigo,nombre,costo,precio1,precio2,precio3,stock,marca,categoria,stock_minimo,gravado,ubicacion,notificar_minimo) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`, [code, name, ...amounts, quantityText(stock), ...metadata]);
  const savedId = number(result.rows[0].id);
  if (altCodes !== undefined) {
    const existing = (await client.query('SELECT id,codigo FROM productos_codigos WHERE producto_id=$1 ORDER BY id', [savedId])).rows;
    const nextByLower = new Map(altCodes.map(c => [c.toLowerCase(), c]));
    for (const row of existing) {
      if (nextByLower.get(row.codigo.toLowerCase()) !== row.codigo) {
        await client.query('DELETE FROM productos_codigos WHERE id=$1', [row.id]);
      } else {
        nextByLower.delete(row.codigo.toLowerCase());
      }
    }
    for (const c of altCodes) {
      if (nextByLower.has(c.toLowerCase())) {
        await client.query('INSERT INTO productos_codigos(producto_id,codigo,creado_en) VALUES($1,$2,COALESCE($3::timestamptz,clock_timestamp()))', [savedId, c, occurredAt ?? null]);
      }
    }
  }
  await movement(client, savedId, stock - quantityUnits(previous?.stock ?? 0, 'las existencias'), stock, previous ? 'ajuste' : 'apertura', null, previous ? 'Ajuste desde catálogo' : 'Existencia inicial', occurredAt);
  return { id: savedId };
}
async function sale(client, body, occurredAt, allowNcf = true) {
  const turn = await lockCash(client, body.cajaId);
  if (body.condicion === 'Credito' ? body.metodoPago !== 'credito' : !['efectivo','tarjeta','transferencia'].includes(body.metodoPago)) fail('Selecciona un método de pago válido para la venta.');
  const customer = (await client.query('SELECT * FROM clientes WHERE id=$1 AND activo FOR UPDATE', [id(body.clienteId)])).rows[0];
  if (!customer) fail('Selecciona un cliente activo.');
  if (!['Contado', 'Credito'].includes(body.condicion) || !['B01', 'B02', 'B14'].includes(body.tipoComprobante)) fail('Condición o tipo de comprobante inválido.');
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 1000) fail('La venta debe tener entre 1 y 1000 líneas.');
  const hasPct = body.descuentoPorcentaje !== undefined && body.descuentoPorcentaje !== null;
  const hasAmt = body.descuentoMonto !== undefined && body.descuentoMonto !== null;
  if (hasPct && hasAmt) fail('Indica el descuento en porcentaje o en monto, no ambos.');
  const discountBps = hasPct ? cents(body.descuentoPorcentaje, 'el porcentaje de descuento') : 0n;
  if (discountBps > 10000n) fail('El descuento no puede superar el 100 %.');
  const discountAmount = hasAmt ? cents(body.descuentoMonto, 'el monto de descuento') : null;
  const requestedDue = validOptionalDate(body.vencimiento, 'la fecha de vencimiento');
  if (body.condicion === 'Contado' && requestedDue !== null) fail('Solo las ventas a crédito admiten fecha de vencimiento.');
  const quantities = new Map();
  const items = body.items.map(item => {
    id(item.productoId);
    const quantity = quantityUnits(item.cantidad, 'la cantidad', 0.01);
    if (!['precio1', 'precio2', 'precio3'].includes(item.nivelPrecio)) fail('Nivel de precio inválido.');
    const total = (quantities.get(item.productoId) ?? 0n) + quantity;
    quantities.set(item.productoId, quantityUnits(quantityText(total), 'la cantidad total'));
    return { ...item, quantity };
  });
  const products = new Map((await client.query('SELECT * FROM productos WHERE id=ANY($1::bigint[]) ORDER BY id FOR UPDATE',
    [[...quantities.keys()]])).rows.map(p => [number(p.id), { ...p, stock: quantityUnits(p.stock, 'las existencias') }]));
  for (const [productId, quantity] of quantities) {
    const p = products.get(productId);
    if (!p?.activo || p.stock < quantity) fail('Producto no disponible o existencias insuficientes. Actualiza el carrito.', 409);
  }
  const config = (await client.query('SELECT tasa_itbis,version FROM configuracion WHERE id=1 FOR SHARE')).rows[0];
  if (body.versionConfiguracion !== undefined && id(body.versionConfiguracion) !== number(config.version)) fail('La configuración cambió. Actualiza la venta.', 409);
  const rate = BigInt(config.tasa_itbis.replace('.', ''));
  const lines = items.map(item => {
    const p = products.get(item.productoId);
    if (item.versionProducto !== undefined && id(item.versionProducto) !== number(p.version)) fail('El artículo cambió. Actualiza el carrito para confirmar su precio y existencia.', 409);
    const price = costUnits(p[item.nivelPrecio], 'el precio');
    return { item, p, price, taxable: p.gravado, ...saleLineAmounts(price, item.quantity, p.gravado ? rate : 0n) };
  });
  let totals;
  try {
    totals = saleDocumentTotals(lines, discountBps, rate, discountAmount);
  } catch (error) {
    if (error instanceof RangeError) fail(error.message);
    throw error;
  }
  if (body.condicion === 'Credito') {
    if (customer.es_contado || customer.limite_credito === null) fail('Configura el límite de crédito de este cliente antes de vender a crédito.');
    const debt = (await client.query(`SELECT (c.saldo_apertura
      + COALESCE((SELECT sum(v.total) FROM ventas v WHERE v.cliente_id=c.id AND v.condicion='Credito' AND v.estado='activa'),0)
      - COALESCE((SELECT sum(a.monto) FROM abonos_cuentas a JOIN ventas v ON v.id=a.venta_id WHERE v.cliente_id=c.id AND v.condicion='Credito' AND v.estado='activa'),0)
    )::text AS deuda FROM clientes c WHERE c.id=$1`, [customer.id])).rows[0].deuda;
    const debtCents = debt.startsWith('-') ? -cents(debt.slice(1)) : cents(debt);
    if (debtCents + totals.total > cents(customer.limite_credito)) fail('La venta supera el crédito disponible del cliente.', 409);
  }
  const saleDate = (await client.query("SELECT (COALESCE($1::timestamptz,clock_timestamp()) AT TIME ZONE 'America/Santo_Domingo')::date::text AS d", [occurredAt ?? null])).rows[0].d;
  const dueDate = body.condicion === 'Credito' ? (requestedDue ?? addDaysIso(saleDate, 30)) : null;
  if (dueDate && dueDate < saleDate) fail('La fecha de vencimiento no puede ser anterior a la fecha de la factura.');
  const ncf = allowNcf && !occurredAt ? await nextNcfIfActive(client, body.tipoComprobante, saleDate) : null;
  const header = (await client.query(`INSERT INTO ventas(cliente_id,cliente_nombre,cliente_rnc,condicion,tipo_comprobante,ncf,descuento_porcentaje,descuento,base,itbis,total,caja_id,metodo_pago,vencimiento,creado_en,fecha)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15::timestamptz,clock_timestamp()),$16::date) RETURNING id`,
    [customer.id, customer.nombre, customer.rnc, body.condicion, body.tipoComprobante, ncf, money(totals.discountBps), money(totals.discount), money(totals.base), money(totals.tax), money(totals.total), turn.id, body.metodoPago, dueDate, occurredAt ?? null, saleDate])).rows[0];
  for (const line of lines) {
    const { item, p } = line;
    const detail = (await client.query(`INSERT INTO venta_detalles(venta_id,producto_id,codigo,nombre,cantidad,nivel_precio,precio,base,itbis,total)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [header.id, p.id, p.codigo, p.nombre, quantityText(item.quantity), item.nivelPrecio, decimalUnits(line.price, 4), money(line.base), money(line.tax), money(line.total)])).rows[0];
    p.stock -= item.quantity;
    await client.query('UPDATE productos SET stock=$2,version=version+1,actualizado_en=now() WHERE id=$1', [p.id, quantityText(p.stock)]);
    await movement(client, p.id, -item.quantity, p.stock, 'venta', detail.id, '', occurredAt);
  }
  await client.query('UPDATE turnos_caja SET version=version+1 WHERE id=$1', [turn.id]);
  return { id: number(header.id) };
}
async function purchase(client, body, occurredAt) {
  const supplier = (await client.query('SELECT * FROM suplidores WHERE id=$1 AND activo FOR SHARE', [id(body.suplidorId)])).rows[0];
  if (!supplier) fail('Selecciona un suplidor activo.');
  const invoice = text(body.numero, 'la factura del suplidor');
  const condition = body.condicion ?? 'Contado';
  if (!['Contado', 'Credito'].includes(condition)) fail('Condición de compra inválida.');
  const requestedDue = validOptionalDate(body.vencimiento, 'la fecha de vencimiento');
  if (condition === 'Contado' && requestedDue !== null) fail('Solo las compras a crédito admiten fecha de vencimiento.');
  if (!Array.isArray(body.items) || !body.items.length || body.items.length > 1000) fail('La compra debe tener entre 1 y 1000 líneas.');
  const lines = body.items.map(item => {
    const quantity = quantityUnits(item.cantidad, 'la cantidad', 0.01);
    const cost = costUnits(item.costo, 'el costo');
    let expected;
    if (Object.hasOwn(item, 'productoId') || Object.hasOwn(item, 'versionProducto')) {
      expected = item.productoId === null && item.versionProducto === null ? null :
        { id: id(item.productoId, 'el artículo'), version: id(item.versionProducto, 'la versión del artículo') };
    }
    return { code: productCode(item.codigo), name: text(item.nombre, 'la descripción'),
      expected, quantity, amounts: prices(item, cost), total: lineCents(cost, quantity, 10000n) };
  });
  const codes = [...new Set(lines.map(line => line.code))].sort();
  for (const code of codes) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['producto:' + code.toLowerCase()]);
  // Lock existing products by id (same order as sales and catalog edits).
  const products = (await client.query('SELECT id,version,activo,codigo,stock FROM productos WHERE codigo=ANY($1::text[]) ORDER BY id FOR UPDATE', [codes])).rows;
  const byCode = new Map(products.map(product => [product.codigo, product]));
  const stocks = new Map(products.map(p => [p.codigo, quantityUnits(p.stock, 'las existencias')]));
  for (const line of lines) {
    const product = byCode.get(line.code);
    if (line.expected === null && product && !product.activo)
      fail(`El código «${line.code}» pertenece a un artículo inactivo. Revisa esa línea en Inventario.`, 409);
    if ((line.expected === null && product) || (line.expected &&
        (!product?.activo || number(product.id) !== line.expected.id || number(product.version) !== line.expected.version))) {
      fail(`El artículo «${line.code}» cambió. Revisa sus datos actuales antes de confirmar la compra.`, 409);
    }
    const stock = (stocks.get(line.code) ?? 0n) + line.quantity;
    stocks.set(line.code, quantityUnits(quantityText(stock), 'las existencias'));
  }
  const purchaseDate = (await client.query("SELECT (COALESCE($1::timestamptz,clock_timestamp()) AT TIME ZONE 'America/Santo_Domingo')::date::text AS d", [occurredAt ?? null])).rows[0].d;
  const dueDate = condition === 'Credito' ? (requestedDue ?? addDaysIso(purchaseDate, supplier.dias_credito ?? 30)) : null;
  if (dueDate && dueDate < purchaseDate) fail('La fecha de vencimiento no puede ser anterior a la fecha de compra.');
  const total = lines.reduce((sum, line) => sum + line.total, 0n);
  const header = (await client.query(`INSERT INTO compras(suplidor_id,suplidor_nombre,numero,fecha,total,condicion,vencimiento,creado_en)
    VALUES($1,$2,$3,$4::date,$5,$6,$7,COALESCE($8::timestamptz,clock_timestamp())) RETURNING id`,
    [supplier.id, supplier.nombre, invoice, purchaseDate, money(total), condition, dueDate, occurredAt ?? null])).rows[0];
  for (const line of lines) {
    const product = (await client.query(`INSERT INTO productos(codigo,nombre,costo,precio1,precio2,precio3,stock)
      VALUES($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (codigo) DO UPDATE SET nombre=EXCLUDED.nombre,costo=EXCLUDED.costo,precio1=EXCLUDED.precio1,precio2=EXCLUDED.precio2,precio3=EXCLUDED.precio3,
      stock=productos.stock+EXCLUDED.stock,activo=true,version=productos.version+1,actualizado_en=now() RETURNING id,stock`, [line.code, line.name, ...line.amounts, quantityText(line.quantity)])).rows[0];
    const detail = (await client.query(`INSERT INTO compra_detalles(compra_id,producto_id,codigo,nombre,cantidad,costo,precio1,precio2,precio3,total)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [header.id, product.id, line.code, line.name, quantityText(line.quantity), ...line.amounts, money(line.total)])).rows[0];
    await movement(client, product.id, line.quantity, quantityUnits(product.stock, 'las existencias'), 'compra', detail.id, '', occurredAt);
  }
  return { id: number(header.id) };
}

async function restore(client, body) {
  const current = (await client.query('SELECT revision FROM pos_privado.sistema WHERE id=1 FOR UPDATE')).rows[0];
  if (!Number.isSafeInteger(body.revision) || body.revision < 0) fail('Revisión inválida.');
  if (number(current.revision) !== body.revision) fail('La base cambió. Exporta o actualiza antes de restaurar.', 409);
  const backup = body.backup;
  if (!backup || typeof backup !== 'object' || Array.isArray(backup)) fail('Respaldo inválido.');
  let legacy, layout;
  if (Object.hasOwn(backup, 'version') || Object.hasOwn(backup, 'tables') || Object.hasOwn(backup, 'format')) layout = backupLayout(backup);
  else { try { legacy = validateState(backup); } catch (error) { fail(error.message); } }
  await client.query('INSERT INTO pos_privado.respaldos(motivo,datos) VALUES($1,$2)', ['Antes de restaurar', await exportBackup(client)]);
  for (const table of Object.keys(tables).reverse()) await client.query(`DELETE FROM public.${table}`);
  if (legacy) await client.query('SELECT pos_privado.importar_estado_legacy($1::jsonb)', [legacy]);
  else {
    for (const [table, columns] of Object.entries(layout)) {
      for (const row of backup.tables[table]) {
        await client.query(`INSERT INTO public.${table}(${columns.join(',')}) VALUES(${columns.map((_, index) => '$' + (index + 1)).join(',')})`, columns.map(key => row[key]));
      }
    }
    if (backup.version < 5 && (await client.query('SELECT 1 FROM productos GROUP BY lower(codigo) HAVING count(*) > 1 LIMIT 1')).rowCount)
      fail('El respaldo contiene códigos duplicados.', 409);
    const invalid = await client.query(`SELECT 1 FROM ventas v LEFT JOIN venta_detalles d ON d.venta_id=v.id GROUP BY v.id
      HAVING count(d.id)=0 OR v.total+v.descuento<>sum(d.total) OR v.base+v.itbis<>v.total OR (v.descuento=0 AND (v.base<>sum(d.base) OR v.itbis<>sum(d.itbis)))
      UNION ALL SELECT 1 FROM compras c LEFT JOIN compra_detalles d ON d.compra_id=c.id GROUP BY c.id HAVING count(d.id)=0 OR c.total<>sum(d.total)
      UNION ALL SELECT 1 FROM productos p LEFT JOIN LATERAL (SELECT existencia_posterior FROM movimientos_inventario m WHERE m.producto_id=p.id ORDER BY id DESC LIMIT 1) m ON true WHERE p.stock<>COALESCE(m.existencia_posterior,0)
      UNION ALL SELECT 1 FROM (SELECT cantidad,existencia_posterior,lag(existencia_posterior,1,0) OVER(PARTITION BY producto_id ORDER BY id) previa FROM movimientos_inventario) m WHERE existencia_posterior<>previa+cantidad
      UNION ALL SELECT 1 FROM movimientos_inventario m JOIN venta_detalles d ON d.id=m.venta_detalle_id WHERE m.producto_id<>d.producto_id OR m.cantidad<>-d.cantidad
      UNION ALL SELECT 1 FROM movimientos_inventario m JOIN compra_detalles d ON d.id=m.compra_detalle_id WHERE m.producto_id<>d.producto_id OR m.cantidad<>d.cantidad
      UNION ALL SELECT 1 FROM ventas v JOIN (SELECT venta_id,sum(monto) AS pagado FROM abonos_cuentas WHERE venta_id IS NOT NULL GROUP BY venta_id) a ON a.venta_id=v.id WHERE v.condicion<>'Credito' OR v.estado<>'activa' OR a.pagado>v.total
      UNION ALL SELECT 1 FROM compras c JOIN (SELECT compra_id,sum(monto) AS pagado FROM abonos_cuentas WHERE compra_id IS NOT NULL GROUP BY compra_id) a ON a.compra_id=c.id WHERE c.condicion<>'Credito' OR a.pagado>c.total
      LIMIT 1`);
    if (invalid.rowCount) fail('El respaldo contiene totales o movimientos inconsistentes.');
    await validateCashRestore(client);
    for (const table of Object.keys(tables).filter(table => table !== 'configuracion')) await client.query(`SELECT setval(pg_get_serial_sequence('public.${table}','id'),COALESCE((SELECT max(id) FROM public.${table}),1),(SELECT count(*)>0 FROM public.${table}))`);
  }
  const databaseId = randomUUID();
  if (legacy || backup.version < 4) await client.query('SELECT pos_privado.marcar_contado_historico($1::jsonb)', [legacy ? backup : null]);
  await client.query('UPDATE pos_privado.sistema SET database_id=$1 WHERE id=1', [databaseId]);
  return { id: databaseId };
}

async function execute(client, method, path, body, actor, occurredAt, context) {
  if (method === 'POST' && ['/api/caja/abrir','/api/caja/cerrar','/api/caja/movimiento'].includes(path)) return cashOperation(client, path, body, actor, occurredAt);
  const voidMatch = path.match(/^\/api\/ventas\/(\d+)\/anular$/);
  if (method === 'POST' && voidMatch) return voidSale(client, id(Number(voidMatch[1]), 'la factura'), body, actor, occurredAt);
  if (method === 'POST' && path === '/api/cuentas/cobros') return accountPayment(client, 'cobro', body, actor, occurredAt);
  if (method === 'POST' && path === '/api/cuentas/pagos') return accountPayment(client, 'pago', body, actor, occurredAt);
  if (method === 'PUT' && path === '/api/ncf') return ncfSequenceOperation(client, body);
  const productMatch = path.match(/^\/api\/productos\/(\d+)$/);
  if ((path === '/api/productos' && method === 'POST') || (productMatch && ['PUT', 'DELETE'].includes(method))) return productOperation(client, method, productMatch ? id(Number(productMatch[1])) : null, body, occurredAt);
  const contactMatch = path.match(/^\/api\/(clientes|suplidores|formulas)(?:\/(\d+))?$/);
  if (contactMatch && (contactMatch[2] ? ['PUT', 'DELETE'].includes(method) : method === 'POST'))
    return contactOperation(client, contactMatch[1], method, contactMatch[2] ? id(Number(contactMatch[2])) : null, body);
  if (method === 'PUT' && path === '/api/configuracion') return settingsOperation(client, body);
  if (method === 'POST' && path === '/api/ventas') return sale(client, body, occurredAt, context.allowNcf !== false);
  if (method === 'POST' && path === '/api/compras') return purchase(client, body, occurredAt);
  if (method === 'POST' && path === '/api/restore') return restore(client, body);
  fail('Ruta de operación no encontrada.', 404);
}
// Context is supplied only by trusted in-process callers; ordinary HTTP bodies never set it.
export async function writeOperation(pool, method, path, body, key, databaseLabel, actor = { id: 'local', name: 'Usuario local' }, context = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !uuid.test(body.databaseId) || !uuid.test(key || '')) fail('Se requiere databaseId e Idempotency-Key UUID válidos.');
  if (context.occurredAt !== undefined && (typeof context.occurredAt !== 'string' ||
      !Number.isFinite(Date.parse(context.occurredAt)) || new Date(context.occurredAt).toISOString() !== context.occurredAt)) fail('La fecha de la operación no es válida.');
  const type = context.requestType ?? method + ' ' + path;
  const fingerprint = createHash('sha256').update(canonical(context.fingerprintPayload ??
    (context.occurredAt ? { body, occurredAt: context.occurredAt } : body))).digest('hex');
  const client = await pool.connect();
  let executingNewOperation = false;
  let discardReason;
  try {
    await client.query('BEGIN');
    await client.query(`SELECT ${path === '/api/restore' ? 'pg_advisory_xact_lock' : 'pg_advisory_xact_lock_shared'}($1)`, [maintenanceLock]);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['solicitud:' + key]);
    const system = (await client.query('SELECT database_id FROM pos_privado.sistema WHERE id=1')).rows[0];
    const previous = (await client.query('SELECT tipo,huella,resultado FROM pos_privado.solicitudes WHERE clave=$1', [key])).rows[0];
    let result, metadata;
    if (previous) {
      if (previous.tipo !== type || previous.huella !== fingerprint) fail('Esta clave ya se usó para otra operación.', 409);
      // Ordinary writes hold this row through COMMIT. A replay must likewise
      // freeze committed revisions while reading the multi-table response.
      const replaySystem = (await client.query('SELECT database_id FROM pos_privado.sistema WHERE id=1 FOR SHARE')).rows[0];
      if (previous.resultado.databaseId !== replaySystem.database_id) fail('La base fue restaurada. Actualiza antes de continuar.', 409);
      result = previous.resultado.result;
      metadata = previous.resultado.metadata;
    } else {
      if (body.databaseId !== system.database_id) fail('La base cambió. Actualiza los datos antes de guardar.', 409);
      // Only this call can reject a new operation after the guarded key miss.
      executingNewOperation = true;
      await context.beforeExecute?.(client);
      result = await execute(client, method, path, body, actor, context.occurredAt, context);
      metadata = await context.afterExecute?.(client, result);
      executingNewOperation = false;
      await client.query('UPDATE pos_privado.sistema SET revision=revision+1 WHERE id=1');
      const identity = (await client.query('SELECT database_id FROM pos_privado.sistema WHERE id=1')).rows[0].database_id;
      await client.query('INSERT INTO pos_privado.solicitudes(clave,tipo,huella,resultado) VALUES($1,$2,$3,$4)', [key, type, fingerprint, { result, databaseId: identity, ...(metadata && { metadata }) }]);
    }
    let response = { ...await (context.versionOnly ? snapshotVersion(client, databaseLabel) : snapshot(client, databaseLabel)), result };
    if (context.represent) response = await context.represent(client, response, metadata, Boolean(previous));
    await client.query('COMMIT');
    return { ...response, confirmation: { operationId: key, databaseId: body.databaseId, method, path, replayed: Boolean(previous) } };
  } catch (cause) {
    discardReason = await rollbackFailure(client);
    if (['40P01', '40001'].includes(cause.code)) throw new OperationError('Otra caja está usando estos datos. Reintenta la misma operación.', 409, cause);
    let error = cause;
    if (!cause.status && ['23502', '23503', '23514', '22003', '22023', '22P02', '22007', '22008', 'P0001'].includes(cause.code)) {
      error = new OperationError('Los datos no cumplen las reglas de integridad. Revisa el formulario o respaldo.', 400, cause);
    } else if (cause.code === '23505') {
      error = new OperationError('Ya existe un registro con ese código o número de factura.', 409, cause);
    }
    if (!discardReason && executingNewOperation && error instanceof OperationError && error.status >= 400 && error.status < 500) {
      error.rejection = { operationId: key, databaseId: body.databaseId, method, path };
    }
    throw error;
  } finally { client.release(discardReason); }
}

import { createHash, randomUUID } from 'node:crypto';
import { saleDocumentTotals, saleLineAmounts } from '../domain/sale-pricing.js';
import { validateState } from './legacy-state.js';
import { OperationError, fail, text, productCode, id, money, cents, quantityUnits, costUnits, decimalUnits } from './operation-fields.js';
import { contactOperation, settingsOperation } from './contact-operations.js';
import { backupLayout, exportBackup, rows, tables } from './relational-backup.js';
import { cashOperation, cashPresentation, lockCash, validateCashRestore } from './cash-operations.js';
import { accountPayment, addDaysIso, ncfSequenceOperation, nextNcfIfActive, voidPurchase, voidSale } from './account-operations.js';
import {
  billWorkshopAccount, cancelWorkshopAccount, dispatchWorkshopItems,
  openWorkshopAccount, presentWorkshopAccount, returnWorkshopItem,
} from './workshop-operations.js';
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
const iso = value => value instanceof Date ? value.toISOString() : (typeof value === 'string' && value ? new Date(value).toISOString() : value);
const normalizeCashRows = (data) => ({
  turnos_caja: data.turnos_caja.map(r => ({ ...r, abierto_en: iso(r.abierto_en), cerrado_en: r.cerrado_en ? iso(r.cerrado_en) : null })),
  movimientos_caja: data.movimientos_caja.map(r => ({ ...r, creado_en: iso(r.creado_en) })),
  abonos_cuentas: (data.abonos_cuentas || []).map(r => ({ ...r, creado_en: iso(r.creado_en) })),
  ventas: data.ventas,
});

function presentConfig(config) {
  return {
    empresa: config.empresa,
    itbisRate: Number(config.tasa_itbis),
    configuracionVersion: number(config.version),
    configuracion: {
      version: number(config.version), empresa: config.empresa, rnc: config.rnc, tel: config.tel,
      correo: config.correo, direccion: config.direccion, itbisPorcentaje: Number((Number(config.tasa_itbis) * 100).toFixed(4)),
      redondeo: config.redondeo, nivelPrecioPredeterminado: config.nivel_precio_predeterminado, formatoImpresion: config.formato_impresion,
      pieTicket: config.pie_ticket, permitirStockNegativo: config.permitir_stock_negativo,
      metaDiaria: config.meta_diaria === null ? null : Number(config.meta_diaria),
    },
  };
}
function presentNcf(rows) {
  return rows.map(s => ({
    id: number(s.id), tipo: s.tipo, prefijo: s.prefijo, inicio: number(s.inicio), fin: number(s.fin),
    actual: number(s.actual), vencimiento: date(s.vencimiento), activa: s.activa, version: number(s.version),
  }));
}
function presentSale(v, items) {
  return {
    id: number(v.id), version: number(v.version), cajaId: v.caja_id === null ? null : number(v.caja_id),
    metodoPago: v.metodo_pago, clienteId: number(v.cliente_id), cliente: v.cliente_nombre, clienteRnc: v.cliente_rnc,
    ncf: v.ncf, tipoComprobante: v.tipo_comprobante, fecha: displayDate(v.fecha), fechaISO: date(v.fecha),
    vencimiento: v.vencimiento ? date(v.vencimiento) : null, condicion: v.condicion,
    descuentoPorcentaje: Number(v.descuento_porcentaje), descuento: Number(v.descuento),
    base: Number(v.base), itbis: Number(v.itbis), total: Number(v.total),
    pagado: Number(v.pagado ?? 0),
    estado: v.estado, anuladaEn: v.anulada_en ? iso(v.anulada_en) : null, anuladaPor: v.anulada_por, motivoAnulacion: v.motivo_anulacion,
    items,
  };
}
function presentPurchase(c, items) {
  return {
    id: number(c.id), version: number(c.version), suplidorId: number(c.suplidor_id),
    suplidor: c.suplidor_nombre, numero: c.numero, fecha: displayDate(c.fecha), fechaISO: date(c.fecha),
    condicion: c.condicion, vencimiento: c.vencimiento ? date(c.vencimiento) : null,
    total: Number(c.total), pagado: Number(c.pagado ?? 0),
    estado: c.estado ?? 'activa',
    anuladaEn: c.anulada_en ? iso(c.anulada_en) : null,
    anuladaPor: c.anulada_por ?? null,
    motivoAnulacion: c.motivo_anulacion ?? null,
    items,
  };
}
function presentAbono(a) {
  return {
    id: number(a.id), tipo: a.tipo,
    ventaId: a.venta_id === null ? null : number(a.venta_id),
    compraId: a.compra_id === null ? null : number(a.compra_id),
    cajaId: a.caja_id === null ? null : number(a.caja_id),
    metodoPago: a.metodo_pago, monto: Number(a.monto), referencia: a.referencia, nota: a.nota,
    usuario: a.usuario, creadoEn: iso(a.creado_en),
  };
}

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
export async function snapshot(client, databaseLabel, { compact = false } = {}) {
  const productExpr = compact
    ? `json_build_array(
        p.id, p.version, p.codigo, p.nombre, p.marca, p.categoria, p.ubicacion,
        CASE WHEN p.gravado THEN 1 ELSE 0 END,
        p.stock::double precision, p.stock_minimo::double precision,
        CASE WHEN p.notificar_minimo THEN 1 ELSE 0 END,
        p.costo::text, p.precio1::text, p.precio2::text, p.precio3::text, ac.codigos
      )`
    : `json_build_object(
        'id', p.id, 'version', p.version, 'codigo', p.codigo,
        'codigosAlternativos', COALESCE(ac.codigos, '[]'::json),
        'nombre', p.nombre, 'marca', p.marca, 'categoria', p.categoria, 'ubicacion', p.ubicacion,
        'gravado', p.gravado, 'activo', p.activo,
        'stock', p.stock::double precision, 'stockMinimo', p.stock_minimo::double precision,
        'notificarMinimo', p.notificar_minimo,
        'costo', p.costo::double precision, 'costoExacto', p.costo::text,
        'preciosExactos', json_build_object('p1', p.precio1::text, 'p2', p.precio2::text, 'p3', p.precio3::text),
        'precio1', p.precio1::double precision, 'precio2', p.precio2::double precision, 'precio3', p.precio3::double precision
      )`;
  const row = (await client.query(`
    WITH alt_codes AS (
      SELECT producto_id, json_agg(codigo ORDER BY id) AS codigos
      FROM public.productos_codigos GROUP BY producto_id
    ),
    sale_paid AS (
      SELECT venta_id, sum(monto) AS pagado FROM public.abonos_cuentas WHERE venta_id IS NOT NULL GROUP BY venta_id
    ),
    purchase_paid AS (
      SELECT compra_id, sum(monto) AS pagado FROM public.abonos_cuentas WHERE compra_id IS NOT NULL GROUP BY compra_id
    ),
    customer_sales AS (
      SELECT cliente_id, sum(total) AS total FROM public.ventas WHERE condicion='Credito' AND estado='activa' GROUP BY cliente_id
    ),
    customer_paid AS (
      SELECT v.cliente_id, sum(a.monto) AS pagado
      FROM public.abonos_cuentas a JOIN public.ventas v ON v.id=a.venta_id
      WHERE v.condicion='Credito' AND v.estado='activa' GROUP BY v.cliente_id
    ),
    supplier_buys AS (
      SELECT suplidor_id, sum(total) AS total FROM public.compras WHERE condicion='Credito' AND estado='activa' GROUP BY suplidor_id
    ),
    supplier_paid AS (
      SELECT c.suplidor_id, sum(a.monto) AS pagado
      FROM public.abonos_cuentas a JOIN public.compras c ON c.id=a.compra_id
      WHERE c.condicion='Credito' AND c.estado='activa' GROUP BY c.suplidor_id
    ),
    sale_lines AS (
      SELECT venta_id, json_agg(json_build_object(
        'id', id, 'productoId', producto_id, 'codigo', codigo, 'nombre', nombre,
        'cant', cantidad::double precision, 'subtotal', total::double precision,
        'precio', precio::double precision, 'precioExacto', precio::text,
        'base', base::double precision, 'itbis', itbis::double precision
      ) ORDER BY id) AS items
      FROM public.venta_detalles GROUP BY venta_id
    ),
    purchase_lines AS (
      SELECT compra_id, json_agg(json_build_object(
        'id', id, 'productoId', producto_id, 'codigo', codigo, 'nombre', nombre,
        'cant', cantidad::double precision, 'subtotal', total::double precision,
        'costo', costo::double precision, 'costoExacto', costo::text,
        'preciosExactos', json_build_object('p1', precio1::text, 'p2', precio2::text, 'p3', precio3::text),
        'p1', precio1::double precision, 'p2', precio2::double precision, 'p3', precio3::double precision
      ) ORDER BY id) AS items
      FROM public.compra_detalles GROUP BY compra_id
    ),
    workshop_lines AS (
      SELECT cuenta_id, json_agg(json_build_object(
        'id', id, 'producto_id', producto_id, 'codigo', codigo, 'nombre', nombre,
        'gravado', gravado, 'nivel_precio', nivel_precio, 'precio', precio::text,
        'cantidad', cantidad::text, 'cantidad_devuelta', cantidad_devuelta::text,
        'despachado_por', despachado_por, 'retirado_por', retirado_por, 'creado_en', creado_en
      ) ORDER BY id) AS items
      FROM public.cuentas_taller_items GROUP BY cuenta_id
    )
    SELECT json_build_object(
      'databaseId', s.database_id,
      'revision', s.revision,
      'catalogo', pos_privado.netpos_opciones(),
      'configuracion', (SELECT row_to_json(c) FROM (SELECT id,empresa,rnc,tel,correo,direccion,tasa_itbis::text AS tasa_itbis,redondeo,nivel_precio_predeterminado,formato_impresion,pie_ticket,permitir_stock_negativo,meta_diaria::text AS meta_diaria,version FROM public.configuracion ORDER BY id LIMIT 1) c),
      'secuencias_ncf', COALESCE((SELECT json_agg(n ORDER BY n.id) FROM (SELECT id,tipo,prefijo,inicio,fin,actual,vencimiento::text AS vencimiento,activa,version FROM public.secuencias_ncf) n), '[]'::json),
      'formulas', COALESCE((SELECT json_agg(json_build_object(
        'id', id, 'version', version, 'nombre', nombre,
        'factorCosto', factor_costo::double precision, 'recargo1', recargo1::double precision,
        'recargo2', recargo2::double precision, 'recargo3', recargo3::double precision
      ) ORDER BY id) FROM public.formulas_precios WHERE activo), '[]'::json),
      'productos', COALESCE((SELECT json_agg(${productExpr} ORDER BY p.id) FROM public.productos p LEFT JOIN alt_codes ac ON ac.producto_id=p.id WHERE p.activo), '[]'::json),
      'clientes', COALESCE((SELECT json_agg(json_build_object(
        'id', c.id, 'version', c.version, 'nombre', c.nombre, 'rnc', c.rnc, 'tel', c.tel,
        'correo', c.correo, 'direccion', c.direccion,
        'limiteCredito', CASE WHEN c.limite_credito IS NULL THEN NULL ELSE c.limite_credito::double precision END,
        'esContado', c.es_contado,
        'deuda', (c.saldo_apertura + COALESCE(cs.total, 0) - COALESCE(cp.pagado, 0))::double precision
      ) ORDER BY c.id) FROM public.clientes c LEFT JOIN customer_sales cs ON cs.cliente_id=c.id LEFT JOIN customer_paid cp ON cp.cliente_id=c.id WHERE c.activo), '[]'::json),
      'suplidores', COALESCE((SELECT json_agg(json_build_object(
        'id', sp.id, 'version', sp.version, 'nombre', sp.nombre, 'rnc', sp.rnc, 'tel', sp.tel,
        'correo', sp.correo, 'contacto', sp.contacto, 'diasCredito', sp.dias_credito,
        'formulaId', sp.formula_id,
        'deuda', (COALESCE(sb.total, 0) - COALESCE(spp.pagado, 0))::double precision
      ) ORDER BY sp.id) FROM public.suplidores sp LEFT JOIN supplier_buys sb ON sb.suplidor_id=sp.id LEFT JOIN supplier_paid spp ON spp.suplidor_id=sp.id WHERE sp.activo), '[]'::json),
      'ventas', COALESCE((SELECT json_agg(json_build_object(
        'id', v.id, 'version', v.version, 'caja_id', v.caja_id, 'metodo_pago', v.metodo_pago,
        'cliente_id', v.cliente_id, 'cliente_nombre', v.cliente_nombre, 'cliente_rnc', v.cliente_rnc,
        'ncf', v.ncf, 'tipo_comprobante', v.tipo_comprobante, 'fecha', v.fecha::text,
        'vencimiento', v.vencimiento::text, 'condicion', v.condicion,
        'descuento_porcentaje', v.descuento_porcentaje::text, 'descuento', v.descuento::text,
        'base', v.base::text, 'itbis', v.itbis::text, 'total', v.total::text,
        'pagado', COALESCE(sp.pagado, 0)::double precision,
        'estado', v.estado, 'anulada_en', v.anulada_en, 'anulada_por', v.anulada_por, 'motivo_anulacion', v.motivo_anulacion,
        'items', COALESCE(sl.items, '[]'::json)
      ) ORDER BY v.id) FROM public.ventas v LEFT JOIN sale_paid sp ON sp.venta_id=v.id LEFT JOIN sale_lines sl ON sl.venta_id=v.id), '[]'::json),
      'compras', COALESCE((SELECT json_agg(json_build_object(
        'id', c.id, 'version', c.version, 'suplidor_id', c.suplidor_id, 'suplidor_nombre', c.suplidor_nombre,
        'numero', c.numero, 'fecha', c.fecha::text, 'condicion', c.condicion, 'vencimiento', c.vencimiento::text,
        'total', c.total::text, 'pagado', COALESCE(pp.pagado, 0)::double precision,
        'estado', c.estado, 'anulada_en', c.anulada_en, 'anulada_por', c.anulada_por, 'motivo_anulacion', c.motivo_anulacion,
        'items', COALESCE(pl.items, '[]'::json)
      ) ORDER BY c.id) FROM public.compras c LEFT JOIN purchase_paid pp ON pp.compra_id=c.id LEFT JOIN purchase_lines pl ON pl.compra_id=c.id), '[]'::json),
      'abonos_cuentas', COALESCE((SELECT json_agg(json_build_object(
        'id', id, 'tipo', tipo, 'venta_id', venta_id, 'compra_id', compra_id, 'caja_id', caja_id,
        'metodo_pago', metodo_pago, 'monto', monto::text, 'referencia', referencia, 'nota', nota,
        'usuario', usuario, 'creado_en', creado_en
      ) ORDER BY id) FROM public.abonos_cuentas), '[]'::json),
      'turnos_caja', COALESCE((SELECT json_agg(json_build_object(
        'id', id, 'version', version, 'abierto_en', abierto_en, 'cerrado_en', cerrado_en,
        'cajero', cajero, 'fondo', fondo::text, 'esperado', esperado::text, 'contado', contado::text, 'ventas', ventas::text
      ) ORDER BY id) FROM public.turnos_caja), '[]'::json),
      'movimientos_caja', COALESCE((SELECT json_agg(json_build_object(
        'id', id, 'caja_id', caja_id, 'tipo', tipo, 'monto', monto::text, 'concepto', concepto, 'creado_en', creado_en
      ) ORDER BY id) FROM public.movimientos_caja WHERE caja_id IN (SELECT id FROM public.turnos_caja WHERE cerrado_en IS NULL)), '[]'::json),
      'movimientos', COALESCE((SELECT json_agg(json_build_object(
        'id', m.id, 'producto_id', m.producto_id, 'productoId', m.producto_id,
        'cantidad', m.cantidad::double precision, 'existencia_posterior', m.existencia_posterior::double precision,
        'tipo', m.tipo, 'venta_detalle_id', m.venta_detalle_id, 'compra_detalle_id', m.compra_detalle_id,
        'motivo', m.motivo, 'creado_en', m.creado_en
      ) ORDER BY m.id) FROM (SELECT * FROM public.movimientos_inventario ORDER BY id DESC LIMIT 100) m), '[]'::json),
      'cuentas_taller', COALESCE((SELECT json_agg(json_build_object(
        'id', ct.id, 'version', ct.version, 'cliente_id', ct.cliente_id, 'cliente_nombre', ct.cliente_nombre,
        'mecanico', ct.mecanico, 'vehiculo', ct.vehiculo, 'nota', ct.nota, 'estado', ct.estado,
        'venta_id', ct.venta_id, 'abierta_por', ct.abierta_por, 'abierta_en', ct.abierta_en,
        'cerrada_en', ct.cerrada_en, 'items', COALESCE(wl.items, '[]'::json)
      ) ORDER BY ct.id) FROM public.cuentas_taller ct LEFT JOIN workshop_lines wl ON wl.cuenta_id=ct.id), '[]'::json)
    ) AS payload
    FROM pos_privado.sistema s WHERE s.id = 1
  `)).rows[0]?.payload;
  if (!row) fail('Ejecuta las migraciones de la base antes de iniciar.', 503);
  if (!row.configuracion) fail('La configuración de la base está incompleta.', 503);
  return {
    ...(compact ? { compact: 1 } : {}),
    databaseId: row.databaseId,
    revision: number(row.revision),
    databaseLabel,
    state: {
      caja: cashPresentation(normalizeCashRows(row)),
      catalogo: row.catalogo,
      ...presentConfig(row.configuracion),
      secuenciasNcf: presentNcf(row.secuencias_ncf),
      formulas: row.formulas,
      productos: row.productos,
      clientes: row.clientes,
      suplidores: row.suplidores,
      facturas: row.ventas.map(v => presentSale(v, v.items)),
      compras: row.compras.map(c => presentPurchase(c, c.items)),
      abonos: row.abonos_cuentas.map(presentAbono),
      movimientos: row.movimientos.map(m => ({ ...m, creado_en: iso(m.creado_en) })),
      cuentasTaller: (row.cuentas_taller || []).map(a => presentWorkshopAccount(a, a.items)),
    },
  };
}

async function fetchCashSlice(client) {
  const row = (await client.query(`
    WITH active_turn AS (SELECT id FROM public.turnos_caja WHERE cerrado_en IS NULL LIMIT 1)
    SELECT json_build_object(
      'turnos_caja', COALESCE((SELECT json_agg(json_build_object(
        'id', id, 'version', version, 'abierto_en', abierto_en, 'cerrado_en', cerrado_en,
        'cajero', cajero, 'fondo', fondo::text, 'esperado', esperado::text, 'contado', contado::text, 'ventas', ventas::text
      ) ORDER BY id) FROM public.turnos_caja), '[]'::json),
      'movimientos_caja', COALESCE((SELECT json_agg(json_build_object(
        'id', id, 'caja_id', caja_id, 'tipo', tipo, 'monto', monto::text, 'concepto', concepto, 'creado_en', creado_en
      ) ORDER BY id) FROM public.movimientos_caja WHERE caja_id IN (SELECT id FROM active_turn)), '[]'::json),
      'abonos_cuentas', COALESCE((SELECT json_agg(json_build_object(
        'id', id, 'tipo', tipo, 'caja_id', caja_id, 'metodo_pago', metodo_pago, 'monto', monto::text, 'creado_en', creado_en
      ) ORDER BY id) FROM public.abonos_cuentas WHERE caja_id IN (SELECT id FROM active_turn)), '[]'::json),
      'ventas', COALESCE((SELECT json_agg(json_build_object(
        'id', id, 'caja_id', caja_id, 'metodo_pago', metodo_pago, 'total', total::text, 'estado', estado
      ) ORDER BY id) FROM public.ventas WHERE caja_id IN (SELECT id FROM active_turn)), '[]'::json)
    ) AS data
  `)).rows[0].data;
  return cashPresentation(normalizeCashRows(row));
}

async function fetchProductsSlice(client, ids) {
  if (!ids.length) return [];
  return (await client.query(`
    SELECT COALESCE(json_agg(json_build_object(
      'id', p.id, 'version', p.version, 'codigo', p.codigo,
      'codigosAlternativos', COALESCE((SELECT json_agg(pc.codigo ORDER BY pc.id) FROM public.productos_codigos pc WHERE pc.producto_id=p.id), '[]'::json),
      'nombre', p.nombre, 'marca', p.marca, 'categoria', p.categoria, 'ubicacion', p.ubicacion,
      'gravado', p.gravado, 'activo', p.activo,
      'stock', p.stock::double precision, 'stockMinimo', p.stock_minimo::double precision,
      'notificarMinimo', p.notificar_minimo,
      'costo', p.costo::double precision, 'costoExacto', p.costo::text,
      'preciosExactos', json_build_object('p1', p.precio1::text, 'p2', p.precio2::text, 'p3', p.precio3::text),
      'precio1', p.precio1::double precision, 'precio2', p.precio2::double precision, 'precio3', p.precio3::double precision
    ) ORDER BY p.id), '[]'::json) AS rows
    FROM public.productos p WHERE p.id = ANY($1::bigint[]) AND p.activo
  `, [ids])).rows[0].rows;
}

async function fetchCustomersSlice(client, ids) {
  if (!ids.length) return [];
  return (await client.query(`
    SELECT COALESCE(json_agg(json_build_object(
      'id', c.id, 'version', c.version, 'nombre', c.nombre, 'rnc', c.rnc, 'tel', c.tel,
      'correo', c.correo, 'direccion', c.direccion,
      'limiteCredito', CASE WHEN c.limite_credito IS NULL THEN NULL ELSE c.limite_credito::double precision END,
      'esContado', c.es_contado,
      'deuda', (c.saldo_apertura
        + COALESCE((SELECT sum(v.total) FROM public.ventas v WHERE v.cliente_id=c.id AND v.condicion='Credito' AND v.estado='activa'), 0)
        - COALESCE((SELECT sum(a.monto) FROM public.abonos_cuentas a JOIN public.ventas v ON v.id=a.venta_id WHERE v.cliente_id=c.id AND v.condicion='Credito' AND v.estado='activa'), 0)
      )::double precision
    ) ORDER BY c.id), '[]'::json) AS rows
    FROM public.clientes c WHERE c.id = ANY($1::bigint[]) AND c.activo
  `, [ids])).rows[0].rows;
}

async function fetchSuppliersSlice(client, ids) {
  if (!ids.length) return [];
  return (await client.query(`
    SELECT COALESCE(json_agg(json_build_object(
      'id', s.id, 'version', s.version, 'nombre', s.nombre, 'rnc', s.rnc, 'tel', s.tel,
      'correo', s.correo, 'contacto', s.contacto, 'diasCredito', s.dias_credito, 'formulaId', s.formula_id,
      'deuda', (
        COALESCE((SELECT sum(c.total) FROM public.compras c WHERE c.suplidor_id=s.id AND c.condicion='Credito' AND c.estado='activa'), 0)
        - COALESCE((SELECT sum(a.monto) FROM public.abonos_cuentas a JOIN public.compras c ON c.id=a.compra_id WHERE c.suplidor_id=s.id AND c.condicion='Credito' AND c.estado='activa'), 0)
      )::double precision
    ) ORDER BY s.id), '[]'::json) AS rows
    FROM public.suplidores s WHERE s.id = ANY($1::bigint[]) AND s.activo
  `, [ids])).rows[0].rows;
}

async function fetchSalesSlice(client, ids) {
  if (!ids.length) return [];
  const list = (await client.query(`
    SELECT COALESCE(json_agg(json_build_object(
      'id', v.id, 'version', v.version, 'caja_id', v.caja_id, 'metodo_pago', v.metodo_pago,
      'cliente_id', v.cliente_id, 'cliente_nombre', v.cliente_nombre, 'cliente_rnc', v.cliente_rnc,
      'ncf', v.ncf, 'tipo_comprobante', v.tipo_comprobante, 'fecha', v.fecha::text,
      'vencimiento', v.vencimiento::text, 'condicion', v.condicion,
      'descuento_porcentaje', v.descuento_porcentaje::text, 'descuento', v.descuento::text,
      'base', v.base::text, 'itbis', v.itbis::text, 'total', v.total::text,
      'pagado', COALESCE((SELECT sum(a.monto) FROM public.abonos_cuentas a WHERE a.venta_id=v.id), 0)::double precision,
      'estado', v.estado, 'anulada_en', v.anulada_en, 'anulada_por', v.anulada_por, 'motivo_anulacion', v.motivo_anulacion,
      'items', COALESCE((SELECT json_agg(json_build_object(
        'id', d.id, 'productoId', d.producto_id, 'codigo', d.codigo, 'nombre', d.nombre,
        'cant', d.cantidad::double precision, 'subtotal', d.total::double precision,
        'precio', d.precio::double precision, 'precioExacto', d.precio::text,
        'base', d.base::double precision, 'itbis', d.itbis::double precision
      ) ORDER BY d.id) FROM public.venta_detalles d WHERE d.venta_id=v.id), '[]'::json)
    ) ORDER BY v.id), '[]'::json) AS rows
    FROM public.ventas v WHERE v.id = ANY($1::bigint[])
  `, [ids])).rows[0].rows;
  return list.map(v => presentSale(v, v.items));
}

async function fetchPurchasesSlice(client, ids) {
  if (!ids.length) return [];
  const list = (await client.query(`
    SELECT COALESCE(json_agg(json_build_object(
      'id', c.id, 'version', c.version, 'suplidor_id', c.suplidor_id, 'suplidor_nombre', c.suplidor_nombre,
      'numero', c.numero, 'fecha', c.fecha::text, 'condicion', c.condicion, 'vencimiento', c.vencimiento::text,
      'total', c.total::text,
      'pagado', COALESCE((SELECT sum(a.monto) FROM public.abonos_cuentas a WHERE a.compra_id=c.id), 0)::double precision,
      'estado', c.estado, 'anulada_en', c.anulada_en, 'anulada_por', c.anulada_por, 'motivo_anulacion', c.motivo_anulacion,
      'items', COALESCE((SELECT json_agg(json_build_object(
        'id', d.id, 'productoId', d.producto_id, 'codigo', d.codigo, 'nombre', d.nombre,
        'cant', d.cantidad::double precision, 'subtotal', d.total::double precision,
        'costo', d.costo::double precision, 'costoExacto', d.costo::text,
        'preciosExactos', json_build_object('p1', d.precio1::text, 'p2', d.precio2::text, 'p3', d.precio3::text),
        'p1', d.precio1::double precision, 'p2', d.precio2::double precision, 'p3', d.precio3::double precision
      ) ORDER BY d.id) FROM public.compra_detalles d WHERE d.compra_id=c.id), '[]'::json)
    ) ORDER BY c.id), '[]'::json) AS rows
    FROM public.compras c WHERE c.id = ANY($1::bigint[])
  `, [ids])).rows[0].rows;
  return list.map(c => presentPurchase(c, c.items));
}

async function fetchMovementsSince(client, afterId) {
  const list = (await client.query(`
    SELECT COALESCE(json_agg(json_build_object(
      'id', m.id, 'producto_id', m.producto_id, 'productoId', m.producto_id,
      'cantidad', m.cantidad::double precision, 'existencia_posterior', m.existencia_posterior::double precision,
      'tipo', m.tipo, 'venta_detalle_id', m.venta_detalle_id, 'compra_detalle_id', m.compra_detalle_id,
      'motivo', m.motivo, 'creado_en', m.creado_en
    ) ORDER BY m.id), '[]'::json) AS rows
    FROM public.movimientos_inventario m WHERE m.id > $1
  `, [afterId])).rows[0].rows;
  return list.map(m => ({ ...m, creado_en: iso(m.creado_en) }));
}

async function fetchWorkshopSlice(client, ids) {
  if (!ids.length) return [];
  const list = (await client.query(`
    SELECT COALESCE(json_agg(json_build_object(
      'id', ct.id, 'version', ct.version, 'cliente_id', ct.cliente_id, 'cliente_nombre', ct.cliente_nombre,
      'mecanico', ct.mecanico, 'vehiculo', ct.vehiculo, 'nota', ct.nota, 'estado', ct.estado,
      'venta_id', ct.venta_id, 'abierta_por', ct.abierta_por, 'abierta_en', ct.abierta_en, 'cerrada_en', ct.cerrada_en,
      'items', COALESCE((SELECT json_agg(json_build_object(
        'id', i.id, 'producto_id', i.producto_id, 'codigo', i.codigo, 'nombre', i.nombre,
        'gravado', i.gravado, 'nivel_precio', i.nivel_precio, 'precio', i.precio::text,
        'cantidad', i.cantidad::text, 'cantidad_devuelta', i.cantidad_devuelta::text,
        'despachado_por', i.despachado_por, 'retirado_por', i.retirado_por, 'creado_en', i.creado_en
      ) ORDER BY i.id) FROM public.cuentas_taller_items i WHERE i.cuenta_id=ct.id), '[]'::json)
    ) ORDER BY ct.id), '[]'::json) AS rows
    FROM public.cuentas_taller ct WHERE ct.id = ANY($1::bigint[])
  `, [ids])).rows[0].rows;
  return list.map(a => presentWorkshopAccount(a, a.items));
}

async function buildDelta(client, method, path, body, result, databaseLabel, baseRevision, priorMovementId = null) {
  const version = await snapshotVersion(client, databaseLabel);
  const changes = {};
  if (method === 'POST' && path === '/api/ventas') {
    const productIds = [...new Set(body.items.map(i => Number(i.productoId)))];
    changes.caja = await fetchCashSlice(client);
    changes.productosUpsert = await fetchProductsSlice(client, productIds);
    changes.clientesUpsert = await fetchCustomersSlice(client, [Number(body.clienteId)]);
    changes.facturasUpsert = await fetchSalesSlice(client, [result.id]);
    changes.secuenciasNcf = presentNcf((await client.query('SELECT id,tipo,prefijo,inicio,fin,actual,vencimiento::text AS vencimiento,activa,version FROM public.secuencias_ncf ORDER BY id')).rows);
    if (priorMovementId !== null) changes.movimientosUpsert = await fetchMovementsSince(client, priorMovementId);
  } else if (method === 'POST' && /^\/api\/ventas\/\d+\/anular$/.test(path)) {
    const [saleRow] = await fetchSalesSlice(client, [result.id]);
    const productIds = [...new Set((saleRow?.items ?? []).map(i => Number(i.productoId)))];
    changes.caja = await fetchCashSlice(client);
    changes.productosUpsert = await fetchProductsSlice(client, productIds);
    if (saleRow) {
      changes.clientesUpsert = await fetchCustomersSlice(client, [saleRow.clienteId]);
      changes.facturasUpsert = [saleRow];
    }
    if (priorMovementId !== null) changes.movimientosUpsert = await fetchMovementsSince(client, priorMovementId);
  } else if (method === 'POST' && ['/api/caja/abrir', '/api/caja/cerrar', '/api/caja/movimiento'].includes(path)) {
    changes.caja = await fetchCashSlice(client);
  } else if (method === 'POST' && path === '/api/cuentas/cobros') {
    const [saleRow] = await fetchSalesSlice(client, [Number(body.ventaId)]);
    if (body.metodoPago === 'efectivo') changes.caja = await fetchCashSlice(client);
    if (saleRow) {
      changes.facturasUpsert = [saleRow];
      changes.clientesUpsert = await fetchCustomersSlice(client, [saleRow.clienteId]);
    }
    const abonoRows = (await client.query('SELECT id,tipo,venta_id,compra_id,caja_id,metodo_pago,monto::text AS monto,referencia,nota,usuario,creado_en FROM public.abonos_cuentas WHERE id=$1', [result.id])).rows;
    changes.abonosUpsert = abonoRows.map(presentAbono);
  } else if (method === 'POST' && path === '/api/cuentas/pagos') {
    const [buyRow] = await fetchPurchasesSlice(client, [Number(body.compraId)]);
    if (body.metodoPago === 'efectivo') changes.caja = await fetchCashSlice(client);
    if (buyRow) {
      changes.comprasUpsert = [buyRow];
      changes.suplidoresUpsert = await fetchSuppliersSlice(client, [buyRow.suplidorId]);
    }
    const abonoRows = (await client.query('SELECT id,tipo,venta_id,compra_id,caja_id,metodo_pago,monto::text AS monto,referencia,nota,usuario,creado_en FROM public.abonos_cuentas WHERE id=$1', [result.id])).rows;
    changes.abonosUpsert = abonoRows.map(presentAbono);
  } else if (method === 'POST' && path === '/api/compras') {
    const [buyRow] = await fetchPurchasesSlice(client, [result.id]);
    const productIds = [...new Set((buyRow?.items ?? []).map(i => Number(i.productoId)))];
    if (buyRow) changes.comprasUpsert = [buyRow];
    changes.suplidoresUpsert = await fetchSuppliersSlice(client, [Number(body.suplidorId)]);
    changes.productosUpsert = await fetchProductsSlice(client, productIds);
    changes.catalogo = (await client.query('SELECT pos_privado.netpos_opciones() AS opciones')).rows[0].opciones;
    if (priorMovementId !== null) changes.movimientosUpsert = await fetchMovementsSince(client, priorMovementId);
  } else if (method === 'POST' && /^\/api\/compras\/\d+\/anular$/.test(path)) {
    const [buyRow] = await fetchPurchasesSlice(client, [result.id]);
    const productIds = [...new Set((buyRow?.items ?? []).map(i => Number(i.productoId)))];
    if (buyRow) {
      changes.comprasUpsert = [buyRow];
      changes.suplidoresUpsert = await fetchSuppliersSlice(client, [buyRow.suplidorId]);
    }
    changes.productosUpsert = await fetchProductsSlice(client, productIds);
    if (priorMovementId !== null) changes.movimientosUpsert = await fetchMovementsSince(client, priorMovementId);
  } else if (/^\/api\/productos(?:\/\d+)?$/.test(path)) {
    if (method === 'DELETE') changes.productosDelete = [result.id];
    else changes.productosUpsert = await fetchProductsSlice(client, [result.id]);
    changes.catalogo = (await client.query('SELECT pos_privado.netpos_opciones() AS opciones')).rows[0].opciones;
    if (priorMovementId !== null && method !== 'DELETE') changes.movimientosUpsert = await fetchMovementsSince(client, priorMovementId);
  } else if (/^\/api\/clientes(?:\/\d+)?$/.test(path)) {
    if (method === 'DELETE') changes.clientesDelete = [result.id];
    else changes.clientesUpsert = await fetchCustomersSlice(client, [result.id]);
  } else if (/^\/api\/suplidores(?:\/\d+)?$/.test(path)) {
    if (method === 'DELETE') changes.suplidoresDelete = [result.id];
    else changes.suplidoresUpsert = await fetchSuppliersSlice(client, [result.id]);
  } else if (/^\/api\/formulas(?:\/\d+)?$/.test(path)) {
    if (method === 'DELETE') changes.formulasDelete = [result.id];
    else {
      changes.formulasUpsert = (await client.query(`SELECT id,version,nombre,factor_costo::double precision AS "factorCosto",
        recargo1::double precision AS recargo1,recargo2::double precision AS recargo2,recargo3::double precision AS recargo3
        FROM public.formulas_precios WHERE id=$1 AND activo`, [result.id])).rows.map(f => ({ ...f, id: number(f.id), version: number(f.version) }));
    }
  } else if (method === 'PUT' && path === '/api/configuracion') {
    const cfg = (await client.query('SELECT id,empresa,rnc,tel,correo,direccion,tasa_itbis::text AS tasa_itbis,redondeo,nivel_precio_predeterminado,formato_impresion,pie_ticket,permitir_stock_negativo,meta_diaria::text AS meta_diaria,version FROM public.configuracion ORDER BY id LIMIT 1')).rows[0];
    Object.assign(changes, presentConfig(cfg));
  } else if (method === 'PUT' && path === '/api/ncf') {
    changes.secuenciasNcf = presentNcf((await client.query('SELECT id,tipo,prefijo,inicio,fin,actual,vencimiento::text AS vencimiento,activa,version FROM public.secuencias_ncf ORDER BY id')).rows);
  } else if (method === 'POST' && (path === '/api/taller' || /^\/api\/taller\/\d+\/(despachar|devolver|cancelar|facturar)$/.test(path))) {
    const [accountRow] = await fetchWorkshopSlice(client, [result.id]);
    if (accountRow) changes.cuentasTallerUpsert = [accountRow];
    if (path.endsWith('/facturar')) {
      changes.caja = await fetchCashSlice(client);
      if (result.ventaId) {
        const [saleRow] = await fetchSalesSlice(client, [result.ventaId]);
        if (saleRow) {
          changes.facturasUpsert = [saleRow];
          changes.clientesUpsert = await fetchCustomersSlice(client, [saleRow.clienteId]);
        }
      }
      changes.secuenciasNcf = presentNcf((await client.query('SELECT id,tipo,prefijo,inicio,fin,actual,vencimiento::text AS vencimiento,activa,version FROM public.secuencias_ncf ORDER BY id')).rows);
    } else {
      const productIds = [...new Set((accountRow?.items ?? []).map(i => Number(i.productoId)))];
      if (productIds.length) changes.productosUpsert = await fetchProductsSlice(client, productIds);
      if (priorMovementId !== null) changes.movimientosUpsert = await fetchMovementsSince(client, priorMovementId);
    }
  } else {
    return null;
  }
  return { ...version, delta: true, baseRevision, changes };
}
async function rollbackFailure(client) {
  try { await client.query('ROLLBACK'); }
  catch (error) { return error; }
}
export async function readSnapshot(pool, databaseLabel, backup = false, matchesVersion, options = {}) {
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
      const result = backup ? await exportBackup(client) : await snapshot(client, databaseLabel, options);
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
  if (body.tipoComprobante !== 'B02' && !(customer.rnc || '').trim()) fail('Este comprobante requiere un cliente con RNC o cédula.');
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
  const lowerCodes = [...new Set(codes.map(code => code.toLowerCase()))].sort();
  for (const code of lowerCodes) await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['producto:' + code]);
  const altClash = (await client.query('SELECT codigo FROM productos_codigos WHERE lower(codigo)=ANY($1::text[]) LIMIT 1', [lowerCodes])).rows[0];
  if (altClash) fail(`El código «${altClash.codigo}» ya está asignado como código alternativo de otro artículo.`, 409);
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
      const rows = backup.tables[table];
      if (!rows.length) continue;
      const chunkSize = Math.max(1, Math.floor(2000 / columns.length));
      const colList = columns.join(',');
      for (let offset = 0; offset < rows.length; offset += chunkSize) {
        const slice = rows.slice(offset, offset + chunkSize);
        const params = [];
        const placeholders = [];
        for (let r = 0; r < slice.length; r++) {
          const row = slice[r];
          const base = r * columns.length;
          const tuple = [];
          for (let c = 0; c < columns.length; c++) {
            params.push(row[columns[c]]);
            tuple.push('$' + (base + c + 1));
          }
          placeholders.push('(' + tuple.join(',') + ')');
        }
        await client.query(`INSERT INTO public.${table}(${colList}) VALUES ${placeholders.join(',')}`, params);
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
      UNION ALL SELECT 1 FROM compras c JOIN (SELECT compra_id,sum(monto) AS pagado FROM abonos_cuentas WHERE compra_id IS NOT NULL GROUP BY compra_id) a ON a.compra_id=c.id WHERE c.condicion<>'Credito' OR c.estado<>'activa' OR a.pagado>c.total
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
  const voidPurchaseMatch = path.match(/^\/api\/compras\/(\d+)\/anular$/);
  if (method === 'POST' && voidPurchaseMatch) return voidPurchase(client, id(Number(voidPurchaseMatch[1]), 'la compra'), body, actor, occurredAt);
  if (method === 'POST' && path === '/api/taller') return openWorkshopAccount(client, body, actor, occurredAt);
  const workshopMatch = path.match(/^\/api\/taller\/(\d+)\/(despachar|devolver|cancelar|facturar)$/);
  if (method === 'POST' && workshopMatch) {
    const accountId = id(Number(workshopMatch[1]), 'la cuenta de taller');
    if (workshopMatch[2] === 'despachar') return dispatchWorkshopItems(client, accountId, body, actor, occurredAt);
    if (workshopMatch[2] === 'devolver') return returnWorkshopItem(client, accountId, body, actor, occurredAt);
    if (workshopMatch[2] === 'cancelar') return cancelWorkshopAccount(client, accountId, body, actor, occurredAt);
    return billWorkshopAccount(client, accountId, body, actor, occurredAt, context.allowNcf !== false);
  }
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
    let result, metadata, newRevision = null, priorMovementId = null;
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
      if (Number.isSafeInteger(context.deltaBaseRevision) && !context.versionOnly && !context.represent &&
          (path === '/api/ventas' || path === '/api/compras' || /^\/api\/ventas\/\d+\/anular$/.test(path) || /^\/api\/compras\/\d+\/anular$/.test(path) || /^\/api\/productos(?:\/\d+)?$/.test(path) ||
           path === '/api/taller' || /^\/api\/taller\/\d+\/(despachar|devolver|cancelar)$/.test(path))) {
        priorMovementId = Number((await client.query('SELECT COALESCE(max(id),0) AS id FROM public.movimientos_inventario')).rows[0].id);
      }
      // Only this call can reject a new operation after the guarded key miss.
      executingNewOperation = true;
      await context.beforeExecute?.(client);
      result = await execute(client, method, path, body, actor, context.occurredAt, context);
      metadata = await context.afterExecute?.(client, result);
      executingNewOperation = false;
      const updated = (await client.query('UPDATE pos_privado.sistema SET revision=revision+1 WHERE id=1 RETURNING database_id, revision')).rows[0];
      newRevision = number(updated.revision);
      await client.query('INSERT INTO pos_privado.solicitudes(clave,tipo,huella,resultado) VALUES($1,$2,$3,$4)', [key, type, fingerprint, { result, databaseId: updated.database_id, ...(metadata && { metadata }) }]);
    }
    let payload;
    if (context.versionOnly) {
      payload = await snapshotVersion(client, databaseLabel);
    } else if (!previous && !context.represent && Number.isSafeInteger(context.deltaBaseRevision) && newRevision === context.deltaBaseRevision + 1) {
      payload = (await buildDelta(client, method, path, body, result, databaseLabel, context.deltaBaseRevision, priorMovementId)) ?? await snapshot(client, databaseLabel, { compact: Boolean(context.compact) });
    } else {
      payload = await snapshot(client, databaseLabel, { compact: Boolean(context.compact) });
    }
    let response = { ...payload, result };
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

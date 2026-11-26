import { normalizeFormula } from '../../../src/domain/pricing.js';
import { costUnits, quantityUnits } from '../../../src/pos/operation-fields.js';
import { archiveJournal, journalArchives, journalStatus, journalTransaction } from './operation-journal.js';
import { clearCachedSnapshot, readCachedSnapshot, writeCachedSnapshot } from './state-cache.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const changedDatabase = 'La base cambió. Revisa la solicitud y los datos antes de continuar.';
const unconfirmed = 'No se confirmó la operación. Reintenta la solicitud pendiente.';

function sameVersionTag(first, second) {
  // Conditional GET uses the opaque tag, even if an intermediary changes W/.
  const opaque = value => typeof value === 'string' ? /^(?:W\/)?("[\x21\x23-\x7e\x80-\xff]*")$/.exec(value)?.[1] : undefined;
  const tag = opaque(first);
  return tag !== undefined && tag === opaque(second);
}

const id = value => Number.isSafeInteger(value) && value > 0;
const integerQuantity = value => Number.isInteger(value) && value >= 0 && value <= 2147483647;
const qtyPattern = /^(\d{1,10})(?:\.(\d{1,2}))?$/;
const costPattern = /^(\d{1,12})(?:\.(\d{1,4}))?$/;
function decimalQuantity(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return false;
  const s = typeof value === 'string' ? value : String(value);
  const m = qtyPattern.exec(s);
  if (!m) return false;
  const whole = Number(m[1]);
  return whole < 2147483647 || (whole === 2147483647 && (!m[2] || Number(m[2]) === 0));
}
const quantity = value => typeof value === 'number' && decimalQuantity(value);
function cost(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return false;
  const s = typeof value === 'string' ? value : String(value);
  const m = costPattern.exec(s);
  if (!m) return false;
  return m[1] !== '999999999999' || !m[2] || Number(m[2].padEnd(4, '0')) <= 9900;
}
const bool = value => typeof value === 'boolean';
const text = value => typeof value === 'string' && value.length <= 2000;
const name = value => text(value) && value.trim().length > 0;
const nullable = check => value => value === null || check(value);
const oneOf = (...values) => value => values.includes(value);
const money = value => typeof value === 'number' && /^\d{1,12}(?:\.\d{1,2})?$/.test(String(value));
const decimal = pattern => value => (typeof value === 'string' || Number.isFinite(value)) && pattern.test(String(value));
const rate = decimal(/^\d{1,3}(?:\.\d{1,4})?$/);
const percentage = value => rate(value) && Number(value) <= 100;
const string = value => typeof value === 'string';
const amount = decimal(/^\d{1,12}(?:\.\d{1,2})?$/);
const productFields = { codigo: string, referencia: text, nombre: string, marca: string, categoria: string, ubicacion: string,
  stockMinimo: decimalQuantity, gravado: bool, notificarMinimo: bool, stock: decimalQuantity,
  costo: cost, precio1: cost, precio2: cost, precio3: cost, motivoAjuste: text,
  codigosAlternativos: value => Array.isArray(value) && value.length <= 20 && value.every(name) };
const contactFields = { nombre: name, rnc: text, tel: text, correo: text };
const customerFields = { ...contactFields, direccion: text, limiteCredito: nullable(amount) };
const supplierFields = { ...contactFields, contacto: text, diasCredito: nullable(integerQuantity), formulaId: nullable(id) };
const formulaValue = value => typeof value === 'string' || Number.isFinite(value);
const formulaFields = { nombre: name, factorCosto: formulaValue, recargo1: formulaValue, recargo2: formulaValue, recargo3: formulaValue };
function validFormula(row) {
  try {
    normalizeFormula({ costFactor: row.factorCosto, margins: { p1: row.recargo1, p2: row.recargo2, p3: row.recargo3 } });
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}
const settingsFields = { empresa: name, rnc: text, tel: text, correo: text, direccion: text, itbisPorcentaje: percentage,
  redondeo: oneOf(0, 1, 5, 10, 25), nivelPrecioPredeterminado: oneOf(null, 'p1', 'p2', 'p3'),
  formatoImpresion: oneOf(null, 'Térmica 80 mm', 'Térmica 58 mm', 'Carta (8.5 x 11)'), pieTicket: text,
  permitirStockNegativo: oneOf(false), metaDiaria: nullable(amount) };
const settingsRequiredFields = { empresa: name, rnc: text, tel: text, correo: text, direccion: text, itbisPorcentaje: percentage,
  redondeo: oneOf(0, 1, 5, 10, 25), nivelPrecioPredeterminado: oneOf(null, 'p1', 'p2', 'p3'),
  formatoImpresion: oneOf(null, 'Térmica 80 mm', 'Térmica 58 mm', 'Carta (8.5 x 11)'), pieTicket: text,
  permitirStockNegativo: oneOf(false) };
const reminderTime = value => typeof value === 'string' && (value === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(value));
const reminderIsoDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const reminderFields = {
  titulo: value => name(value) && value.trim().length <= 200,
  nota: text,
  fechaLimite: nullable(reminderIsoDate),
  horaLimite: reminderTime,
  prioridad: oneOf('baja', 'media', 'alta'),
  estado: oneOf('pendiente', 'completado'),
  clienteId: nullable(id),
  suplidorId: nullable(id),
  productoId: nullable(id),
};
const resourceFields = { productos: productFields, clientes: customerFields, suplidores: supplierFields, formulas: formulaFields,
  recordatorios: reminderFields, configuracion: settingsFields };

function checkTarget(method, path) {
  if (method === 'POST' && ['/api/caja/abrir','/api/caja/cerrar','/api/caja/movimiento'].includes(path)) return { resource: path.slice(5), target: null };
  if (method === 'POST' && ['/api/cuentas/cobros','/api/cuentas/pagos'].includes(path)) return { resource: path.slice(5), target: null };
  if (method === 'PUT' && path === '/api/ncf') return { resource: 'ncf', target: null };
  const voidMatch = typeof path === 'string' && /^\/api\/ventas\/([1-9]\d*)\/anular$/.exec(path);
  if (method === 'POST' && voidMatch && id(Number(voidMatch[1]))) return { resource: 'ventas/anular', target: Number(voidMatch[1]) };
  const voidPurchaseMatch = typeof path === 'string' && /^\/api\/compras\/([1-9]\d*)\/anular$/.exec(path);
  if (method === 'POST' && voidPurchaseMatch && id(Number(voidPurchaseMatch[1]))) return { resource: 'compras/anular', target: Number(voidPurchaseMatch[1]) };
  if (method === 'POST' && path === '/api/taller') return { resource: 'taller', target: null };
  const workshopMatch = typeof path === 'string' && /^\/api\/taller\/([1-9]\d*)\/(despachar|devolver|cancelar|facturar)$/.exec(path);
  if (method === 'POST' && workshopMatch && id(Number(workshopMatch[1]))) return { resource: 'taller/' + workshopMatch[2], target: Number(workshopMatch[1]) };
  if (method === 'POST' && ['/api/ventas', '/api/compras'].includes(path)) return { resource: path.slice(5), target: null };
  if (method === 'PUT' && path === '/api/configuracion') return { resource: 'configuracion', target: 1 };
  const match = typeof path === 'string' && /^\/api\/(productos|clientes|suplidores|formulas|recordatorios)(?:\/([1-9]\d*))?$/.exec(path);
  if (match && (match[2] ? ['PUT', 'DELETE'].includes(method) && id(Number(match[2])) : method === 'POST')) {
    return { resource: match[1], target: match[2] ? Number(match[2]) : null };
  }
  throw new Error('La operación de catálogo no es válida.');
}

function checkPayload(method, resource, payload) {
  const mutable = resourceFields[resource];
  const invalid = () => { throw new Error('Los campos de la solicitud no son válidos.'); };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) invalid();
  if (resource === 'ventas/anular' || resource === 'compras/anular') {
    const fields = { version: id, motivo: name };
    if (Object.keys(payload).length !== 2 || !complete(payload, fields)) invalid();
    return;
  }
  if (resource === 'taller') {
    const allowed = {
      clienteId: id, clienteNombre: text, mecanico: text, vehiculo: text, nota: text, retiradoPor: text,
      items: value => Array.isArray(value) && value.length <= 1000,
    };
    if (!id(payload.clienteId) || Object.entries(payload).some(([key, value]) => !allowed[key] || !allowed[key](value))) invalid();
    const itemFields = { productoId: id, cantidad: v => decimalQuantity(v) && Number(v) > 0, nivelPrecio: oneOf('precio1', 'precio2', 'precio3'), versionProducto: id };
    for (const row of payload.items || []) {
      if (!row || typeof row !== 'object' || Array.isArray(row) ||
          Object.entries(row).some(([key, value]) => !itemFields[key] || !itemFields[key](value)) ||
          ['productoId', 'cantidad', 'nivelPrecio'].some(key => !Object.hasOwn(row, key))) invalid();
    }
    return;
  }
  if (resource === 'taller/despachar') {
    const allowed = { version: id, retiradoPor: text, items: value => Array.isArray(value) && value.length >= 1 && value.length <= 1000 };
    if (!id(payload.version) || !allowed.items(payload.items) ||
        Object.entries(payload).some(([key, value]) => !allowed[key] || !allowed[key](value))) invalid();
    const itemFields = { productoId: id, cantidad: v => decimalQuantity(v) && Number(v) > 0, nivelPrecio: oneOf('precio1', 'precio2', 'precio3'), versionProducto: id };
    for (const row of payload.items) {
      if (!row || typeof row !== 'object' || Array.isArray(row) ||
          Object.entries(row).some(([key, value]) => !itemFields[key] || !itemFields[key](value)) ||
          ['productoId', 'cantidad', 'nivelPrecio'].some(key => !Object.hasOwn(row, key))) invalid();
    }
    return;
  }
  if (resource === 'taller/devolver') {
    const allowed = { version: id, itemId: id, cantidad: v => decimalQuantity(v) && Number(v) > 0, motivo: text };
    if (!id(payload.version) || !id(payload.itemId) || !allowed.cantidad(payload.cantidad) ||
        Object.entries(payload).some(([key, value]) => !allowed[key] || !allowed[key](value))) invalid();
    return;
  }
  if (resource === 'taller/cancelar') {
    const allowed = { version: id, motivo: text };
    if (!id(payload.version) || Object.entries(payload).some(([key, value]) => !allowed[key] || !allowed[key](value))) invalid();
    return;
  }
  if (resource === 'taller/facturar') {
    const allowed = {
      version: id, clienteId: id, cajaId: id,
      condicion: oneOf('Contado', 'Credito'),
      tipoComprobante: oneOf('B01', 'B02', 'B14'),
      metodoPago: oneOf('efectivo', 'tarjeta', 'transferencia', 'credito'),
      versionConfiguracion: id,
      descuentoPorcentaje: value => amount(value) && Number(value) <= 100,
      descuentoMonto: amount,
      vencimiento: nullable(documentDate),
    };
    const req = ['version', 'cajaId', 'condicion', 'tipoComprobante', 'metodoPago'];
    if (Object.entries(payload).some(([key, value]) => !allowed[key] || !allowed[key](value)) ||
        req.some(key => !Object.hasOwn(payload, key)) ||
        (payload.condicion === 'Credito') !== (payload.metodoPago === 'credito')) invalid();
    return;
  }
  if (resource === 'cuentas/cobros' || resource === 'cuentas/pagos') {
    const isCobro = resource === 'cuentas/cobros';
    const allowed = {
      [isCobro ? 'ventaId' : 'compraId']: id,
      version: id,
      monto: value => amount(value) && Number(value) > 0,
      metodoPago: oneOf('efectivo', 'tarjeta', 'transferencia'),
      cajaId: nullable(id),
      referencia: text,
      nota: text,
    };
    const req = [isCobro ? 'ventaId' : 'compraId', 'version', 'monto', 'metodoPago'];
    if (Object.entries(payload).some(([key, value]) => !allowed[key] || !allowed[key](value)) ||
        req.some(key => !Object.hasOwn(payload, key))) invalid();
    if (payload.metodoPago === 'efectivo' && !id(payload.cajaId)) invalid();
    if (payload.metodoPago !== 'efectivo' && payload.cajaId != null) invalid();
    return;
  }
  if (resource === 'ncf') {
    const allowed = { tipo: oneOf('B01', 'B02', 'B14'), inicio: integerQuantity, fin: integerQuantity,
      actual: integerQuantity, vencimiento: documentDate, activa: bool, version: nullable(id) };
    const req = ['tipo', 'inicio', 'fin', 'actual', 'vencimiento', 'activa'];
    if (Object.entries(payload).some(([key, value]) => !allowed[key] || !allowed[key](value)) ||
        req.some(key => !Object.hasOwn(payload, key))) invalid();
    if (payload.inicio < 1 || payload.fin < payload.inicio || payload.actual < payload.inicio - 1 || payload.actual > payload.fin) invalid();
    return;
  }
  if (resource.startsWith('caja/')) {
    const fields = resource === 'caja/abrir' ? { monto: amount } : resource === 'caja/cerrar'
      ? { cajaId: id, version: id, conteo: amount }
      : { cajaId: id, version: id, tipo: oneOf('entrada','salida'), monto: value => amount(value) && Number(value) > 0, concepto: name };
    if (Object.keys(payload).length !== Object.keys(fields).length || !complete(payload, fields)) invalid();
    return;
  }
  if (resource === 'ventas' || resource === 'compras') {
    const sale = resource === 'ventas';
    const header = sale ? { clienteId: id, condicion: oneOf('Contado','Credito'), tipoComprobante: oneOf('B01','B02','B14'),
      versionConfiguracion: id, cajaId: id, metodoPago: oneOf('efectivo','tarjeta','transferencia','credito'),
      descuentoPorcentaje: value => amount(value) && Number(value) <= 100,
      descuentoMonto: amount,
      vencimiento: nullable(documentDate) }
      : { suplidorId: id, numero: name, fecha: nullable(documentDate), condicion: oneOf('Contado','Credito'), vencimiento: nullable(documentDate) };
    const optionalHeader = sale ? ['cajaId','metodoPago','descuentoPorcentaje','descuentoMonto','vencimiento'] : ['fecha','condicion','vencimiento'];
    const fields = sale ? { productoId: id, cantidad: v => decimalQuantity(v) && Number(v) > 0,
      nivelPrecio: oneOf('precio1','precio2','precio3'), versionProducto: id } :
      { codigo: name, referencia: text, nombre: name, cantidad: v => decimalQuantity(v) && Number(v) > 0, costo: cost, precio1: cost, precio2: cost, precio3: cost,
        productoId: nullable(id), versionProducto: nullable(id) };
    const required = sale ? ['productoId','cantidad','nivelPrecio'] : ['codigo','nombre','cantidad','costo','precio1','precio2','precio3'];
    if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 1000 ||
        Object.entries(payload).some(([key,value]) => key !== 'items' && (!header[key] || !header[key](value))) ||
        Object.keys(header).some(key => !key.startsWith('version') && !optionalHeader.includes(key) && !Object.hasOwn(payload,key))) invalid();
    // Old pending journals must reach the server to obtain a definitive rejection.
    if (sale && (Object.hasOwn(payload,'cajaId') !== Object.hasOwn(payload,'metodoPago') ||
        (payload.metodoPago && (payload.condicion === 'Credito') !== (payload.metodoPago === 'credito')))) invalid();
    for (const row of payload.items) {
      if (!row || typeof row !== 'object' || Array.isArray(row) ||
          Object.entries(row).some(([key,value]) => !fields[key] || !fields[key](value)) ||
          required.some(key => !Object.hasOwn(row,key))) invalid();
      if (!sale && (Object.hasOwn(row,'productoId') !== Object.hasOwn(row,'versionProducto') ||
          (Object.hasOwn(row,'productoId') && (row.productoId === null) !== (row.versionProducto === null)))) invalid();
    }
    return;
  }
  if (method !== 'POST' && !id(payload.version)) invalid();
  const entries = Object.entries(payload);
  if (resource === 'configuracion' && entries.length < 2) invalid();
  if (method !== 'DELETE') {
    if (['clientes', 'suplidores', 'formulas'].includes(resource) && !name(payload.nombre)) invalid();
    if (resource === 'recordatorios' && method === 'POST' && !name(payload.titulo)) invalid();
    if (resource === 'formulas' && !validFormula(payload)) invalid();
  }
  for (const [key, value] of entries) {
    if (key === 'version' && method !== 'POST') continue;
    if (method === 'DELETE' || !Object.hasOwn(mutable, key)) invalid();
    const legacyEmpty = method === 'POST' && ['clientes', 'suplidores'].includes(resource) && ['rnc', 'tel'].includes(key) && value === null;
    if (!legacyEmpty && !mutable[key](value)) invalid();
  }
}

function validUnit(value, exact) {
  if (exact === undefined) return money(value);
  return typeof exact === 'string' && /^\d{1,12}\.\d{4}$/.test(exact) && cost(exact) && value === Number(exact);
}

function validPrices(row, keys) {
  const exact = row.preciosExactos;
  if (exact === undefined) return keys.every(key => money(row[key]));
  return exact && typeof exact === 'object' && ['p1','p2','p3'].every((level, i) =>
    typeof exact[level] === 'string' && validUnit(row[keys[i]], exact[level]));
}

function validProduct(p) {
  return p && id(p.id) && id(p.version) && name(p.codigo) && name(p.nombre) &&
    (!Object.hasOwn(p, 'referencia') || text(p.referencia)) &&
    ['marca', 'categoria', 'ubicacion'].every(key => text(p[key])) &&
    quantity(p.stock) && quantity(p.stockMinimo) &&
    (!Object.hasOwn(p, 'stock_minimo') || p.stock_minimo === p.stockMinimo) &&
    validUnit(p.costo, p.costoExacto) && validPrices(p, ['precio1','precio2','precio3']) &&
    (!Object.hasOwn(p, 'notificarMinimo') || bool(p.notificarMinimo)) &&
    (!Object.hasOwn(p, 'notificar_minimo') || p.notificar_minimo === p.notificarMinimo) &&
    typeof p.gravado === 'boolean' && p.activo === true;
}

function complete(row, fields) {
  return row && Object.entries(fields).every(([key, validate]) => validate(row[key]));
}
function records(rows, validate) {
  return Array.isArray(rows) && rows.every(row => row && id(row.id) && validate(row)) &&
    new Set(rows.map(row => row.id)).size === rows.length;
}
function documentDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const lineFields = { productoId: id, codigo: name, nombre: name, cant: value => quantity(value) && value > 0, subtotal: money };
function validDocument(row, sale) {
  const header = sale ? { clienteId: id, cliente: name, clienteRnc: text, ncf: nullable(name),
    tipoComprobante: oneOf('B01','B02','B14'), condicion: oneOf('Credito','Contado'), base: money, itbis: money }
    : { suplidorId: id, suplidor: name, numero: name };
  return complete(row, header) && documentDate(row.fechaISO) && money(row.total) && row.items?.length > 0 &&
    records(row.items, line => complete(line, lineFields) && (sale
      ? money(line.base) && money(line.itbis) && validUnit(line.precio,line.precioExacto) &&
        ((line.costoUnitario === undefined || line.costoUnitario === null) && (line.costoUnitarioExacto === undefined || line.costoUnitarioExacto === null)
          || validUnit(line.costoUnitario, line.costoUnitarioExacto))
      : validUnit(line.costo,line.costoExacto) && validPrices(line,['p1','p2','p3'])));
}
function validWorkshopAccount(row) {
  const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  return complete(row, {
    id, version: id, clienteId: id, cliente: name, mecanico: text, vehiculo: text, nota: text,
    estado: oneOf('abierta', 'facturada', 'cancelada'),
    ventaId: nullable(id), abiertaPor: name, abiertaEn: instant, cerradaEn: nullable(instant),
  }) && records(row.items, item => complete(item, {
    productoId: id, codigo: name, nombre: name, gravado: bool,
    nivelPrecio: oneOf('precio1', 'precio2', 'precio3'),
    cantidad: value => quantity(value) && value > 0,
    cantidadDevuelta: quantity,
    cantidadNeta: quantity,
    despachadoPor: name, retiradoPor: text, creadoEn: instant,
  }) && validUnit(item.precio, item.precioExacto));
}
function validReminder(row) {
  const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  return Boolean(row && id(row.version) && complete(row, {
    ...reminderFields,
    creadoPor: text,
    completadoPor: nullable(text),
    completadoEn: nullable(instant),
    creadoEn: nullable(instant),
    actualizadoEn: nullable(instant),
  }));
}
function validOperationalState(state) {
  if (state.caja !== undefined && !validCash(state.caja)) return false;
  if (state.cuentasTaller !== undefined && !records(state.cuentasTaller, validWorkshopAccount)) return false;
  if (state.recordatorios !== undefined && !records(state.recordatorios, validReminder)) return false;
  const config = state.configuracion;
  if (!complete(config, settingsRequiredFields) || !id(config.version) || typeof config.itbisPorcentaje !== 'number' ||
      (Object.hasOwn(config, 'metaDiaria') && !nullable(money)(config.metaDiaria)) ||
      state.empresa !== config.empresa || state.configuracionVersion !== config.version || !Number.isFinite(state.itbisRate) ||
      Number((config.itbisPorcentaje / 100).toFixed(6)) !== state.itbisRate) return false;
  if (!records(state.formulas, row => id(row.version) && name(row.nombre) && validFormula(row) &&
      ['factorCosto','recargo1','recargo2','recargo3'].every(key => typeof row[key] === 'number'))) return false;
  const formulas = new Set(state.formulas.map(row => row.id));
  return Array.isArray(state.movimientos) && records(state.clientes, row => id(row.version) && complete(row, customerFields) && nullable(money)(row.limiteCredito) &&
      typeof row.esContado === 'boolean' && Number.isFinite(row.deuda) && /^-?\d+(?:\.\d{1,2})?$/.test(String(row.deuda))) &&
    state.clientes.filter(row => row.esContado).length <= 1 &&
    records(state.suplidores, row => id(row.version) && complete(row, supplierFields) && (row.formulaId === null || formulas.has(row.formulaId))) &&
    records(state.facturas, row => validDocument(row, true)) && records(state.compras, row => validDocument(row, false));
}

function validCash(cash) {
  const instant = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  return cash && cash.session && bool(cash.session.open) && (cash.session.open
    ? complete(cash.session, { id, version: id, openedAt: instant, cashier: name, openingAmount: money })
    : cash.session.id === null) && complete(cash.summary, {
      opening: money, cashSales: money, cardSales: money, transferSales: money, creditSales: money,
      entradas: money, salidas: money, cobros: money, pagos: money, expected: money, invoices: integerQuantity,
    }) && records(cash.movements, row => complete(row, { sessionId: id, type: oneOf('entrada','salida'), amount: money, description: name, date: instant })) &&
    records(cash.closures, row => complete(row, { openedAt: instant, closedAt: instant, cashier: name, opening: money, expected: money, counted: money, sales: money }));
}

function expandCompactSnapshot(raw) {
  if (raw?.compact !== 1 || !raw.state || !Array.isArray(raw.state.productos)) return raw;
  const productos = raw.state.productos.map(row => {
    if (!Array.isArray(row)) return row;
    const [
      pid, version, codigo, nombre, marca, categoria, ubicacion,
      gravado, stock, stockMinimo, notificarMinimo,
      costoExacto, p1, p2, p3, altCodes, referencia,
    ] = row;
    return {
      id: pid,
      version,
      codigo,
      referencia: referencia || '',
      codigosAlternativos: altCodes || [],
      nombre,
      marca: marca || '',
      categoria: categoria || '',
      ubicacion: ubicacion || '',
      gravado: gravado === 1 ? true : gravado === 0 ? false : gravado,
      activo: true,
      stock,
      stockMinimo,
      notificarMinimo: notificarMinimo === 1 ? true : notificarMinimo === 0 ? false : notificarMinimo,
      costo: Number(costoExacto),
      costoExacto,
      preciosExactos: { p1, p2, p3 },
      precio1: Number(p1),
      precio2: Number(p2),
      precio3: Number(p3),
    };
  });
  const { compact: _compact, ...rest } = raw;
  return { ...rest, state: { ...raw.state, productos } };
}

function checkSnapshot(snapshot) {
  const products = snapshot?.state?.productos;
  if (typeof snapshot?.databaseId !== 'string' || !uuid.test(snapshot.databaseId) || !Number.isSafeInteger(snapshot.revision) ||
      snapshot.revision < 0 || typeof snapshot.databaseLabel !== 'string' ||
      !Array.isArray(products) || !products.every(validProduct) || !validOperationalState(snapshot.state)) {
    throw new Error('El servicio devolvió datos de catálogo no válidos.');
  }
  const seenIds = new Set();
  const seenCodes = new Set();
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    if (seenIds.has(p.id) || seenCodes.has(p.codigo)) {
      throw new Error('El servicio devolvió datos de catálogo no válidos.');
    }
    seenIds.add(p.id);
    seenCodes.add(p.codigo);
  }
  return snapshot;
}

function upsertById(existing, incoming) {
  if (!incoming.length) return existing;
  const incomingMap = new Map();
  for (let i = 0; i < incoming.length; i++) incomingMap.set(incoming[i].id, incoming[i]);
  const sortedIncoming = [...incomingMap.values()].sort((a, b) => a.id - b.id);
  const out = [];
  let i = 0, j = 0;
  while (i < existing.length && j < sortedIncoming.length) {
    const a = existing[i], b = sortedIncoming[j];
    if (a.id < b.id) {
      out.push(a);
      i++;
    } else if (a.id === b.id) {
      out.push(b);
      i++;
      j++;
    } else {
      out.push(b);
      j++;
    }
  }
  while (i < existing.length) out.push(existing[i++]);
  while (j < sortedIncoming.length) out.push(sortedIncoming[j++]);
  return out;
}
function deleteById(existing, ids) {
  if (!ids.length) return existing;
  const drop = new Set(ids);
  return existing.filter(row => !drop.has(row.id));
}
function mergeDelta(current, body) {
  const invalid = () => { throw new Error('El servicio devolvió datos de catálogo no válidos.'); };
  if (!current?.state || body?.delta !== true || typeof body.databaseId !== 'string' || !uuid.test(body.databaseId) ||
      body.databaseId !== current.databaseId || !Number.isSafeInteger(body.baseRevision) ||
      body.baseRevision !== current.revision || body.revision !== current.revision + 1 ||
      typeof body.databaseLabel !== 'string' || !body.changes || typeof body.changes !== 'object' || Array.isArray(body.changes)) {
    invalid();
  }
  const c = body.changes;
  const next = { ...current.state };
  if (Object.hasOwn(c, 'caja')) {
    if (!validCash(c.caja)) invalid();
    next.caja = c.caja;
  }
  if (Object.hasOwn(c, 'catalogo')) next.catalogo = c.catalogo;
  if (Object.hasOwn(c, 'configuracion')) {
    next.configuracion = c.configuracion;
    next.empresa = c.empresa;
    next.itbisRate = c.itbisRate;
    next.configuracionVersion = c.configuracionVersion;
    const cfg = next.configuracion;
    if (!complete(cfg, settingsRequiredFields) || !id(cfg.version) || typeof cfg.itbisPorcentaje !== 'number' ||
        (Object.hasOwn(cfg, 'metaDiaria') && !nullable(money)(cfg.metaDiaria)) ||
        next.empresa !== cfg.empresa || next.configuracionVersion !== cfg.version || !Number.isFinite(next.itbisRate) ||
        Number((cfg.itbisPorcentaje / 100).toFixed(6)) !== next.itbisRate) invalid();
  }
  if (Object.hasOwn(c, 'secuenciasNcf')) {
    if (!Array.isArray(c.secuenciasNcf)) invalid();
    next.secuenciasNcf = c.secuenciasNcf;
  }
  if (Object.hasOwn(c, 'productosUpsert')) {
    if (!Array.isArray(c.productosUpsert) || !c.productosUpsert.every(validProduct)) invalid();
    const incomingIds = new Set(c.productosUpsert.map(p => p.id));
    if (incomingIds.size !== c.productosUpsert.length) invalid();
    const incomingCodes = new Set(c.productosUpsert.map(p => p.codigo));
    if (incomingCodes.size !== c.productosUpsert.length) invalid();
    if (next.productos.some(p => !incomingIds.has(p.id) && incomingCodes.has(p.codigo))) invalid();
    next.productos = upsertById(next.productos, c.productosUpsert);
  }
  if (Object.hasOwn(c, 'productosDelete')) {
    if (!Array.isArray(c.productosDelete) || !c.productosDelete.every(id)) invalid();
    next.productos = deleteById(next.productos, c.productosDelete);
  }
  if (Object.hasOwn(c, 'formulasUpsert')) {
    if (!records(c.formulasUpsert, row => id(row.version) && name(row.nombre) && validFormula(row) &&
        ['factorCosto', 'recargo1', 'recargo2', 'recargo3'].every(key => typeof row[key] === 'number'))) invalid();
    next.formulas = upsertById(next.formulas, c.formulasUpsert);
  }
  if (Object.hasOwn(c, 'formulasDelete')) {
    if (!Array.isArray(c.formulasDelete) || !c.formulasDelete.every(id)) invalid();
    next.formulas = deleteById(next.formulas, c.formulasDelete);
  }
  if (Object.hasOwn(c, 'clientesUpsert')) {
    if (!records(c.clientesUpsert, row => id(row.version) && complete(row, customerFields) && nullable(money)(row.limiteCredito) &&
        typeof row.esContado === 'boolean' && Number.isFinite(row.deuda) && /^-?\d+(?:\.\d{1,2})?$/.test(String(row.deuda)))) invalid();
    next.clientes = upsertById(next.clientes, c.clientesUpsert);
    if (next.clientes.filter(row => row.esContado).length > 1) invalid();
  }
  if (Object.hasOwn(c, 'clientesDelete')) {
    if (!Array.isArray(c.clientesDelete) || !c.clientesDelete.every(id)) invalid();
    next.clientes = deleteById(next.clientes, c.clientesDelete);
  }
  if (Object.hasOwn(c, 'suplidoresUpsert')) {
    const formulaIds = new Set(next.formulas.map(row => row.id));
    if (!records(c.suplidoresUpsert, row => id(row.version) && complete(row, supplierFields) &&
        (row.formulaId === null || formulaIds.has(row.formulaId)))) invalid();
    next.suplidores = upsertById(next.suplidores, c.suplidoresUpsert);
  }
  if (Object.hasOwn(c, 'suplidoresDelete')) {
    if (!Array.isArray(c.suplidoresDelete) || !c.suplidoresDelete.every(id)) invalid();
    next.suplidores = deleteById(next.suplidores, c.suplidoresDelete);
  }
  if (Object.hasOwn(c, 'facturasUpsert')) {
    if (!records(c.facturasUpsert, row => validDocument(row, true))) invalid();
    next.facturas = upsertById(next.facturas, c.facturasUpsert);
  }
  if (Object.hasOwn(c, 'comprasUpsert')) {
    if (!records(c.comprasUpsert, row => validDocument(row, false))) invalid();
    next.compras = upsertById(next.compras, c.comprasUpsert);
  }
  if (Object.hasOwn(c, 'abonosUpsert')) {
    if (!Array.isArray(c.abonosUpsert)) invalid();
    next.abonos = upsertById(next.abonos ?? [], c.abonosUpsert);
  }
  if (Object.hasOwn(c, 'movimientosUpsert')) {
    if (!Array.isArray(c.movimientosUpsert)) invalid();
    next.movimientos = upsertById(next.movimientos ?? [], c.movimientosUpsert).slice(-100);
  }
  if (Object.hasOwn(c, 'cuentasTallerUpsert')) {
    if (!records(c.cuentasTallerUpsert, validWorkshopAccount)) invalid();
    next.cuentasTaller = upsertById(next.cuentasTaller ?? [], c.cuentasTallerUpsert);
  }
  if (Object.hasOwn(c, 'recordatoriosUpsert')) {
    if (!records(c.recordatoriosUpsert, validReminder)) invalid();
    next.recordatorios = upsertById(next.recordatorios ?? [], c.recordatoriosUpsert);
  }
  if (Object.hasOwn(c, 'recordatoriosDelete')) {
    if (!Array.isArray(c.recordatoriosDelete) || !c.recordatoriosDelete.every(id)) invalid();
    next.recordatorios = deleteById(next.recordatorios ?? [], c.recordatoriosDelete);
  }
  return {
    databaseId: body.databaseId,
    revision: body.revision,
    databaseLabel: body.databaseLabel,
    state: next,
    result: body.result,
    confirmation: body.confirmation,
    ...(typeof body.localReceipt === 'string' ? { localReceipt: body.localReceipt } : {}),
    ...(body.desktop ? { desktop: body.desktop } : {}),
  };
}

async function serviceError(response) {
  const body = await response.json().catch(() => null);
  return typeof body?.error === 'string' && body.error.trim() ? body : null;
}

function matchesPacket(proof, packet) {
  return proof?.operationId === packet.id && proof.databaseId === packet.databaseId &&
    proof.method === packet.method && proof.path === packet.path;
}

function checkConfirmation(snapshot, packet, resource, expected, payload) {
  const proof = snapshot.confirmation;
  const target = snapshot.result?.id;
  if (!matchesPacket(proof, packet) || typeof proof.replayed !== 'boolean' ||
      !id(target) || (expected !== null && target !== expected)) throw new Error(unconfirmed);

  // Older journals have no baseline. Their exact operation can still be confirmed by the server.
  if (Object.hasOwn(packet, 'baseRevision') && (!Number.isSafeInteger(packet.baseRevision) ||
      packet.baseRevision < 0 || snapshot.revision <= packet.baseRevision)) throw new Error(unconfirmed);
  if (resource === 'ventas/anular') {
    if (!proof.replayed) {
      const row = snapshot.state.facturas.find(item => item.id === target);
      if (!row || row.estado !== 'anulada') throw new Error(unconfirmed);
    }
    return;
  }
  if (resource === 'compras/anular') {
    if (!proof.replayed) {
      const row = snapshot.state.compras.find(item => item.id === target);
      if (!row || row.estado !== 'anulada') throw new Error(unconfirmed);
    }
    return;
  }
  if (resource === 'taller' || resource.startsWith('taller/')) {
    if (resource === 'taller/facturar') {
      const saleId = snapshot.result?.ventaId;
      if (!id(saleId)) throw new Error(unconfirmed);
      if (!snapshot.state.facturas.some(item => item.id === saleId)) throw new Error(unconfirmed);
    }
    if (!proof.replayed) {
      const row = (snapshot.state.cuentasTaller || []).find(item => item.id === target);
      if (!row) throw new Error(unconfirmed);
      if (resource === 'taller' && row.version !== 1) throw new Error(unconfirmed);
      if (resource !== 'taller' && row.version !== payload.version + 1) throw new Error(unconfirmed);
      if (resource === 'taller/cancelar' && row.estado !== 'cancelada') throw new Error(unconfirmed);
      if (resource === 'taller/facturar' && (row.estado !== 'facturada' || row.ventaId !== snapshot.result.ventaId)) throw new Error(unconfirmed);
    }
    return;
  }
  if (resource === 'cuentas/cobros' || resource === 'cuentas/pagos') {
    if (!proof.replayed && !(snapshot.state.abonos || []).some(item => item.id === target)) throw new Error(unconfirmed);
    return;
  }
  if (resource === 'ncf') {
    if (!proof.replayed && !(snapshot.state.secuenciasNcf || []).some(item => item.id === target && item.tipo === payload.tipo)) throw new Error(unconfirmed);
    return;
  }
  if (resource.startsWith('caja/')) {
    if (!validCash(snapshot.state.caja)) throw new Error(unconfirmed);
    // A replay may now show a later turn; the durable receipt proves the original command.
    if (resource === 'caja/cerrar' && (target !== payload.cajaId || snapshot.result.counted !== Number(payload.conteo))) throw new Error(unconfirmed);
    if (!proof.replayed) {
      const cash = snapshot.state.caja;
      if (resource === 'caja/abrir' && (!cash.session.open || cash.session.id !== target || cash.session.openingAmount !== Number(payload.monto))) throw new Error(unconfirmed);
      if (resource === 'caja/movimiento' && !cash.movements.some(row => row.id === target && row.sessionId === payload.cajaId &&
        row.type === payload.tipo && row.amount === Number(payload.monto) && row.description === payload.concepto.trim())) throw new Error(unconfirmed);
      if (resource === 'caja/cerrar' && !cash.closures.some(row => row.id === target && row.counted === Number(payload.conteo))) throw new Error(unconfirmed);
    }
    return;
  }
  if (resource === 'ventas' || resource === 'compras') {
    // Documents are immutable, including when recovering a lost response.
    const sale = resource === 'ventas';
    const rows = sale ? snapshot.state.facturas : snapshot.state.compras;
    const row = rows.find(row => row.id === target);
    if (!row || row.items.length !== payload.items.length || (sale
      ? row.clienteId !== payload.clienteId || row.condicion !== payload.condicion || row.tipoComprobante !== payload.tipoComprobante
      : row.suplidorId !== payload.suplidorId || row.numero !== payload.numero.trim())) throw new Error(unconfirmed);
    if (sale && payload.cajaId !== undefined && (row.cajaId !== payload.cajaId || row.metodoPago !== payload.metodoPago)) throw new Error(unconfirmed);
    if (!sale && payload.fecha && row.fechaISO !== payload.fecha) throw new Error(unconfirmed);
    for (const [index, item] of payload.items.entries()) {
      const saved = row.items[index];
      if (quantityUnits(saved.cant) !== quantityUnits(item.cantidad) || (sale
        ? saved.productoId !== item.productoId
        : (item.productoId != null && saved.productoId !== item.productoId) || saved.codigo !== item.codigo || saved.nombre !== item.nombre.trim() ||
          costUnits(saved.costoExacto ?? saved.costo) !== costUnits(item.costo) ||
          ['p1','p2','p3'].some((level, n) => costUnits(saved.preciosExactos?.[level] ?? saved[level]) !== costUnits(item['precio' + (n + 1)])))) {
        throw new Error(unconfirmed);
      }
    }
    return;
  }
  // Mutable catalog rows can reflect subsequent edits and deactivations on a replay.
  if (proof.replayed) return;
  const row = resource === 'configuracion' ? snapshot.state.configuracion : snapshot.state[resource].find(item => item.id === target);
  if (packet.method === 'DELETE') {
    if (row) throw new Error(unconfirmed);
  } else if (row?.version !== (packet.method === 'POST' ? 1 : payload.version + 1)) throw new Error(unconfirmed);
}

export function createPosClient() {
  // Only an operation UUID is kept per tab, to recognize its receipt after a
  // reload. The journal is shared; another tab's pending sale is not this draft.
  let saleOperationId = null;
  try { saleOperationId = sessionStorage.getItem('repuestos-felix-venta-pendiente'); } catch { /* Optional receipt ownership. */ }
  let state = { snapshot: null, pending: null, inFlightOperationId: null, archiveCount: 0, busy: false, recovering: false, recoveryIssue: null, resolution: null, saleOperationId, readErrorRetryable: false, connection: 'checking', error: null, lastSync: null, authenticationRequired: false };
  const listeners = new Set();
  const retired = new Set();
  const changes = new BroadcastChannel('repuestos-felix-operaciones');
  let active = 0, issued = 0, latestConfirmed = 0, etag = null, disposed = false;
  let lastConfirmedSync = null;
  let reading = null;
  let skipInitialCache = typeof performance !== 'undefined' &&
    performance.getEntriesByType?.('navigation')?.[0]?.type === 'reload';
  let operationError = null;
  let recoveryEnabled = false, retryTimer = null;
  const awaiting = new Map(), attempts = new Map(), stopped = new Set();
  const retryDelays = [1000, 3000, 10000];

  // AbortController works in older installed Safari PWAs too. Keep the timer
  // alive until the response body is read, not just until its headers arrive.
  function deadline() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Tiempo de espera agotado.', 'TimeoutError')), 30000);
    return { signal: controller.signal, close: () => clearTimeout(timer) };
  }

  function recoveryPacket() {
    const packet = state.pending ?? awaiting.values().next().value;
    return packet?.method === 'POST' && packet.path === '/api/ventas' && !stopped.has(packet.id) && (attempts.get(packet.id) ?? 0) < retryDelays.length &&
      state.snapshot?.databaseId === packet.databaseId ? packet : null;
  }

  function scheduleRecovery() {
    // Windows can reach its local API without internet. Keep the web/PWA
    // network guard; the native exception still requires a confirmed catalog.
    if (!recoveryEnabled || disposed || retryTimer !== null || active || state.recovering ||
        state.authenticationRequired || (!window.__FELIX_DESKTOP__ && navigator.onLine === false) || document.hidden) return;
    const packet = recoveryPacket();
    if (!packet) return;
    retryTimer = setTimeout(async () => {
      retryTimer = null;
      if (disposed || active || state.recovering || state.authenticationRequired ||
          (!window.__FELIX_DESKTOP__ && navigator.onLine === false) || document.hidden || recoveryPacket()?.id !== packet.id) return;
      attempts.set(packet.id, (attempts.get(packet.id) ?? 0) + 1);
      set({ recovering: true });
      try {
        // A live service must first confirm the current database generation.
        await readSnapshot({ background: true });
        const current = state.pending ?? awaiting.values().next().value;
        if (current?.id !== packet.id || state.snapshot?.databaseId !== packet.databaseId ||
            stopped.has(packet.id) || state.authenticationRequired) return;
        await working(() => send(packet, true, true));
      } catch (error) {
        if (error.recoveryStopped) {
          stopped.add(packet.id);
          set({ recoveryIssue: { operationId: packet.id, message: error.message } });
        }
      }
      finally {
        set({ recovering: false });
        scheduleRecovery();
      }
    }, retryDelays[attempts.get(packet.id) ?? 0]);
  }

  function set(fields) {
    if (disposed) return;
    if (Object.entries(fields).every(([key, value]) => Object.is(state[key], value))) return;
    state = { ...state, ...fields };
    listeners.forEach(listener => listener());
  }

  function samePending(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.id === b.id && a.status === b.status && a.databaseId === b.databaseId &&
      a.method === b.method && a.path === b.path && a.body === b.body && a.baseRevision === b.baseRevision;
  }

  async function readPending() {
    const [pending, archiveCount] = await journalStatus();
    const nextPending = samePending(pending, state.pending) ? state.pending : pending;
    set({ pending: nextPending, archiveCount });
    return nextPending;
  }
  function lockSession() {
    etag = null;
    lastConfirmedSync = null;
    operationError = null;
    clearCachedSnapshot().catch(() => {});
    clearDraftStorage();
    try { sessionStorage.removeItem('repuestos-felix-venta-pendiente'); } catch { /* Optional receipt ownership. */ }
    set({ authenticationRequired: true, snapshot: null, resolution: null, saleOperationId: null, lastSync: null, connection: 'unavailable' });
  }
  changes.onmessage = event => {
    if (event.data === 'logout') lockSession();
    else readPending().then(scheduleRecovery).catch(error => set({ error: error.message }));
  };

  async function updatePending(update, markInFlight = false) {
    const pending = await journalTransaction(update);
    set({ pending, ...(markInFlight && pending ? { inFlightOperationId: pending.id } : {}) });
    if (!disposed) changes.postMessage(null);
    return pending;
  }

  function apply(snapshot, tag, request, { skipCacheWrite = false } = {}) {
    if (state.authenticationRequired) return;
    const current = state.snapshot;
    if (current?.databaseId === snapshot.databaseId) {
      if (snapshot.revision < current.revision) return;
    } else {
      if (retired.has(snapshot.databaseId) || request < latestConfirmed) return;
      if (current) retired.add(current.databaseId);
    }
    latestConfirmed = Math.max(latestConfirmed, request);
    etag = tag;
    lastConfirmedSync = new Date().toISOString();
    if (tag && !skipCacheWrite) writeCachedSnapshot(snapshot, tag);
    set({ snapshot, connection: 'connected', authenticationRequired: false, readErrorRetryable: false, error: operationError, lastSync: lastConfirmedSync });
  }

  async function working(work, background = false, readSequence = null) {
    if (disposed) throw new Error('El cliente está cerrado.');
    if (readSequence === null) operationError = null;
    if (!background) {
      active++;
      set({ busy: true, error: operationError });
    }
    try { return await work(); }
    catch (error) {
      if (readSequence === null) {
        operationError = error.message;
        set({ error: operationError });
      } else if (readSequence === issued && readSequence >= latestConfirmed) {
        set({ error: operationError ?? error.message });
      }
      throw error;
    } finally {
      if (!background) {
        active--;
        set({ busy: active > 0 });
      }
      scheduleRecovery();
    }
  }

  function readSnapshot({ fresh = false, background = false } = {}) {
    if (state.authenticationRequired) return Promise.reject(new Error('Inicia sesión para acceder al sistema.'));
    if (reading && !fresh) return reading;
    const sequence = ++issued;
    const job = working(async () => {
      const bypassCache = fresh || skipInitialCache;
      skipInitialCache = false;
      const [_, cached] = await Promise.all([
        readPending(),
        !bypassCache && !state.snapshot && !etag ? readCachedSnapshot() : Promise.resolve(null),
      ]);
      const previousTag = bypassCache ? null : (etag || cached?.etag || null);
      const previous = bypassCache ? null : (state.snapshot || cached?.snapshot || null);
      const fromCache = !bypassCache && !state.snapshot && Boolean(cached?.snapshot);
      const timeout = deadline();
      let response;
      try {
        response = await fetch('/api/state', {
          credentials: 'same-origin', mode: 'same-origin', redirect: 'error', cache: 'no-store',
          headers: {
            'X-Felix-Compact': '1',
            ...(previousTag ? { 'If-None-Match': previousTag } : {}),
          },
          signal: timeout.signal,
        });
        if (response.status === 304) {
          if (!previous || !previousTag) throw new Error('No hay una copia confirmada del catálogo.');
          if (!sameVersionTag(response.headers.get('ETag'), previousTag)) throw new Error('El servicio no confirmó la versión del catálogo.');
          if (fromCache) {
            apply(previous, previousTag, sequence, { skipCacheWrite: true });
          } else if (previous === state.snapshot && previousTag === etag) {
            latestConfirmed = Math.max(latestConfirmed, sequence);
            lastConfirmedSync = new Date().toISOString();
            if (state.connection !== 'connected' || state.authenticationRequired || state.readErrorRetryable || state.error !== operationError) {
              set({ connection: 'connected', authenticationRequired: false, readErrorRetryable: false, error: operationError, lastSync: lastConfirmedSync });
            }
          }
          return previous;
        }
        if (response.status === 401 && sequence >= latestConfirmed) lockSession();
        if (response.status !== 200) throw new Error((await serviceError(response))?.error || 'El servicio no confirmó la lectura del catálogo.');
        const observed = checkSnapshot(expandCompactSnapshot(await response.json()));
        apply(observed, response.headers.get('ETag'), sequence);
        return observed;
      } catch (error) {
        if (response && [400, 401, 403, 404, 409].includes(response.status)) error.recoveryStopped = true;
        if (sequence === issued) set({ connection: 'unavailable', lastSync: lastConfirmedSync, readErrorRetryable: !response || response.status >= 500 ||
          [408, 429].includes(response.status) || error instanceof TypeError || ['TimeoutError', 'AbortError'].includes(error.name) });
        if (error instanceof TypeError || ['TimeoutError', 'AbortError'].includes(error.name)) throw new Error('No se pudo conectar con el servicio.');
        throw error;
      } finally { timeout.close(); }
    }, background, sequence).finally(() => { if (reading === job) reading = null; });
    reading = job;
    return job;
  }

  async function reload(options = {}) {
    if (options.recover) recoveryEnabled = true;
    // An online/foreground event can arrive while the last attempt is still
    // in flight. Renew its budget now; terminal rejections remain in stopped.
    if (options.resumeRecovery) attempts.clear();
    await readSnapshot(options);
    scheduleRecovery();
    return state.snapshot;
  }

  function checkGeneration(databaseId) {
    if (state.authenticationRequired) throw new Error('Inicia sesión para acceder al sistema.');
    if (!state.snapshot) throw new Error('Actualiza el catálogo antes de guardar.');
    if (databaseId !== state.snapshot.databaseId) throw new Error(changedDatabase);
  }

  function uncertainError(cause, packet, remember = true) {
    // The dialog may outlive the journal slot if another tab confirms it.
    const original = Object.freeze({ ...packet, status: 'sending' });
    const error = new Error(cause instanceof TypeError || cause instanceof SyntaxError ? unconfirmed : cause.message);
    error.uncertain = true;
    error.recoveryStopped = stopped.has(original.id);
    error.operationId = original.id;
    if (remember) awaiting.set(original.id, original);
    error.retry = () => {
      stopped.delete(original.id);
      attempts.delete(original.id);
      return working(() => send(original, true, true));
    };
    return error;
  }

  async function send(packet, exactRetry = false, recovered = false) {
    const { resource, target: expected } = checkTarget(packet.method, packet.path);
    const { databaseId, ...payload } = JSON.parse(packet.body);
    if (packet.databaseId !== databaseId || !uuid.test(packet.id)) throw new Error(unconfirmed);
    checkPayload(packet.method, resource, payload);
    checkGeneration(packet.databaseId);
    const remember = !recovered || awaiting.has(packet.id) || state.saleOperationId === packet.id;
    // A crashed tab releases its lock. Its durable "sending" marker still
    // records that the previous attempt could have committed.
    return navigator.locks.request('repuestos-felix-envio-' + packet.id, { ifAvailable: true }, async lock => {
      if (!lock) throw uncertainError(new Error('Otra pestaña está enviando esta solicitud.'), packet, remember);
      const sending = await updatePending(current => {
        checkGeneration(packet.databaseId);
        if (!current && exactRetry) return packet;
        if (current?.id !== packet.id || current.databaseId !== packet.databaseId ||
            current.method !== packet.method || current.path !== packet.path || current.body !== packet.body || current.baseRevision !== packet.baseRevision) {
          throw uncertainError(new Error('La solicitud pendiente cambió. Revisa las operaciones antes de reintentar.'), packet, remember);
        }
        return { ...current, status: 'sending' };
      });
      const request = ++issued;
      let received;
      let definitive = false;
      const timeout = deadline();
      try {
        checkGeneration(sending.databaseId);
        const deltaRevision = state.snapshot?.databaseId === sending.databaseId && Number.isSafeInteger(state.snapshot.revision)
          ? String(state.snapshot.revision) : null;
        set({ ...(recovered ? {} : { inFlightOperationId: sending.id }), recoveryIssue: null });
        received = await fetch(sending.path, {
          method: sending.method, mode: 'same-origin', credentials: 'same-origin', redirect: 'error',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': sending.id,
            'X-Felix-Compact': '1',
            ...(deltaRevision !== null ? { 'X-Felix-Delta': deltaRevision } : {}),
          },
          body: sending.body,
          signal: timeout.signal,
        });
        if (received.status !== 200) {
          if (received.status === 401 && request >= latestConfirmed) lockSession();
          const body = await serviceError(received);
          const proven = [400, 404, 409].includes(received.status) && matchesPacket(body?.rejection, sending);
          // Even an unproven conflict may announce a restored generation.
          if (proven || received.status === 409) {
            const observed = await readSnapshot({ fresh: true }).catch(() => null);
            if (proven && observed?.databaseId === sending.databaseId) {
              await updatePending(current => {
                checkGeneration(sending.databaseId);
                return current?.id === sending.id ? null : current;
              });
              definitive = true;
            }
          }
          throw new Error(body?.error || unconfirmed);
        }
        const raw = await received.json();
        let snapshot;
        let responseTag = received.headers.get('ETag');
        if (raw?.delta === true) {
          if (state.snapshot?.databaseId === raw.databaseId && state.snapshot.revision === raw.baseRevision) {
            snapshot = mergeDelta(state.snapshot, raw);
          } else {
            const fresh = await readSnapshot({ fresh: true, background: true });
            snapshot = {
              ...fresh,
              result: raw.result,
              confirmation: raw.confirmation,
              ...(typeof raw.localReceipt === 'string' ? { localReceipt: raw.localReceipt } : {}),
              ...(raw.desktop ? { desktop: raw.desktop } : {}),
            };
            responseTag = etag;
          }
        } else {
          snapshot = checkSnapshot(expandCompactSnapshot(raw));
        }
        if (snapshot.databaseId !== sending.databaseId) throw new Error(changedDatabase);
        checkConfirmation(snapshot, sending, resource, expected, payload);
        checkGeneration(sending.databaseId);
        apply(snapshot, responseTag, request);
        await updatePending(current => current?.id === sending.id ? null : current);
        awaiting.delete(sending.id);
        attempts.delete(sending.id);
        stopped.delete(sending.id);
        set({ resolution: { operationId: sending.id, databaseId: sending.databaseId, path: sending.path, snapshot, recovered } });
        return snapshot;
      } catch (cause) {
        if ((!received || received.status >= 500 || [401, 403].includes(received.status)) && request >= latestConfirmed) {
          set({ connection: 'unavailable', lastSync: lastConfirmedSync });
        }
        if (definitive) {
          cause.definitive = true;
          awaiting.delete(sending.id);
          stopped.add(sending.id);
          set({ resolution: { operationId: sending.id, databaseId: sending.databaseId, path: sending.path, error: cause.message } });
          throw cause;
        }
        if (received && received.status !== 200 && ![408, 429].includes(received.status) && received.status < 500) {
          stopped.add(sending.id);
          set({ recoveryIssue: { operationId: sending.id, message: cause.message } });
        }
        throw uncertainError(cause, sending, remember);
      } finally {
        timeout.close();
        if (state.inFlightOperationId === sending.id) set({ inFlightOperationId: null });
      }
    });
  }

  function writeOperation({ method, path, payload, databaseId }) {
    return working(async () => {
      const { resource } = checkTarget(method, path);
      checkGeneration(databaseId);
      checkPayload(method, resource, payload);
      const body = JSON.stringify({ ...payload, databaseId });
      const packet = await updatePending(current => {
        checkGeneration(databaseId);
        if (!current) return { id: crypto.randomUUID(), method, path, body, databaseId, databaseLabel: state.snapshot.databaseLabel,
          createdAt: new Date().toISOString(), baseRevision: state.snapshot.revision, status: 'prepared' };
        // Equal sale contents can belong to two customers. Only an explicit
        // recovery may reuse the pending invoice's idempotency key.
        if (resource !== 'ventas' && current.method === method && current.path === path && current.databaseId === databaseId && current.body === body) return current;
        throw new Error('Resuelve la solicitud pendiente antes de guardar otra operación.');
      }, true);
      if (resource === 'ventas') {
        set({ saleOperationId: packet.id });
        try { sessionStorage.setItem('repuestos-felix-venta-pendiente', packet.id); } catch { /* The journal remains durable. */ }
      }
      try {
        return await send(packet);
      } finally {
        if (state.inFlightOperationId === packet.id) set({ inFlightOperationId: null });
      }
    });
  }

  function retryPending() {
    return working(async () => {
      const packet = await readPending();
      if (packet) {
        stopped.delete(packet.id);
        attempts.delete(packet.id);
        return send(packet, false, true);
      }
    });
  }

  async function readArchives() {
    checkGeneration(state.snapshot?.databaseId);
    const records = await journalArchives();
    checkGeneration(state.snapshot?.databaseId);
    return records.sort((a, b) => b.archivedAt.localeCompare(a.archivedAt));
  }

  function archivePending({ operationId, databaseId, acknowledged, reviewedPacket } = {}) {
    return working(async () => {
      if (acknowledged !== true) throw new Error('Confirma que has revisado la solicitud y su posible resultado.');
      checkGeneration(databaseId);
      const reviewed = reviewedPacket ?? state.pending;
      if (!reviewed || reviewed.id !== operationId) throw new Error('La solicitud pendiente cambió. Repite la revisión.');
      if (reviewed.databaseId === databaseId) throw new Error('Esta solicitud corresponde a la base actual. Reintenta su confirmación.');
      return navigator.locks.request('repuestos-felix-envio-' + operationId, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('Otra pestaña está enviando esta solicitud. Espera antes de archivarla.');
        // Never release the journal based only on a cached or obsolete generation.
        const observed = await readSnapshot({ fresh: true, background: true });
        if (observed.databaseId !== databaseId) throw new Error(changedDatabase);
        const record = await archiveJournal(current => {
          checkGeneration(databaseId);
          if (!current || ['id', 'databaseId', 'method', 'path', 'body', 'baseRevision', 'status'].some(key => current[key] !== reviewed[key])) {
            throw new Error('La solicitud pendiente cambió. Repite la revisión.');
          }
          return { packet: current, archivedAt: new Date().toISOString(), currentDatabaseId: databaseId,
            currentDatabaseLabel: state.snapshot.databaseLabel, reason: 'database-changed', acknowledged: true };
        });
        awaiting.delete(operationId);
        attempts.delete(operationId);
        stopped.add(operationId);
        operationError = null;
        if (state.saleOperationId === operationId) {
          try { sessionStorage.removeItem('repuestos-felix-venta-pendiente'); } catch { /* The archive is durable. */ }
          set({ saleOperationId: null });
        }
        await readPending();
        set({ error: null, recoveryIssue: null });
        if (!disposed) changes.postMessage(null);
        return record;
      });
    });
  }

  function clearDraftStorage() {
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
        const key = sessionStorage.key(i);
        if (key && key.startsWith('felix-venta-borrador:')) sessionStorage.removeItem(key);
      }
    } catch { /* Optional session storage. */ }
  }
  async function logout() {
    clearDraftStorage();
    const response = await fetch('/logout', { method: 'POST', credentials: 'same-origin', mode: 'same-origin', redirect: 'error' });
    if (response.status !== 200) throw new Error('No se pudo cerrar la sesión. Inténtalo de nuevo.');
    lockSession();
    if (!disposed) changes.postMessage('logout');
    const result = await response.json().catch(() => null);
    location.replace(result?.redirect === '/login?salida=local' ? result.redirect : '/login');
  }

  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    reload, writeOperation, retryPending, readArchives, archivePending, logout,
    dispose() { disposed = true; clearTimeout(retryTimer); changes.close(); listeners.clear(); },
  };
}

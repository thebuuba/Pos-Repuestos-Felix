import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { PosStoreContext } from './pos-context.jsx';
import { catalogCategories } from './catalog-options.js';
import { purchaseOperation } from './operational-purchases.js';

function productFromSnapshot(p, databaseId) {
  return {
    id: p.id, version: p.version, databaseId, code: p.codigo, name: p.nombre,
    brand: p.marca, category: p.categoria, location: p.ubicacion, minStock: p.stockMinimo,
    taxable: p.gravado, notifyMinStock: p.notificarMinimo ?? true,
    cost: p.costo, costExact: p.costoExacto ?? p.costo.toFixed(4), stock: p.stock,
    pricesExact: p.preciosExactos,
    prices: { p1: p.precio1, p2: p.precio2, p3: p.precio3 },
  };
}

const businessFields = { name: 'empresa', rnc: 'rnc', phone: 'tel', email: 'correo', address: 'direccion' };
const billingFields = { itbisRate: 'itbisPorcentaje', rounding: 'redondeo', defaultPriceLevel: 'nivelPrecioPredeterminado',
  printer: 'formatoImpresion', ticketFooter: 'pieTicket', allowNegativeStock: 'permitirStockNegativo' };
const contactFields = { name: 'nombre', rnc: 'rnc', phone: 'tel', email: 'correo' };
const customerFields = { ...contactFields, address: 'direccion', creditLimit: 'limiteCredito' };
const supplierFields = { ...contactFields, contact: 'contacto', creditDays: 'diasCredito', formulaId: 'formulaId' };
const localId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readFields(row, fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, api]) => [key, row?.[api] ?? null]));
}
function writeFields(dto, fields) {
  return Object.fromEntries(Object.entries(fields).filter(([key]) => Object.hasOwn(dto, key))
    .map(([key, api]) => [api, dto[key]]));
}
const recordIdentity = (row, databaseId) => ({ id: row.id, version: row.version, databaseId });
const newestFirst = (a, b) => b.date.localeCompare(a.date) || b.id - a.id;
const documentLine = row => ({ id: row.id, productId: row.productoId, code: row.codigo, name: row.nombre,
  quantity: row.cant, subtotal: row.subtotal });

function presentation(snapshot) {
  const state = snapshot?.state;
  const databaseId = snapshot?.databaseId ?? null;
  const config = state?.configuracion;
  return {
    cashSession: state?.caja?.session ?? { open: false, id: null, version: null, openedAt: '', cashier: '' },
    cashSummary: state?.caja?.summary ?? {},
    cashMovements: state?.caja?.movements ?? [],
    closures: state?.caja?.closures ?? [],
    products: state?.productos.map(p => productFromSnapshot(p, databaseId)) ?? [],
    categories: catalogCategories(state),
    customers: state?.clientes.map(c => ({ ...recordIdentity(c, databaseId), ...readFields(c, customerFields),
      isCashCustomer: c.esContado, balance: c.deuda })) ?? [],
    suppliers: state?.suplidores.map(s => ({ ...recordIdentity(s, databaseId), ...readFields(s, supplierFields), balance: null })) ?? [],
    formulas: state?.formulas.map(f => ({ ...recordIdentity(f, databaseId), name: f.nombre, costFactor: f.factorCosto,
      margins: { p1: f.recargo1, p2: f.recargo2, p3: f.recargo3 } })) ?? [],
    settings: { databaseId, version: config?.version ?? null, business: readFields(config, businessFields),
      ...readFields(config, billingFields), allowNegativeStock: false, ncf: [] },
    sales: state?.facturas.map(s => ({
      id: s.id, customerId: s.clienteId, customerName: s.cliente, customerRnc: s.clienteRnc, number: 'Registro ' + s.id,
      date: s.fechaISO, ncf: s.ncf, comprobante: s.tipoComprobante, condition: s.condicion === 'Credito' ? 'credito' : 'contado',
      paymentMethod: s.metodoPago, cashSessionId: s.cajaId, status: null, subtotal: s.base, itbis: s.itbis, total: s.total,
      lines: s.items.map(line => ({ ...documentLine(line), price: line.precio, priceExact: line.precioExacto, base: line.base, itbis: line.itbis })),
    })).sort(newestFirst) ?? [],
    purchases: state?.compras.map(c => ({
      id: c.id, supplierId: c.suplidorId, supplierName: c.suplidor, number: 'Registro ' + c.id,
      supplierInvoice: c.numero, date: c.fechaISO, total: c.total, lines: c.items.map(line => ({ ...documentLine(line),
        cost: line.costo, costExact: line.costoExacto ?? line.costo.toFixed(4),
        pricesExact: line.preciosExactos, prices: { p1: line.p1, p2: line.p2, p3: line.p3 } })),
    })).sort(newestFirst) ?? [],
    receivables: [],
    payables: [],
  };
}

function productPayload(p) {
  const prices = p.pricesExact ?? p.prices;
  return { codigo: p.code, nombre: p.name, marca: p.brand, categoria: p.category, ubicacion: p.location,
    stockMinimo: p.minStock, gravado: p.taxable, costo: p.cost, stock: p.stock,
    ...(Object.hasOwn(p, 'notifyMinStock') ? { notificarMinimo: p.notifyMinStock } : {}),
    precio1: prices.p1, precio2: prices.p2, precio3: prices.p3 };
}
function recordOperation(resource, dto, toPayload) {
  const existing = Number.isSafeInteger(dto.id) && dto.id > 0;
  if (!existing && (!toPayload || typeof dto.id !== 'string' || !localId.test(dto.id))) {
    throw new Error('El identificador del registro no es válido.');
  }
  const path = '/api/' + resource + (existing ? '/' + dto.id : '');
  const payload = toPayload ? toPayload(dto) : {};
  if (existing) payload.version = dto.version;
  return { databaseId: dto.databaseId, path, method: !toPayload ? 'DELETE' : existing ? 'PUT' : 'POST', payload };
}
function settingsOperation(dto) {
  if (Object.keys(dto).some(key => !['databaseId','version','business'].includes(key) && !Object.hasOwn(billingFields, key)) ||
      (Object.hasOwn(dto, 'business') && (!dto.business || typeof dto.business !== 'object' || Array.isArray(dto.business) ||
        Object.keys(dto.business).some(key => !Object.hasOwn(businessFields, key))))) {
    throw new Error('Los campos de configuración no son válidos.');
  }
  return { databaseId: dto.databaseId, path: '/api/configuracion', method: 'PUT',
    payload: { version: dto.version, ...writeFields(dto.business ?? {}, businessFields), ...writeFields(dto, billingFields) } };
}

function durableAction(client, operation) {
  const retries = new WeakMap();
  return async dto => {
    const retry = retries.get(dto);
    try {
      const result = await (retry ? retry() : client.writeOperation(operation(dto)));
      retries.delete(dto);
      return result;
    } catch (error) {
      if (error.definitive) retries.delete(dto);
      else if (error.retry) retries.set(dto, error.retry);
      throw error;
    }
  };
}
function actions(client) {
  const record = (resource, fields) => durableAction(client, dto => recordOperation(resource, dto, fields));
  const cash = action => durableAction(client, ({ databaseId, ...payload }) => ({ databaseId, method: 'POST', path: '/api/caja/' + action, payload }));
  return {
    openCash: cash('abrir'), closeCash: cash('cerrar'), addCashMovement: cash('movimiento'),
    registerSale: durableAction(client, ({ databaseId, ...payload }) => ({ databaseId, method: 'POST', path: '/api/ventas', payload })),
    registerPurchase: durableAction(client, purchaseOperation),
    saveProduct: record('productos', productPayload), deleteProduct: record('productos'),
    saveCustomer: record('clientes', c => writeFields(c, customerFields)), deleteCustomer: record('clientes'),
    saveSupplier: record('suplidores', s => writeFields(s, supplierFields)), deleteSupplier: record('suplidores'),
    saveFormula: record('formulas', f => ({ nombre: f.name, factorCosto: f.costFactor,
      recargo1: f.margins.p1, recargo2: f.margins.p2, recargo3: f.margins.p3 })), deleteFormula: record('formulas'),
    updateSettings: durableAction(client, settingsOperation),
  };
}

export function OperationalStoreProvider({ client, children }) {
  const state = useSyncExternalStore(client.subscribe, client.getState);
  const writes = useMemo(() => actions(client), [client]);
  useEffect(() => {
    const reload = () => { client.reload({ background: !!client.getState().snapshot, recover: true, resumeRecovery: true }).catch(() => {}); };
    const refreshVisible = event => { if (!document.hidden) client.reload({ background: true, recover: true, resumeRecovery: !!event }).catch(() => {}); };
    reload();
    const timer = window.setInterval(refreshVisible, 5_000);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    window.addEventListener('online', reload);
    window.addEventListener('offline', reload);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
      window.removeEventListener('online', reload);
      window.removeEventListener('offline', reload);
    };
  }, [client]);
  const { snapshot } = state;
  const data = useMemo(() => presentation(snapshot), [snapshot]);
  const runtime = {
    ...state, mode: 'online', databaseId: snapshot?.databaseId ?? null, revision: snapshot?.revision ?? null,
    accountDetailsAvailable: false, reload: client.reload, retryPending: client.retryPending,
    readArchives: client.readArchives, archivePending: client.archivePending, logout: client.logout,
  };
  return <PosStoreContext.Provider value={{ runtime, ...data, ...writes }}>
    {children}
  </PosStoreContext.Provider>;
}

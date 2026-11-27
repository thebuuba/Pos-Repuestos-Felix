import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { PosStoreContext } from './pos-context.jsx';
import { catalogCategories } from './catalog-options.js';
import { purchaseOperation } from './operational-purchases.js';
import { isOwner, normalizeRole } from '../../../src/pos/roles.js';

const adaptedProductCache = new WeakMap();
function productFromSnapshot(p, databaseId) {
  let cached = adaptedProductCache.get(p);
  if (cached && cached.databaseId === databaseId) return cached;
  cached = {
    id: p.id, version: p.version, databaseId, code: p.codigo, reference: p.referencia ?? '', altCodes: p.codigosAlternativos ?? [],
    name: p.nombre, brand: p.marca, category: p.categoria, location: p.ubicacion, minStock: p.stockMinimo,
    taxable: p.gravado, notifyMinStock: p.notificarMinimo ?? true,
    cost: p.costo, costExact: p.costoExacto ?? p.costo.toFixed(4), stock: p.stock,
    pricesExact: p.preciosExactos,
    prices: { p1: p.precio1, p2: p.precio2, p3: p.precio3 },
  };
  adaptedProductCache.set(p, cached);
  return cached;
}

const businessFields = { name: 'empresa', rnc: 'rnc', phone: 'tel', email: 'correo', address: 'direccion' };
const billingFields = { itbisRate: 'itbisPorcentaje', rounding: 'redondeo', defaultPriceLevel: 'nivelPrecioPredeterminado',
  printer: 'formatoImpresion', ticketFooter: 'pieTicket', allowNegativeStock: 'permitirStockNegativo', dailyGoal: 'metaDiaria' };
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
import { formatSaleNumber } from './operational-sales.js';
const recordIdentity = (row, databaseId) => ({ id: row.id, version: row.version, databaseId });
const formatPurchaseNumber = id => 'C-' + String(id).padStart(6, '0');
const newestFirst = (a, b) => b.date.localeCompare(a.date) || b.id - a.id;
const documentLine = row => ({ id: row.id, productId: row.productoId, code: row.codigo, name: row.nombre,
  quantity: row.cant, subtotal: row.subtotal });

function presentationDocsAndCash(state, databaseId) {
  const paymentsBySale = new Map();
  const paymentsByPurchase = new Map();
  for (const a of state?.abonos ?? []) {
    const payment = { id: a.id, date: a.creadoEn, amount: a.monto, method: a.metodoPago,
      reference: a.referencia, note: a.nota, cashSessionId: a.cajaId };
    if (a.ventaId != null) {
      const list = paymentsBySale.get(a.ventaId) ?? [];
      list.push(payment);
      paymentsBySale.set(a.ventaId, list);
    }
    if (a.compraId != null) {
      const list = paymentsByPurchase.get(a.compraId) ?? [];
      list.push(payment);
      paymentsByPurchase.set(a.compraId, list);
    }
  }
  const sales = state?.facturas.map(s => ({
    id: s.id, version: s.version ?? 1, databaseId, customerId: s.clienteId, customerName: s.cliente, customerRnc: s.clienteRnc,
    number: formatSaleNumber(s.id), date: s.fechaISO, createdAt: s.creadoEn ?? null, dueDate: s.vencimiento ?? null,
    ncf: s.ncf, comprobante: s.tipoComprobante, condition: s.condicion === 'Credito' ? 'credito' : 'contado',
    method: s.metodoPago, paymentMethod: s.metodoPago, cashSessionId: s.cajaId,
    status: s.estado === 'anulada' ? 'anulada' : s.condicion === 'Credito' ? ((s.pagado ?? 0) >= s.total ? 'pagada' : 'pendiente') : 'pagada',
    voidedAt: s.anuladaEn ?? null, voidedBy: s.anuladaPor ?? null, voidReason: s.motivoAnulacion ?? null,
    discountPercent: s.descuentoPorcentaje ?? 0, discount: s.descuento ?? 0,
    subtotal: s.base, netBase: s.base, itbis: s.itbis, total: s.total, paid: s.pagado ?? 0,
    payments: paymentsBySale.get(s.id) ?? [],
    lines: s.items.map(line => ({
      ...documentLine(line),
      price: line.precio,
      priceExact: line.precioExacto,
      costUnit: line.costoUnitarioExacto ?? (line.costoUnitario !== null && line.costoUnitario !== undefined ? String(line.costoUnitario) : null),
      base: line.base,
      itbis: line.itbis,
    })),
  })).sort(newestFirst) ?? [];
  const purchases = state?.compras.map(c => ({
    id: c.id, version: c.version ?? 1, databaseId, supplierId: c.suplidorId, supplierName: c.suplidor,
    number: formatPurchaseNumber(c.id), supplierInvoice: c.numero, date: c.fechaISO,
    condition: c.condicion === 'Credito' ? 'credito' : 'contado', dueDate: c.vencimiento ?? null,
    status: c.estado === 'anulada' ? 'anulada' : c.condicion === 'Credito' ? ((c.pagado ?? 0) >= c.total ? 'pagada' : 'pendiente') : 'pagada',
    voidedAt: c.anuladaEn ?? null, voidedBy: c.anuladaPor ?? null, voidReason: c.motivoAnulacion ?? null,
    total: c.total, paid: c.pagado ?? 0, payments: paymentsByPurchase.get(c.id) ?? [],
    lines: c.items.map(line => ({ ...documentLine(line),
      cost: line.costo, costExact: line.costoExacto ?? line.costo.toFixed(4),
      pricesExact: line.preciosExactos, prices: { p1: line.p1, p2: line.p2, p3: line.p3 } })),
  })).sort(newestFirst) ?? [];
  const receivables = sales
    .filter(s => s.condition === 'credito' && s.status !== 'anulada')
    .map(s => ({ id: s.id, version: s.version, databaseId, document: s.ncf || s.number,
      partyId: s.customerId, partyName: s.customerName, date: s.date, dueDate: s.dueDate,
      amount: s.total, paid: s.paid, payments: s.payments }));
  const payables = purchases
    .filter(c => c.condition === 'credito' && c.status !== 'anulada')
    .map(c => ({ id: c.id, version: c.version, databaseId, document: c.supplierInvoice,
      partyId: c.supplierId, partyName: c.supplierName, date: c.date, dueDate: c.dueDate,
      amount: c.total, paid: c.paid, payments: c.payments }));
  const saleLabels = new Map(sales.map(s => [s.id, `${s.ncf || s.number} · ${s.customerName}`]));
  const purchaseLabels = new Map(purchases.map(c => [c.id, `${c.supplierInvoice || c.number} · ${c.supplierName}`]));
  const cashAbonoMoves = (state?.abonos ?? [])
    .filter(a => a.cajaId != null && a.metodoPago === 'efectivo')
    .map(a => {
      const target = a.tipo === 'cobro'
        ? (saleLabels.get(a.ventaId) ?? `Factura #${a.ventaId}`)
        : (purchaseLabels.get(a.compraId) ?? `Compra #${a.compraId}`);
      const detail = [a.referencia, a.nota].filter(Boolean).join(' · ');
      return {
        id: 'abono-' + a.id,
        sessionId: a.cajaId,
        type: a.tipo,
        amount: a.monto,
        description: detail ? `${target} (${detail})` : target,
        date: a.creadoEn,
      };
    });
  const cashMovements = [...(state?.caja?.movements ?? []), ...cashAbonoMoves]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return {
    cashSession: state?.caja?.session ?? { open: false, id: null, version: null, openedAt: '', cashier: '' },
    cashSummary: state?.caja?.summary ?? {},
    cashMovements,
    closures: state?.caja?.closures ?? [],
    sales,
    purchases,
    receivables,
    payables,
  };
}

function productPayload(p) {
  const prices = p.pricesExact ?? p.prices;
  return { codigo: p.code, nombre: p.name, marca: p.brand, categoria: p.category, ubicacion: p.location,
    stockMinimo: p.minStock, gravado: p.taxable, costo: p.cost, stock: p.stock,
    ...(Object.hasOwn(p, 'reference') ? { referencia: p.reference ?? '' } : {}),
    ...(Object.hasOwn(p, 'notifyMinStock') ? { notificarMinimo: p.notifyMinStock } : {}),
    ...(Object.hasOwn(p, 'altCodes') ? { codigosAlternativos: p.altCodes } : {}),
    ...(p.adjustmentReason ? { motivoAjuste: p.adjustmentReason } : {}),
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
    voidSale: durableAction(client, ({ databaseId, saleId, version, reason }) => ({
      databaseId, method: 'POST', path: '/api/ventas/' + saleId + '/anular', payload: { version, motivo: reason },
    })),
    recordReceivablePayment: durableAction(client, ({ databaseId, saleId, version, amount, method, cashSessionId, reference = '', note = '' }) => ({
      databaseId, method: 'POST', path: '/api/cuentas/cobros',
      payload: { ventaId: saleId, version, monto: amount, metodoPago: method, ...(method === 'efectivo' ? { cajaId: cashSessionId } : {}), referencia: reference, nota: note },
    })),
    recordPayablePayment: durableAction(client, ({ databaseId, purchaseId, version, amount, method, cashSessionId, reference = '', note = '' }) => ({
      databaseId, method: 'POST', path: '/api/cuentas/pagos',
      payload: { compraId: purchaseId, version, monto: amount, metodoPago: method, ...(method === 'efectivo' ? { cajaId: cashSessionId } : {}), referencia: reference, nota: note },
    })),
    saveNcfSequence: durableAction(client, ({ databaseId, type, start, end, current, expiresAt, active, version }) => ({
      databaseId, method: 'PUT', path: '/api/ncf',
      payload: { tipo: type, inicio: Number(start), fin: Number(end), actual: Number(current), vencimiento: expiresAt, activa: Boolean(active), ...(version ? { version } : {}) },
    })),
    registerPurchase: durableAction(client, purchaseOperation),
    voidPurchase: durableAction(client, ({ databaseId, purchaseId, version, reason }) => ({
      databaseId, method: 'POST', path: '/api/compras/' + purchaseId + '/anular', payload: { version, motivo: reason },
    })),
    saveProduct: record('productos', productPayload), deleteProduct: record('productos'),
    fetchProductMovements: async (productId) => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch('/api/productos/' + encodeURIComponent(String(productId)) + '/movimientos', {
          cache: 'no-store',
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'No se pudo cargar el historial del artículo.');
        return body;
      } catch (err) {
        if (err?.name === 'AbortError') throw new Error('Tiempo de espera agotado al consultar el historial del artículo.');
        if (err instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(String(err?.message || ''))) {
          throw new Error('Sin conexión al servidor. No se pudo cargar el historial del artículo.');
        }
        throw err;
      } finally {
        window.clearTimeout(timer);
      }
    },
    saveCustomer: record('clientes', c => writeFields(c, customerFields)), deleteCustomer: record('clientes'),
    saveSupplier: record('suplidores', s => writeFields(s, supplierFields)), deleteSupplier: record('suplidores'),
    saveFormula: record('formulas', f => ({ nombre: f.name, factorCosto: f.costFactor,
      recargo1: f.margins.p1, recargo2: f.margins.p2, recargo3: f.margins.p3 })), deleteFormula: record('formulas'),
    saveReminder: record('recordatorios', r => ({
      titulo: r.title,
      nota: r.note ?? '',
      fechaLimite: r.dueDate || null,
      horaLimite: r.dueDate ? (r.dueTime || '') : '',
      prioridad: r.priority || 'media',
      estado: r.status || 'pendiente',
      clienteId: r.customerId ?? null,
      suplidorId: r.supplierId ?? null,
      productoId: r.productId ?? null,
    })),
    deleteReminder: record('recordatorios'),
    updateSettings: durableAction(client, settingsOperation),
    openWorkshopAccount: durableAction(client, ({ databaseId, ...payload }) => ({
      databaseId, method: 'POST', path: '/api/taller', payload,
    })),
    dispatchWorkshopItems: durableAction(client, ({ databaseId, accountId, ...payload }) => ({
      databaseId, method: 'POST', path: '/api/taller/' + accountId + '/despachar', payload,
    })),
    returnWorkshopItem: durableAction(client, ({ databaseId, accountId, ...payload }) => ({
      databaseId, method: 'POST', path: '/api/taller/' + accountId + '/devolver', payload,
    })),
    cancelWorkshopAccount: durableAction(client, ({ databaseId, accountId, ...payload }) => ({
      databaseId, method: 'POST', path: '/api/taller/' + accountId + '/cancelar', payload,
    })),
    billWorkshopAccount: durableAction(client, ({ databaseId, accountId, ...payload }) => ({
      databaseId, method: 'POST', path: '/api/taller/' + accountId + '/facturar', payload,
    })),
  };
}

export function OperationalStoreProvider({ client, children }) {
  const state = useSyncExternalStore(client.subscribe, client.getState);
  const writes = useMemo(() => actions(client), [client]);
  const [account, setAccount] = useState({ id: null, username: '', role: 'cajero', resolved: false });
  useEffect(() => {
    const reload = () => { client.reload({ background: !!client.getState().snapshot, recover: true, resumeRecovery: true }).catch(() => {}); };
    const refreshVisible = event => {
      if (document.hidden) return;
      const current = client.getState();
      if (current.inFlightOperationId || (!event && current.busy)) return;
      client.reload({ background: true, recover: true, resumeRecovery: !!event }).catch(() => {});
    };
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
  useEffect(() => {
    if (!state.snapshot || state.authenticationRequired) return;
    let active = true;
    let retryTimer = null;
    let attempts = 0;
    const loadAccount = () => {
      fetch('/api/account', { credentials: 'same-origin', cache: 'no-store' })
        .then(res => res.ok ? res.json() : null)
        .then(info => {
          if (!active) return;
          if (info && typeof info.username === 'string') {
            setAccount({ id: info.id ?? null, username: info.username, role: normalizeRole(info.role), resolved: true });
            return;
          }
          if (++attempts < 3) retryTimer = window.setTimeout(loadAccount, 2500);
        })
        .catch(() => {
          if (active && ++attempts < 3) retryTimer = window.setTimeout(loadAccount, 2500);
        });
    };
    loadAccount();
    return () => { active = false; if (retryTimer) window.clearTimeout(retryTimer); };
  }, [state.snapshot?.databaseId, state.authenticationRequired, state.connection]);
  const { snapshot } = state;
  const rawState = snapshot?.state;
  const databaseId = snapshot?.databaseId ?? null;
  const products = useMemo(
    () => rawState?.productos.map(p => productFromSnapshot(p, databaseId)) ?? [],
    [rawState?.productos, databaseId],
  );
  const categories = useMemo(() => catalogCategories(rawState), [rawState?.catalogo, rawState?.productos]);
  const customers = useMemo(
    () => rawState?.clientes.map(c => ({ ...recordIdentity(c, databaseId), ...readFields(c, customerFields),
      isCashCustomer: c.esContado, balance: c.deuda })) ?? [],
    [rawState?.clientes, databaseId],
  );
  const suppliers = useMemo(
    () => rawState?.suplidores.map(s => ({ ...recordIdentity(s, databaseId), ...readFields(s, supplierFields), balance: s.deuda ?? 0 })) ?? [],
    [rawState?.suplidores, databaseId],
  );
  const formulas = useMemo(
    () => rawState?.formulas.map(f => ({ ...recordIdentity(f, databaseId), name: f.nombre, costFactor: f.factorCosto,
      margins: { p1: f.recargo1, p2: f.recargo2, p3: f.recargo3 } })) ?? [],
    [rawState?.formulas, databaseId],
  );
  const settings = useMemo(() => {
    const config = rawState?.configuracion;
    return {
      databaseId, version: config?.version ?? null, business: readFields(config, businessFields),
      ...readFields(config, billingFields), allowNegativeStock: false,
      ncf: (rawState?.secuenciasNcf ?? []).map(n => ({ id: n.id, type: n.tipo, prefix: n.prefijo,
        start: n.inicio, end: n.fin, current: n.actual, expiresAt: n.vencimiento, active: n.activa, version: n.version })),
    };
  }, [rawState?.configuracion, rawState?.secuenciasNcf, databaseId]);
  const docsAndCash = useMemo(() => presentationDocsAndCash(rawState, databaseId), [
    rawState?.facturas, rawState?.compras, rawState?.abonos, rawState?.caja, databaseId,
  ]);
  const workshopAccounts = useMemo(() => {
    const order = { abierta: 0, facturada: 1, cancelada: 2 };
    return (rawState?.cuentasTaller ?? []).map(a => ({
      id: a.id,
      version: a.version,
      databaseId,
      customerId: a.clienteId,
      customerName: a.cliente,
      mechanic: a.mecanico ?? '',
      vehicle: a.vehiculo ?? '',
      note: a.nota ?? '',
      status: a.estado,
      saleId: a.ventaId ?? null,
      openedBy: a.abiertaPor,
      openedAt: a.abiertaEn,
      closedAt: a.cerradaEn ?? null,
      items: (a.items ?? []).map(item => ({
        id: item.id,
        productId: item.productoId,
        code: item.codigo,
        name: item.nombre,
        taxable: item.gravado,
        priceLevel: item.nivelPrecio,
        price: item.precio,
        priceExact: item.precioExacto ?? item.precio.toFixed(4),
        quantity: item.cantidad,
        returnedQuantity: item.cantidadDevuelta,
        netQuantity: item.cantidadNeta,
        dispatchedBy: item.despachadoPor,
        withdrawnBy: item.retiradoPor ?? '',
        createdAt: item.creadoEn,
      })),
    })).sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || b.id - a.id);
  }, [rawState?.cuentasTaller, databaseId]);
  const reminders = useMemo(
    () => (rawState?.recordatorios ?? []).map(r => ({
      ...recordIdentity(r, databaseId),
      title: r.titulo,
      note: r.nota ?? '',
      dueDate: r.fechaLimite ?? null,
      dueTime: r.horaLimite ?? '',
      priority: r.prioridad,
      status: r.estado,
      customerId: r.clienteId ?? null,
      supplierId: r.suplidorId ?? null,
      productId: r.productoId ?? null,
      createdBy: r.creadoPor ?? '',
      completedBy: r.completadoPor ?? null,
      completedAt: r.completadoEn ?? null,
      createdAt: r.creadoEn ?? null,
      updatedAt: r.actualizadoEn ?? null,
    })),
    [rawState?.recordatorios, databaseId],
  );
  const rawRole = account.resolved ? account.role : (state.viewerRole ?? 'dueno');
  const role = normalizeRole(rawRole);
  const desktopMode = typeof window !== 'undefined' && Boolean(window.__FELIX_DESKTOP__);
  const runtime = useMemo(() => ({
    ...state, mode: desktopMode ? 'desktop' : 'online', databaseId, revision: snapshot?.revision ?? null,
    role, isOwner: isOwner(role), account,
    accountDetailsAvailable: true, reload: client.reload, retryPending: client.retryPending,
    readArchives: client.readArchives, archivePending: client.archivePending, logout: client.logout,
  }), [state, desktopMode, databaseId, snapshot?.revision, role, account, client]);
  const value = useMemo(() => ({
    runtime, products, categories, customers, suppliers, formulas, settings, workshopAccounts, reminders, ...docsAndCash, ...writes,
  }), [runtime, products, categories, customers, suppliers, formulas, settings, workshopAccounts, reminders, docsAndCash, writes]);
  return <PosStoreContext.Provider value={value}>
    {children}
  </PosStoreContext.Provider>;
}

import { cents, costUnits, decimalUnits, money, quantityUnits } from '../../../src/pos/operation-fields.js';
import { saleDocumentTotals, saleLineAmounts } from '../../../src/domain/sale-pricing.js';

const quantityOf = value => quantityUnits(value, 'la cantidad', 0.01);
const levels = { p1: 'precio1', p2: 'precio2', p3: 'precio3' };

export function updateSaleLine(items, product, level, value, replace = false) {
  const units = quantityOf(value);
  const key = product.id + '-' + level;
  const existing = items.find(item => item.key === key);
  let used = 0n;
  for (const item of items) {
    if (item.product.databaseId !== product.databaseId) throw new Error('La base cambió. Inicia una nueva venta.');
    if (item.product.id !== product.id) continue;
    if (item.product.version !== product.version) throw new Error('El producto cambió. Retíralo y agrégalo de nuevo.');
    if (!replace || item.key !== key) used += quantityOf(item.quantity);
  }
  if (used + units > quantityUnits(product.stock, 'las existencias')) {
    throw new Error('Existencias insuficientes. Hay ' + product.stock + ' unidades de ' + product.name + '.');
  }
  const quantity = Number(decimalUnits(units + (!replace && existing ? quantityOf(existing.quantity) : 0n), 2));
  const line = { key, product, priceLevel: level, quantity };
  if (existing) return items.map(item => item.key === key ? line : item);
  if (items.length >= 1000) throw new Error('La factura admite hasta 1000 líneas.');
  return [...items, line];
}

function normalizeDiscount(discount) {
  if (discount && typeof discount === 'object') {
    const mode = discount.mode === 'amount' ? 'amount' : 'percent';
    const raw = discount.value === undefined || discount.value === null ? '' : String(discount.value).trim();
    return { mode, raw };
  }
  const raw = discount === undefined || discount === null || discount === 0 || discount === '' ? '' : String(discount).trim();
  return { mode: 'percent', raw };
}

export function quoteSale(items, percent, discount = 0) {
  const rate = costUnits(percent, 'la tasa de ITBIS');
  let count = 0n;
  const computed = [];
  const lines = items.map(item => {
    const unitPrice = (item.product.pricesExact ?? item.product.prices)[item.priceLevel];
    const quantity = quantityOf(item.quantity);
    const amounts = saleLineAmounts(costUnits(unitPrice, 'el precio'), quantity, item.product.taxable ? rate : 0n);
    count += quantity;
    computed.push({ ...amounts, taxable: item.product.taxable });
    return { ...item, unitPrice, subtotal: Number(money(amounts.total)), itbis: Number(money(amounts.tax)) };
  });
  const grossTotalCents = computed.reduce((sum, line) => sum + line.total, 0n);
  const { mode, raw } = normalizeDiscount(discount);
  let discountBps = 0n;
  let discountAmountCents = null;
  let discountError = null;
  if (raw !== '') {
    try {
      const units = cents(raw, mode === 'amount' ? 'el monto de descuento' : 'el porcentaje de descuento');
      if (mode === 'percent') {
        if (units > 10000n) discountError = 'El descuento no puede superar el 100 %.';
        else discountBps = units;
      } else {
        if (grossTotalCents > 0n && units > grossTotalCents) {
          discountError = 'El descuento no puede superar el total de la venta.';
        } else if (grossTotalCents > 0n) {
          discountAmountCents = units;
        }
      }
    } catch {
      discountError = mode === 'amount'
        ? 'Indica un monto de descuento válido (hasta dos decimales).'
        : 'Indica un porcentaje entre 0 % y 100 % (hasta dos decimales).';
    }
  }
  const doc = saleDocumentTotals(computed, discountBps, rate, discountAmountCents);
  return {
    lines,
    discountError,
    totals: {
      items: Number(decimalUnits(count, 2)),
      subtotal: Number(money(doc.base)),
      grossTotal: Number(money(doc.grossTotal)),
      discount: Number(money(doc.discount)),
      discountPercent: Number(money(doc.discountBps)),
      itbis: Number(money(doc.tax)),
      total: Number(money(doc.total)),
    },
  };
}

export function saleRequest(items, settings, customerId, condition, comprobante, cashSession, paymentMethod, discount = 0, dueDate = null) {
  if (!items.length || items.some(item => item.product.databaseId !== settings.databaseId)) {
    throw new Error('Revisa la base y los artículos de la venta.');
  }
  if (cashSession && (!cashSession.open || !Number.isSafeInteger(cashSession.id))) {
    throw new Error('La caja está cerrada. Ábrela para facturar.');
  }
  const { mode, raw } = normalizeDiscount(discount);
  let discountField = {};
  if (raw !== '') {
    const units = cents(raw, mode === 'amount' ? 'el monto de descuento' : 'el porcentaje de descuento');
    if (units > 0n) {
      if (mode === 'amount') discountField = { descuentoMonto: Number(money(units)) };
      else {
        if (units > 10000n) throw new Error('El descuento no puede superar el 100 %.');
        discountField = { descuentoPorcentaje: Number(money(units)) };
      }
    }
  }
  return { databaseId: settings.databaseId, clienteId: customerId,
    ...(cashSession ? { cajaId: cashSession.id, metodoPago: condition === 'credito' ? 'credito' : paymentMethod } : {}),
    condicion: condition === 'credito' ? 'Credito' : 'Contado', tipoComprobante: comprobante,
    ...discountField,
    ...(condition === 'credito' && dueDate ? { vencimiento: dueDate } : {}),
    versionConfiguracion: settings.version,
    items: items.map(({ product, priceLevel, quantity }) => ({ productoId: product.id, versionProducto: product.version,
      nivelPrecio: levels[priceLevel], cantidad: decimalUnits(quantityOf(quantity), 2) })) };
}

export function quoteWorkshopItems(items, percent, discount = 0) {
  const rate = costUnits(percent, 'la tasa de ITBIS');
  let count = 0n;
  const computed = [];
  const lines = items.map(item => {
    const netQty = quantityUnits(item.netQuantity ?? 0, 'la cantidad neta');
    if (netQty <= 0n) {
      return { ...item, subtotal: 0, itbis: 0, base: 0 };
    }
    const unitPrice = item.priceExact ?? item.price;
    const amounts = saleLineAmounts(costUnits(unitPrice, 'el precio'), netQty, item.taxable ? rate : 0n);
    count += netQty;
    computed.push({ ...amounts, taxable: Boolean(item.taxable) });
    return {
      ...item,
      subtotal: Number(money(amounts.total)),
      itbis: Number(money(amounts.tax)),
      base: Number(money(amounts.base)),
    };
  });
  const grossTotalCents = computed.reduce((sum, line) => sum + line.total, 0n);
  const { mode, raw } = normalizeDiscount(discount);
  let discountBps = 0n;
  let discountAmountCents = null;
  let discountError = null;
  if (raw !== '') {
    try {
      const units = cents(raw, mode === 'amount' ? 'el monto de descuento' : 'el porcentaje de descuento');
      if (mode === 'percent') {
        if (units > 10000n) discountError = 'El descuento no puede superar el 100 %.';
        else discountBps = units;
      } else {
        if (grossTotalCents > 0n && units > grossTotalCents) {
          discountError = 'El descuento no puede superar el total de la cuenta.';
        } else if (grossTotalCents > 0n) {
          discountAmountCents = units;
        }
      }
    } catch {
      discountError = mode === 'amount'
        ? 'Indica un monto de descuento válido (hasta dos decimales).'
        : 'Indica un porcentaje entre 0 % y 100 % (hasta dos decimales).';
    }
  }
  const doc = saleDocumentTotals(computed, discountBps, rate, discountAmountCents);
  return {
    lines,
    discountError,
    totals: {
      items: Number(decimalUnits(count, 2)),
      subtotal: Number(money(doc.base)),
      grossTotal: Number(money(doc.grossTotal)),
      discount: Number(money(doc.discount)),
      discountPercent: Number(money(doc.discountBps)),
      itbis: Number(money(doc.tax)),
      total: Number(money(doc.total)),
    },
  };
}

export function workshopBillRequest(account, settings, customerId, condition, comprobante, cashSession, paymentMethod, discount = 0, dueDate = null) {
  if (!account || account.databaseId !== settings.databaseId) {
    throw new Error('La base cambió. Actualiza antes de cobrar la cuenta.');
  }
  if (!cashSession?.open || !Number.isSafeInteger(cashSession.id)) {
    throw new Error('La caja está cerrada. Ábrela para cobrar esta cuenta.');
  }
  const { mode, raw } = normalizeDiscount(discount);
  let discountField = {};
  if (raw !== '') {
    const units = cents(raw, mode === 'amount' ? 'el monto de descuento' : 'el porcentaje de descuento');
    if (units > 0n) {
      if (mode === 'amount') discountField = { descuentoMonto: Number(money(units)) };
      else {
        if (units > 10000n) throw new Error('El descuento no puede superar el 100 %.');
        discountField = { descuentoPorcentaje: Number(money(units)) };
      }
    }
  }
  return {
    databaseId: settings.databaseId,
    accountId: account.id,
    version: account.version,
    clienteId: customerId,
    cajaId: cashSession.id,
    condicion: condition === 'credito' ? 'Credito' : 'Contado',
    tipoComprobante: comprobante,
    metodoPago: condition === 'credito' ? 'credito' : paymentMethod,
    ...discountField,
    ...(condition === 'credito' && dueDate ? { vencimiento: dueDate } : {}),
    versionConfiguracion: settings.version,
  };
}

export function receiptFromConfirmation(snapshot) {
  const saleId = snapshot.result?.ventaId ?? snapshot.result?.id;
  const doc = snapshot.state.facturas.find(row => row.id === saleId);
  if (!doc) throw new Error('Falta la factura en la confirmación del servidor.');
  const localReference = typeof snapshot.localReceipt === 'string' ? snapshot.localReceipt : null;
  return { invoiceNumber: localReference ? 'Local ' + localReference.slice(0, 8) : 'Registro ' + doc.id,
    ...(localReference ? { localReference } : {}), dateOnly: doc.fechaISO, dueDate: doc.vencimiento ?? null,
    customerName: doc.cliente, customerRnc: doc.clienteRnc, ncf: localReference ? null : doc.ncf,
    comprobante: doc.tipoComprobante, itbisRate: null,
    conditionLabel: doc.condicion === 'Credito' ? 'Crédito' : 'Contado',
    paymentLabel: { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', credito: 'Crédito' }[doc.metodoPago],
    totals: {
      subtotal: doc.base,
      ...((doc.descuento ?? 0) > 0 ? { grossTotal: Math.round((doc.total + doc.descuento) * 100) / 100 } : {}),
      discount: doc.descuento ?? 0,
      discountPercent: doc.descuentoPorcentaje ?? 0,
      itbis: doc.itbis,
      total: doc.total,
    },
    lines: doc.items.map(row => ({ key: row.id, product: { name: row.nombre }, quantity: row.cant,
      unitPrice: row.precioExacto ?? row.precio, subtotal: row.subtotal })) };
}

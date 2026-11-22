import { costUnits, decimalUnits, money, quantityUnits } from '../../../src/pos/operation-fields.js';
import { saleLineAmounts } from '../../../src/domain/sale-pricing.js';

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

export function quoteSale(items, percent) {
  const rate = costUnits(percent, 'la tasa de ITBIS');
  let count = 0n, total = 0n, base = 0n;
  const lines = items.map(item => {
    const unitPrice = (item.product.pricesExact ?? item.product.prices)[item.priceLevel];
    const quantity = quantityOf(item.quantity);
    const amounts = saleLineAmounts(costUnits(unitPrice, 'el precio'), quantity, item.product.taxable ? rate : 0n);
    count += quantity;
    total += amounts.total;
    base += amounts.base;
    return { ...item, unitPrice, subtotal: Number(money(amounts.total)), itbis: Number(money(amounts.tax)) };
  });
  return { lines, totals: { items: Number(decimalUnits(count, 2)), subtotal: Number(money(base)),
    discount: 0, itbis: Number(money(total - base)), total: Number(money(total)) } };
}

export function saleRequest(items, settings, customerId, condition, comprobante) {
  if (!items.length || items.some(item => item.product.databaseId !== settings.databaseId)) {
    throw new Error('Revisa la base y los artículos de la venta.');
  }
  return { databaseId: settings.databaseId, clienteId: customerId,
    condicion: condition === 'credito' ? 'Credito' : 'Contado', tipoComprobante: comprobante,
    versionConfiguracion: settings.version,
    items: items.map(({ product, priceLevel, quantity }) => ({ productoId: product.id, versionProducto: product.version,
      nivelPrecio: levels[priceLevel], cantidad: decimalUnits(quantityOf(quantity), 2) })) };
}

export function receiptFromConfirmation(snapshot) {
  const doc = snapshot.state.facturas.find(row => row.id === snapshot.result.id);
  if (!doc) throw new Error('Falta la factura en la confirmación del servidor.');
  return { invoiceNumber: 'Registro ' + doc.id, dateOnly: doc.fechaISO, customerName: doc.cliente,
    customerRnc: doc.clienteRnc, ncf: doc.ncf, comprobante: doc.tipoComprobante, itbisRate: null,
    conditionLabel: doc.condicion === 'Credito' ? 'Crédito' : 'Contado',
    totals: { subtotal: doc.base, itbis: doc.itbis, total: doc.total },
    lines: doc.items.map(row => ({ key: row.id, product: { name: row.nombre }, quantity: row.cant,
      unitPrice: row.precioExacto ?? row.precio, subtotal: row.subtotal })) };
}

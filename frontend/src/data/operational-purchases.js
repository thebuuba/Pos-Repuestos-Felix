import { calculateCascadeFormula, calculateCascadeFromCost, normalizeFormula } from '../../../src/domain/pricing.js';
import { costUnits, decimalUnits, money, quantityUnits } from '../../../src/pos/operation-fields.js';

export const purchaseDecimal = value => String(value).replace(/^\./, '0.').replace(/^0+(?=\d)/, '');

export function cleanPurchaseDecimal(value) {
  if (value === null || value === undefined || value === '') return '';
  const text = String(value).trim();
  const match = /^(\d+)\.(\d+)$/.exec(text);
  if (!match) return text;
  const trimmed = match[2].replace(/0+$/, '');
  const fraction = trimmed.length <= 2 ? trimmed.padEnd(2, '0') : trimmed;
  return `${match[1]}.${fraction}`;
}

export function purchaseLineAmounts(cost, quantity) {
  const units = quantityUnits(purchaseDecimal(quantity), 'la cantidad', 0.01);
  const unitCost = costUnits(purchaseDecimal(cost), 'el costo');
  const cents = (unitCost * units + 5000n) / 10000n;
  return { units, cents, subtotal: money(cents) };
}

export function purchaseCostFromList(listPrice, formula) {
  const decimal = purchaseDecimal(listPrice);
  if (!decimal) return '';
  if (!formula) {
    costUnits(decimal, 'el precio de lista');
    return decimal;
  }
  return calculateCascadeFormula(decimal, formula, 0).cost;
}

export function purchaseListFromCost(cost, formula) {
  if (cost === null || cost === undefined || cost === '') return '';
  const decimal = purchaseDecimal(cost);
  if (!decimal) return '';
  try {
    const unitCost = costUnits(decimal, 'el costo');
    if (unitCost === 0n) return cleanPurchaseDecimal(decimal);
    if (!formula || formula.costFactor === null || formula.costFactor === undefined || formula.costFactor === '') {
      return cleanPurchaseDecimal(decimal);
    }
    const normalized = normalizeFormula({ costFactor: formula.costFactor, margins: { p1: 0, p2: 0, p3: 0 } }).costFactor;
    const factorUnits = BigInt(normalized.replace('.', ''));
    if (factorUnits === 0n) return cleanPurchaseDecimal(decimal);
    const numerator = unitCost * 1_000_000n;
    const denominator = factorUnits * 100n;
    const cents = (numerator + denominator / 2n) / denominator;
    return money(cents);
  } catch {
    return cleanPurchaseDecimal(decimal);
  }
}

export function purchaseSuggestedPrices(cost, formula, rounding = 0) {
  if (!formula || cost === '' || cost === null || cost === undefined) return null;
  const decimal = purchaseDecimal(cost);
  return calculateCascadeFromCost(decimal, formula, rounding).prices;
}

export function purchasePrices(cost, _formula, _rounding, existingPrices) {
  const decimal = purchaseDecimal(cost);
  costUnits(decimal, 'el costo');
  return existingPrices
    ? { p1: cleanPurchaseDecimal(existingPrices.p1), p2: cleanPurchaseDecimal(existingPrices.p2) }
    : {};
}

export function purchaseOperation(input) {
  return {
    databaseId: input.databaseId, method: 'POST', path: '/api/compras',
    payload: {
      suplidorId: input.supplierId, numero: input.supplierInvoice,
      ...(input.date ? { fecha: input.date } : {}),
      ...(input.condition ? { condicion: input.condition === 'credito' ? 'Credito' : 'Contado' } : {}),
      ...(input.condition === 'credito' && input.dueDate ? { vencimiento: input.dueDate } : {}),
      items: input.lines.map(line => {
        const p1 = purchaseDecimal(line.prices.p1);
        const p2 = purchaseDecimal(line.prices.p2);
        const p3 = line.prices.p3 !== undefined && line.prices.p3 !== '' ? purchaseDecimal(line.prices.p3) : p2;
        return {
          productoId: line.productId ?? null, versionProducto: line.productVersion ?? null,
          codigo: line.code,
          ...(line.reference !== undefined ? { referencia: line.reference } : {}),
          nombre: line.name, cantidad: purchaseDecimal(line.quantity), costo: purchaseDecimal(line.cost),
          precio1: p1, precio2: p2, precio3: p3,
        };
      }),
    },
  };
}

export function purchaseTotals(lines) {
  if (lines.some(line => line.cents === undefined)) return { total: null, units: '—' };
  const units = decimalUnits(lines.reduce((sum, line) => sum + line.units, 0n), 2);
  try {
    return { units, total: money(lines.reduce((sum, line) => sum + line.cents, 0n)) };
  } catch (error) {
    return { units, total: null, error: error.message };
  }
}

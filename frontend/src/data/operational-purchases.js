import { calculateFormula } from '../../../src/domain/pricing.js';
import { costUnits, decimalUnits, money, quantityUnits } from '../../../src/pos/operation-fields.js';

export const purchaseDecimal = value => String(value).replace(/^\./, '0.').replace(/^0+(?=\d)/, '');

export function purchaseLineAmounts(cost, quantity) {
  const units = quantityUnits(purchaseDecimal(quantity), 'la cantidad', 0.01);
  const unitCost = costUnits(purchaseDecimal(cost), 'el costo');
  const cents = (unitCost * units + 5000n) / 10000n;
  return { units, cents, subtotal: money(cents) };
}

export function purchasePrices(cost, formula, rounding, existingPrices) {
  const decimal = purchaseDecimal(cost);
  if (formula) {
    const { prices } = calculateFormula(decimal, formula, rounding);
    return Object.fromEntries(Object.entries(prices).map(([key, value]) => [key, String(Number(value))]));
  }
  costUnits(decimal, 'el costo');
  return existingPrices ?? {};
}

export function purchaseOperation(input) {
  return {
    databaseId: input.databaseId, method: 'POST', path: '/api/compras',
    payload: {
      suplidorId: input.supplierId, numero: input.supplierInvoice,
      items: input.lines.map(line => ({
        productoId: line.productId ?? null, versionProducto: line.productVersion ?? null,
        codigo: line.code, nombre: line.name, cantidad: purchaseDecimal(line.quantity), costo: purchaseDecimal(line.cost),
        precio1: purchaseDecimal(line.prices.p1), precio2: purchaseDecimal(line.prices.p2), precio3: purchaseDecimal(line.prices.p3),
      })),
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

// Precio en diezmilésimas de peso, cantidad en centésimas de unidad y
// tasa de ITBIS en millonésimas (18 % = 180000). Los precios incluyen ITBIS.
export function saleLineAmounts(priceUnits, quantityUnits, taxRateUnits) {
  const total = (priceUnits * quantityUnits + 5000n) / 10000n;
  const divisor = 1000000n + taxRateUnits;
  const base = (total * 1000000n + divisor / 2n) / divisor;
  return { total, base, tax: total - base };
}

// Redondea el total final de una venta a pesos dominicanos enteros (RD$ 1).
// Un total positivo menor a RD$ 0.50 sube a RD$ 1.00 para nunca regalar una venta cobrada.
export function roundSaleTotalCents(totalCents) {
  if (totalCents <= 0n) return 0n;
  const rounded = ((totalCents + 50n) / 100n) * 100n;
  return rounded === 0n ? 100n : rounded;
}

// discountBps en centésimas de porcentaje (5 % = 500n, 15 % = 1500n).
// discountAmountCents (opcional) en centavos de peso (RD$ 50.00 = 5000n).
export function saleDocumentTotals(lines, discountBps = 0n, taxRateUnits = 0n, discountAmountCents = null) {
  const gross = lines.reduce(
    (sum, line) => ({
      base: sum.base + line.base,
      tax: sum.tax + line.tax,
      total: sum.total + line.total,
      taxableTotal: sum.taxableTotal + (line.taxable ? line.total : 0n),
    }),
    { base: 0n, tax: 0n, total: 0n, taxableTotal: 0n },
  );
  let discount = 0n;
  let effectiveBps = discountBps || 0n;
  if (discountAmountCents !== null && discountAmountCents !== undefined) {
    if (discountAmountCents < 0n || discountAmountCents > gross.total) {
      throw new RangeError('El descuento no puede superar el total de la venta.');
    }
    discount = discountAmountCents;
    effectiveBps = gross.total > 0n
      ? (discount * 10000n + gross.total / 2n) / gross.total
      : 0n;
    if (effectiveBps > 10000n) effectiveBps = 10000n;
  } else if (effectiveBps > 0n && gross.total > 0n) {
    discount = (gross.total * effectiveBps + 5000n) / 10000n;
  }
  const rawTotal = gross.total - discount;
  const total = roundSaleTotalCents(rawTotal);
  const roundingAdjustment = total - rawTotal;
  if (gross.total === 0n || total === 0n) {
    return {
      grossTotal: gross.total,
      discount,
      discountBps: effectiveBps,
      base: 0n,
      tax: 0n,
      total: 0n,
      roundingAdjustment: 0n,
    };
  }
  if (discount === 0n && roundingAdjustment === 0n) {
    return {
      grossTotal: gross.total,
      discount: 0n,
      discountBps: 0n,
      base: gross.base,
      tax: gross.tax,
      total: gross.total,
      roundingAdjustment: 0n,
    };
  }
  const taxableNet = (total * gross.taxableTotal + gross.total / 2n) / gross.total;
  const exemptNet = total - taxableNet;
  const divisor = 1000000n + taxRateUnits;
  const taxableBase = (taxableNet * 1000000n + divisor / 2n) / divisor;
  const base = taxableBase + exemptNet;
  return {
    grossTotal: gross.total,
    discount,
    discountBps: effectiveBps,
    base,
    tax: total - base,
    total,
    roundingAdjustment,
  };
}

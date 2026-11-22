// Precio en diezmilésimas de peso, cantidad en centésimas de unidad y
// tasa de ITBIS en millonésimas (18 % = 180000). Los precios incluyen ITBIS.
export function saleLineAmounts(priceUnits, quantityUnits, taxRateUnits) {
  const total = (priceUnits * quantityUnits + 5000n) / 10000n;
  const divisor = 1000000n + taxRateUnits;
  const base = (total * 1000000n + divisor / 2n) / divisor;
  return { total, base, tax: total - base };
}

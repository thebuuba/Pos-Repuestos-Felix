// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { ITBIS_RATE } from "./format.js";
import { round2 } from "./format.js";
function toLines(items, rate = ITBIS_RATE) {
  return items.map((item) => {
    const unitPrice = item.product.prices[item.priceLevel];
    const subtotal = round2(unitPrice * item.quantity);
    const itbis = item.product.taxable ? round2(subtotal * rate) : 0;
    return {
      ...item,
      unitPrice,
      subtotal,
      itbis,
    };
  });
}
function computeTotals(lines, discountPct) {
  const pct = Math.min(Math.max(discountPct, 0), 100) / 100;
  const subtotal = lines.reduce((s, l) => s + l.subtotal, 0);
  const rawItbis = lines.reduce((s, l) => s + l.itbis, 0);
  const discount = round2(subtotal * pct);
  const itbis = round2(rawItbis * (1 - pct));
  return {
    items: lines.reduce((s, l) => s + l.quantity, 0),
    subtotal: round2(subtotal),
    discount,
    itbis,
    total: round2(subtotal - discount + itbis),
  };
}
export { toLines, computeTotals };

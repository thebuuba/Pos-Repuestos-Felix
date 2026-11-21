// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { round2 } from "./format.js";
var PRICE_KEYS = ["p1", "p2", "p3"];
function roundPrice(value, step) {
  if (!step || step <= 0) return round2(value);
  return Math.ceil(value / step) * step;
}
function adjustedCost(cost, formula) {
  return round2(cost * (formula?.costFactor ?? 1));
}
function pricesFromFormula(cost, formula, rounding) {
  const base = adjustedCost(cost, formula);
  const m = formula?.margins ?? {
    p1: 35,
    p2: 25,
    p3: 15,
  };
  return {
    p1: roundPrice(base * (1 + m.p1 / 100), rounding),
    p2: roundPrice(base * (1 + m.p2 / 100), rounding),
    p3: roundPrice(base * (1 + m.p3 / 100), rounding),
  };
}
function marginPct(price, cost) {
  if (!price) return 0;
  return ((price - cost) / price) * 100;
}
function formulaSummary(f) {
  const factor = f.costFactor === 1 ? "" : `costo ×${f.costFactor} · `;
  return `${factor}${f.margins.p1}% / ${f.margins.p2}% / ${f.margins.p3}%`;
}
export {
  pricesFromFormula,
  formulaSummary,
  PRICE_KEYS,
  marginPct,
  adjustedCost,
};

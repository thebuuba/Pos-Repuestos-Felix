// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import {
  calculateCascadeFormula,
  calculateCascadeFromCost,
  calculateFormula,
} from "../../../src/domain/pricing.js";
const PRICE_KEYS = ["p1", "p2", "p3"];
const ACTIVE_PRICE_KEYS = ["p1", "p2"];
const DEFAULT_MARGINS = { p1: 35, p2: 25, p3: 15 };
const NO_MARGINS = { p1: 0, p2: 0, p3: 0 };
function adjustedCost(cost, formula) {
  const result = calculateFormula(
    cost,
    { costFactor: formula?.costFactor ?? 1, margins: NO_MARGINS },
    0,
  );
  return Number(result.adjustedCost);
}
function pricesFromFormula(cost, formula, rounding = 0) {
  const { prices } = calculateFormula(
    cost,
    {
      costFactor: formula?.costFactor ?? 1,
      margins: formula?.margins ?? DEFAULT_MARGINS,
    },
    rounding,
  );
  return Object.fromEntries(PRICE_KEYS.map((key) => [key, Number(prices[key])]));
}
function cascadeFromListPrice(listPrice, formula, rounding = 0) {
  return calculateCascadeFormula(listPrice, formula, rounding);
}
function cascadeFromCost(cost, formula, rounding = 0) {
  return calculateCascadeFromCost(cost, formula, rounding);
}
function factorFromPercent(percent) {
  const n = Number(percent);
  if (!Number.isFinite(n)) return "";
  const factor = Math.round((1 + n / 100) * 10000) / 10000;
  return `×${factor}`;
}
function marginPct(price, cost) {
  if (!price) return 0;
  return ((price - cost) / price) * 100;
}
function formulaSummary(f) {
  const parts = [];
  if (Number(f.costFactor) !== 1) parts.push(`Costo ×${f.costFactor}`);
  parts.push(`Mayor +${f.margins.p2}%`);
  parts.push(`Detalle +${f.margins.p1}%`);
  return parts.join(" · ");
}
export {
  ACTIVE_PRICE_KEYS,
  PRICE_KEYS,
  adjustedCost,
  cascadeFromCost,
  cascadeFromListPrice,
  factorFromPercent,
  formulaSummary,
  marginPct,
  pricesFromFormula,
};

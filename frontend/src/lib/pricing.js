// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { calculateFormula } from "../../../src/domain/pricing.js";
const PRICE_KEYS = ["p1", "p2", "p3"];
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

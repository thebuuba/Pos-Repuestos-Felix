// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
var ITBIS_RATE = 0.18;
var CURRENCY = "RD$";
var moneyFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
var intFormatter = new Intl.NumberFormat("en-US");
function formatMoney(value, withSymbol = true) {
  const formatted = moneyFormatter.format(value);
  return withSymbol ? `${CURRENCY} ${formatted}` : formatted;
}
function formatNumber(value) {
  return intFormatter.format(value);
}
function splitMoney(value) {
  const [whole, cents] = moneyFormatter.format(value).split(".");
  return {
    whole,
    cents: cents ?? "00",
  };
}
function round2(value) {
  return Math.round(value * 100) / 100;
}
export { ITBIS_RATE, round2, formatMoney, splitMoney, CURRENCY, formatNumber };

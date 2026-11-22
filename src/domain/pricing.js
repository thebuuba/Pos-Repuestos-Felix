const PRICE_KEYS = ['p1', 'p2', 'p3'];
const FACTOR_SCALE = 1_000n;
const PERCENT_SCALE = 1_000_000n; // 100 percent at four decimal places.
const MAX_CENTS = 99_999_999_999_999n;
const ROUNDING_STEPS = [0, 1, 5, 10, 25];

function scaledDecimal(value, wholeDigits, scale, label) {
  const decimal = typeof value === 'number' && !Object.is(value, -0) ? String(value) : value;
  const pattern = new RegExp(`^0*(\\d{1,${wholeDigits}})(?:\\.(\\d{1,${scale}}))?$`);
  const match = typeof decimal === 'string' && pattern.exec(decimal);
  if (!match || match[0] !== decimal) {
    throw new RangeError(`Usa hasta ${wholeDigits} dígitos enteros y hasta ${scale} decimales para ${label}.`);
  }
  const [, whole, fraction = ''] = match;
  return BigInt(whole + fraction.padEnd(scale, '0'));
}

function decimalString(value, scale) {
  const digits = String(value).padStart(scale + 1, '0');
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

function formulaUnits(formula) {
  const costFactor = scaledDecimal(formula?.costFactor, 6, 3, 'el factor de costo');
  if (costFactor === 0n) throw new RangeError('El factor de costo debe ser mayor que cero.');
  const margins = Object.fromEntries(PRICE_KEYS.map((key) => [
    key,
    scaledDecimal(formula?.margins?.[key], 5, 4, `el recargo ${key.toUpperCase()}`),
  ]));
  return { costFactor, margins };
}

export function normalizeFormula(formula) {
  const { costFactor, margins } = formulaUnits(formula);
  return {
    costFactor: decimalString(costFactor, 3),
    margins: Object.fromEntries(PRICE_KEYS.map((key) => [key, decimalString(margins[key], 4)])),
  };
}

function money(cents) {
  if (cents > MAX_CENTS) throw new RangeError('El importe calculado excede el límite permitido.');
  return decimalString(cents, 2);
}

function halfUp(numerator, denominator) {
  return (numerator + denominator / 2n) / denominator;
}

export function calculateFormula(cost, formula, rounding) {
  if (!ROUNDING_STEPS.includes(rounding)) throw new RangeError('Revisa el paso de redondeo.');
  const costCents = scaledDecimal(cost, 12, 2, 'el costo');
  const { costFactor, margins } = formulaUnits(formula);
  const adjustedCents = halfUp(costCents * costFactor, FACTOR_SCALE);
  const adjustedCost = money(adjustedCents);
  const stepCents = BigInt(rounding) * 100n;
  const stepNumerator = PERCENT_SCALE * stepCents;
  const prices = Object.fromEntries(PRICE_KEYS.map((key) => {
    const numerator = adjustedCents * (PERCENT_SCALE + margins[key]);
    const cents = rounding === 0
      ? halfUp(numerator, PERCENT_SCALE)
      : ((numerator + stepNumerator - 1n) / stepNumerator) * stepCents;
    return [key, money(cents)];
  }));
  return { adjustedCost, prices };
}

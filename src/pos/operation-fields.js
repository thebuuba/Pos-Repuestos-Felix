const maxCents = 99999999999999n;
const maxQuantity = 214748364700n;
export class OperationError extends Error {
  constructor(message, status, cause) {
    super(message, { cause });
    this.status = status;
  }
}
export function fail(message, status = 400) { throw new OperationError(message, status); }
export function text(value, label, required = true) {
  if (typeof value !== 'string' || value.length > 2000 || (required && !value.trim())) fail(`Revisa ${label}.`);
  return value.trim();
}
export function productCode(value) {
  text(value, 'el código');
  return value;
}
export function integer(value, label, min = 1) {
  if (!Number.isSafeInteger(value) || value < min || value > 2147483647) fail(`Revisa ${label}.`);
  return value;
}
export function id(value, label = 'el identificador') {
  if (!Number.isSafeInteger(value) || value < 1) fail(`Revisa ${label}.`);
  return value;
}
function scaledUnits(value, label, scale, pattern) {
  const decimal = ['number', 'string'].includes(typeof value) ? String(value) : '';
  const match = pattern.exec(decimal);
  if (!match || match[0] !== decimal) fail(`Revisa ${label}: usa hasta ${scale === 2 ? 'dos' : 'cuatro'} decimales.`);
  const [, whole, fraction = ''] = match;
  return BigInt(whole + fraction.padEnd(scale, '0'));
}
const twoDecimals = /^(\d{1,12})(?:\.(\d{1,2}))?$/;
const fourDecimals = /^(\d{1,12})(?:\.(\d{1,4}))?$/;
export function cents(value, label = 'el importe') {
  return scaledUnits(value, label, 2, twoDecimals);
}
export function quantityUnits(value, label, min = 0) {
  const quantity = scaledUnits(value, label, 2, twoDecimals);
  if (quantity < scaledUnits(min, label, 2, twoDecimals) || quantity > maxQuantity) fail(`Revisa ${label}: la cantidad está fuera del límite permitido.`);
  return quantity;
}
export function costUnits(value, label) {
  const cost = scaledUnits(value, label, 4, fourDecimals);
  if (cost > maxCents * 100n) fail(`El importe de ${label} es demasiado alto.`);
  return cost;
}
export function decimalUnits(value, scale) {
  const digits = String(value < 0n ? -value : value).padStart(scale + 1, '0');
  return `${value < 0n ? '-' : ''}${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}
export function money(value) {
  if (value < 0n || value > maxCents) fail('El importe excede el límite permitido.');
  return decimalUnits(value, 2);
}

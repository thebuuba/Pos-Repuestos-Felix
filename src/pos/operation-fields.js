const maxCents = 99999999999999n;
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
export function integer(value, label, min = 1) {
  if (!Number.isSafeInteger(value) || value < min || value > 2147483647) fail(`Revisa ${label}.`);
  return value;
}
export function id(value, label = 'el identificador') {
  if (!Number.isSafeInteger(value) || value < 1) fail(`Revisa ${label}.`);
  return value;
}
export function cents(value, label = 'el importe') {
  if (!['number', 'string'].includes(typeof value) || !/^\d{1,12}(?:\.\d{1,2})?$/.test(String(value))) fail(`Revisa ${label}: usa hasta dos decimales.`);
  const [whole, fraction = ''] = String(value).split('.');
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (result > maxCents) fail(`El importe de ${label} es demasiado alto.`);
  return result;
}
export function money(value) {
  if (value < 0n || value > maxCents) fail('El importe excede el límite permitido.');
  return `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
}

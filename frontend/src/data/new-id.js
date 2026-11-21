export function newId(prefix) {
  return prefix + '-' + crypto.randomUUID();
}

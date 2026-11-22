export function productForBarcode(products, code, format) {
  const codes = [code];
  // UPC-A and EAN-13 starting with zero have identical bars. Only a camera's
  // decoded format permits this equivalence; keyboard codes stay literal.
  if (format === 'UPC_A' && /^\d{12}$/.test(code)) codes.push('0' + code);
  if (format === 'EAN_13' && /^0\d{12}$/.test(code)) codes.push(code.slice(1));
  const matches = products.filter(product => codes.includes(product.code));
  const similar = matches.length ? matches : products.filter(product => product.code.toLowerCase() === code.toLowerCase());
  if (matches.length > 1 || similar.length > 1)
    throw new Error(`El código «${code}» corresponde a varios artículos. Revisa el catálogo antes de agregarlo.`);
  if (matches.length === 1) return matches[0];
  throw new Error(`No hay un artículo con el código exacto «${code}». Revisa Inventario o búscalo por nombre y selecciónalo.`);
}

// ponytail: HID readers look like keyboards. Timing is a conservative heuristic,
// not device identification; slow readers/short codes can use the focused search.
export function createKeyboardScan() {
  let code = '', first = 0, last = 0, invalid = false;
  const reset = () => { code = ''; first = last = 0; invalid = false; };
  return {
    reset,
    get length() { return code.length; },
    push(event) {
      if (event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) {
        reset(); return null;
      }
      if (event.key === 'Shift') return null;
      const now = event.timeStamp;
      if (code && now - last > 500) reset();
      if (event.key === 'Enter') {
        const accepted = !invalid && code.length >= 4 && now - last <= 80 && (now - first) / code.length <= 50;
        const result = accepted ? code : null;
        reset();
        return result;
      }
      if (!/^[\x20-\x7e]$/.test(event.key)) { reset(); return null; }
      if (code && now - last > 80) invalid = true;
      if (code.length >= 256) { invalid = true; last = now; return null; }
      if (!code) first = now;
      code += event.key;
      last = now;
      return null;
    },
  };
}

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

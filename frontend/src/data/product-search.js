// Índice en minúsculas memoizado por referencia de catálogo (WeakMap) para búsquedas <1 ms en ~7,700 productos.
const cache = new WeakMap();

export function indexedProducts(products) {
  if (!Array.isArray(products)) return [];
  let index = cache.get(products);
  if (!index) {
    index = new Array(products.length);
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const alts = p.altCodes;
      let altLowers = null;
      if (alts && alts.length) {
        altLowers = new Array(alts.length);
        for (let j = 0; j < alts.length; j++) altLowers[j] = alts[j].toLowerCase();
      }
      index[i] = {
        p,
        code: p.code,
        codeLower: p.code.toLowerCase(),
        nameLower: p.name.toLowerCase(),
        brandLower: p.brand ? p.brand.toLowerCase() : '',
        altLowers,
      };
    }
    cache.set(products, index);
  }
  return index;
}

export function matchesIndexed(entry, q) {
  if (entry.codeLower.includes(q) || entry.nameLower.includes(q) || (entry.brandLower && entry.brandLower.includes(q))) {
    return true;
  }
  const alts = entry.altLowers;
  if (alts) {
    for (let i = 0; i < alts.length; i++) {
      if (alts[i].includes(q)) return true;
    }
  }
  return false;
}

export function searchTopProducts(products, rawQuery, limit = 6) {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return [];
  const index = indexedProducts(products);
  const exact = [];
  const exactCi = [];
  const prefix = [];
  const contains = [];
  for (let i = 0; i < index.length; i++) {
    const entry = index[i];
    const p = entry.p;
    if (entry.code === rawQuery || (p.altCodes && p.altCodes.includes(rawQuery))) {
      exact.push(p);
      if (exact.length >= limit) break;
      continue;
    }
    if (entry.codeLower === q || (entry.altLowers && entry.altLowers.includes(q))) {
      if (exact.length + exactCi.length < limit) exactCi.push(p);
      continue;
    }
    if (exact.length + exactCi.length >= limit) continue;
    if (entry.codeLower.startsWith(q)) {
      if (prefix.length < limit) prefix.push(p);
      continue;
    }
    if (prefix.length < limit && matchesIndexed(entry, q)) {
      if (contains.length < limit) contains.push(p);
    }
  }
  return [...exact, ...exactCi, ...prefix, ...contains].slice(0, limit);
}

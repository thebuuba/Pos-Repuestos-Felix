// Índice en minúsculas memoizado por referencia de catálogo (WeakMap) para búsquedas <1 ms en ~7,700 productos.
const cache = new WeakMap();
const SEPARATOR_RE = /[-\s/_]+/g;

export function compactSearchText(value) {
  return typeof value === 'string' ? value.toLowerCase().replace(SEPARATOR_RE, '') : '';
}

export function indexedProducts(products) {
  if (!Array.isArray(products)) return [];
  let index = cache.get(products);
  if (!index) {
    index = new Array(products.length);
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const alts = p.altCodes;
      let altLowers = null;
      let altCompacts = null;
      if (alts && alts.length) {
        altLowers = new Array(alts.length);
        altCompacts = new Array(alts.length);
        for (let j = 0; j < alts.length; j++) {
          const lower = alts[j].toLowerCase();
          altLowers[j] = lower;
          altCompacts[j] = lower.replace(SEPARATOR_RE, '');
        }
      }
      const codeLower = p.code.toLowerCase();
      const nameLower = p.name.toLowerCase();
      const refLower = p.reference ? p.reference.toLowerCase() : '';
      index[i] = {
        p,
        code: p.code,
        codeLower,
        codeCompact: codeLower.replace(SEPARATOR_RE, ''),
        refLower,
        refCompact: refLower ? refLower.replace(SEPARATOR_RE, '') : '',
        nameLower,
        nameCompact: nameLower.replace(SEPARATOR_RE, ''),
        brandLower: p.brand ? p.brand.toLowerCase() : '',
        altLowers,
        altCompacts,
      };
    }
    cache.set(products, index);
  }
  return index;
}

export function matchesIndexed(entry, q, qCompact = compactSearchText(q)) {
  if (
    entry.codeLower.includes(q) ||
    (entry.refLower && entry.refLower.includes(q)) ||
    entry.nameLower.includes(q) ||
    (entry.brandLower && entry.brandLower.includes(q))
  ) {
    return true;
  }
  const alts = entry.altLowers;
  if (alts) {
    for (let i = 0; i < alts.length; i++) {
      if (alts[i].includes(q)) return true;
    }
  }
  if (qCompact) {
    if (
      entry.codeCompact.includes(qCompact) ||
      (entry.refCompact && entry.refCompact.includes(qCompact)) ||
      entry.nameCompact.includes(qCompact)
    ) {
      return true;
    }
    const altC = entry.altCompacts;
    if (altC) {
      for (let i = 0; i < altC.length; i++) {
        if (altC[i].includes(qCompact)) return true;
      }
    }
  }
  return false;
}

export function searchTopProducts(products, rawQuery, limit = 6) {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return [];
  const qCompact = q.replace(SEPARATOR_RE, '');
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
    if (
      entry.codeLower === q ||
      (entry.refLower && entry.refLower === q) ||
      (entry.altLowers && entry.altLowers.includes(q)) ||
      (qCompact && (
        entry.codeCompact === qCompact ||
        (entry.refCompact && entry.refCompact === qCompact) ||
        (entry.altCompacts && entry.altCompacts.includes(qCompact))
      ))
    ) {
      if (exact.length + exactCi.length < limit) exactCi.push(p);
      continue;
    }
    if (exact.length + exactCi.length >= limit) continue;
    if (
      entry.codeLower.startsWith(q) ||
      (entry.refLower && entry.refLower.startsWith(q)) ||
      (qCompact && (entry.codeCompact.startsWith(qCompact) || (entry.refCompact && entry.refCompact.startsWith(qCompact))))
    ) {
      if (prefix.length < limit) prefix.push(p);
      continue;
    }
    if (prefix.length < limit && matchesIndexed(entry, q, qCompact)) {
      if (contains.length < limit) contains.push(p);
    }
  }
  return [...exact, ...exactCi, ...prefix, ...contains].slice(0, limit);
}

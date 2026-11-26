// Índice en minúsculas memoizado por referencia de catálogo (WeakMap) para búsquedas <1 ms en ~7,700 productos.
const cache = new WeakMap();
const SEPARATOR_RE = /[-\s/_]+/g;
const naturalCollator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

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
      const categoryLower = p.category ? p.category.toLowerCase() : '';
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
        categoryLower,
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
    (entry.brandLower && entry.brandLower.includes(q)) ||
    (entry.categoryLower && entry.categoryLower.includes(q))
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

export function matchesScoped(entry, q, qCompact = compactSearchText(q), scope = 'all') {
  if (!q) return true;
  if (scope === 'reference') {
    if (!entry.refLower) return false;
    return entry.refLower.includes(q) || Boolean(qCompact && entry.refCompact.includes(qCompact));
  }
  if (scope === 'code') {
    if (entry.codeLower.includes(q) || (qCompact && entry.codeCompact.includes(qCompact))) return true;
    if (entry.altLowers) {
      for (let i = 0; i < entry.altLowers.length; i++) {
        if (entry.altLowers[i].includes(q)) return true;
      }
    }
    if (qCompact && entry.altCompacts) {
      for (let i = 0; i < entry.altCompacts.length; i++) {
        if (entry.altCompacts[i].includes(qCompact)) return true;
      }
    }
    return false;
  }
  if (scope === 'name') {
    return (
      entry.nameLower.includes(q) ||
      Boolean(entry.brandLower && entry.brandLower.includes(q)) ||
      Boolean(qCompact && entry.nameCompact.includes(qCompact))
    );
  }
  return matchesIndexed(entry, q, qCompact);
}

export function countMatchingProducts(products, rawQuery, scope = 'all') {
  const q = typeof rawQuery === 'string' ? rawQuery.trim().toLowerCase() : '';
  if (!q) return Array.isArray(products) ? products.length : 0;
  const qCompact = q.replace(SEPARATOR_RE, '');
  const index = indexedProducts(products);
  let count = 0;
  for (let i = 0; i < index.length; i++) {
    if (matchesScoped(index[i], q, qCompact, scope)) count += 1;
  }
  return count;
}

function productNeedsRestock(p) {
  return p.notifyMinStock !== false && (p.stock === 0 || (p.stock > 0 && p.stock <= p.minStock));
}

function numericPrice(p, level) {
  const raw = (p.pricesExact ?? p.prices)?.[level];
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function numericCost(p) {
  const n = Number(p.costExact ?? p.cost);
  return Number.isFinite(n) ? n : 0;
}

function numericMargin(p) {
  const p1 = numericPrice(p, 'p1');
  if (p1 <= 0) return -Infinity;
  return ((p1 - numericCost(p)) / p1) * 100;
}

export function compareProducts(a, b, sortBy = 'code', sortDir = 'asc') {
  const factor = sortDir === 'desc' ? -1 : 1;
  let cmp = 0;
  switch (sortBy) {
    case 'stock':
      cmp = (Number(a.stock) || 0) - (Number(b.stock) || 0);
      if (cmp === 0) cmp = naturalCollator.compare(a.name || '', b.name || '');
      return cmp * factor;
    case 'reference': {
      const ra = (a.reference || '').trim();
      const rb = (b.reference || '').trim();
      if (!ra && rb) return 1;
      if (ra && !rb) return -1;
      cmp = naturalCollator.compare(ra, rb);
      if (cmp === 0) cmp = naturalCollator.compare(a.code || '', b.code || '');
      return cmp * factor;
    }
    case 'name':
      cmp = naturalCollator.compare(a.name || '', b.name || '');
      if (cmp === 0) cmp = naturalCollator.compare(a.code || '', b.code || '');
      return cmp * factor;
    case 'category':
      cmp = naturalCollator.compare(a.category || '', b.category || '');
      if (cmp === 0) cmp = naturalCollator.compare(a.name || '', b.name || '');
      return cmp * factor;
    case 'cost':
      cmp = numericCost(a) - numericCost(b);
      if (cmp === 0) cmp = naturalCollator.compare(a.name || '', b.name || '');
      return cmp * factor;
    case 'p1':
    case 'p2':
    case 'p3':
      cmp = numericPrice(a, sortBy) - numericPrice(b, sortBy);
      if (cmp === 0) cmp = naturalCollator.compare(a.name || '', b.name || '');
      return cmp * factor;
    case 'margin':
      cmp = numericMargin(a) - numericMargin(b);
      if (cmp === 0) cmp = naturalCollator.compare(a.name || '', b.name || '');
      return cmp * factor;
    case 'code':
    default:
      cmp = naturalCollator.compare(a.code || '', b.code || '');
      if (cmp === 0) cmp = naturalCollator.compare(a.name || '', b.name || '');
      return cmp * factor;
  }
}

export function filterAndSortCatalog(
  products,
  {
    query = '',
    scope = 'all',
    stockFilter = 'all',
    category = '',
    location = '',
    sortBy = 'code',
    sortDir = 'asc',
  } = {},
) {
  const q = typeof query === 'string' ? query.trim().toLowerCase() : '';
  const qCompact = q ? q.replace(SEPARATOR_RE, '') : '';
  const index = indexedProducts(products);
  const out = [];
  for (let i = 0; i < index.length; i++) {
    const entry = index[i];
    const p = entry.p;
    if (category && p.category !== category) continue;
    if (location && (p.location || '').trim() !== location) continue;
    if (stockFilter === 'out') {
      if (p.stock !== 0) continue;
    } else if (stockFilter === 'low') {
      if (!(p.notifyMinStock !== false && p.stock > 0 && p.stock <= p.minStock)) continue;
    } else if (stockFilter === 'restock') {
      if (!productNeedsRestock(p)) continue;
    } else if (stockFilter === 'in') {
      if (!(p.stock > 0)) continue;
    } else if (stockFilter === 'ok') {
      if (p.stock === 0 || productNeedsRestock(p)) continue;
    }
    if (q && !matchesScoped(entry, q, qCompact, scope)) continue;
    out.push(p);
  }
  if (sortBy && sortBy !== 'default') {
    out.sort((a, b) => compareProducts(a, b, sortBy, sortDir));
  }
  return out;
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

// Índice normalizado (minúsculas y sin tildes) memoizado por referencia de catálogo (WeakMap)
// para búsquedas <2 ms en ~8,000 productos con relevancia por prefijo, multipalabra y códigos compactos.
const cache = new WeakMap();
const DIACRITICS_RE = /[\u0300-\u036f]/g;
const SEPARATOR_RE = /[-\s/_]+/g;
const WHITESPACE_RE = /\s+/;
const naturalCollator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });

export function normalizeSearchText(value) {
  if (typeof value !== 'string' || !value) return '';
  return value.normalize('NFD').replace(DIACRITICS_RE, '').toLowerCase();
}

export function compactSearchText(value) {
  return normalizeSearchText(value).replace(SEPARATOR_RE, '');
}

function isWordBoundaryChar(ch) {
  return !ch || ch === ' ' || ch === '-' || ch === '/' || ch === '_' || ch === '(' || ch === ')' || ch === '.';
}

function startsWithWord(haystack, needle) {
  if (!haystack || !needle || !haystack.startsWith(needle)) return false;
  return haystack.length === needle.length || isWordBoundaryChar(haystack[needle.length]);
}

function containsWholeWord(haystack, needle) {
  if (!haystack || !needle) return false;
  let pos = haystack.indexOf(needle);
  while (pos !== -1) {
    const beforeOk = pos === 0 || isWordBoundaryChar(haystack[pos - 1]);
    const afterPos = pos + needle.length;
    const afterOk = afterPos === haystack.length || isWordBoundaryChar(haystack[afterPos]);
    if (beforeOk && afterOk) return true;
    pos = haystack.indexOf(needle, pos + 1);
  }
  return false;
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
      let altJoined = '';
      if (alts && alts.length) {
        altLowers = new Array(alts.length);
        altCompacts = new Array(alts.length);
        for (let j = 0; j < alts.length; j++) {
          const lower = normalizeSearchText(alts[j]);
          altLowers[j] = lower;
          altCompacts[j] = lower.replace(SEPARATOR_RE, '');
        }
        altJoined = altLowers.join(' ');
      }
      const codeLower = normalizeSearchText(p.code);
      const nameLower = normalizeSearchText(p.name);
      const refLower = p.reference ? normalizeSearchText(p.reference) : '';
      const brandLower = p.brand ? normalizeSearchText(p.brand) : '';
      const categoryLower = p.category ? normalizeSearchText(p.category) : '';
      const allHaystack = [codeLower, refLower, nameLower, brandLower, categoryLower, altJoined]
        .filter(Boolean)
        .join(' ');
      index[i] = {
        p,
        code: p.code,
        codeLower,
        codeCompact: codeLower.replace(SEPARATOR_RE, ''),
        refLower,
        refCompact: refLower ? refLower.replace(SEPARATOR_RE, '') : '',
        nameLower,
        nameCompact: nameLower.replace(SEPARATOR_RE, ''),
        brandLower,
        categoryLower,
        altLowers,
        altCompacts,
        allHaystack,
      };
    }
    cache.set(products, index);
  }
  return index;
}

function tokenMatchesAll(entry, token, tokenCompact) {
  if (entry.allHaystack.includes(token)) return true;
  if (tokenCompact) {
    if (
      entry.codeCompact.includes(tokenCompact) ||
      (entry.refCompact && entry.refCompact.includes(tokenCompact)) ||
      entry.nameCompact.includes(tokenCompact)
    ) {
      return true;
    }
    const altC = entry.altCompacts;
    if (altC) {
      for (let i = 0; i < altC.length; i++) {
        if (altC[i].includes(tokenCompact)) return true;
      }
    }
  }
  return false;
}

function tokenMatchesCode(entry, token, tokenCompact) {
  if (entry.codeLower.includes(token) || (tokenCompact && entry.codeCompact.includes(tokenCompact))) return true;
  if (entry.altLowers) {
    for (let i = 0; i < entry.altLowers.length; i++) {
      if (entry.altLowers[i].includes(token)) return true;
    }
  }
  if (tokenCompact && entry.altCompacts) {
    for (let i = 0; i < entry.altCompacts.length; i++) {
      if (entry.altCompacts[i].includes(tokenCompact)) return true;
    }
  }
  return false;
}

function tokenMatchesName(entry, token, tokenCompact) {
  return (
    entry.nameLower.includes(token) ||
    Boolean(entry.brandLower && entry.brandLower.includes(token)) ||
    Boolean(tokenCompact && entry.nameCompact.includes(tokenCompact))
  );
}

function tokenMatchesReference(entry, token, tokenCompact) {
  if (!entry.refLower) return false;
  return entry.refLower.includes(token) || Boolean(tokenCompact && entry.refCompact.includes(tokenCompact));
}

function parseQuery(rawQuery) {
  const raw = typeof rawQuery === 'string' ? rawQuery : '';
  const q = normalizeSearchText(raw).trim();
  if (!q) return { raw, q: '', qCompact: '', tokens: [], tokenCompacts: [] };
  const qCompact = q.replace(SEPARATOR_RE, '');
  const tokens = q.split(WHITESPACE_RE).filter(Boolean);
  const tokenCompacts = tokens.length > 1
    ? tokens.map((t) => t.replace(SEPARATOR_RE, ''))
    : [qCompact];
  return { raw, q, qCompact, tokens, tokenCompacts };
}

function matchTokensInScope(entry, tokens, tokenCompacts, scope) {
  const len = tokens.length;
  if (scope === 'reference') {
    for (let i = 0; i < len; i++) {
      if (!tokenMatchesReference(entry, tokens[i], tokenCompacts[i])) return false;
    }
    return true;
  }
  if (scope === 'code') {
    for (let i = 0; i < len; i++) {
      if (!tokenMatchesCode(entry, tokens[i], tokenCompacts[i])) return false;
    }
    return true;
  }
  if (scope === 'name') {
    for (let i = 0; i < len; i++) {
      if (!tokenMatchesName(entry, tokens[i], tokenCompacts[i])) return false;
    }
    return true;
  }
  for (let i = 0; i < len; i++) {
    if (!tokenMatchesAll(entry, tokens[i], tokenCompacts[i])) return false;
  }
  return true;
}

/**
 * Devuelve nivel de relevancia (0 = mejor, 6 = coincidencia general, -1 = sin coincidencia).
 * 0: código o código alterno exacto literal
 * 1: código, alterno o referencia exacta (sin distinguir mayúsculas/tildes/guiones)
 * 2: código o referencia comienza con la búsqueda
 * 3: el nombre del artículo empieza con la palabra buscada (ej. "goma" -> "GOMA 300-18")
 * 4: el nombre comienza con el prefijo buscado (ej. "gom" -> "GOMA 300-18")
 * 5: palabra completa dentro del nombre (ej. "goma" -> "BUJE DE GOMA") o todos los términos en el nombre
 * 6: cualquier otra coincidencia (subcadena, marca, categoría o cruce entre campos)
 */
function relevanceBucket(entry, parsed, scope = 'all') {
  const { raw, q, qCompact, tokens, tokenCompacts } = parsed;
  if (!q) return 6;
  const p = entry.p;
  if (!matchTokensInScope(entry, tokens, tokenCompacts, scope)) return -1;

  if (scope === 'all' || scope === 'code') {
    if (entry.code === raw || (p.altCodes && p.altCodes.includes(raw))) return 0;
    if (
      entry.codeLower === q ||
      (entry.altLowers && entry.altLowers.includes(q)) ||
      (qCompact && (entry.codeCompact === qCompact || (entry.altCompacts && entry.altCompacts.includes(qCompact))))
    ) {
      return 1;
    }
  }
  if (scope === 'all' || scope === 'reference') {
    if (entry.refLower && (entry.refLower === q || (qCompact && entry.refCompact === qCompact))) return 1;
  }
  if (scope === 'all' || scope === 'code') {
    if (entry.codeLower.startsWith(q) || (qCompact && entry.codeCompact.startsWith(qCompact))) return 2;
  }
  if (scope === 'all' || scope === 'reference') {
    if (entry.refLower && (entry.refLower.startsWith(q) || (qCompact && entry.refCompact.startsWith(qCompact)))) return 2;
  }
  if (scope === 'all' || scope === 'name') {
    if (tokens.length === 1) {
      if (startsWithWord(entry.nameLower, q)) return 3;
      if (entry.nameLower.startsWith(q) || (qCompact && entry.nameCompact.startsWith(qCompact))) return 4;
      if (containsWholeWord(entry.nameLower, q)) return 5;
      return 6;
    }
    const first = tokens[0];
    let allInName = true;
    for (let i = 0; i < tokens.length; i++) {
      if (!entry.nameLower.includes(tokens[i]) && !(tokenCompacts[i] && entry.nameCompact.includes(tokenCompacts[i]))) {
        allInName = false;
        break;
      }
    }
    if (allInName && startsWithWord(entry.nameLower, first)) return 3;
    if (startsWithWord(entry.nameLower, first) || entry.nameLower.startsWith(first)) return 4;
    if (allInName) return 5;
  }
  return 6;
}

export function matchesIndexed(entry, q, qCompact = compactSearchText(q)) {
  const norm = normalizeSearchText(q).trim();
  if (!norm) return true;
  const compact = qCompact ? normalizeSearchText(qCompact).replace(SEPARATOR_RE, '') : norm.replace(SEPARATOR_RE, '');
  if (!WHITESPACE_RE.test(norm)) {
    return tokenMatchesAll(entry, norm, compact);
  }
  const tokens = norm.split(WHITESPACE_RE).filter(Boolean);
  const tokenCompacts = tokens.map((t) => t.replace(SEPARATOR_RE, ''));
  return matchTokensInScope(entry, tokens, tokenCompacts, 'all');
}

export function matchesScoped(entry, q, qCompact = compactSearchText(q), scope = 'all') {
  const norm = normalizeSearchText(q).trim();
  if (!norm) return true;
  if (scope === 'all') return matchesIndexed(entry, norm, qCompact);
  const compact = qCompact ? normalizeSearchText(qCompact).replace(SEPARATOR_RE, '') : norm.replace(SEPARATOR_RE, '');
  if (!WHITESPACE_RE.test(norm)) {
    if (scope === 'reference') return tokenMatchesReference(entry, norm, compact);
    if (scope === 'code') return tokenMatchesCode(entry, norm, compact);
    if (scope === 'name') return tokenMatchesName(entry, norm, compact);
    return tokenMatchesAll(entry, norm, compact);
  }
  const tokens = norm.split(WHITESPACE_RE).filter(Boolean);
  const tokenCompacts = tokens.map((t) => t.replace(SEPARATOR_RE, ''));
  return matchTokensInScope(entry, tokens, tokenCompacts, scope);
}

export function countMatchingProducts(products, rawQuery, scope = 'all') {
  const parsed = parseQuery(rawQuery);
  if (!parsed.q) return Array.isArray(products) ? products.length : 0;
  const index = indexedProducts(products);
  let count = 0;
  for (let i = 0; i < index.length; i++) {
    if (matchTokensInScope(index[i], parsed.tokens, parsed.tokenCompacts, scope)) count += 1;
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
  const parsed = parseQuery(query);
  const index = indexedProducts(products);
  const rankByRelevance = Boolean(parsed.q) && (!sortBy || sortBy === 'default');
  const buckets = rankByRelevance ? [[], [], [], [], [], [], []] : null;
  const out = rankByRelevance ? null : [];
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
    if (parsed.q) {
      if (rankByRelevance) {
        const tier = relevanceBucket(entry, parsed, scope);
        if (tier < 0) continue;
        buckets[tier].push(p);
      } else {
        if (!matchTokensInScope(entry, parsed.tokens, parsed.tokenCompacts, scope)) continue;
        out.push(p);
      }
    } else {
      out.push(p);
    }
  }
  if (rankByRelevance) {
    return buckets[0].concat(buckets[1], buckets[2], buckets[3], buckets[4], buckets[5], buckets[6]);
  }
  if (sortBy && sortBy !== 'default') {
    out.sort((a, b) => compareProducts(a, b, sortBy, sortDir));
  }
  return out;
}

export function searchTopProducts(products, rawQuery, limit = 6, { preferInStock = false } = {}) {
  const parsed = parseQuery(rawQuery);
  if (!parsed.q) return [];
  const index = indexedProducts(products);
  // 7 niveles de relevancia; en niveles de nombre (3..6) se puede priorizar con existencia sin ocultar agotados.
  const buckets = preferInStock
    ? Array.from({ length: 11 }, () => [])
    : Array.from({ length: 7 }, () => []);
  for (let i = 0; i < index.length; i++) {
    const entry = index[i];
    const tier = relevanceBucket(entry, parsed, 'all');
    if (tier < 0) continue;
    let slot = tier;
    if (preferInStock && tier >= 3) {
      slot = 3 + (tier - 3) * 2 + (entry.p.stock > 0 ? 0 : 1);
    }
    if (buckets[slot].length < limit) {
      buckets[slot].push(entry.p);
      if (slot === 0 && buckets[0].length >= limit) break;
    }
  }
  const result = [];
  for (let s = 0; s < buckets.length && result.length < limit; s++) {
    const list = buckets[s];
    for (let j = 0; j < list.length && result.length < limit; j++) {
      result.push(list[j]);
    }
  }
  return result;
}

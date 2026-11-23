import { createHash } from 'node:crypto';

export function stateTag({ databaseId, revision, databaseLabel, role }) {
  const payload = role === 'cajero'
    ? [6, databaseId, revision, databaseLabel, role]
    : [6, databaseId, revision, databaseLabel];
  return `"${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}"`;
}

export function bootstrapTag(version) { return '"sync-2-' + stateTag(version).slice(1); }

export function matchesStateTag(condition, tag) {
  if (condition === '*') return true;
  for (const [, candidate] of (condition || '').matchAll(/(?:^|,)\s*(?:W\/)?("[^"]*")\s*(?=,|$)/g)) {
    if (candidate === tag.replace(/^W\//, '')) return true;
  }
  return false;
}

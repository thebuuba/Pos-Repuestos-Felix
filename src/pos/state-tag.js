import { createHash } from 'node:crypto';

export function stateTag({ databaseId, revision, databaseLabel }) {
  return `"${createHash('sha256').update(JSON.stringify([5, databaseId, revision, databaseLabel])).digest('hex')}"`;
}

export function bootstrapTag(version) { return '"sync-1-' + stateTag(version).slice(1); }

export function matchesStateTag(condition, tag) {
  if (condition === '*') return true;
  for (const [, candidate] of (condition || '').matchAll(/(?:^|,)\s*(?:W\/)?("[^"]*")\s*(?=,|$)/g)) {
    if (candidate === tag.replace(/^W\//, '')) return true;
  }
  return false;
}

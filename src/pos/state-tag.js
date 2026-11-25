import { createHash } from 'node:crypto';
import { CURRENT_BACKUP_VERSION, LEGACY_SYNC_BACKUP_VERSION } from './relational-backup.js';

export function stateTag({ databaseId, revision, databaseLabel, role }) {
  const payload = role === 'cajero'
    ? [6, databaseId, revision, databaseLabel, role]
    : [6, databaseId, revision, databaseLabel];
  return `"${createHash('sha256').update(JSON.stringify(payload)).digest('hex')}"`;
}

export function bootstrapTag(version) {
  const resolved = Number.isInteger(version?.backupVersion) ? version.backupVersion : CURRENT_BACKUP_VERSION;
  const schema = resolved <= LEGACY_SYNC_BACKUP_VERSION ? '' : `v${resolved}-`;
  return `"sync-2-${schema}` + stateTag(version).slice(1);
}

export function matchesStateTag(condition, tag) {
  if (condition === '*') return true;
  for (const [, candidate] of (condition || '').matchAll(/(?:^|,)\s*(?:W\/)?("[^"]*")\s*(?=,|$)/g)) {
    if (candidate === tag.replace(/^W\//, '')) return true;
  }
  return false;
}

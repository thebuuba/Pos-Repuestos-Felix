import { businessTodayIso } from "../lib/dates.js";

const STORAGE_PREFIX = "felix-smart-notif-v1";
const DAY_MS = 86_400_000;

export function notificationStorageKey(databaseId, accountKey) {
  return `${STORAGE_PREFIX}:${databaseId || "demo"}:${accountKey || "anon"}`;
}

export function emptyNotificationState() {
  return { seen: {}, snoozed: {} };
}

export function readNotificationState(key, storage = globalThis.localStorage) {
  if (!storage || !key) return emptyNotificationState();
  try {
    const raw = storage.getItem(key);
    if (!raw) return emptyNotificationState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyNotificationState();
    return {
      seen: parsed.seen && typeof parsed.seen === "object" && !Array.isArray(parsed.seen) ? parsed.seen : {},
      snoozed: parsed.snoozed && typeof parsed.snoozed === "object" && !Array.isArray(parsed.snoozed) ? parsed.snoozed : {},
    };
  } catch {
    return emptyNotificationState();
  }
}

export function writeNotificationState(key, state, storage = globalThis.localStorage) {
  if (!storage || !key) return;
  try {
    storage.setItem(key, JSON.stringify({
      seen: state?.seen ?? {},
      snoozed: state?.snoozed ?? {},
    }));
  } catch {
    /* Ignore quota / private browsing errors */
  }
}

/**
 * Devuelve la fecha ISO del siguiente día hábil de negocio (mañana) para posponer alertas.
 */
export function nextBusinessDayIso(now = new Date()) {
  const today = businessTodayIso(now);
  const tomorrow = new Date(new Date(`${today}T12:00:00Z`).getTime() + DAY_MS);
  const y = tomorrow.getUTCFullYear();
  const m = String(tomorrow.getUTCMonth() + 1).padStart(2, "0");
  const d = String(tomorrow.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isAlertSnoozed(alert, state, now = new Date()) {
  if (!alert || alert.snoozeable === false) return false;
  const entry = state?.snoozed?.[alert.id];
  if (!entry || typeof entry !== "object") return false;
  if (entry.fingerprint !== alert.fingerprint) return false;
  const todayIso = businessTodayIso(now);
  if (typeof entry.untilDay === "string" && entry.untilDay > todayIso) return true;
  if (typeof entry.untilMs === "number" && entry.untilMs > now.getTime()) return true;
  return false;
}

export function isAlertSeen(alert, state) {
  if (!alert) return true;
  if (alert.snoozeable === false) return false;
  return state?.seen?.[alert.id] === alert.fingerprint;
}

export function markAlertSeen(state, alert) {
  if (!alert || alert.snoozeable === false) return state;
  if (state?.seen?.[alert.id] === alert.fingerprint) return state;
  return {
    seen: { ...(state?.seen ?? {}), [alert.id]: alert.fingerprint },
    snoozed: state?.snoozed ?? {},
  };
}

export function markAllAlertsSeen(state, alerts) {
  const seen = { ...(state?.seen ?? {}) };
  let changed = false;
  for (const alert of alerts) {
    if (!alert || alert.snoozeable === false) continue;
    if (seen[alert.id] !== alert.fingerprint) {
      seen[alert.id] = alert.fingerprint;
      changed = true;
    }
  }
  return changed ? { seen, snoozed: state?.snoozed ?? {} } : state;
}

export function snoozeAlertUntilTomorrow(state, alert, now = new Date()) {
  if (!alert || alert.snoozeable === false) return state;
  return {
    seen: { ...(state?.seen ?? {}), [alert.id]: alert.fingerprint },
    snoozed: {
      ...(state?.snoozed ?? {}),
      [alert.id]: {
        fingerprint: alert.fingerprint,
        untilDay: nextBusinessDayIso(now),
      },
    },
  };
}

export function unsnoozeAlert(state, alertId) {
  if (!state?.snoozed?.[alertId]) return state;
  const snoozed = { ...state.snoozed };
  delete snoozed[alertId];
  return { seen: state.seen ?? {}, snoozed };
}

export function partitionNotifications(alerts, state, now = new Date()) {
  const active = [];
  const snoozed = [];
  let unreadCount = 0;
  let unreadCriticalCount = 0;

  for (const alert of alerts) {
    if (isAlertSnoozed(alert, state, now)) {
      snoozed.push({ ...alert, seen: true, snoozed: true });
      continue;
    }
    const seen = isAlertSeen(alert, state);
    if (!seen) {
      unreadCount += 1;
      if (alert.severity === "critical") unreadCriticalCount += 1;
    }
    active.push({ ...alert, seen, snoozed: false });
  }
  return { active, snoozed, unreadCount, unreadCriticalCount };
}

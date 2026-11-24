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

let stockToastSuppressedUntil = 0;

/**
 * Evita duplicar el toast en vivo de stock justo después del aviso inmediato post-venta
 * emitido en el mismo equipo.
 */
export function suppressStockLiveToast(durationMs = 6000) {
  stockToastSuppressedUntil = Date.now() + Math.max(0, Number(durationMs) || 0);
}

export function isStockLiveToastSuppressed(nowMs = Date.now()) {
  return nowMs < stockToastSuppressedUntil;
}

const LIVE_STOCK_ALERT_IDS = new Set(["stock-out-hot", "stock-velocity"]);

/**
 * Detecta alertas activas nuevas o empeoradas respecto al último estado conocido de la sesión.
 * - Solo dispara toasts en vivo para alertas críticas nuevas o hitos positivos (meta diaria).
 * - Nunca dispara toasts si `previousFingerprints` aún es null (arranque / cambio de sesión).
 */
export function detectLiveArrivals(activeAlerts = [], previousFingerprints = null, { suppressStockToast = false } = {}) {
  const nextFingerprints = new Map();
  for (const alert of activeAlerts) {
    if (alert?.id) nextFingerprints.set(alert.id, alert.fingerprint);
  }
  if (!previousFingerprints) {
    return { arrived: [], toastCandidates: [], nextFingerprints };
  }
  const arrived = [];
  const toastCandidates = [];
  for (const alert of activeAlerts) {
    if (!alert?.id || alert.seen) continue;
    const prevFp = previousFingerprints.get(alert.id);
    if (prevFp === alert.fingerprint) continue;
    arrived.push(alert);
    const qualifiesForToast = alert.severity === "critical" || alert.id === "daily-goal-hit";
    if (!qualifiesForToast) continue;
    if (suppressStockToast && LIVE_STOCK_ALERT_IDS.has(alert.id)) continue;
    toastCandidates.push(alert);
  }
  return { arrived, toastCandidates, nextFingerprints };
}

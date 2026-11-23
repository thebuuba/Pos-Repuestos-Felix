// Utilidades centralizadas de fecha y hora en la zona del negocio (America/Santo_Domingo).
export const BUSINESS_TIMEZONE = "America/Santo_Domingo";

const isoDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const shortDateTimeFormatter = new Intl.DateTimeFormat("es-DO", {
  timeZone: BUSINESS_TIMEZONE,
  dateStyle: "short",
  timeStyle: "short",
});

const weekdayFormatter = new Intl.DateTimeFormat("es-DO", {
  timeZone: BUSINESS_TIMEZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function businessTodayIso(now = new Date()) {
  return isoDayFormatter.format(now);
}

export function businessMonthIso(now = new Date()) {
  return businessTodayIso(now).slice(0, 7);
}

export function formatBusinessDateTime(value, fallback = "No registrada") {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? shortDateTimeFormatter.format(date) : fallback;
}

export function formatBusinessLongDate(now = new Date()) {
  return weekdayFormatter.format(now);
}

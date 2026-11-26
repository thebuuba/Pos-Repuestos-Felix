import { businessTodayIso } from './dates.js';
import { formatDate } from './accounts.js';

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Santo_Domingo',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function businessNowTimeHHMM(now = new Date()) {
  const parts = timeFormatter.formatToParts(now);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${hour === '24' ? '00' : hour}:${minute}`;
}

export function addBusinessDaysIso(baseIso, deltaDays) {
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(baseIso || '') ? baseIso : businessTodayIso();
  const d = new Date(anchor + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export function formatTime12h(hhmm) {
  if (!hhmm || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return '';
  const [hStr, mStr] = hhmm.split(':');
  const h = Number(hStr);
  const suffix = h >= 12 ? 'p. m.' : 'a. m.';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr} ${suffix}`;
}

export function reminderBucket(reminder, now = new Date()) {
  if (!reminder) return 'nodate';
  if (reminder.status === 'completado') return 'completed';
  if (!reminder.dueDate) return 'nodate';
  const todayIso = businessTodayIso(now);
  if (reminder.dueDate < todayIso) return 'overdue';
  if (reminder.dueDate === todayIso) {
    if (reminder.dueTime && reminder.dueTime < businessNowTimeHHMM(now)) {
      return 'overdue';
    }
    return 'today';
  }
  return 'upcoming';
}

export function reminderDueLabel(reminder, now = new Date()) {
  if (!reminder?.dueDate) return 'Sin fecha';
  const todayIso = businessTodayIso(now);
  const tomorrowIso = addBusinessDaysIso(todayIso, 1);
  const yesterdayIso = addBusinessDaysIso(todayIso, -1);
  const timeText = reminder.dueTime ? ` · ${formatTime12h(reminder.dueTime)}` : '';
  if (reminder.dueDate === todayIso) {
    const bucket = reminderBucket(reminder, now);
    return bucket === 'overdue' ? `Vencido hoy${timeText}` : `Hoy${timeText}`;
  }
  if (reminder.dueDate === tomorrowIso) return `Mañana${timeText}`;
  if (reminder.dueDate === yesterdayIso) return `Ayer${timeText}`;
  const formatted = formatDate(reminder.dueDate);
  return `${formatted}${timeText}`;
}

const BUCKET_RANK = { overdue: 0, today: 1, upcoming: 2, nodate: 3, completed: 4 };
const PRIORITY_RANK = { alta: 0, media: 1, baja: 2 };

export function sortReminders(list, now = new Date()) {
  return [...list].sort((a, b) => {
    const ba = BUCKET_RANK[reminderBucket(a, now)] ?? 9;
    const bb = BUCKET_RANK[reminderBucket(b, now)] ?? 9;
    if (ba !== bb) return ba - bb;
    if (ba === BUCKET_RANK.completed) {
      const ta = a.completedAt ? Date.parse(a.completedAt) : 0;
      const tb = b.completedAt ? Date.parse(b.completedAt) : 0;
      if (ta !== tb) return tb - ta;
      return (b.id ?? 0) - (a.id ?? 0);
    }
    if (a.dueDate && b.dueDate && a.dueDate !== b.dueDate) {
      return a.dueDate.localeCompare(b.dueDate);
    }
    if (a.dueDate && b.dueDate && a.dueTime !== b.dueTime) {
      const ta = a.dueTime || '99:99';
      const tb = b.dueTime || '99:99';
      return ta.localeCompare(tb);
    }
    const pa = PRIORITY_RANK[a.priority] ?? 1;
    const pb = PRIORITY_RANK[b.priority] ?? 1;
    if (pa !== pb) return pa - pb;
    return (b.id ?? 0) - (a.id ?? 0);
  });
}

export const PRIORITY_META = {
  alta: {
    label: 'Alta',
    badgeClass: 'bg-primary/10 text-primary',
  },
  media: {
    label: 'Media',
    badgeClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  },
  baja: {
    label: 'Baja',
    badgeClass: 'bg-muted text-muted-foreground',
  },
};

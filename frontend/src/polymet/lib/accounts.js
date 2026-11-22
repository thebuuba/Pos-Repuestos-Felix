// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
var AGING_BUCKETS = [
  {
    key: "corriente",
    label: "Al día",
  },
  {
    key: "1-30",
    label: "1–30 días",
  },
  {
    key: "31-60",
    label: "31–60 días",
  },
  {
    key: "61-90",
    label: "61–90 días",
  },
  {
    key: "90+",
    label: "+90 días",
  },
];
var DAY = 86400000;
function balanceOf(doc) {
  return Math.max(0, Math.round((doc.amount - doc.paid) * 100) / 100);
}
function daysOverdue(doc, now = new Date()) {
  return Math.floor((now.getTime() - new Date(doc.dueDate).getTime()) / DAY);
}
function agingBucket(doc) {
  const d = daysOverdue(doc);
  if (d <= 0) return "corriente";
  if (d <= 30) return "1-30";
  if (d <= 60) return "31-60";
  if (d <= 90) return "61-90";
  return "90+";
}
function agingSummary(docs) {
  const out = {
    corriente: 0,
    "1-30": 0,
    "31-60": 0,
    "61-90": 0,
    "90+": 0,
  };
  for (const d of docs) out[agingBucket(d)] += balanceOf(d);
  return out;
}
const BUSINESS_ZONE = "America/Santo_Domingo";
const dateParts = { day: "2-digit", month: "short" };
const timeParts = { hour: "numeric", minute: "2-digit" };
const documentDateFmt = new Intl.DateTimeFormat("es-DO", {
  ...dateParts,
  year: "numeric",
  timeZone: "UTC",
});
const shortDocumentDateFmt = new Intl.DateTimeFormat("es-DO", {
  ...dateParts,
  timeZone: "UTC",
});
const dateFmt = new Intl.DateTimeFormat("es-DO", {
  ...dateParts,
  year: "numeric",
  timeZone: BUSINESS_ZONE,
});
const dateTimeFmt = new Intl.DateTimeFormat("es-DO", {
  ...dateParts,
  ...timeParts,
  timeZone: BUSINESS_ZONE,
});
const timeFmt = new Intl.DateTimeFormat("es-DO", {
  ...timeParts,
  timeZone: BUSINESS_ZONE,
});

function documentaryDate(iso) {
  const parts =
    typeof iso === "string" &&
    iso.length === 10 &&
    /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!parts) return null;
  const [year, month, day] = parts.slice(1).map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new RangeError("Revisa la fecha del documento.");
  }
  return date;
}
function formatDate(iso) {
  const date = documentaryDate(iso);
  return date ? documentDateFmt.format(date) : dateFmt.format(new Date(iso));
}
function formatDateTime(iso) {
  const date = documentaryDate(iso);
  return date ? shortDocumentDateFmt.format(date) : dateTimeFmt.format(new Date(iso));
}
function formatTime(iso) {
  return documentaryDate(iso) ? "" : timeFmt.format(new Date(iso));
}
function isSameDay(iso, ref = new Date()) {
  const d = new Date(iso);
  return (
    d.getFullYear() === ref.getFullYear() &&
    d.getMonth() === ref.getMonth() &&
    d.getDate() === ref.getDate()
  );
}
export {
  balanceOf,
  formatTime,
  isSameDay,
  formatDate,
  formatDateTime,
  agingSummary,
  agingBucket,
  AGING_BUCKETS,
  daysOverdue,
};

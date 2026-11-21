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
var dateFmt = new Intl.DateTimeFormat("es-DO", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});
var dateTimeFmt = new Intl.DateTimeFormat("es-DO", {
  day: "2-digit",
  month: "short",
  hour: "numeric",
  minute: "2-digit",
});
var timeFmt = new Intl.DateTimeFormat("es-DO", {
  hour: "numeric",
  minute: "2-digit",
});
var formatDate = (iso) => dateFmt.format(new Date(iso));
var formatDateTime = (iso) => dateTimeFmt.format(new Date(iso));
var formatTime = (iso) => timeFmt.format(new Date(iso));
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

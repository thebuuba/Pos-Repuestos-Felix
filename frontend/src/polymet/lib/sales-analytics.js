import { decimalUnits } from "../../../../src/pos/operation-fields.js";
const zone = "America/Santo_Domingo";
const dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" });
const hourFormat = new Intl.DateTimeFormat("es-DO", { timeZone: zone, hour: "2-digit", hourCycle: "h23" });
const dayLabel = new Intl.DateTimeFormat("es-DO", { timeZone: "UTC", day: "numeric", month: "short" });
const monthLabel = new Intl.DateTimeFormat("es-DO", { timeZone: "UTC", month: "short" });
// API money and quantities have at most two fractional places. Totals can exceed
// the safe integer range even when each individual document fits in a Number.
const cents = value => {
  const [whole, fraction = ""] = String(value).split(".");
  return BigInt(whole + fraction.padEnd(2, "0"));
};
const money = amount => decimalUnits(amount, 2);
export const averageAmount = (total, count) => {
  if (!count) return "0.00";
  const n = BigInt(count);
  return money((cents(total) + n / 2n) / n);
};
const hoursLabel = h => `${h % 12 || 12}${h < 12 ? "a" : "p"}`;
const methods = { efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia", contado: "Contado", credito: "Crédito", desconocido: "Sin registrar" };

export const businessDay = (date = new Date()) =>
  typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : dayFormat.format(new Date(date));
export const shiftDay = (day, offset) => {
  const date = new Date(day);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
export const paymentLabel = sale => methods[sale.method ?? sale.condition] ?? methods.desconocido;
export const salesTotal = rows => money(rows.reduce((sum, row) => sum + cents(row.total), 0n));
export const sumAmounts = amounts => money(amounts.reduce((sum, amount) => sum + cents(amount), 0n));

export function paymentGroups(rows, byCondition) {
  const groups = new Map((byCondition ? ["contado", "credito"] : ["efectivo", "tarjeta", "transferencia", "credito"])
    .map(key => [key, { key, label: methods[key], cents: 0n, count: 0 }]));
  for (const row of rows) {
    const key = (byCondition ? row.condition : row.method ?? row.condition) ?? "desconocido";
    const group = groups.get(key) ?? { key, label: methods[key] ?? methods.desconocido, cents: 0n, count: 0 };
    group.count++;
    group.cents += cents(row.total);
    groups.set(key, group);
  }
  return [...groups.values()].map(group => ({ ...group, total: money(group.cents) }));
}

export function monthlyActivity(sales, today) {
  const totals = new Map();
  for (const sale of sales) {
    const day = businessDay(sale.date);
    if (day > today || sale.status === "anulada") continue;
    const month = day.slice(0, 7);
    totals.set(month, (totals.get(month) ?? 0n) + cents(sale.total));
  }
  const year = Number(today.slice(0, 4));
  const currentIndex = Number(today.slice(5, 7)) - 1;
  const monthRow = index => {
    const date = new Date(Date.UTC(year, index));
    const key = date.toISOString().slice(0, 7);
    const month = monthLabel.format(date).replace(".", "");
    return { month: month.charAt(0).toUpperCase() + month.slice(1), total: money(totals.get(key) ?? 0n) };
  };
  return { data: Array.from({ length: 12 }, (_, index) => monthRow(index)), currentIndex,
    lastSix: Array.from({ length: 6 }, (_, index) => monthRow(currentIndex - 5 + index)) };
}

export function reportData(sales, products, period, end, operational) {
  const start = period === "mes" ? end.slice(0, 8) + "01" : shiftDay(end, period === "7d" ? -6 : period === "30d" ? -29 : 0);
  const inPeriod = sales.filter(sale => {
    const day = businessDay(sale.date);
    return day >= start && day <= end;
  });
  const valid = inPeriod.filter(sale => sale.status !== "anulada");
  const catalog = new Map(products.map(product => [product.id, product]));
  const articles = new Map(), categorySales = new Map(), daySales = new Map(), hourSales = new Map();
  const fiscalGroups = new Map((operational ? [] : ["B01", "B02", "B14", "B15"])
    .map(type => [type, { type, count: 0, base: 0n, itbis: 0n }]));
  let net = 0n, tax = 0n, cost = 0n;
  for (const sale of valid) {
    const base = cents(sale.subtotal) - cents(sale.discount ?? 0);
    const itbis = cents(sale.itbis);
    const amount = cents(sale.total);
    net += base;
    tax += itbis;
    const day = businessDay(sale.date);
    daySales.set(day, (daySales.get(day) ?? 0n) + amount);
    const hour = sale.date.length > 10 ? Number(hourFormat.format(new Date(sale.date))) : null;
    hourSales.set(hour, (hourSales.get(hour) ?? 0n) + amount);
    const type = operational && !sale.ncf ? "Sin NCF" : sale.comprobante;
    const group = fiscalGroups.get(type) ?? { type, count: 0, base: 0n, itbis: 0n };
    group.count++;
    group.base += base;
    group.itbis += itbis;
    fiscalGroups.set(type, group);
    for (const line of sale.lines) {
      const product = catalog.get(line.productId);
      const row = articles.get(line.productId) ?? { id: line.productId, name: line.name, code: line.code, qty: 0n, revenue: 0n, cost: 0n };
      row.qty += cents(line.quantity);
      const revenue = cents(line.base ?? line.subtotal);
      row.revenue += revenue;
      if (!operational) {
        const lineCost = cents(((product?.cost ?? 0) * line.quantity).toFixed(2));
        row.cost += lineCost;
        cost += lineCost;
      }
      articles.set(line.productId, row);
      const category = product?.category || "Sin categoría";
      categorySales.set(category, (categorySales.get(category) ?? 0n) + revenue);
    }
  }
  const series = [];
  if (period === "hoy" && hourSales.size && !hourSales.has(null)) {
    const first = Math.min(8, ...hourSales.keys()), last = Math.max(18, ...hourSales.keys());
    for (let h = first; h <= last; h++) series.push({ label: hoursLabel(h), total: money(hourSales.get(h) ?? 0n) });
  } else {
    for (let day = start; day <= end; day = shiftDay(day, 1)) {
      series.push({ label: dayLabel.format(new Date(day)), total: money(daySales.get(day) ?? 0n) });
    }
  }
  const top = [...articles.values()].sort((a, b) => Number(b.revenue - a.revenue)).slice(0, 7)
    .map(row => ({ ...row, qty: Number(money(row.qty)).toLocaleString("es-DO"), revenue: money(row.revenue), profit: operational ? null : money(row.revenue - row.cost) }));
  const categories = [...categorySales].sort((a, b) => Number(b[1] - a[1])).map(([category, amount]) => [category, money(amount)]);
  const fiscal = [...fiscalGroups.values()].map(group => ({ ...group, base: money(group.base), itbis: money(group.itbis) }));
  return { inPeriod, valid, series, categories, top, fiscal, methods: paymentGroups(valid, operational),
    total: salesTotal(valid), net: money(net), itbis: money(tax), profit: operational ? null : money(net - cost),
    voided: inPeriod.length - valid.length };
}

// Preserve literal text fields when the report is opened in a spreadsheet.
export function salesCsv(sales) {
  const cell = value => {
    let text = String(value ?? "");
    if (/^\s*[=+@-]|^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const header = ["Registro", "Fecha", "Cliente", "Tipo", "NCF", "Pago", "Base (RD$)", "ITBIS (RD$)", "Total (RD$)", "Estado"];
  const rows = sales.map(s => [s.number, businessDay(s.date), s.customerName, s.comprobante, s.ncf, paymentLabel(s),
    money(cents(s.subtotal) - cents(s.discount ?? 0)), s.itbis.toFixed(2), s.total.toFixed(2), s.status ?? "Registrada"]);
  return "\uFEFF" + [header, ...rows].map(row => row.map(cell).join(",")).join("\r\n");
}

export function downloadSales(sales, filename) {
  const url = URL.createObjectURL(new Blob([salesCsv(sales)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename + ".csv";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

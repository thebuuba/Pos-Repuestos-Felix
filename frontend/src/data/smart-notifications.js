import { balanceOf, daysOverdue, documentaryDate } from "../lib/accounts.js";
import { businessTodayIso } from "../lib/dates.js";
import { formatMoney, formatNumber } from "../lib/format.js";

const DAY_MS = 86_400_000;
const VELOCITY_WINDOW_DAYS = 30;
const VELOCITY_MIN_UNITS = 3;
const VELOCITY_WARN_DAYS = 5;
const VELOCITY_CRIT_DAYS = 2;
const DUE_SOON_DAYS = 3;
const NCF_EXPIRY_WARN_DAYS = 15;
const NCF_LOW_COUNT = 20;
const NCF_LOW_DAYS = 7;
const CREDIT_WARN_RATIO = 0.9;
const WORKSHOP_STALE_HOURS = 24;

export const NOTIFICATION_CATEGORIES = [
  { id: "all", label: "Todas" },
  { id: "critical", label: "Críticas" },
  { id: "inventario", label: "Inventario" },
  { id: "cuentas", label: "Cuentas" },
  { id: "operacion", label: "Operación" },
];

const SEVERITY_RANK = { critical: 3, warning: 2, info: 1 };

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isoDateOffset(todayDate, deltaDays) {
  const shifted = new Date(todayDate.getTime() + deltaDays * DAY_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function businessDayOf(value) {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? businessTodayIso(parsed) : null;
}

function daysBetweenIso(fromIso, toIso) {
  const a = documentaryDate(fromIso);
  const b = documentaryDate(toIso);
  if (!a || !b) return null;
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

function plural(count, singular, pluralWord) {
  return `${formatNumber(count)} ${count === 1 ? singular : pluralWord}`;
}

function formatRate(dailyRate) {
  const rounded = dailyRate >= 10 ? Math.round(dailyRate) : Math.round(dailyRate * 10) / 10;
  return `~${formatNumber(rounded)}/día`;
}

function formatDaysLabel(days) {
  const d = Math.max(1, Math.ceil(days));
  return d === 1 ? "~1 día" : `~${d} días`;
}

function safeDueDays(doc, now, todayDate) {
  if (!doc?.dueDate) return null;
  try {
    const days = daysOverdue(doc, now, todayDate);
    return Number.isFinite(days) ? days : null;
  } catch {
    return null;
  }
}

function summarizeParties(docs, now, todayDate, partyNames = null) {
  const byParty = new Map();
  let totalAmount = 0;
  let maxOverdue = 0;
  for (const doc of docs) {
    const bal = balanceOf(doc);
    if (bal <= 0) continue;
    totalAmount = round2(totalAmount + bal);
    const over = safeDueDays(doc, now, todayDate) ?? 0;
    if (over > maxOverdue) maxOverdue = over;
    const key = doc.partyId ?? doc.partyName ?? doc.id;
    const resolvedName = doc.partyName || (partyNames && doc.partyId != null ? partyNames.get(doc.partyId) : null) || "Sin nombre";
    const prev = byParty.get(key) ?? {
      partyId: doc.partyId,
      name: resolvedName,
      total: 0,
      count: 0,
      maxDays: over,
      minDays: over,
    };
    prev.total = round2(prev.total + bal);
    prev.count += 1;
    if (over > prev.maxDays) prev.maxDays = over;
    if (over < prev.minDays) prev.minDays = over;
    byParty.set(key, prev);
  }
  const ranked = [...byParty.values()].sort((a, b) => b.total - a.total || b.maxDays - a.maxDays);
  return { totalAmount, maxOverdue, ranked };
}

/**
 * Construye las notificaciones inteligentes a partir del estado real del POS.
 * Función 100 % pura y determinística (apto para pruebas unitarias, Web, PWA y Windows offline).
 */
export function buildSmartNotifications({
  now = new Date(),
  hasRuntime = false,
  isOwner = true,
  products = [],
  sales = [],
  customers = [],
  suppliers = [],
  receivables = [],
  payables = [],
  workshopAccounts = [],
  cashSession = null,
  settings = null,
  pending = null,
  inFlightOperationId = null,
  desktopStatus = null,
} = {}) {
  const list = [];
  const todayIso = businessTodayIso(now);
  const todayDate = documentaryDate(todayIso);
  const cutoff30Iso = isoDateOffset(todayDate, -VELOCITY_WINDOW_DAYS);
  const customerNames = new Map(customers.map((c) => [c.id, c.name]));
  const supplierNames = new Map(suppliers.map((s) => [s.id, s.name]));

  // --- 1. Operación crítica: sincronización y solicitudes pendientes ---
  if (desktopStatus?.connection === "conflict") {
    const count = Number(desktopStatus.pending) || 0;
    list.push({
      id: "sync-conflict",
      category: "operacion",
      severity: "critical",
      priority: 100,
      title: "Conflicto de sincronización en este equipo",
      description: count > 0
        ? `Hay ${plural(count, "operación local", "operaciones locales")} que requieren revisión antes de continuar sincronizando.`
        : "Revisa el estado de sincronización en la barra superior para resolver el conflicto.",
      metric: count > 0 ? plural(count, "pendiente", "pendientes") : "Requiere revisión",
      actionLabel: "Ir a Ventas",
      to: "/ventas",
      fingerprint: `sync-conflict:${count}`,
      snoozeable: false,
    });
  } else if (desktopStatus && Number(desktopStatus.pending) > 0) {
    const count = Number(desktopStatus.pending);
    const offline = desktopStatus.connection === "offline";
    list.push({
      id: "desktop-pending",
      category: "operacion",
      severity: offline && count >= 5 ? "warning" : "info",
      priority: offline ? 73 : 56,
      title: offline
        ? `${plural(count, "operación guardada", "operaciones guardadas")} sin conexión`
        : `${plural(count, "operación pendiente", "operaciones pendientes")} de subir`,
      description: offline
        ? "Tus ventas y movimientos siguen guardados localmente y se sincronizarán al volver el internet."
        : "El equipo está conectado; puedes sincronizar desde el botón de estado en la barra superior.",
      metric: plural(count, "pendiente", "pendientes"),
      actionLabel: "Ver estado",
      to: "/ventas",
      fingerprint: `desktop-pending:${desktopStatus.connection}:${count}`,
      snoozeable: true,
    });
  }

  if (pending?.id && inFlightOperationId !== pending.id) {
    list.push({
      id: "pending",
      category: "operacion",
      severity: "critical",
      priority: 98,
      title: "Solicitud pendiente de confirmación",
      description: "Revisa el aviso en la parte superior para reintentar, confirmar o archivar sin duplicar.",
      metric: "En espera",
      actionLabel: "Revisar ahora",
      to: "/ventas",
      fingerprint: `pending:${pending.id}`,
      snoozeable: false,
    });
  }

  // --- 2. Caja (cerrada o abierta desde un día anterior) ---
  if (hasRuntime) {
    if (cashSession?.open) {
      const openedDay = businessDayOf(cashSession.openedAt);
      if (openedDay && openedDay < todayIso) {
        const daysOpen = daysBetweenIso(openedDay, todayIso) ?? 1;
        list.push({
          id: "cash-stale",
          category: "operacion",
          severity: "critical",
          priority: 93,
          title: "Caja abierta de un día anterior",
          description: `El turno actual se abrió el ${openedDay} (hace ${plural(daysOpen, "día", "días")}). Realiza el cierre y cuadre para mantener los cortes diarios limpios.`,
          metric: plural(daysOpen, "día abierta", "días abierta"),
          actionLabel: "Ir a Caja",
          to: "/caja",
          fingerprint: `cash-stale:${cashSession.id ?? openedDay}:${todayIso}`,
          snoozeable: true,
        });
      }
    } else {
      list.push({
        id: "cash-closed",
        category: "operacion",
        severity: "warning",
        priority: 82,
        title: "Caja cerrada",
        description: "Abre la caja para registrar ventas y cobros en efectivo.",
        metric: "Sin turno",
        actionLabel: "Abrir caja",
        to: "/caja",
        fingerprint: `cash-closed:${todayIso}`,
        snoozeable: true,
      });
    }
  }

  // --- 3. Análisis en 1 barrido de ventas (últimos 30 días + hoy) ---
  const sold30dByProduct = new Map();
  const ncf30dByType = new Map();
  let salesTodayTotal = 0;
  let salesTodayCount = 0;

  for (let i = 0; i < sales.length; i++) {
    const sale = sales[i];
    if (!sale || sale.status === "anulada") continue;
    const saleDay = businessDayOf(sale.date);
    if (!saleDay) continue;
    if (saleDay === todayIso) {
      salesTodayTotal = round2(salesTodayTotal + (Number(sale.total) || 0));
      salesTodayCount += 1;
    }
    if (saleDay >= cutoff30Iso && saleDay <= todayIso) {
      if (sale.ncf && sale.comprobante) {
        ncf30dByType.set(sale.comprobante, (ncf30dByType.get(sale.comprobante) ?? 0) + 1);
      }
      const lines = sale.lines ?? [];
      for (let j = 0; j < lines.length; j++) {
        const line = lines[j];
        const qty = Number(line.quantity) || 0;
        if (qty <= 0 || line.productId == null) continue;
        sold30dByProduct.set(line.productId, (sold30dByProduct.get(line.productId) ?? 0) + qty);
      }
    }
  }

  // --- 4. Comprobantes NCF (solo dueño) ---
  if (isOwner) {
    for (const seq of settings?.ncf ?? []) {
      if (!seq?.active) continue;
      const remaining = Math.max(0, (Number(seq.end) || 0) - (Number(seq.current) || 0));
      const daysToExp = seq.expiresAt ? daysBetweenIso(todayIso, seq.expiresAt) : null;

      if (daysToExp !== null && daysToExp < 0) {
        list.push({
          id: `ncf-exp-${seq.type}`,
          category: "operacion",
          severity: "critical",
          priority: 95,
          title: `Secuencia NCF ${seq.type} vencida`,
          description: `Venció el ${seq.expiresAt}. Registra un rango vigente en Configuración para seguir emitiendo ${seq.type}.`,
          metric: "Vencida",
          actionLabel: "Configurar NCF",
          to: "/configuracion",
          fingerprint: `ncf-exp:${seq.type}:${seq.expiresAt}`,
          snoozeable: true,
        });
        continue;
      }

      if (remaining <= 0) {
        list.push({
          id: `ncf-empty-${seq.type}`,
          category: "operacion",
          severity: "critical",
          priority: 94,
          title: `Secuencia NCF ${seq.type} agotada`,
          description: "No quedan comprobantes disponibles en el rango activo. Configura una nueva secuencia.",
          metric: "0 restantes",
          actionLabel: "Configurar NCF",
          to: "/configuracion",
          fingerprint: `ncf-empty:${seq.type}:${seq.end}`,
          snoozeable: true,
        });
        continue;
      }

      if (daysToExp !== null && daysToExp <= NCF_EXPIRY_WARN_DAYS) {
        list.push({
          id: `ncf-exp-soon-${seq.type}`,
          category: "operacion",
          severity: daysToExp <= 3 ? "critical" : "warning",
          priority: daysToExp <= 3 ? 86 : 75,
          title: `Secuencia NCF ${seq.type} por vencer`,
          description: daysToExp === 0
            ? `Vence hoy (${seq.expiresAt}). Quedan ${formatNumber(remaining)} comprobantes.`
            : `Vence en ${plural(daysToExp, "día", "días")} (${seq.expiresAt}). Quedan ${formatNumber(remaining)} comprobantes.`,
          metric: daysToExp === 0 ? "Vence hoy" : `${daysToExp} d`,
          actionLabel: "Ver NCF",
          to: "/configuracion",
          fingerprint: `ncf-exp-soon:${seq.type}:${seq.expiresAt}:${daysToExp <= 3 ? "urgent" : "soon"}`,
          snoozeable: true,
        });
      }

      const used30 = ncf30dByType.get(seq.type) ?? 0;
      const dailyNcfRate = used30 / VELOCITY_WINDOW_DAYS;
      const estDaysLeft = dailyNcfRate > 0 ? remaining / dailyNcfRate : Infinity;
      if (remaining <= NCF_LOW_COUNT || (used30 >= 5 && estDaysLeft <= NCF_LOW_DAYS)) {
        const pace = used30 >= 5 ? ` (a este ritmo dura ${formatDaysLabel(estDaysLeft)})` : "";
        list.push({
          id: `ncf-low-${seq.type}`,
          category: "operacion",
          severity: remaining <= 5 ? "critical" : "warning",
          priority: remaining <= 5 ? 85 : 74,
          title: `Secuencia NCF ${seq.type} por agotarse`,
          description: `Quedan ${plural(remaining, "comprobante disponible", "comprobantes disponibles")}${pace}.`,
          metric: `${formatNumber(remaining)} rest.`,
          actionLabel: "Ver NCF",
          to: "/configuracion",
          fingerprint: `ncf-low:${seq.type}:${remaining <= 5 ? "crit" : Math.ceil(remaining / 5)}`,
          snoozeable: true,
        });
      }
    }
  }

  // --- 5. Inventario inteligente (rotación, agotados con demanda, bajo mínimo y margen <= 0) ---
  const outHot = [];
  const outCold = [];
  const velocityRisk = [];
  const lowGeneral = [];
  const marginIssues = [];

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    if (!p) continue;
    const stock = Number(p.stock) || 0;
    const minStock = Number(p.minStock) || 0;
    const sold30 = sold30dByProduct.get(p.id) ?? 0;
    const notify = p.notifyMinStock !== false;

    if (isOwner) {
      const cost = Number(p.cost) || 0;
      const p1 = Number(p.prices?.p1) || 0;
      if (cost > 0 && p1 > 0 && p1 <= cost) {
        marginIssues.push({ product: p, cost, p1, diff: round2(p1 - cost) });
      }
    }

    if (!notify) continue;

    if (stock <= 0) {
      if (sold30 > 0) outHot.push({ product: p, sold30 });
      else outCold.push(p);
      continue;
    }

    const dailyRate = sold30 / VELOCITY_WINDOW_DAYS;
    const daysLeft = dailyRate > 0 ? stock / dailyRate : Infinity;
    if (sold30 >= VELOCITY_MIN_UNITS && daysLeft <= VELOCITY_WARN_DAYS) {
      velocityRisk.push({ product: p, stock, sold30, dailyRate, daysLeft });
    } else if (stock <= minStock) {
      lowGeneral.push(p);
    }
  }

  if (outHot.length > 0) {
    outHot.sort((a, b) => b.sold30 - a.sold30);
    list.push({
      id: "stock-out-hot",
      category: "inventario",
      severity: "critical",
      priority: 91,
      title: outHot.length === 1
        ? "1 repuesto de alta rotación agotado"
        : `${formatNumber(outHot.length)} repuestos con ventas recientes agotados`,
      description: "Se vendieron en los últimos 30 días y ya están en 0 unidades. Prioriza su reposición.",
      metric: plural(outHot.length, "agotado", "agotados"),
      actionLabel: "Ver agotados",
      to: "/inventario?existencia=out",
      items: outHot.slice(0, 4).map(({ product, sold30 }) => ({
        label: product.name,
        meta: `0 disp. · ${formatNumber(sold30)} vend. (30 d)`,
        to: `/inventario?buscar=${encodeURIComponent(product.code)}`,
      })),
      fingerprint: `stock-out-hot:${outHot.map((x) => x.product.id).sort((a, b) => a - b).join(",")}`,
      snoozeable: true,
    });
  }

  if (velocityRisk.length > 0) {
    velocityRisk.sort((a, b) => a.daysLeft - b.daysLeft || b.sold30 - a.sold30);
    const mostUrgentDays = Math.max(1, Math.ceil(velocityRisk[0].daysLeft));
    const critical = velocityRisk[0].daysLeft <= VELOCITY_CRIT_DAYS;
    list.push({
      id: "stock-velocity",
      category: "inventario",
      severity: critical ? "critical" : "warning",
      priority: critical ? 88 : 78,
      title: velocityRisk.length === 1
        ? `1 repuesto se agota en ${formatDaysLabel(velocityRisk[0].daysLeft)}`
        : `${formatNumber(velocityRisk.length)} repuestos con quiebre inminente`,
      description: "Según tu ritmo de ventas de los últimos 30 días, estos artículos se quedarán sin existencia muy pronto.",
      metric: `≤ ${mostUrgentDays} ${mostUrgentDays === 1 ? "día" : "días"}`,
      actionLabel: isOwner ? "Ir a Compras" : "Ver reposición",
      to: isOwner ? "/compras" : "/inventario?existencia=reposicion",
      items: velocityRisk.slice(0, 4).map(({ product, stock, dailyRate, daysLeft }) => ({
        label: product.name,
        meta: `Quedan ${formatNumber(stock)} · ${formatRate(dailyRate)} (${formatDaysLabel(daysLeft)})`,
        to: `/inventario?buscar=${encodeURIComponent(product.code)}`,
      })),
      fingerprint: `stock-velocity:${velocityRisk.map((x) => `${x.product.id}:${Math.ceil(x.daysLeft)}`).join(",")}`,
      snoozeable: true,
    });
  }

  if (marginIssues.length > 0) {
    marginIssues.sort((a, b) => a.diff - b.diff);
    list.push({
      id: "price-below-cost",
      category: "inventario",
      severity: "critical",
      priority: 87,
      title: marginIssues.length === 1
        ? "1 artículo con precio menor o igual al costo"
        : `${formatNumber(marginIssues.length)} artículos con precio ≤ costo`,
      description: "Revisa estos precios para evitar vender sin margen o con pérdida tras cambios de costo.",
      metric: plural(marginIssues.length, "artículo", "artículos"),
      actionLabel: "Revisar precios",
      to: `/inventario?buscar=${encodeURIComponent(marginIssues[0].product.code)}`,
      items: marginIssues.slice(0, 4).map(({ product, cost, p1 }) => ({
        label: product.name,
        meta: `Costo ${formatMoney(cost)} · P1 ${formatMoney(p1)}`,
        to: `/inventario?buscar=${encodeURIComponent(product.code)}`,
      })),
      fingerprint: `price-below-cost:${marginIssues.map((x) => `${x.product.id}:${x.cost}:${x.p1}`).join(",")}`,
      snoozeable: true,
    });
  }

  if (outCold.length > 0) {
    const description = outCold.length <= 3
      ? `${outCold.map((p) => p.name).join(", ")}.`
      : "Artículos en 0 sin ventas registradas en los últimos 30 días.";
    list.push({
      id: "stock-out-other",
      category: "inventario",
      severity: "warning",
      priority: 59,
      title: outHot.length > 0
        ? `${plural(outCold.length, "artículo agotado", "artículos agotados")} sin ventas recientes`
        : plural(outCold.length, "artículo agotado", "artículos agotados"),
      description,
      metric: plural(outCold.length, "agotado", "agotados"),
      actionLabel: "Ver agotados",
      to: "/inventario?existencia=out",
      fingerprint: `stock-out-other:${outCold.length}:${outCold.slice(0, 5).map((p) => p.id).join(",")}`,
      snoozeable: true,
    });
  }

  if (lowGeneral.length > 0) {
    lowGeneral.sort((a, b) => a.stock / (a.minStock || 1) - b.stock / (b.minStock || 1));
    list.push({
      id: "stock-low",
      category: "inventario",
      severity: "warning",
      priority: 57,
      title: plural(lowGeneral.length, "artículo bajo mínimo", "artículos bajo mínimo"),
      description: lowGeneral.slice(0, 3).map((p) => `${p.name} (${formatNumber(p.stock)}/${formatNumber(p.minStock)})`).join(", ") +
        (lowGeneral.length > 3 ? ` y ${lowGeneral.length - 3} más.` : "."),
      metric: plural(lowGeneral.length, "bajo mín.", "bajo mín."),
      actionLabel: "Ver inventario",
      to: "/inventario?existencia=low",
      fingerprint: `stock-low:${lowGeneral.length}:${lowGeneral.slice(0, 5).map((p) => `${p.id}=${p.stock}`).join(",")}`,
      snoozeable: true,
    });
  }

  // --- 6. Cuentas por cobrar y límites de crédito ---
  const cxcOverdueDocs = [];
  const cxcSoonDocs = [];
  for (let i = 0; i < receivables.length; i++) {
    const doc = receivables[i];
    if (balanceOf(doc) <= 0) continue;
    const over = safeDueDays(doc, now, todayDate);
    if (over === null) continue;
    if (over > 0) cxcOverdueDocs.push(doc);
    else if (over >= -DUE_SOON_DAYS) cxcSoonDocs.push(doc);
  }

  if (cxcOverdueDocs.length > 0) {
    const { totalAmount, maxOverdue, ranked } = summarizeParties(cxcOverdueDocs, now, todayDate, customerNames);
    list.push({
      id: "cxc-overdue",
      category: "cuentas",
      severity: "critical",
      priority: 90,
      title: `${plural(cxcOverdueDocs.length, "factura por cobrar vencida", "facturas por cobrar vencidas")}`,
      description: `Saldo vencido de ${formatMoney(totalAmount)} entre ${plural(ranked.length, "cliente", "clientes")} (atraso máx. ${plural(maxOverdue, "día", "días")}).`,
      metric: formatMoney(totalAmount),
      actionLabel: "Ver vencidas",
      to: "/cuentas-por-cobrar?filtro=vencidas",
      items: ranked.slice(0, 4).map((c) => ({
        label: c.name,
        meta: `${formatMoney(c.total)} · ${plural(c.maxDays, "día", "días")}`,
        to: c.partyId != null ? `/cuentas-por-cobrar?cliente=${encodeURIComponent(c.partyId)}` : "/cuentas-por-cobrar",
      })),
      fingerprint: `cxc-overdue:${cxcOverdueDocs.length}:${totalAmount.toFixed(2)}`,
      snoozeable: true,
    });
  }

  if (cxcSoonDocs.length > 0) {
    const { totalAmount, ranked } = summarizeParties(cxcSoonDocs, now, todayDate, customerNames);
    list.push({
      id: "cxc-due-soon",
      category: "cuentas",
      severity: "warning",
      priority: 70,
      title: `${plural(cxcSoonDocs.length, "cobro vence", "cobros vencen")} en ≤ ${DUE_SOON_DAYS} días`,
      description: `${formatMoney(totalAmount)} próximos a vencer de ${ranked.slice(0, 2).map((c) => c.name).join(", ")}${ranked.length > 2 ? ` y ${ranked.length - 2} más` : ""}.`,
      metric: formatMoney(totalAmount),
      actionLabel: "Ver CxC",
      to: "/cuentas-por-cobrar",
      items: ranked.slice(0, 3).map((c) => {
        const left = Math.abs(c.minDays);
        return {
          label: c.name,
          meta: `${formatMoney(c.total)} · ${left === 0 ? "vence hoy" : `en ${plural(left, "día", "días")}`}`,
          to: c.partyId != null ? `/cuentas-por-cobrar?cliente=${encodeURIComponent(c.partyId)}` : "/cuentas-por-cobrar",
        };
      }),
      fingerprint: `cxc-soon:${cxcSoonDocs.length}:${totalAmount.toFixed(2)}:${todayIso}`,
      snoozeable: true,
    });
  }

  const nearCreditLimit = [];
  for (let i = 0; i < customers.length; i++) {
    const c = customers[i];
    if (!c || c.isCashCustomer) continue;
    const limit = Number(c.creditLimit) || 0;
    const bal = Number(c.balance) || 0;
    if (limit <= 0 || bal <= 0) continue;
    const ratio = bal / limit;
    if (ratio >= CREDIT_WARN_RATIO) {
      nearCreditLimit.push({ customer: c, bal, limit, pct: Math.round(ratio * 100) });
    }
  }
  if (nearCreditLimit.length > 0) {
    nearCreditLimit.sort((a, b) => b.pct - a.pct || b.bal - a.bal);
    const exceeded = nearCreditLimit.filter((x) => x.pct >= 100).length;
    list.push({
      id: "credit-limit",
      category: "cuentas",
      severity: exceeded > 0 ? "warning" : "info",
      priority: exceeded > 0 ? 68 : 48,
      title: exceeded > 0
        ? `${plural(exceeded, "cliente llegó", "clientes llegaron")} a su límite de crédito`
        : `${plural(nearCreditLimit.length, "cliente cerca", "clientes cerca")} del límite de crédito`,
      description: "Revisa sus saldos o registra abonos antes de emitir nuevas facturas a crédito.",
      metric: plural(nearCreditLimit.length, "cliente", "clientes"),
      actionLabel: "Ver clientes",
      to: `/clientes?buscar=${encodeURIComponent(nearCreditLimit[0].customer.name)}`,
      items: nearCreditLimit.slice(0, 4).map(({ customer, bal, limit, pct }) => ({
        label: customer.name,
        meta: `${formatMoney(bal)} / ${formatMoney(limit)} (${pct}%)`,
        to: `/clientes?buscar=${encodeURIComponent(customer.name)}`,
      })),
      fingerprint: `credit-limit:${nearCreditLimit.map((x) => `${x.customer.id}:${Math.floor(x.pct / 5)}`).join(",")}`,
      snoozeable: true,
    });
  }

  // --- 7. Cuentas por pagar a suplidores (solo dueño) ---
  if (isOwner) {
    const cxpOverdueDocs = [];
    const cxpSoonDocs = [];
    for (let i = 0; i < payables.length; i++) {
      const doc = payables[i];
      if (balanceOf(doc) <= 0) continue;
      const over = safeDueDays(doc, now, todayDate);
      if (over === null) continue;
      if (over > 0) cxpOverdueDocs.push(doc);
      else if (over >= -DUE_SOON_DAYS) cxpSoonDocs.push(doc);
    }

    if (cxpOverdueDocs.length > 0) {
      const { totalAmount, maxOverdue, ranked } = summarizeParties(cxpOverdueDocs, now, todayDate, supplierNames);
      list.push({
        id: "cxp-overdue",
        category: "cuentas",
        severity: "critical",
        priority: 89,
        title: `${plural(cxpOverdueDocs.length, "factura a suplidor vencida", "facturas a suplidores vencidas")}`,
        description: `Balance vencido de ${formatMoney(totalAmount)} con ${plural(ranked.length, "suplidor", "suplidores")} (atraso máx. ${plural(maxOverdue, "día", "días")}).`,
        metric: formatMoney(totalAmount),
        actionLabel: "Ver vencidas",
        to: "/cuentas-por-pagar?filtro=vencidas",
        items: ranked.slice(0, 4).map((s) => ({
          label: s.name,
          meta: `${formatMoney(s.total)} · ${plural(s.maxDays, "día", "días")}`,
          to: s.partyId != null ? `/cuentas-por-pagar?suplidor=${encodeURIComponent(s.partyId)}` : "/cuentas-por-pagar",
        })),
        fingerprint: `cxp-overdue:${cxpOverdueDocs.length}:${totalAmount.toFixed(2)}`,
        snoozeable: true,
      });
    }

    if (cxpSoonDocs.length > 0) {
      const { totalAmount, ranked } = summarizeParties(cxpSoonDocs, now, todayDate, supplierNames);
      list.push({
        id: "cxp-due-soon",
        category: "cuentas",
        severity: "warning",
        priority: 69,
        title: `${plural(cxpSoonDocs.length, "pago a suplidor vence", "pagos a suplidores vencen")} en ≤ ${DUE_SOON_DAYS} días`,
        description: `${formatMoney(totalAmount)} próximos a vencer con ${ranked.slice(0, 2).map((s) => s.name).join(", ")}${ranked.length > 2 ? ` y ${ranked.length - 2} más` : ""}.`,
        metric: formatMoney(totalAmount),
        actionLabel: "Ver CxP",
        to: "/cuentas-por-pagar",
        items: ranked.slice(0, 3).map((s) => {
          const left = Math.abs(s.minDays);
          return {
            label: s.name,
            meta: `${formatMoney(s.total)} · ${left === 0 ? "vence hoy" : `en ${plural(left, "día", "días")}`}`,
            to: s.partyId != null ? `/cuentas-por-pagar?suplidor=${encodeURIComponent(s.partyId)}` : "/cuentas-por-pagar",
          };
        }),
        fingerprint: `cxp-soon:${cxpSoonDocs.length}:${totalAmount.toFixed(2)}:${todayIso}`,
        snoozeable: true,
      });
    }
  }

  // --- 8. Cuentas de taller abiertas con piezas despachadas > 24 h ---
  const staleWorkshop = [];
  const nowMs = now.getTime();
  for (let i = 0; i < workshopAccounts.length; i++) {
    const acc = workshopAccounts[i];
    if (!acc || acc.status !== "abierta") continue;
    const openedMs = new Date(acc.openedAt).getTime();
    if (!Number.isFinite(openedMs)) continue;
    const hoursOpen = (nowMs - openedMs) / 3_600_000;
    if (hoursOpen < WORKSHOP_STALE_HOURS) continue;
    let netTotal = 0;
    let netUnits = 0;
    for (const item of acc.items ?? []) {
      const qty = Number(item.netQuantity) || 0;
      if (qty > 0) {
        netUnits += qty;
        netTotal = round2(netTotal + qty * (Number(item.price) || 0));
      }
    }
    if (netUnits <= 0) continue;
    staleWorkshop.push({ account: acc, hoursOpen, netTotal, netUnits });
  }
  if (staleWorkshop.length > 0) {
    staleWorkshop.sort((a, b) => b.hoursOpen - a.hoursOpen);
    const totalPending = round2(staleWorkshop.reduce((sum, x) => sum + x.netTotal, 0));
    list.push({
      id: "workshop-stale",
      category: "operacion",
      severity: "warning",
      priority: 64,
      title: `${plural(staleWorkshop.length, "cuenta de taller abierta", "cuentas de taller abiertas")} sin facturar`,
      description: `Hay ${formatMoney(totalPending)} en repuestos despachados con más de 24 horas pendientes de cobro.`,
      metric: formatMoney(totalPending),
      actionLabel: "Ir a Ventas",
      to: "/ventas",
      items: staleWorkshop.slice(0, 3).map(({ account, hoursOpen, netTotal }) => ({
        label: [account.customerName, account.vehicle].filter(Boolean).join(" · "),
        meta: `${formatMoney(netTotal)} · hace ${Math.floor(hoursOpen / 24)} d`,
        to: "/ventas",
      })),
      fingerprint: `workshop-stale:${staleWorkshop.map((x) => `${x.account.id}:${x.netTotal}`).join(",")}`,
      snoozeable: true,
    });
  }

  // --- 9. Meta diaria alcanzada (informativa) ---
  const dailyGoal = Number(settings?.dailyGoal) || 0;
  if (dailyGoal > 0 && salesTodayTotal >= dailyGoal) {
    const pct = Math.round((salesTodayTotal / dailyGoal) * 100);
    list.push({
      id: "daily-goal-hit",
      category: "operacion",
      severity: "info",
      priority: 25,
      title: "Meta diaria alcanzada",
      description: `Llevas ${formatMoney(salesTodayTotal)} en ${plural(salesTodayCount, "venta", "ventas")} hoy (${pct}% de tu meta de ${formatMoney(dailyGoal)}).`,
      metric: `${pct}%`,
      actionLabel: "Ver Panel",
      to: "/",
      fingerprint: `daily-goal:${todayIso}`,
      snoozeable: true,
    });
  }

  list.sort((a, b) =>
    (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0) ||
    b.priority - a.priority ||
    a.id.localeCompare(b.id),
  );
  return list;
}

/**
 * Detecta productos vendidos que acaban de cruzar a stock 0 o bajo mínimo tras una venta confirmada.
 * Permite mostrar un aviso breve sin repetir alertas de productos que ya estaban por debajo antes de la venta.
 */
export function detectPostSaleStockCrossings(soldItems = [], updatedProducts = []) {
  if (!soldItems.length || !updatedProducts.length) return { newlyOut: [], newlyLow: [] };
  const byId = new Map(updatedProducts.map((p) => [p.id, p]));
  const seen = new Set();
  const newlyOut = [];
  const newlyLow = [];

  for (const line of soldItems) {
    const prod = line?.product;
    if (!prod || seen.has(prod.id)) continue;
    seen.add(prod.id);
    const updated = byId.get(prod.id);
    if (!updated) continue;
    const notify = updated.notificarMinimo ?? updated.notifyMinStock ?? prod.notifyMinStock ?? true;
    if (notify === false) continue;

    const beforeStock = Number(prod.stock);
    const afterStock = Number(updated.stock);
    const minStock = Number(updated.stockMinimo ?? updated.minStock ?? prod.minStock) || 0;
    const name = updated.nombre ?? updated.name ?? prod.name;
    if (!Number.isFinite(beforeStock) || !Number.isFinite(afterStock)) continue;

    if (beforeStock > 0 && afterStock <= 0) {
      newlyOut.push({ id: prod.id, name, stock: afterStock, minStock });
    } else if (minStock > 0 && beforeStock > minStock && afterStock > 0 && afterStock <= minStock) {
      newlyLow.push({ id: prod.id, name, stock: afterStock, minStock });
    }
  }
  return { newlyOut, newlyLow };
}

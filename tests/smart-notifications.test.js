import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSmartNotifications,
  detectPostSaleStockCrossings,
} from "../frontend/src/data/smart-notifications.js";
import {
  emptyNotificationState,
  markAlertSeen,
  markAllAlertsSeen,
  partitionNotifications,
  snoozeAlertUntilTomorrow,
  unsnoozeAlert,
} from "../frontend/src/data/notification-state.js";

const NOW = new Date("2026-11-24T15:00:00-04:00");

test("inventario inteligente: separa agotados con demanda, quiebre inminente por rotación, bajo mínimo y precio <= costo", () => {
  const products = [
    { id: 1, code: "BUJ-01", name: "Bujía NGK", stock: 0, minStock: 5, cost: 80, prices: { p1: 150 }, notifyMinStock: true },
    { id: 2, code: "COR-02", name: "Correa Bando", stock: 3, minStock: 2, cost: 200, prices: { p1: 400 }, notifyMinStock: true },
    { id: 3, code: "ESP-03", name: "Espejo Viejo", stock: 0, minStock: 3, cost: 100, prices: { p1: 250 }, notifyMinStock: true },
    { id: 4, code: "FIL-04", name: "Filtro Aire", stock: 2, minStock: 5, cost: 150, prices: { p1: 300 }, notifyMinStock: true },
    { id: 5, code: "ACE-05", name: "Aceite 20W50", stock: 10, minStock: 5, cost: 320, prices: { p1: 300 }, notifyMinStock: true },
    { id: 6, code: "SIL-06", name: "Sin Alerta", stock: 0, minStock: 5, cost: 50, prices: { p1: 100 }, notifyMinStock: false },
  ];
  const sales = [
    // Bujía vendió 6 en los últimos 30 días -> agotada con alta rotación
    { id: 101, date: "2026-11-20T10:00:00-04:00", status: "pagada", total: 900, lines: [{ productId: 1, quantity: 6 }] },
    // Correa vendió 60 en los últimos 30 días (2/día) y quedan 3 -> ~1.5 días (crítico!) aunque stock (3) > minStock (2)
    { id: 102, date: "2026-11-18T11:00:00-04:00", status: "pagada", total: 24000, lines: [{ productId: 2, quantity: 60 }] },
    // Anulada no debe contar
    { id: 103, date: "2026-11-22T11:00:00-04:00", status: "anulada", total: 2500, lines: [{ productId: 3, quantity: 10 }] },
  ];

  const ownerAlerts = buildSmartNotifications({ now: NOW, isOwner: true, products, sales });
  const byId = new Map(ownerAlerts.map((a) => [a.id, a]));

  assert.equal(byId.get("stock-out-hot")?.severity, "critical");
  assert.match(byId.get("stock-out-hot")?.items?.[0]?.label ?? "", /Bujía NGK/);

  assert.equal(byId.get("stock-velocity")?.severity, "critical");
  assert.match(byId.get("stock-velocity")?.items?.[0]?.label ?? "", /Correa Bando/);

  assert.equal(byId.get("price-below-cost")?.severity, "critical");
  assert.match(byId.get("price-below-cost")?.items?.[0]?.label ?? "", /Aceite 20W50/);

  assert.equal(byId.get("stock-out-other")?.severity, "warning");
  assert.match(byId.get("stock-out-other")?.description ?? "", /Espejo Viejo/);
  assert.doesNotMatch(byId.get("stock-out-other")?.description ?? "", /Sin Alerta/);

  assert.equal(byId.get("stock-low")?.severity, "warning");
  assert.match(byId.get("stock-low")?.description ?? "", /Filtro Aire/);
  assert.doesNotMatch(byId.get("stock-low")?.description ?? "", /Correa Bando/);

  // Cajero NO ve precio <= costo ni enlace a /compras
  const cashierAlerts = buildSmartNotifications({ now: NOW, isOwner: false, products, sales });
  const cashierIds = new Set(cashierAlerts.map((a) => a.id));
  assert.equal(cashierIds.has("price-below-cost"), false);
  assert.equal(cashierAlerts.find((a) => a.id === "stock-velocity")?.to, "/inventario?existencia=reposicion");
});

test("cuentas por cobrar, límite de crédito y cuentas por pagar respetan vencimientos y roles", () => {
  const customers = [
    { id: 10, name: "Taller El Primo", isCashCustomer: false, creditLimit: 10000, balance: 9500 },
    { id: 11, name: "Moto Express", isCashCustomer: false, creditLimit: 5000, balance: 5400 },
    { id: 12, name: "Cliente Contado", isCashCustomer: true, creditLimit: 0, balance: 0 },
  ];
  const receivables = [
    { id: 1, partyId: 10, partyName: "Taller El Primo", dueDate: "2026-11-19", amount: 3000, paid: 500 },
    { id: 2, partyId: 11, partyName: "Moto Express", dueDate: "2026-11-26", amount: 1800, paid: 0 },
    { id: 3, partyId: 11, partyName: "Moto Express", dueDate: "2026-11-10", amount: 1000, paid: 1000 }, // ya saldada
  ];
  const payables = [
    { id: 20, partyId: 50, partyName: "Importadora Cibao", dueDate: "2026-11-20", amount: 12500, paid: 0 },
    { id: 21, partyId: 51, partyName: "Distribuidora Sur", dueDate: "2026-11-24", amount: 4200, paid: 200 },
  ];

  const owner = buildSmartNotifications({ now: NOW, isOwner: true, customers, receivables, payables });
  const map = new Map(owner.map((a) => [a.id, a]));
  assert.equal(map.get("cxc-overdue")?.severity, "critical");
  assert.equal(map.get("cxc-overdue")?.to, "/cuentas-por-cobrar?filtro=vencidas");
  assert.match(map.get("cxc-overdue")?.description ?? "", /2,500\.00/);

  assert.equal(map.get("cxc-due-soon")?.severity, "warning");
  assert.match(map.get("cxc-due-soon")?.description ?? "", /1,800\.00/);

  assert.equal(map.get("credit-limit")?.severity, "warning");
  assert.equal(map.get("credit-limit")?.items?.length, 2);

  assert.equal(map.get("cxp-overdue")?.severity, "critical");
  assert.equal(map.get("cxp-overdue")?.to, "/cuentas-por-pagar?filtro=vencidas");
  assert.equal(map.get("cxp-due-soon")?.severity, "warning");

  // Cajero ve CxC y límite de crédito, pero NO CxP
  const cashier = buildSmartNotifications({ now: NOW, isOwner: false, customers, receivables, payables });
  const cIds = new Set(cashier.map((a) => a.id));
  assert.equal(cIds.has("cxc-overdue"), true);
  assert.equal(cIds.has("credit-limit"), true);
  assert.equal(cIds.has("cxp-overdue"), false);
  assert.equal(cIds.has("cxp-due-soon"), false);
});

test("caja de día anterior, NCF por vencer/agotarse, taller > 24h, sync conflicto y meta diaria", () => {
  const settings = {
    dailyGoal: 5000,
    ncf: [
      { type: "B01", active: true, start: 1, end: 100, current: 96, expiresAt: "2026-12-04" }, // vence en 10 d + quedan 4 (crítico)
      { type: "B02", active: true, start: 1, end: 100, current: 10, expiresAt: "2026-11-20" }, // vencida
      { type: "B14", active: false, start: 1, end: 10, current: 10, expiresAt: "2026-11-01" }, // inactiva -> ignorar
    ],
  };
  const sales = [
    { id: 1, date: "2026-11-24T09:30:00-04:00", status: "pagada", total: 5600, lines: [] },
  ];
  const workshopAccounts = [
    {
      id: 7,
      status: "abierta",
      customerName: "Carlos Mecánico",
      vehicle: "CG-150 Roja",
      openedAt: "2026-11-22T10:00:00-04:00",
      items: [{ netQuantity: 2, price: 650 }],
    },
    {
      id: 8,
      status: "abierta",
      customerName: "Reciente",
      vehicle: "AX-100",
      openedAt: "2026-11-24T12:00:00-04:00",
      items: [{ netQuantity: 1, price: 300 }],
    },
  ];

  const alerts = buildSmartNotifications({
    now: NOW,
    hasRuntime: true,
    isOwner: true,
    sales,
    settings,
    workshopAccounts,
    cashSession: { id: 3, open: true, openedAt: "2026-11-23T08:15:00-04:00" },
    desktopStatus: { connection: "conflict", pending: 2 },
  });
  const byId = new Map(alerts.map((a) => [a.id, a]));

  assert.equal(byId.get("sync-conflict")?.snoozeable, false);
  assert.equal(byId.get("cash-stale")?.severity, "critical");
  assert.equal(byId.has("cash-closed"), false);
  assert.equal(byId.get("ncf-exp-B02")?.severity, "critical");
  assert.equal(byId.get("ncf-exp-soon-B01")?.severity, "warning");
  assert.equal(byId.get("ncf-low-B01")?.severity, "critical");
  assert.equal(byId.has("ncf-exp-B14"), false);
  assert.equal(byId.get("workshop-stale")?.severity, "warning");
  assert.match(byId.get("workshop-stale")?.description ?? "", /1,300\.00/);
  assert.equal(byId.get("daily-goal-hit")?.severity, "info");
  assert.equal(byId.get("daily-goal-hit")?.metric, "112%");

  // Primera alerta debe ser sync-conflict (prioridad 100) y última daily-goal-hit
  assert.equal(alerts[0].id, "sync-conflict");
  assert.equal(alerts[alerts.length - 1].id, "daily-goal-hit");
});

test("estado inteligente: posponer oculta hasta mañana y se reactiva sola si cambia la huella", () => {
  const baseAlerts = [
    { id: "sync-conflict", severity: "critical", fingerprint: "sync:1", snoozeable: false },
    { id: "cxc-overdue", severity: "critical", fingerprint: "cxc:1:2500.00", snoozeable: true },
    { id: "stock-low", severity: "warning", fingerprint: "low:2", snoozeable: true },
  ];

  let state = emptyNotificationState();
  let view = partitionNotifications(baseAlerts, state, NOW);
  assert.equal(view.unreadCount, 3);
  assert.equal(view.unreadCriticalCount, 2);

  // Marcar leída una alerta
  state = markAlertSeen(state, baseAlerts[1]);
  view = partitionNotifications(baseAlerts, state, NOW);
  assert.equal(view.unreadCount, 2);

  // Posponer stock-low hasta mañana
  state = snoozeAlertUntilTomorrow(state, baseAlerts[2], NOW);
  view = partitionNotifications(baseAlerts, state, NOW);
  assert.equal(view.active.length, 2);
  assert.equal(view.snoozed.length, 1);
  assert.equal(view.unreadCount, 1); // sync-conflict no se marca como vista

  // Marcar todas leídas no borra sync-conflict (snoozeable: false)
  state = markAllAlertsSeen(state, baseAlerts);
  view = partitionNotifications(baseAlerts, state, NOW);
  assert.equal(view.unreadCount, 1);

  // Si empeora stock-low (cambia fingerprint), se reactiva sola aunque sea el mismo día
  const worsened = [
    baseAlerts[0],
    baseAlerts[1],
    { id: "stock-low", severity: "warning", fingerprint: "low:4", snoozeable: true },
  ];
  view = partitionNotifications(worsened, state, NOW);
  assert.equal(view.snoozed.length, 0);
  assert.equal(view.active.length, 3);
  assert.equal(view.unreadCount, 2);

  // Al día siguiente vence el snooze automáticamente
  const tomorrow = new Date("2026-11-25T09:00:00-04:00");
  view = partitionNotifications(baseAlerts, state, tomorrow);
  assert.equal(view.snoozed.length, 0);

  // Unsnooze manual funciona el mismo día
  const resnoozed = snoozeAlertUntilTomorrow(state, baseAlerts[2], NOW);
  const restored = unsnoozeAlert(resnoozed, "stock-low");
  assert.equal(partitionNotifications(baseAlerts, restored, NOW).snoozed.length, 0);
});

test("detectPostSaleStockCrossings solo avisa cuando la venta cruza el umbral", () => {
  const soldItems = [
    { product: { id: 1, name: "Bujía", stock: 2, minStock: 5, notifyMinStock: true } }, // ya estaba bajo -> cruza a 0!
    { product: { id: 2, name: "Filtro", stock: 6, minStock: 5, notifyMinStock: true } }, // cruza de 6 a 4 -> nuevo bajo!
    { product: { id: 3, name: "Cadena", stock: 4, minStock: 5, notifyMinStock: true } }, // ya estaba bajo (4 -> 3) -> NO repetir
    { product: { id: 4, name: "Tornillo", stock: 1, minStock: 5, notifyMinStock: false } }, // notifyMinStock false -> ignorar
  ];
  const updatedProducts = [
    { id: 1, nombre: "Bujía", stock: 0, stockMinimo: 5, notificarMinimo: true },
    { id: 2, nombre: "Filtro", stock: 4, stockMinimo: 5, notificarMinimo: true },
    { id: 3, nombre: "Cadena", stock: 3, stockMinimo: 5, notificarMinimo: true },
    { id: 4, nombre: "Tornillo", stock: 0, stockMinimo: 5, notificarMinimo: false },
  ];

  const { newlyOut, newlyLow } = detectPostSaleStockCrossings(soldItems, updatedProducts);
  assert.deepEqual(newlyOut.map((x) => x.id), [1]);
  assert.deepEqual(newlyLow.map((x) => x.id), [2]);
});

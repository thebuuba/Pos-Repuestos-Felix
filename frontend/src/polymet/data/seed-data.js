// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { ITBIS_RATE } from "../lib/format.js";
import { PRODUCTS } from "./pos-data.js";
import { round2 } from "../lib/format.js";
import { CUSTOMERS } from "./pos-data.js";
function daysAgo(days, hour = 10, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}
function addDays(iso, days) {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}
var SEED_FORMULAS = [
  {
    id: "f-std",
    name: "Estándar",
    costFactor: 1,
    margins: {
      p1: 35,
      p2: 25,
      p3: 15,
    },
  },
  {
    id: "f-sga",
    name: "Super Gato / Almonte",
    costFactor: 1.062,
    margins: {
      p1: 30,
      p2: 15,
      p3: 13,
    },
  },
  {
    id: "f-ari",
    name: "Arias Piezas y Gomas",
    costFactor: 1.12,
    margins: {
      p1: 30,
      p2: 15,
      p3: 13,
    },
  },
  {
    id: "f-ast",
    name: "Almonte Asterisco *",
    costFactor: 1.18,
    margins: {
      p1: 30,
      p2: 15,
      p3: 13,
    },
  },
  {
    id: "f-mas",
    name: "Masotti",
    costFactor: 1,
    margins: {
      p1: 30,
      p2: 15,
      p3: 13,
    },
  },
];
var SEED_SUPPLIERS = [
  {
    id: "s-001",
    name: "Super Gato / Almonte",
    rnc: "130-11223-4",
    phone: "809-555-2101",
    contact: "Ramón Almonte",
    formulaId: "f-sga",
    creditDays: 30,
    email: "ventas@supergato.do",
  },
  {
    id: "s-002",
    name: "Arias Piezas y Gomas",
    rnc: "131-55667-8",
    phone: "809-555-2202",
    contact: "Luis Arias",
    formulaId: "f-ari",
    creditDays: 15,
  },
  {
    id: "s-003",
    name: "Almonte Asterisco",
    rnc: "101-88990-1",
    phone: "829-555-2303",
    contact: "Pedro Almonte",
    formulaId: "f-ast",
    creditDays: 30,
  },
  {
    id: "s-004",
    name: "Masotti",
    rnc: "130-44556-7",
    phone: "809-555-2404",
    contact: "Carla Masotti",
    formulaId: "f-mas",
    creditDays: 45,
    email: "pedidos@masotti.do",
  },
  {
    id: "s-005",
    name: "Tanaka Motors Dominicana",
    rnc: "132-33445-6",
    phone: "809-555-2505",
    contact: "Kenji Ruiz",
    formulaId: "f-std",
    creditDays: 30,
  },
];
var RECEIVABLE_SEED = [
  ["c-001", "F-000198", 4200, 48],
  ["c-001", "F-000221", 3518, 21],
  ["c-001", "F-000240", 4732, 4],
  ["c-002", "F-000176", 9800, 95],
  ["c-002", "F-000203", 7650, 66],
  ["c-002", "F-000219", 8250, 33],
  ["c-002", "F-000238", 5500, 6],
  ["c-004", "F-000160", 12000, 120],
  ["c-004", "F-000188", 9600, 72],
  ["c-004", "F-000207", 8400, 41],
  ["c-004", "F-000226", 10200, 18],
  ["c-004", "F-000243", 6600, 2],
];
var SEED_RECEIVABLES = RECEIVABLE_SEED.map(
  ([partyId, document2, amount, ago], i) => {
    const date = daysAgo(ago, 11);
    return {
      id: `r-${i + 1}`,
      partyId,
      document: document2,
      date,
      dueDate: addDays(date, 30),
      amount,
      paid: 0,
      payments: [],
    };
  },
);
var PAYABLE_SEED = [
  ["s-001", "SG-88412", 38450, 40, 30],
  ["s-001", "SG-89120", 21300, 12, 30],
  ["s-002", "AP-2291", 15780, 20, 15],
  ["s-004", "MS-00731", 52600, 25, 45],
];
var SEED_PAYABLES = PAYABLE_SEED.map(
  ([partyId, document2, amount, ago, credit], i) => {
    const date = daysAgo(ago, 9);
    return {
      id: `cp-${i + 1}`,
      partyId,
      document: document2,
      date,
      dueDate: addDays(date, credit),
      amount,
      paid: i === 0 ? 1e4 : 0,
      payments:
        i === 0
          ? [
              {
                id: "pp-1",
                date: daysAgo(20, 15),
                amount: 1e4,
                method: "transferencia",
              },
            ]
          : [],
    };
  },
);
var SEED_PURCHASES = [
  {
    id: "pu-1",
    number: "C-000038",
    date: daysAgo(12, 9, 30),
    supplierId: "s-001",
    supplierInvoice: "SG-89120",
    formulaId: "f-sga",
    condition: "credito",
    lines: [
      {
        productId: "p-001",
        code: "BUJ-C7HSA",
        name: "Bujía NGK C7HSA",
        category: "Motor",
        quantity: 60,
        cost: 95,
        prices: {
          p1: 175,
          p2: 150,
          p3: 140,
        },
      },
      {
        productId: "p-007",
        code: "FIL-AIR-GN125",
        name: "Filtro de aire GN125",
        category: "Motor",
        quantity: 20,
        cost: 140,
        prices: {
          p1: 250,
          p2: 220,
          p3: 210,
        },
      },
    ],
    total: 21300,
  },
  {
    id: "pu-2",
    number: "C-000037",
    date: daysAgo(20, 10),
    supplierId: "s-002",
    supplierInvoice: "AP-2291",
    formulaId: "f-ari",
    condition: "credito",
    lines: [
      {
        productId: "p-008",
        code: "LLA-275-18",
        name: "Goma 2.75-18 trasera",
        category: "Llantas",
        quantity: 8,
        cost: 1450,
        prices: {
          p1: 2350,
          p2: 2150,
          p3: 2050,
        },
      },
      {
        productId: "p-009",
        code: "TUB-275-18",
        name: "Tubo 2.75/3.00-18",
        category: "Llantas",
        quantity: 18,
        cost: 230,
        prices: {
          p1: 395,
          p2: 350,
          p3: 330,
        },
      },
    ],
    total: 15780,
  },
  {
    id: "pu-3",
    number: "C-000036",
    date: daysAgo(25, 11),
    supplierId: "s-004",
    supplierInvoice: "MS-00731",
    formulaId: "f-mas",
    condition: "credito",
    lines: [
      {
        productId: "p-006",
        code: "ACE-20W50",
        name: "Aceite 4T 20W-50 (1L)",
        category: "Lubricantes",
        quantity: 120,
        cost: 260,
        prices: {
          p1: 395,
          p2: 360,
          p3: 345,
        },
      },
      {
        productId: "p-016",
        code: "LIQ-FRE-DOT4",
        name: "Líquido de freno DOT 4",
        category: "Lubricantes",
        quantity: 142,
        cost: 150,
        prices: {
          p1: 275,
          p2: 245,
          p3: 235,
        },
      },
    ],
    total: 52500,
  },
];
var SEED_SETTINGS = {
  business: {
    name: "Repuestos Felix",
    rnc: "131-98765-4",
    phone: "829-782-3872",
    address: "Av. Duarte #45, Santiago",
    email: "repuestosfelix@gmail.com",
  },
  itbisRate: ITBIS_RATE * 100,
  rounding: 5,
  defaultPriceLevel: "p1",
  allowNegativeStock: false,
  ticketFooter: "¡Gracias por su compra! Cambios solo con factura en 7 días.",
  printer: "Térmica 80 mm",
  ncf: [
    {
      type: "B02",
      label: "Consumo final",
      next: 1245,
      end: 5000,
      expires: "2027-12-31",
    },
    {
      type: "B01",
      label: "Crédito fiscal",
      next: 318,
      end: 1000,
      expires: "2027-12-31",
    },
    {
      type: "B14",
      label: "Régimen especial",
      next: 12,
      end: 200,
      expires: "2027-12-31",
    },
    {
      type: "B15",
      label: "Gubernamental",
      next: 41,
      end: 200,
      expires: "2027-12-31",
    },
  ],
};
var SEED_CASH_SESSION = {
  open: true,
  openedAt: daysAgo(0, 8, 0),
  openingAmount: 5000,
  cashier: "Felix Rodríguez",
};
var SEED_CASH_MOVEMENTS = [
  {
    id: "m-1",
    date: daysAgo(0, 9, 15),
    type: "entrada",
    description: "Fondo adicional para cambio",
    amount: 2000,
  },
  {
    id: "m-2",
    date: daysAgo(0, 12, 40),
    type: "salida",
    description: "Almuerzo del personal",
    amount: 650,
  },
  {
    id: "m-3",
    date: daysAgo(0, 14, 5),
    type: "salida",
    description: "Compra de agua y limpieza",
    amount: 300,
  },
];
function prng(seed) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
function buildSalesHistory() {
  const rand = prng(42);
  const sales = [];
  const closures = [];
  const methods = [
    "efectivo",
    "efectivo",
    "efectivo",
    "tarjeta",
    "transferencia",
  ];
  const sellable = PRODUCTS.filter((p) => p.stock > 0);
  const nowHour = new Date().getHours();
  let counter = 245 - 1;
  const raw = [];
  for (let day = 44; day >= 0; day--) {
    const date = new Date();
    date.setDate(date.getDate() - day);
    if (date.getDay() === 0) continue;
    const count = 4 + Math.floor(rand() * 6);
    let daySales = 0;
    for (let n = 0; n < count; n++) {
      const hour = 8 + Math.floor(rand() * 10);
      if (day === 0 && hour >= Math.max(nowHour, 9)) continue;
      const minute = Math.floor(rand() * 60);
      const lineCount = 1 + Math.floor(rand() * 3);
      const lines = [];
      for (let l = 0; l < lineCount; l++) {
        const p = sellable[Math.floor(rand() * sellable.length)];
        if (lines.some((x) => x.productId === p.id)) continue;
        const quantity = 1 + Math.floor(rand() * (p.prices.p1 < 400 ? 4 : 2));
        const subtotal = round2(p.prices.p1 * quantity);
        lines.push({
          productId: p.id,
          code: p.code,
          name: p.name,
          quantity,
          unitPrice: p.prices.p1,
          subtotal,
          itbis: round2(subtotal * ITBIS_RATE),
        });
      }
      const subtotal = round2(lines.reduce((s, l) => s + l.subtotal, 0));
      const itbis = round2(lines.reduce((s, l) => s + l.itbis, 0));
      const total = round2(subtotal + itbis);
      const method = methods[Math.floor(rand() * methods.length)];
      const voided = rand() < 0.03;
      const customer = rand() < 0.8 ? CUSTOMERS[0] : CUSTOMERS[3];
      daySales += voided ? 0 : total;
      raw.push({
        id: `h-${day}-${n}`,
        date: daysAgo(day, hour, minute),
        customerId: customer.id,
        customerName: customer.name,
        comprobante: "B02",
        condition: "contado",
        method,
        lines,
        subtotal,
        discount: 0,
        itbis,
        total,
        received:
          method === "efectivo" ? Math.ceil(total / 100) * 100 : undefined,
        status: voided ? "anulada" : "pagada",
      });
    }
    if (day > 0 && day <= 6) {
      const expected = round2(5000 + daySales * 0.55);
      const diff = Math.round((rand() - 0.6) * 300);
      closures.push({
        id: `cl-${day}`,
        openedAt: daysAgo(day, 8),
        closedAt: daysAgo(day, 18, 15),
        cashier: "Felix Rodríguez",
        opening: 5000,
        expected,
        counted: round2(expected + diff),
        sales: round2(daySales),
      });
    }
  }
  raw.sort((a, b) => a.date.localeCompare(b.date));
  counter = 245 - raw.length;
  for (const s of raw) {
    counter += 1;
    sales.push({
      ...s,
      number: `F-${String(counter).padStart(6, "0")}`,
    });
  }
  return {
    sales: sales.reverse(),
    closures: closures.reverse(),
  };
}
var history = buildSalesHistory();
var SEED_SALES = history.sales;
var SEED_CLOSURES = history.closures;
export {
  SEED_SUPPLIERS,
  SEED_FORMULAS,
  SEED_SALES,
  SEED_PURCHASES,
  SEED_RECEIVABLES,
  SEED_PAYABLES,
  SEED_CASH_SESSION,
  SEED_CASH_MOVEMENTS,
  SEED_CLOSURES,
  SEED_SETTINGS,
  addDays,
};

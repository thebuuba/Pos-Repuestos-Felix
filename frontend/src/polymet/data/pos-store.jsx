// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { PRODUCTS } from "./pos-data.js";
import { CUSTOMERS } from "./pos-data.js";
import { SEED_SUPPLIERS } from "./seed-data.js";
import { SEED_FORMULAS } from "./seed-data.js";
import { SEED_SALES } from "./seed-data.js";
import { SEED_PURCHASES } from "./seed-data.js";
import { SEED_RECEIVABLES } from "./seed-data.js";
import { SEED_PAYABLES } from "./seed-data.js";
import { SEED_CASH_SESSION } from "./seed-data.js";
import { SEED_CASH_MOVEMENTS } from "./seed-data.js";
import { SEED_CLOSURES } from "./seed-data.js";
import { SEED_SETTINGS } from "./seed-data.js";
import { round2 } from "../lib/format.js";
import { balanceOf } from "../lib/accounts.js";
import { addDays } from "./seed-data.js";
import { PosStoreContext } from "../../data/pos-context.jsx";
import { newId as uid } from "../../data/new-id.js";
import cashierAvatar from "../../../assets/demo-cashier.png";
import { useCallback } from "react";
import { useMemo } from "react";
import { useState } from "react";
var pad = (n, size = 6) => String(n).padStart(size, "0");
function PosStoreProvider({ children }) {
  const [products, setProducts] = useState(PRODUCTS);
  const [baseCustomers, setBaseCustomers] = useState(CUSTOMERS);
  const [baseSuppliers, setBaseSuppliers] = useState(SEED_SUPPLIERS);
  const [formulas, setFormulas] = useState(SEED_FORMULAS);
  const [sales, setSales] = useState(SEED_SALES);
  const [purchases, setPurchases] = useState(SEED_PURCHASES);
  const [receivables, setReceivables] = useState(SEED_RECEIVABLES);
  const [payables, setPayables] = useState(SEED_PAYABLES);
  const [cashSession, setCashSession] = useState(SEED_CASH_SESSION);
  const [cashMovements, setCashMovements] = useState(SEED_CASH_MOVEMENTS);
  const [closures, setClosures] = useState(SEED_CLOSURES);
  const [settings, setSettings] = useState(SEED_SETTINGS);
  const [invoiceCounter, setInvoiceCounter] = useState(246);
  const [purchaseCounter, setPurchaseCounter] = useState(39);
  const customers = useMemo(
    () =>
      baseCustomers.map((c) => ({
        ...c,
        balance: round2(
          receivables
            .filter((r) => r.partyId === c.id)
            .reduce((s, r) => s + balanceOf(r), 0),
        ),
      })),
    [baseCustomers, receivables],
  );
  const suppliers = useMemo(
    () =>
      baseSuppliers.map((s) => ({
        ...s,
        balance: round2(
          payables
            .filter((p) => p.partyId === s.id)
            .reduce((sum, p) => sum + balanceOf(p), 0),
        ),
      })),
    [baseSuppliers, payables],
  );
  const cashSummary = useMemo(() => {
    const since = cashSession.openedAt;
    const sessionSales = sales.filter(
      (s) => s.status !== "anulada" && s.date >= since,
    );
    const sum = (method) =>
      round2(
        sessionSales
          .filter((s) => s.method === method)
          .reduce((t, s) => t + s.total, 0),
      );
    const moves = cashMovements.filter((m) => m.date >= since);
    const byType = (type) =>
      round2(
        moves.filter((m) => m.type === type).reduce((t, m) => t + m.amount, 0),
      );
    const summary = {
      opening: cashSession.openingAmount,
      cashSales: sum("efectivo"),
      cardSales: sum("tarjeta"),
      transferSales: sum("transferencia"),
      creditSales: sum("credito"),
      entradas: byType("entrada"),
      salidas: byType("salida"),
      cobros: byType("cobro"),
      pagos: byType("pago"),
      invoices: sessionSales.length,
      expected: 0,
    };
    summary.expected = round2(
      summary.opening +
        summary.cashSales +
        summary.entradas +
        summary.cobros -
        summary.salidas -
        summary.pagos,
    );
    return summary;
  }, [cashMovements, cashSession, sales]);
  const nextNcf = useCallback(
    (type) => {
      const seq = settings.ncf.find((n) => n.type === type);
      return seq ? `${seq.type}${pad(seq.next, 8)}` : undefined;
    },
    [settings.ncf],
  );
  const saveProduct = useCallback((product) => {
    setProducts((prev) =>
      prev.some((p) => p.id === product.id)
        ? prev.map((p) => (p.id === product.id ? product : p))
        : [product, ...prev],
    );
  }, []);
  const deleteProduct = useCallback((product) => {
    const id = product?.id ?? product;
    setProducts((prev) => prev.filter((p) => p.id !== id));
  }, []);
  const saveCustomer = useCallback((customer) => {
    setBaseCustomers((prev) =>
      prev.some((c) => c.id === customer.id)
        ? prev.map((c) => (c.id === customer.id ? customer : c))
        : [...prev, customer],
    );
  }, []);
  const deleteCustomer = useCallback((id) => {
    setBaseCustomers((prev) => prev.filter((c) => c.id !== id));
  }, []);
  const saveSupplier = useCallback((supplier) => {
    setBaseSuppliers((prev) =>
      prev.some((s) => s.id === supplier.id)
        ? prev.map((s) => (s.id === supplier.id ? supplier : s))
        : [...prev, supplier],
    );
  }, []);
  const deleteSupplier = useCallback((id) => {
    setBaseSuppliers((prev) => prev.filter((s) => s.id !== id));
  }, []);
  const saveFormula = useCallback((formula) => {
    setFormulas((prev) =>
      prev.some((f) => f.id === formula.id)
        ? prev.map((f) => (f.id === formula.id ? formula : f))
        : [...prev, formula],
    );
  }, []);
  const deleteFormula = useCallback((id) => {
    setFormulas((prev) => prev.filter((f) => f.id !== id));
  }, []);
  const updateSettings = useCallback((patch) => {
    setSettings((prev) => ({
      ...prev,
      ...patch,
    }));
  }, []);
  const registerSale = useCallback(
    (input) => {
      const customer = baseCustomers.find((c) => c.id === input.customerId);
      const now = new Date().toISOString();
      const isCredit = input.condition === "credito";
      const sale = {
        id: uid("sale"),
        number: `F-${pad(invoiceCounter)}`,
        date: now,
        customerId: input.customerId,
        customerName: customer?.name ?? "Cliente contado",
        comprobante: input.comprobante,
        ncf: nextNcf(input.comprobante),
        condition: input.condition,
        method: isCredit ? "credito" : input.method,
        lines: input.lines,
        subtotal: input.subtotal,
        discount: input.discount,
        itbis: input.itbis,
        total: input.total,
        received: input.received,
        status: isCredit ? "pendiente" : "pagada",
      };
      setSales((prev) => [sale, ...prev]);
      setInvoiceCounter((n) => n + 1);
      setSettings((prev) => ({
        ...prev,
        ncf: prev.ncf.map((n) =>
          n.type === input.comprobante
            ? {
                ...n,
                next: n.next + 1,
              }
            : n,
        ),
      }));
      setProducts((prev) =>
        prev.map((p) => {
          const qty = input.lines
            .filter((l) => l.productId === p.id)
            .reduce((s, l) => s + l.quantity, 0);
          return qty
            ? {
                ...p,
                stock: Math.max(0, p.stock - qty),
              }
            : p;
        }),
      );
      if (isCredit) {
        setReceivables((prev) => [
          {
            id: uid("r"),
            partyId: input.customerId,
            refId: sale.id,
            document: sale.number,
            date: now,
            dueDate: addDays(now, 30),
            amount: sale.total,
            paid: 0,
            payments: [],
          },
          ...prev,
        ]);
      }
      return sale;
    },
    [baseCustomers, invoiceCounter, nextNcf],
  );
  const voidSale = useCallback(
    (id) => {
      const sale = sales.find((s) => s.id === id);
      if (!sale || sale.status === "anulada") return;
      setSales((prev) =>
        prev.map((s) =>
          s.id === id
            ? {
                ...s,
                status: "anulada",
              }
            : s,
        ),
      );
      setProducts((prev) =>
        prev.map((p) => {
          const qty = sale.lines
            .filter((l) => l.productId === p.id)
            .reduce((s, l) => s + l.quantity, 0);
          return qty
            ? {
                ...p,
                stock: p.stock + qty,
              }
            : p;
        }),
      );
      setReceivables((prev) => prev.filter((r) => r.refId !== id));
    },
    [sales],
  );
  const registerPurchase = useCallback(
    (input) => {
      const now = new Date().toISOString();
      const total = round2(
        input.lines.reduce((s, l) => s + l.cost * l.quantity, 0),
      );
      const purchase = {
        id: uid("pu"),
        number: `C-${pad(purchaseCounter)}`,
        date: now,
        ...input,
        total,
      };
      setPurchases((prev) => [purchase, ...prev]);
      setPurchaseCounter((n) => n + 1);
      setProducts((prev) => {
        let next = [...prev];
        for (const line of input.lines) {
          const idx = next.findIndex(
            (p) =>
              p.id === line.productId ||
              p.code.toLowerCase() === line.code.toLowerCase(),
          );
          if (idx >= 0) {
            const p = next[idx];
            next[idx] = {
              ...p,
              name: line.name || p.name,
              stock: p.stock + line.quantity,
              cost: line.cost,
              prices: line.prices,
            };
          } else {
            next = [
              {
                id: uid("p"),
                code: line.code.toUpperCase(),
                name: line.name,
                brand: "—",
                category: line.category,
                stock: line.quantity,
                minStock: 5,
                cost: line.cost,
                prices: line.prices,
                taxable: true,
                location: "—",
              },
              ...next,
            ];
          }
        }
        return next;
      });
      if (input.condition === "credito") {
        const supplier = baseSuppliers.find((s) => s.id === input.supplierId);
        setPayables((prev) => [
          {
            id: uid("cp"),
            partyId: input.supplierId,
            refId: purchase.id,
            document: input.supplierInvoice || purchase.number,
            date: now,
            dueDate: addDays(now, supplier?.creditDays ?? 30),
            amount: total,
            paid: 0,
            payments: [],
          },
          ...prev,
        ]);
      }
      return purchase;
    },
    [baseSuppliers, purchaseCounter],
  );
  const applyPayment = (setter, id, amount, method, note) => {
    const date = new Date().toISOString();
    setter((prev) =>
      prev.map((d) =>
        d.id === id
          ? {
              ...d,
              paid: round2(Math.min(d.amount, d.paid + amount)),
              payments: [
                ...d.payments,
                {
                  id: uid("pay"),
                  date,
                  amount,
                  method,
                  note,
                },
              ],
            }
          : d,
      ),
    );
  };
  const payReceivable = useCallback(
    (id, amount, method, note) => {
      const doc = receivables.find((r) => r.id === id);
      if (!doc) return;
      applyPayment(setReceivables, id, amount, method, note);
      if (doc.refId && round2(doc.paid + amount) >= doc.amount) {
        setSales((prev) =>
          prev.map((s) =>
            s.id === doc.refId
              ? {
                  ...s,
                  status: "pagada",
                }
              : s,
          ),
        );
      }
      if (method === "efectivo") {
        const customer = baseCustomers.find((c) => c.id === doc.partyId);
        setCashMovements((prev) => [
          {
            id: uid("m"),
            date: new Date().toISOString(),
            type: "cobro",
            description: `Cobro ${doc.document} · ${customer?.name ?? ""}`,
            amount,
          },
          ...prev,
        ]);
      }
    },
    [receivables, baseCustomers],
  );
  const payPayable = useCallback(
    (id, amount, method, note) => {
      const doc = payables.find((p) => p.id === id);
      if (!doc) return;
      applyPayment(setPayables, id, amount, method, note);
      if (method === "efectivo") {
        const supplier = baseSuppliers.find((s) => s.id === doc.partyId);
        setCashMovements((prev) => [
          {
            id: uid("m"),
            date: new Date().toISOString(),
            type: "pago",
            description: `Pago ${doc.document} · ${supplier?.name ?? ""}`,
            amount,
          },
          ...prev,
        ]);
      }
    },
    [payables, baseSuppliers],
  );
  const openCash = useCallback((amount) => {
    setCashSession((prev) => ({
      ...prev,
      open: true,
      openedAt: new Date().toISOString(),
      openingAmount: amount,
    }));
  }, []);
  const closeCash = useCallback(
    (counted) => {
      const closure = {
        id: uid("cl"),
        openedAt: cashSession.openedAt,
        closedAt: new Date().toISOString(),
        cashier: cashSession.cashier,
        opening: cashSummary.opening,
        expected: cashSummary.expected,
        counted,
        sales: round2(
          cashSummary.cashSales +
            cashSummary.cardSales +
            cashSummary.transferSales +
            cashSummary.creditSales,
        ),
      };
      setClosures((prev) => [closure, ...prev]);
      setCashSession((prev) => ({
        ...prev,
        open: false,
      }));
      return closure;
    },
    [cashSession, cashSummary],
  );
  const addCashMovement = useCallback((type, amount, description) => {
    setCashMovements((prev) => [
      {
        id: uid("m"),
        date: new Date().toISOString(),
        type,
        amount,
        description,
      },
      ...prev,
    ]);
  }, []);
  const value = {
    cashierAvatar,
    products,
    customers,
    suppliers,
    formulas,
    sales,
    purchases,
    receivables,
    payables,
    cashSession,
    cashMovements,
    closures,
    cashSummary,
    settings,
    nextInvoiceNumber: `F-${pad(invoiceCounter)}`,
    nextNcf,
    saveProduct,
    deleteProduct,
    saveCustomer,
    deleteCustomer,
    saveSupplier,
    deleteSupplier,
    saveFormula,
    deleteFormula,
    updateSettings,
    registerSale,
    voidSale,
    registerPurchase,
    payReceivable,
    payPayable,
    openCash,
    closeCash,
    addCashMovement,
  };
  return (
    <PosStoreContext.Provider value={value}>
      {children}
    </PosStoreContext.Provider>
  );
}
export { PosStoreProvider };
export { usePosStore } from "../../data/pos-context.jsx";

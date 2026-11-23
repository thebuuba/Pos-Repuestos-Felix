import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast as ue } from 'sonner';
import { usePosStore } from './pos-context.jsx';
import { quoteSale, updateSaleLine, receiptFromConfirmation, saleRequest } from './operational-sales.js';
import { ReceiptDialog } from '../components/pos/receipt-dialog.jsx';
import { businessTodayIso } from '../lib/dates.js';

const SaleDraftContext = createContext(null);
export const useSaleDraft = () => useContext(SaleDraftContext);

function readHeldSales(databaseId) {
  if (!databaseId) return [];
  try {
    const raw = JSON.parse(localStorage.getItem('felix-ventas-espera:' + databaseId) || '[]');
    return Array.isArray(raw) ? raw.slice(0, 20) : [];
  } catch { return []; }
}
function writeHeldSales(databaseId, list) {
  if (!databaseId) return;
  try { localStorage.setItem('felix-ventas-espera:' + databaseId, JSON.stringify(list.slice(0, 20))); } catch { /* Optional local storage. */ }
}

// The draft and its exact retry stay together above route boundaries. A session
// loss unmounts this provider. A database change resets only the sale, preserving
// other modules' open forms so their original versions can still be rejected.
export function SaleDraftProvider({ children }) {
  const { products, customers, settings, cashSession, runtime, registerSale } =
    usePosStore();
  const cashCustomer = customers.find((row) => row.isCashCustomer);
  const [draftDatabase, setDraftDatabase] = useState(runtime.databaseId);
  const currentDatabase = useRef(runtime.databaseId);
  currentDatabase.current = runtime.databaseId;
  const [customerId, setCustomerId] = useState(() => cashCustomer?.id ?? null);
  const [comprobante, setComprobante] = useState("B02");
  const [condition, setCondition] = useState("contado");
  const [paymentMethod, setPaymentMethod] = useState("efectivo");
  const [discountMode, setDiscountMode] = useState("percent");
  const [discountValue, setDiscountValue] = useState("");
  const discount = useMemo(
    () => ({ mode: discountMode, value: discountValue }),
    [discountMode, discountValue],
  );
  const discountPercent = discountMode === "percent" ? Number(discountValue) || 0 : 0;
  const setDiscountPercent = (value) => {
    setDiscountMode("percent");
    const num = Number(value);
    setDiscountValue(!value || !Number.isFinite(num) || num <= 0 ? "" : String(value));
  };
  const [received, setReceived] = useState("");
  const [priceLevel, setPriceLevel] = useState(
    settings.defaultPriceLevel ?? "p1",
  );
  const [items, updateItems] = useState([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [heldSales, setHeldSales] = useState(() => readHeldSales(runtime.databaseId));
  const [receipt, setReceipt] = useState(null);
  const [failure, setFailure] = useState(null);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
  const initialRecovery = useRef(runtime.pending?.path === '/api/ventas' && runtime.pending.id === runtime.saleOperationId ? runtime.pending.id : null);
  const resolved = useRef(null);
  const customer = customers.find((row) => row.id === customerId);
  const catalog = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );
  const { lines, totals, discountError } = useMemo(
    () => quoteSale(items, settings.itbisRate, discount),
    [items, settings.itbisRate, discount],
  );
  const cartQuantities = useMemo(() => {
    const map = {};
    for (const item of items) {
      map[item.product.id] =
        Math.round(
          ((map[item.product.id] ?? 0) + item.quantity) * 100,
        ) / 100;
    }
    return map;
  }, [items]);
  // Another tab's confirmation or a catalog refresh must not freeze this draft.
  // Checkout still waits for the shared journal; an already-sent sale stays locked.
  const locked = sending || !!failure?.retry;
  let disabledReason;
  if (runtime.connection !== "connected")
    disabledReason = "Conecta con el servicio para registrar la venta.";
  else if (runtime.pending && runtime.inFlightOperationId !== runtime.pending.id)
    disabledReason = "Hay una solicitud pendiente de confirmación.";
  else if (runtime.busy && !sending) disabledReason = "Espera a que termine la operación en curso.";
  else if (!cashSession?.open) disabledReason = "La caja está cerrada. Ábrela para facturar.";
  else if (!customer) disabledReason = "Selecciona un cliente activo.";
  else if (comprobante !== "B02" && !customer.rnc)
    disabledReason = "Selecciona un cliente con RNC.";
  else if (
    condition === "credito" &&
    (customer.isCashCustomer || !customer.creditLimit)
  )
    disabledReason = "Selecciona un cliente con crédito aprobado.";
  else if (
    condition === "credito" &&
    Math.round(customer.balance * 100) + Math.round(totals.total * 100) >
      Math.round(customer.creditLimit * 100)
  )
    disabledReason = "La venta excede el crédito disponible del cliente.";
  else if (items.some((item) => item.product.databaseId !== runtime.databaseId))
    disabledReason = "La base cambió. Inicia una nueva venta.";
  else if (discountError) disabledReason = discountError;
  else if (
    items.some(
      (item) => catalog.get(item.product.id)?.version !== item.product.version,
    )
  )
    disabledReason =
      "El catálogo cambió. Retira los artículos actualizados y agrégalos de nuevo.";

  function clearSale() {
    itemsRef.current = [];
    updateItems([]);
    setCustomerId(cashCustomer?.id ?? null);
    setComprobante("B02");
    setCondition("contado");
    setPaymentMethod("efectivo");
    setDiscountMode("percent");
    setDiscountValue("");
    setReceived("");
    setFailure(null);
  }
  function showReceipt(snapshot, cashReceived) {
    const config = snapshot.state.configuracion;
    const baseSale = receiptFromConfirmation(snapshot);
    const sale = Number.isFinite(cashReceived) && baseSale.paymentLabel === "Efectivo"
      ? { ...baseSale, received: cashReceived }
      : baseSale;
    setReceipt({
      sale,
      footer: config.pieTicket,
      printFormat: config.formatoImpresion ?? "Térmica 80 mm",
      business: { name: config.empresa, rnc: config.rnc, address: config.direccion, phone: config.tel },
    });
  }
  function showSaleDocument(saleObj, options = {}) {
    setReceipt({
      ...options,
      sale: saleObj,
      footer: settings.ticketFooter,
      printFormat: settings.printer ?? "Térmica 80 mm",
      business: { name: settings.business.name, rnc: settings.business.rnc, address: settings.business.address, phone: settings.business.phone },
    });
  }
  function openQuote() {
    if (!items.length || receipt) return;
    setReceipt({
      isQuote: true,
      sale: {
        invoiceNumber: "Cotización",
        dateOnly: businessTodayIso(),
        customerName: customer?.name ?? "Cliente Contado",
        customerRnc: customer?.rnc ?? "",
        ncf: null,
        comprobante,
        itbisRate: settings.itbisRate,
        conditionLabel: condition === "credito" ? "Crédito" : "Contado",
        paymentLabel: "Cotización (no válida como factura)",
        totals,
        lines: lines.map((line) => ({
          key: line.key,
          product: { name: line.product.name },
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          subtotal: line.subtotal,
        })),
      },
      footer: settings.ticketFooter,
      printFormat: settings.printer ?? "Térmica 80 mm",
      business: { name: settings.business.name, rnc: settings.business.rnc, address: settings.business.address, phone: settings.business.phone },
    });
  }
  function holdCurrentSale() {
    if (locked || inFlight.current || receipt || !items.length) return false;
    const entry = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      customerId,
      customerName: customer?.name ?? "Cliente Contado",
      comprobante,
      condition,
      paymentMethod,
      discountMode,
      discountValue,
      discountPercent,
      total: totals.total,
      itemCount: totals.items,
      items: items.map((item) => ({ productId: item.product.id, priceLevel: item.priceLevel, quantity: item.quantity })),
    };
    const next = [entry, ...heldSales].slice(0, 20);
    setHeldSales(next);
    writeHeldSales(runtime.databaseId, next);
    clearSale();
    ue.success("Venta puesta en espera", { description: `${entry.customerName} · ${entry.items.length} líneas` });
    return true;
  }
  function resumeHeldSale(holdId) {
    if (locked || inFlight.current || receipt) return false;
    const entry = heldSales.find((h) => h.id === holdId);
    if (!entry) return false;
    let restored = [];
    const skipped = [];
    for (const saved of entry.items) {
      const live = catalog.get(saved.productId);
      if (!live) { skipped.push("un artículo ya no está activo"); continue; }
      try {
        restored = updateSaleLine(restored, live, saved.priceLevel, saved.quantity, false);
      } catch (error) {
        skipped.push(live.name + " (" + error.message + ")");
      }
    }
    const hadActiveCart = itemsRef.current.length > 0;
    let nextHeld = heldSales.filter((h) => h.id !== holdId);
    if (hadActiveCart) {
      const stashed = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        customerId,
        customerName: customer?.name ?? "Cliente Contado",
        comprobante,
        condition,
        paymentMethod,
        discountMode,
        discountValue,
        discountPercent,
        total: totals.total,
        itemCount: totals.items,
        items: itemsRef.current.map((item) => ({ productId: item.product.id, priceLevel: item.priceLevel, quantity: item.quantity })),
      };
      nextHeld = [stashed, ...nextHeld].slice(0, 20);
    }
    setHeldSales(nextHeld);
    writeHeldSales(runtime.databaseId, nextHeld);
    itemsRef.current = restored;
    updateItems(restored);
    setCustomerId(customers.some((c) => c.id === entry.customerId) ? entry.customerId : cashCustomer?.id ?? null);
    setComprobante(entry.comprobante || "B02");
    setCondition(entry.condition || "contado");
    setPaymentMethod(entry.paymentMethod || "efectivo");
    if (entry.discountMode === "amount" || entry.discountMode === "percent") {
      setDiscountMode(entry.discountMode);
      setDiscountValue(entry.discountValue ?? "");
    } else {
      setDiscountMode("percent");
      setDiscountValue(entry.discountPercent ? String(entry.discountPercent) : "");
    }
    setReceived("");
    setFailure(null);
    if (skipped.length) ue.warning("Venta retomada con ajustes", { description: skipped.join("; ") });
    else if (hadActiveCart) ue.success("Venta retomada", { description: "Tu carrito anterior se guardó automáticamente en espera." });
    else ue.success("Venta retomada");
    return true;
  }
  function removeHeldSale(holdId) {
    const next = heldSales.filter((h) => h.id !== holdId);
    setHeldSales(next);
    writeHeldSales(runtime.databaseId, next);
  }
  useEffect(() => {
    const result = runtime.resolution;
    if (!result || result.path !== '/api/ventas' || result.databaseId !== currentDatabase.current ||
        resolved.current === result.operationId) return;
    const ownDraft = result.operationId === failure?.operationId;
    if (!ownDraft && result.operationId !== initialRecovery.current) return;
    resolved.current = result.operationId;
    initialRecovery.current = null;
    if (result.snapshot) {
      showReceipt(result.snapshot);
      if (ownDraft) clearSale();
    } else if (ownDraft) setFailure({ message: result.error, retry: null });
  }, [runtime.resolution, failure?.operationId]);
  function editQuantity(product, level, quantity, replace = false) {
    if (locked || inFlight.current || receipt) return false;
    try {
      const updated = updateSaleLine(itemsRef.current, product, level, quantity, replace);
      quoteSale(updated, settings.itbisRate, discount);
      itemsRef.current = updated;
      setItems(updated);
      setFailure(null);
      return true;
    } catch (error) {
      ue.error(error.message);
      return false;
    }
  }
  async function checkout(retry = false) {
    if (inFlight.current || receipt) return;
    if (!retry && (disabledReason || locked || !items.length)) return;
    if (!retry && condition === "contado" && paymentMethod === "efectivo" &&
        (!Number.isFinite(Number(received)) || Number(received) < totals.total)) {
      ue.warning("El monto recibido es menor al total");
      return;
    }
    inFlight.current = true;
    setSending(true);
    const requestDatabase = currentDatabase.current;
    try {
      const snapshot = retry
        ? await failure.retry()
        : await registerSale(
            saleRequest(items, settings, customerId, condition, comprobante, cashSession, paymentMethod, discount),
          );
      if (requestDatabase !== currentDatabase.current) return;
      resolved.current = snapshot.confirmation.operationId;
      const cashReceived = condition === "contado" && paymentMethod === "efectivo" && received !== "" ? Number(received) : undefined;
      showReceipt(snapshot, cashReceived);
      clearSale();
    } catch (error) {
      if (requestDatabase !== currentDatabase.current) return;
      setFailure({
        message: error.message,
        operationId: error.operationId ?? (retry ? failure.operationId : null),
        recoveryStopped: error.recoveryStopped,
        retry:
          error.retry ?? (retry && !error.definitive ? failure.retry : null),
      });
    } finally {
      if (requestDatabase === currentDatabase.current) {
        inFlight.current = false;
        setSending(false);
      }
    }
  }

  function setItems(next) {
    if (locked || inFlight.current || receipt) return;
    const updated = typeof next === 'function' ? next(itemsRef.current) : next;
    itemsRef.current = updated;
    updateItems(updated);
  }
  function resetSale() {
    if (!locked && !inFlight.current && !receipt) clearSale();
  }
  if (draftDatabase !== runtime.databaseId) {
    setDraftDatabase(runtime.databaseId);
    setHeldSales(readHeldSales(runtime.databaseId));
    clearSale();
    setReceipt(null);
    initialRecovery.current = null;
    setSending(false);
    setPriceLevel(settings.defaultPriceLevel ?? 'p1');
    inFlight.current = false;
    return null; // React retries this render before committing children.
  }
  return <SaleDraftContext.Provider value={{ products, customers, settings, cashSession, runtime, cashCustomer,
    customerId, setCustomerId, comprobante, setComprobante, condition, setCondition,
    paymentMethod, setPaymentMethod, discountMode, setDiscountMode, discountValue, setDiscountValue, discountError,
    discountPercent, setDiscountPercent, received, setReceived, priceLevel, setPriceLevel,
    items, setItems, heldSales, holdCurrentSale, resumeHeldSale, removeHeldSale, openQuote,
    showReceipt, showSaleDocument,
    receipt, failure, sending, customer, lines, totals, cartQuantities,
    locked, disabledReason, resetSale, editQuantity, checkout }}>
    {children}
      {receipt && (
        <ReceiptDialog
          {...receipt}
          open
          onOpenChange={(open) => {
            if (!open) setReceipt(null);
          }}
          onNewSale={() => setReceipt(null)}
        />
      )}
  </SaleDraftContext.Provider>;
}

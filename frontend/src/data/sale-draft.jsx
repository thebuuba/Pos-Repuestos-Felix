import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast as ue } from 'sonner';
import { usePosStore } from './pos-context.jsx';
import { quoteSale, updateSaleLine, receiptFromConfirmation, saleRequest } from './operational-sales.js';
import { ReceiptDialog } from '../polymet/components/receipt-dialog.jsx';

const SaleDraftContext = createContext(null);
export const useSaleDraft = () => useContext(SaleDraftContext);

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
  const [received, setReceived] = useState("");
  const [priceLevel, setPriceLevel] = useState(
    settings.defaultPriceLevel ?? "p1",
  );
  const [items, updateItems] = useState([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
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
  const { lines, totals } = useMemo(
    () => quoteSale(items, settings.itbisRate),
    [items, settings.itbisRate],
  );
  const cartQuantities = {};
  for (const item of items) {
    cartQuantities[item.product.id] =
      Math.round(
        ((cartQuantities[item.product.id] ?? 0) + item.quantity) * 100,
      ) / 100;
  }
  // Another tab's confirmation or a catalog refresh must not freeze this draft.
  // Checkout still waits for the shared journal; an already-sent sale stays locked.
  const locked = sending || !!failure?.retry;
  let disabledReason;
  if (runtime.connection !== "connected")
    disabledReason = "Conecta con el servicio para registrar la venta.";
  else if (runtime.pending)
    disabledReason = "Hay una solicitud pendiente de confirmación.";
  else if (runtime.busy) disabledReason = "Espera a que termine la operación en curso.";
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
    setReceived("");
    setFailure(null);
  }
  function showReceipt(snapshot) {
    const config = snapshot.state.configuracion;
    setReceipt({
      sale: receiptFromConfirmation(snapshot),
      footer: config.pieTicket,
      printFormat: config.formatoImpresion ?? "Térmica 80 mm",
      business: { name: config.empresa, rnc: config.rnc, address: config.direccion, phone: config.tel },
    });
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
      // A reopened page can already contain a new draft. Only clear the draft
      // whose exact operation was confirmed; never compare identical contents.
      if (ownDraft) clearSale();
    } else if (ownDraft) setFailure({ message: result.error, retry: null });
  }, [runtime.resolution, failure?.operationId]);
  function editQuantity(product, level, quantity, replace = false) {
    if (locked || inFlight.current || receipt) return false;
    try {
      const updated = updateSaleLine(itemsRef.current, product, level, quantity, replace);
      quoteSale(updated, settings.itbisRate);
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
            saleRequest(items, settings, customerId, condition, comprobante, cashSession, paymentMethod),
          );
      if (requestDatabase !== currentDatabase.current) return;
      resolved.current = snapshot.confirmation.operationId;
      showReceipt(snapshot);
      clearSale();
    } catch (error) {
      if (requestDatabase !== currentDatabase.current) return;
      // An exact retry can fail before sending, for example on a database change.
      // Keep its original operation while its outcome is uncertain.
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
    paymentMethod, setPaymentMethod, received, setReceived, priceLevel, setPriceLevel,
    items, setItems, receipt, failure, sending, customer, lines, totals, cartQuantities,
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

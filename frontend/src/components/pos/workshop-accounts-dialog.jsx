import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Car,
  CheckCircle2,
  CircleAlert,
  Lock,
  Plus,
  Printer,
  ReceiptText,
  RotateCcw,
  Search,
  ShoppingCart,
  User,
  Wrench,
  XCircle,
} from "lucide-react";
import { Link } from "react-router-dom";
import { usePosStore } from "../../data/pos-context.jsx";
import { quoteWorkshopItems, workshopBillRequest } from "../../data/operational-sales.js";
import { COMPROBANTES, CONDITIONS, PAYMENT_METHODS, PRICE_LEVELS } from "../../data/sales-options.js";
import { searchTopProducts } from "../../data/product-search.js";
import { productForBarcode } from "../../data/barcode-scanner.js";
import { formatMoney, formatUnitMoney } from "../../lib/format.js";
import { businessTodayIso, formatBusinessDateTime } from "../../lib/dates.js";
import { cn } from "../../lib/utils.js";
import { Button } from "../ui/button.jsx";
import { Input } from "../ui/input.jsx";
import { Label } from "../ui/label.jsx";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog.jsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.jsx";

const API_LEVELS = { p1: "precio1", p2: "precio2", p3: "precio3" };
const LEVEL_LABELS = { precio1: "P1", precio2: "P2", precio3: "P3" };
const QUICK_BILLS = [100, 200, 500, 1000, 2000];

const STATUS_BADGE = {
  abierta: { label: "Abierta", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  facturada: { label: "Facturada", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  cancelada: { label: "Cancelada", cls: "bg-muted text-muted-foreground" },
};

function cartItemsToApi(cartItems) {
  return cartItems.map((item) => ({
    productoId: item.product.id,
    versionProducto: item.product.version,
    nivelPrecio: API_LEVELS[item.priceLevel] || "precio1",
    cantidad: String(item.quantity),
  }));
}

export function WorkshopAccountsDialog({
  open,
  onOpenChange,
  cartItems = [],
  defaultCustomerId = null,
  onCartDispatched,
  onBilled,
  onShowStatement,
  onShowSale,
}) {
  const {
    products,
    customers,
    sales,
    settings,
    cashSession,
    runtime,
    workshopAccounts = [],
    openWorkshopAccount,
    dispatchWorkshopItems,
    returnWorkshopItem,
    cancelWorkshopAccount,
    billWorkshopAccount,
  } = usePosStore();

  const cashCustomer = useMemo(() => customers.find((c) => c.isCashCustomer) ?? customers[0] ?? null, [customers]);
  const [view, setView] = useState("list"); // list | new | detail | bill
  const [tab, setTab] = useState("open"); // open | history
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // New account form state
  const [newCustomerId, setNewCustomerId] = useState(() => defaultCustomerId ?? cashCustomer?.id ?? null);
  const [newCustomName, setNewCustomName] = useState("");
  const [newMechanic, setNewMechanic] = useState("");
  const [newVehicle, setNewVehicle] = useState("");
  const [newWithdrawnBy, setNewWithdrawnBy] = useState("");
  const [newNote, setNewNote] = useState("");
  const [includeCart, setIncludeCart] = useState(true);

  // Dispatch state (detail view)
  const [dispatchQuery, setDispatchQuery] = useState("");
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchHighlight, setDispatchHighlight] = useState(0);
  const [dispatchQty, setDispatchQty] = useState("1");
  const [dispatchLevel, setDispatchLevel] = useState(() => settings.defaultPriceLevel ?? "p3");
  const [dispatchWithdrawnBy, setDispatchWithdrawnBy] = useState("");
  const dispatchInputRef = useRef(null);

  // Return item inline state
  const [returningItemId, setReturningItemId] = useState(null);
  const [returnQty, setReturnQty] = useState("");
  const [returnReason, setReturnReason] = useState("");

  // Cancel confirmation state
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  // Bill state
  const [billCustomerId, setBillCustomerId] = useState(null);
  const [billComprobante, setBillComprobante] = useState("B02");
  const [billCondition, setBillCondition] = useState("contado");
  const [billMethod, setBillMethod] = useState("efectivo");
  const [billDiscountMode, setBillDiscountMode] = useState("percent");
  const [billDiscountValue, setBillDiscountValue] = useState("");
  const [billDueDate, setBillDueDate] = useState("");
  const [billReceived, setBillReceived] = useState("");

  useEffect(() => {
    if (!open) return;
    setError("");
    setConfirmCancel(false);
    setReturningItemId(null);
    if (view === "new") {
      setNewCustomerId(defaultCustomerId ?? cashCustomer?.id ?? null);
      setIncludeCart(cartItems.length > 0);
    }
  }, [open]);

  const selectedAccount = useMemo(
    () => workshopAccounts.find((a) => a.id === selectedId) ?? null,
    [workshopAccounts, selectedId],
  );

  const accountTotalsMap = useMemo(() => {
    const map = new Map();
    for (const acc of workshopAccounts) {
      map.set(acc.id, quoteWorkshopItems(acc.items, settings.itbisRate, 0));
    }
    return map;
  }, [workshopAccounts, settings.itbisRate]);

  const openAccounts = useMemo(
    () => workshopAccounts.filter((a) => a.status === "abierta"),
    [workshopAccounts],
  );
  const historyAccounts = useMemo(
    () => workshopAccounts.filter((a) => a.status !== "abierta"),
    [workshopAccounts],
  );

  const filteredAccounts = useMemo(() => {
    const source = tab === "open" ? openAccounts : historyAccounts;
    const q = search.trim().toLowerCase();
    if (!q) return source;
    return source.filter((a) =>
      String(a.id).includes(q) ||
      a.customerName.toLowerCase().includes(q) ||
      a.mechanic.toLowerCase().includes(q) ||
      a.vehicle.toLowerCase().includes(q) ||
      a.note.toLowerCase().includes(q),
    );
  }, [tab, openAccounts, historyAccounts, search]);

  const dispatchResults = useMemo(
    () => searchTopProducts(products, dispatchQuery, 6),
    [products, dispatchQuery],
  );

  const selectedQuote = useMemo(() => {
    if (!selectedAccount) return null;
    if (view === "bill") {
      return quoteWorkshopItems(selectedAccount.items, settings.itbisRate, {
        mode: billDiscountMode,
        value: billDiscountValue,
      });
    }
    return accountTotalsMap.get(selectedAccount.id) ?? quoteWorkshopItems(selectedAccount.items, settings.itbisRate, 0);
  }, [selectedAccount, view, settings.itbisRate, billDiscountMode, billDiscountValue, accountTotalsMap]);

  const billCustomer = useMemo(
    () => customers.find((c) => c.id === billCustomerId) ?? cashCustomer,
    [customers, billCustomerId, cashCustomer],
  );

  const todayIso = businessTodayIso();
  const configuredNcf = !window.__FELIX_DESKTOP__ && (settings.ncf || []).find((s) => s.type === billComprobante && s.active);
  const activeNcf = configuredNcf && configuredNcf.current < configuredNcf.end && configuredNcf.expiresAt >= todayIso ? configuredNcf : null;
  const ncfWarning = configuredNcf && !activeNcf
    ? (configuredNcf.expiresAt < todayIso
      ? `La secuencia NCF ${billComprobante} venció el ${configuredNcf.expiresAt}. Actualízala en Configuración.`
      : `La secuencia NCF ${billComprobante} está agotada. Actualízala en Configuración.`)
    : null;
  const nextNcfPreview = activeNcf ? `${activeNcf.prefix}${String(activeNcf.current + 1).padStart(8, "0")}` : null;

  const billDisabledReason = useMemo(() => {
    if (view !== "bill" || !selectedAccount || !selectedQuote) return null;
    if (runtime.connection !== "connected") return "Conecta con el servicio para cobrar la cuenta.";
    if (!cashSession?.open) return "La caja está cerrada. Ábrela para cobrar.";
    if (!billCustomer) return "Selecciona un cliente activo.";
    if (selectedQuote.totals.items <= 0) return "No hay artículos pendientes por cobrar.";
    if (selectedQuote.discountError) return selectedQuote.discountError;
    if (ncfWarning) return ncfWarning;
    if (billComprobante !== "B02" && !(billCustomer.rnc || "").trim()) {
      return "Este comprobante requiere un cliente con RNC o cédula.";
    }
    if (billCondition === "credito") {
      if (billCustomer.isCashCustomer || !billCustomer.creditLimit) {
        return "Selecciona un cliente con límite de crédito aprobado para pasar a Cuentas x cobrar.";
      }
      if (Math.round(billCustomer.balance * 100) + Math.round(selectedQuote.totals.total * 100) > Math.round(billCustomer.creditLimit * 100)) {
        return "El total excede el crédito disponible de este cliente.";
      }
      if (billDueDate && billDueDate < todayIso) {
        return "La fecha de vencimiento no puede ser anterior a hoy.";
      }
    }
    return null;
  }, [view, selectedAccount, selectedQuote, runtime.connection, cashSession?.open, billCustomer, ncfWarning, billComprobante, billCondition, billDueDate, todayIso]);

  const startNewAccount = () => {
    setError("");
    setNewCustomerId(defaultCustomerId ?? cashCustomer?.id ?? null);
    setNewCustomName("");
    setNewMechanic("");
    setNewVehicle("");
    setNewWithdrawnBy("");
    setNewNote("");
    setIncludeCart(cartItems.length > 0);
    setView("new");
  };

  const openDetail = (accountId) => {
    setError("");
    setSelectedId(accountId);
    setDispatchQuery("");
    setDispatchQty("1");
    setDispatchLevel(settings.defaultPriceLevel ?? "p3");
    setDispatchWithdrawnBy("");
    setReturningItemId(null);
    setConfirmCancel(false);
    setCancelReason("");
    setView("detail");
  };

  const openBillView = () => {
    if (!selectedAccount) return;
    setError("");
    const cust = customers.find((c) => c.id === selectedAccount.customerId) ?? cashCustomer;
    setBillCustomerId(cust?.id ?? null);
    setBillComprobante("B02");
    setBillCondition("contado");
    setBillMethod("efectivo");
    setBillDiscountMode("percent");
    setBillDiscountValue("");
    setBillDueDate("");
    setBillReceived("");
    setView("bill");
  };

  async function handleCreateAccount(e) {
    e.preventDefault();
    if (busy || !runtime.databaseId) return;
    const customer = customers.find((c) => c.id === newCustomerId) ?? cashCustomer;
    if (!customer) { setError("Selecciona un cliente activo."); return; }
    if (customer.isCashCustomer && !newCustomName.trim() && !newMechanic.trim() && !newVehicle.trim()) {
      setError("Indica el nombre del cliente, el mecánico o el vehículo para identificar la cuenta.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = {
        databaseId: runtime.databaseId,
        clienteId: customer.id,
        ...(newCustomName.trim() ? { clienteNombre: newCustomName.trim() } : {}),
        ...(newMechanic.trim() ? { mecanico: newMechanic.trim() } : {}),
        ...(newVehicle.trim() ? { vehiculo: newVehicle.trim() } : {}),
        ...(newNote.trim() ? { nota: newNote.trim() } : {}),
        ...(newWithdrawnBy.trim() ? { retiradoPor: newWithdrawnBy.trim() } : {}),
        ...(includeCart && cartItems.length > 0 ? { items: cartItemsToApi(cartItems) } : {}),
      };
      const snapshot = await openWorkshopAccount(payload);
      if (includeCart && cartItems.length > 0) onCartDispatched?.();
      toast.success("Cuenta de taller abierta", {
        description: includeCart && cartItems.length > 0
          ? `Cuenta #${snapshot.result.id} creada y ${cartItems.length} línea(s) descontadas del inventario.`
          : `Cuenta #${snapshot.result.id} lista para despachar piezas.`,
      });
      openDetail(snapshot.result.id);
    } catch (cause) {
      setError(cause.message || "No se pudo abrir la cuenta de taller.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDispatchProduct(product) {
    if (busy || !selectedAccount || selectedAccount.status !== "abierta") return;
    const target = product ?? dispatchResults[dispatchHighlight] ?? dispatchResults[0];
    if (!target) return;
    const qtyNum = Number(dispatchQty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setError("Indica una cantidad mayor que cero.");
      return;
    }
    if (qtyNum > target.stock) {
      setError(target.stock === 0 ? `${target.name} está agotado.` : `Solo hay ${target.stock} unidades disponibles de ${target.name}.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await dispatchWorkshopItems({
        databaseId: runtime.databaseId,
        accountId: selectedAccount.id,
        version: selectedAccount.version,
        ...(dispatchWithdrawnBy.trim() ? { retiradoPor: dispatchWithdrawnBy.trim() } : {}),
        items: [{
          productoId: target.id,
          versionProducto: target.version,
          nivelPrecio: API_LEVELS[dispatchLevel] || "precio1",
          cantidad: String(qtyNum),
        }],
      });
      setDispatchQuery("");
      setDispatchQty("1");
      setDispatchHighlight(0);
      setDispatchOpen(false);
      toast.success("Despacho registrado", {
        description: `${qtyNum} × ${target.name} · descontado del inventario.`,
      });
      dispatchInputRef.current?.focus();
    } catch (cause) {
      setError(cause.message || "No se pudo despachar el artículo.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDispatchCartToSelected() {
    if (busy || !selectedAccount || selectedAccount.status !== "abierta" || !cartItems.length) return;
    setBusy(true);
    setError("");
    try {
      await dispatchWorkshopItems({
        databaseId: runtime.databaseId,
        accountId: selectedAccount.id,
        version: selectedAccount.version,
        ...(dispatchWithdrawnBy.trim() ? { retiradoPor: dispatchWithdrawnBy.trim() } : {}),
        items: cartItemsToApi(cartItems),
      });
      onCartDispatched?.();
      toast.success("Carrito despachado a la cuenta", {
        description: `${cartItems.length} línea(s) agregadas a la cuenta #${selectedAccount.id}.`,
      });
    } catch (cause) {
      setError(cause.message || "No se pudo despachar el carrito.");
    } finally {
      setBusy(false);
    }
  }

  async function handleReturnItem(item) {
    if (busy || !selectedAccount || selectedAccount.status !== "abierta") return;
    const qtyNum = Number(returnQty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0 || qtyNum > item.netQuantity) {
      setError(`Indica una cantidad entre 0.01 y ${item.netQuantity} para devolver.`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await returnWorkshopItem({
        databaseId: runtime.databaseId,
        accountId: selectedAccount.id,
        version: selectedAccount.version,
        itemId: item.id,
        cantidad: String(qtyNum),
        ...(returnReason.trim() ? { motivo: returnReason.trim() } : {}),
      });
      setReturningItemId(null);
      setReturnQty("");
      setReturnReason("");
      toast.success("Devolución registrada", {
        description: `${qtyNum} × ${item.name} regresó al inventario.`,
      });
    } catch (cause) {
      setError(cause.message || "No se pudo registrar la devolución.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCancelAccount() {
    if (busy || !selectedAccount || selectedAccount.status !== "abierta") return;
    setBusy(true);
    setError("");
    try {
      await cancelWorkshopAccount({
        databaseId: runtime.databaseId,
        accountId: selectedAccount.id,
        version: selectedAccount.version,
        ...(cancelReason.trim() ? { motivo: cancelReason.trim() } : {}),
      });
      setConfirmCancel(false);
      setCancelReason("");
      toast.success("Cuenta de taller cancelada", {
        description: "Las piezas pendientes se devolvieron al inventario.",
      });
    } catch (cause) {
      setError(cause.message || "No se pudo cancelar la cuenta.");
    } finally {
      setBusy(false);
    }
  }

  async function handleBillAccount() {
    if (busy || !selectedAccount || !selectedQuote || billDisabledReason) return;
    const isCash = billCondition === "contado" && billMethod === "efectivo";
    const receivedNum = Number(billReceived);
    if (isCash && (!Number.isFinite(receivedNum) || receivedNum < selectedQuote.totals.total)) {
      setError("El monto recibido en efectivo es menor al total por cobrar.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const request = workshopBillRequest(
        selectedAccount,
        settings,
        billCustomer.id,
        billCondition,
        billComprobante,
        cashSession,
        billMethod,
        { mode: billDiscountMode, value: billDiscountValue },
        billCondition === "credito" && billDueDate ? billDueDate : null,
      );
      const snapshot = await billWorkshopAccount(request);
      onOpenChange(false);
      setView("list");
      onBilled?.(snapshot, isCash ? receivedNum : undefined);
      toast.success(
        billCondition === "credito"
          ? "Cuenta facturada a crédito (Cuentas x cobrar)"
          : "Cuenta de taller cobrada",
        { description: `Se generó la factura consolidada #${snapshot.result.ventaId}.` },
      );
    } catch (cause) {
      setError(cause.message || "No se pudo cobrar la cuenta de taller.");
    } finally {
      setBusy(false);
    }
  }

  function handlePrintStatement() {
    if (!selectedAccount || !selectedQuote) return;
    const netLines = selectedQuote.lines
      .filter((line) => line.netQuantity > 0)
      .map((line) => ({
        key: line.id,
        product: { name: `${line.code} · ${line.name}` },
        quantity: line.netQuantity,
        unitPrice: line.priceExact ?? line.price,
        subtotal: line.subtotal,
      }));
    onShowStatement?.({
      invoiceNumber: `Cuenta taller #${selectedAccount.id}`,
      dateOnly: businessTodayIso(),
      customerName: selectedAccount.customerName,
      customerRnc: customers.find((c) => c.id === selectedAccount.customerId)?.rnc ?? "",
      mechanic: selectedAccount.mechanic,
      vehicle: selectedAccount.vehicle,
      ncf: null,
      comprobante: "Estado",
      itbisRate: settings.itbisRate,
      conditionLabel: "Cuenta abierta",
      paymentLabel: "Pendiente de cobro (No es factura)",
      totals: selectedQuote.totals,
      lines: netLines,
    });
  }

  function handleViewBilledInvoice() {
    if (!selectedAccount?.saleId) return;
    const sale = sales.find((s) => s.id === selectedAccount.saleId);
    if (!sale) {
      toast.error("No se encontró la factura asociada en el estado actual.");
      return;
    }
    onShowSale?.({
      invoiceNumber: sale.number,
      dateOnly: sale.date,
      dueDate: sale.dueDate,
      customerName: sale.customerName,
      customerRnc: sale.customerRnc,
      mechanic: selectedAccount.mechanic,
      vehicle: selectedAccount.vehicle,
      ncf: sale.ncf,
      comprobante: sale.comprobante,
      itbisRate: null,
      conditionLabel: sale.condition === "credito" ? "Crédito" : "Contado",
      paymentLabel: { efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia", credito: "Crédito" }[sale.paymentMethod] || sale.paymentMethod,
      totals: {
        subtotal: sale.subtotal,
        ...(sale.discount > 0 ? { grossTotal: Math.round((sale.total + sale.discount) * 100) / 100 } : {}),
        discount: sale.discount,
        discountPercent: sale.discountPercent,
        itbis: sale.itbis,
        total: sale.total,
      },
      lines: sale.lines.map((row) => ({
        key: row.id,
        product: { name: row.name },
        quantity: row.quantity,
        unitPrice: row.priceExact ?? row.price,
        subtotal: row.subtotal,
      })),
    });
  }

  const handleDispatchKeyDown = (e) => {
    if (busy || e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setDispatchHighlight((h) => Math.min(h + 1, Math.max(0, dispatchResults.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setDispatchHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!dispatchQuery.trim()) return;
      try {
        const scanned = productForBarcode(products, dispatchQuery);
        handleDispatchProduct(scanned);
      } catch {
        handleDispatchProduct(dispatchResults[dispatchHighlight] ?? dispatchResults[0]);
      }
    } else if (e.key === "Escape") {
      setDispatchOpen(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
        if (!next) {
          setView("list");
          setError("");
          setConfirmCancel(false);
          setReturningItemId(null);
        }
      }}
    >
      <DialogContent
        closeDisabled={busy}
        className="flex max-w-4xl flex-col gap-0 overflow-hidden rounded-2xl p-0"
        style={{ width: "calc(100vw - 1.5rem)", maxHeight: "calc(100dvh - 1.5rem)" }}
      >
        <DialogHeader className="border-b border-border px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2 pr-8">
            <div className="flex items-center gap-2.5">
              {view !== "list" && (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-9 w-9 rounded-xl"
                  disabled={busy}
                  aria-label="Volver"
                  onClick={() => {
                    setError("");
                    setConfirmCancel(false);
                    setReturningItemId(null);
                    setView(view === "bill" ? "detail" : "list");
                  }}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              )}
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
                <Wrench className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle className="text-base sm:text-lg">
                  {view === "list" && "Cuentas abiertas de taller"}
                  {view === "new" && "Nueva cuenta de taller"}
                  {view === "detail" && selectedAccount && `Cuenta de taller #${selectedAccount.id}`}
                  {view === "bill" && selectedAccount && `Cobrar cuenta #${selectedAccount.id}`}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {view === "list" && "Despacha piezas al mecánico con inventario al día y cobra todo junto al terminar."}
                  {view === "new" && "Cada pieza despachada se descuenta del inventario y congela su precio al momento."}
                  {view === "detail" && "Registra despachos adicionales, devoluciones o pasa al cobro final."}
                  {view === "bill" && "Se emitirá una sola factura consolidada sin volver a descontar inventario."}
                </DialogDescription>
              </div>
            </div>
            {view === "list" && (
              <Button
                type="button"
                className="h-11 rounded-xl"
                disabled={busy || runtime.connection !== "connected"}
                onClick={startNewAccount}
              >
                <Plus className="h-4 w-4" />
                <span>Nueva cuenta</span>
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
          {error && (
            <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* LIST VIEW */}
          {view === "list" && (
            <div className="space-y-4">
              {cartItems.length > 0 && (
                <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-accent/60 p-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2.5 text-sm">
                    <ShoppingCart className="h-4 w-4 shrink-0 text-primary" />
                    <span>
                      Tienes <strong>{cartItems.length} {cartItems.length === 1 ? "línea" : "líneas"}</strong> en el carrito actual. Puedes enviarlas a una cuenta nueva o abrir una existente para despacharlas.
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="h-10 shrink-0 rounded-xl"
                    disabled={busy || runtime.connection !== "connected"}
                    onClick={startNewAccount}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Abrir cuenta con carrito</span>
                  </Button>
                </div>
              )}

              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex rounded-xl border border-border bg-muted/40 p-1">
                  <button
                    type="button"
                    className={cn(
                      "min-h-9 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                      tab === "open" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setTab("open")}
                  >
                    Abiertas ({openAccounts.length})
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "min-h-9 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                      tab === "history" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setTab("history")}
                  >
                    Historial ({historyAccounts.length})
                  </button>
                </div>
                <div className="relative flex-1 sm:max-w-xs">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar cliente, mecánico, vehículo…"
                    className="h-11 rounded-xl bg-card pl-9"
                  />
                </div>
              </div>

              {filteredAccounts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-border bg-muted/20 px-6 py-10 text-center">
                  <Wrench className="mx-auto mb-2.5 h-8 w-8 text-muted-foreground/60" />
                  <p className="text-sm font-medium">
                    {tab === "open" ? "No hay cuentas de taller abiertas" : "Aún no hay cuentas cerradas"}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {tab === "open"
                      ? "Abre una cuenta para ir despachando piezas mientras el mecánico trabaja."
                      : "Aquí verás las cuentas facturadas y canceladas."}
                  </p>
                  {tab === "open" && (
                    <Button
                      type="button"
                      className="mt-4 h-11 rounded-xl"
                      disabled={busy || runtime.connection !== "connected"}
                      onClick={startNewAccount}
                    >
                      <Plus className="h-4 w-4" />
                      <span>Abrir primera cuenta</span>
                    </Button>
                  )}
                </div>
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                  {filteredAccounts.map((acc) => {
                    const quote = accountTotalsMap.get(acc.id);
                    const badge = STATUS_BADGE[acc.status] ?? STATUS_BADGE.abierta;
                    return (
                      <li key={acc.id}>
                        <button
                          type="button"
                          onClick={() => openDetail(acc.id)}
                          className="flex w-full flex-col gap-2.5 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/20"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-mono text-xs font-semibold text-muted-foreground">#{acc.id}</span>
                                <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", badge.cls)}>
                                  {badge.label}
                                </span>
                                {acc.saleId && (
                                  <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                                    Fact. #{acc.saleId}
                                  </span>
                                )}
                              </div>
                              <p className="mt-1 truncate text-sm font-semibold text-foreground">{acc.customerName}</p>
                            </div>
                            <div className="shrink-0 text-right">
                              <p className="text-base font-bold tabular-nums text-foreground">
                                {formatMoney(quote?.totals.total ?? 0)}
                              </p>
                              <p className="text-[11px] text-muted-foreground tabular-nums">
                                {quote?.totals.items ?? 0} {(quote?.totals.items ?? 0) === 1 ? "pieza" : "piezas"}
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            {acc.mechanic && (
                              <span className="inline-flex items-center gap-1">
                                <Wrench className="h-3.5 w-3.5" />
                                {acc.mechanic}
                              </span>
                            )}
                            {acc.vehicle && (
                              <span className="inline-flex items-center gap-1">
                                <Car className="h-3.5 w-3.5" />
                                {acc.vehicle}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            Abierta: {formatBusinessDateTime(acc.openedAt)} · por {acc.openedBy}
                          </p>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {/* NEW ACCOUNT VIEW */}
          {view === "new" && (
            <form onSubmit={handleCreateAccount} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Cliente registrado</Label>
                  <Select
                    value={newCustomerId ? String(newCustomerId) : ""}
                    onValueChange={(v) => setNewCustomerId(Number(v))}
                  >
                    <SelectTrigger aria-label="Cliente registrado" className="h-11 rounded-xl bg-card">
                      <SelectValue placeholder="Selecciona un cliente" />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="taller-nombre" className="text-xs text-muted-foreground">
                    Nombre / referencia del cliente (opcional)
                  </Label>
                  <Input
                    id="taller-nombre"
                    value={newCustomName}
                    onChange={(e) => setNewCustomName(e.target.value)}
                    placeholder="Ej. Juan Pérez · cliente de contado"
                    className="h-11 rounded-xl bg-card"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="taller-mecanico" className="text-xs text-muted-foreground">
                    Mecánico
                  </Label>
                  <Input
                    id="taller-mecanico"
                    value={newMechanic}
                    onChange={(e) => setNewMechanic(e.target.value)}
                    placeholder="Ej. Luis Gómez"
                    className="h-11 rounded-xl bg-card"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="taller-vehiculo" className="text-xs text-muted-foreground">
                    Vehículo / motor / placa
                  </Label>
                  <Input
                    id="taller-vehiculo"
                    value={newVehicle}
                    onChange={(e) => setNewVehicle(e.target.value)}
                    placeholder="Ej. Toyota Corolla 2018 · Rojo"
                    className="h-11 rounded-xl bg-card"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="taller-retira" className="text-xs text-muted-foreground">
                    Quién retira las piezas (opcional)
                  </Label>
                  <Input
                    id="taller-retira"
                    value={newWithdrawnBy}
                    onChange={(e) => setNewWithdrawnBy(e.target.value)}
                    placeholder="Ej. Ayudante Pedro"
                    className="h-11 rounded-xl bg-card"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="taller-nota" className="text-xs text-muted-foreground">
                    Nota (opcional)
                  </Label>
                  <Input
                    id="taller-nota"
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Ej. Reparación de frenos y tren delantero"
                    className="h-11 rounded-xl bg-card"
                  />
                </div>
              </div>

              {cartItems.length > 0 && (
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-muted/40 p-3.5 text-sm">
                  <input
                    type="checkbox"
                    checked={includeCart}
                    onChange={(e) => setIncludeCart(e.target.checked)}
                    className="mt-1 h-4 w-4 shrink-0"
                    style={{ accentColor: "hsl(var(--primary))" }}
                  />
                  <div className="space-y-1">
                    <p className="font-medium">
                      Despachar ahora los {cartItems.length} {cartItems.length === 1 ? "artículo" : "artículos"} del carrito actual
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Se descontarán del inventario inmediatamente con su precio actual y se limpiará el carrito de mostrador.
                    </p>
                  </div>
                </label>
              )}

              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-xl bg-card"
                  disabled={busy}
                  onClick={() => setView("list")}
                >
                  Cancelar
                </Button>
                <Button type="submit" className="h-11 rounded-xl" disabled={busy}>
                  <Wrench className="h-4 w-4" />
                  <span>{busy ? "Abriendo…" : "Abrir cuenta de taller"}</span>
                </Button>
              </div>
            </form>
          )}

          {/* DETAIL VIEW */}
          {view === "detail" && selectedAccount && selectedQuote && (
            <div className="space-y-4">
              {/* Summary card */}
              <div className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", (STATUS_BADGE[selectedAccount.status] ?? STATUS_BADGE.abierta).cls)}>
                      {(STATUS_BADGE[selectedAccount.status] ?? STATUS_BADGE.abierta).label}
                    </span>
                    <span className="text-base font-semibold">{selectedAccount.customerName}</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {selectedAccount.mechanic && (
                      <span className="inline-flex items-center gap-1">
                        <Wrench className="h-3.5 w-3.5" />
                        Mecánico: <strong className="text-foreground">{selectedAccount.mechanic}</strong>
                      </span>
                    )}
                    {selectedAccount.vehicle && (
                      <span className="inline-flex items-center gap-1">
                        <Car className="h-3.5 w-3.5" />
                        Vehículo: <strong className="text-foreground">{selectedAccount.vehicle}</strong>
                      </span>
                    )}
                    <span>Abierta: {formatBusinessDateTime(selectedAccount.openedAt)}</span>
                  </div>
                  {selectedAccount.note && (
                    <p className="text-xs text-muted-foreground">Nota: {selectedAccount.note}</p>
                  )}
                </div>
                <div className="shrink-0 sm:text-right">
                  <p className="text-xs text-muted-foreground">Total acumulado (precios congelados)</p>
                  <p className="text-2xl font-bold tabular-nums text-foreground">
                    {formatMoney(selectedQuote.totals.total)}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {selectedQuote.totals.items} {selectedQuote.totals.items === 1 ? "pieza neta" : "piezas netas"} · ITBIS {formatMoney(selectedQuote.totals.itbis)}
                  </p>
                </div>
              </div>

              {/* Closed status banners */}
              {selectedAccount.status === "facturada" && (
                <div className="flex flex-col gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>
                      Cuenta cerrada y facturada en <strong>Registro #{selectedAccount.saleId}</strong>
                      {selectedAccount.closedAt ? ` el ${formatBusinessDateTime(selectedAccount.closedAt)}` : ""}.
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-10 rounded-xl bg-card"
                    onClick={handleViewBilledInvoice}
                  >
                    <Printer className="h-3.5 w-3.5" />
                    <span>Ver / imprimir factura</span>
                  </Button>
                </div>
              )}

              {selectedAccount.status === "cancelada" && (
                <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-3.5 text-sm text-muted-foreground">
                  <XCircle className="h-4 w-4 shrink-0" />
                  <span>
                    Cuenta cancelada{selectedAccount.closedAt ? ` el ${formatBusinessDateTime(selectedAccount.closedAt)}` : ""}. Todas las piezas pendientes regresaron al inventario.
                  </span>
                </div>
              )}

              {/* Dispatch bar (only when open) */}
              {selectedAccount.status === "abierta" && (
                <div className="space-y-3 rounded-2xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold">Despachar piezas a esta cuenta</h3>
                    {cartItems.length > 0 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-9 rounded-xl bg-card"
                        disabled={busy || runtime.connection !== "connected"}
                        onClick={handleDispatchCartToSelected}
                      >
                        <ShoppingCart className="h-3.5 w-3.5" />
                        <span>Despachar carrito actual ({cartItems.length})</span>
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-2.5 md:grid-cols-[minmax(0,1fr)_88px_150px_140px_auto] md:items-end">
                    <div className="relative space-y-1">
                      <Label htmlFor="taller-buscar-prod" className="text-xs text-muted-foreground">
                        Código o nombre del producto
                      </Label>
                      <Input
                        id="taller-buscar-prod"
                        ref={dispatchInputRef}
                        disabled={busy}
                        autoComplete="off"
                        value={dispatchQuery}
                        onChange={(e) => {
                          setDispatchQuery(e.target.value);
                          setDispatchHighlight(0);
                          setDispatchOpen(true);
                          setError("");
                        }}
                        onFocus={() => setDispatchOpen(true)}
                        onBlur={() => setTimeout(() => setDispatchOpen(false), 150)}
                        onKeyDown={handleDispatchKeyDown}
                        placeholder="Escanea o busca pieza…"
                        className="h-11 rounded-xl bg-card"
                      />
                      {dispatchOpen && dispatchQuery.trim() && (
                        <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
                          {dispatchResults.length === 0 ? (
                            <p className="px-3 py-4 text-xs text-muted-foreground">Sin coincidencias para “{dispatchQuery}”</p>
                          ) : (
                            <ul className="max-h-56 overflow-y-auto py-1">
                              {dispatchResults.map((p, i) => (
                                <li key={p.id}>
                                  <button
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onMouseEnter={() => setDispatchHighlight(i)}
                                    onClick={() => handleDispatchProduct(p)}
                                    className={cn(
                                      "flex w-full items-center gap-2 px-3 py-2 text-left text-xs",
                                      i === dispatchHighlight && "bg-accent",
                                    )}
                                  >
                                    <span className="w-24 shrink-0 truncate font-mono text-muted-foreground">{p.code}</span>
                                    <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                                    <span className={cn("shrink-0", p.stock === 0 ? "text-destructive" : "text-muted-foreground")}>
                                      {p.stock === 0 ? "Agotado" : `${p.stock} disp.`}
                                    </span>
                                    <span className="w-20 shrink-0 text-right font-semibold tabular-nums">
                                      {formatUnitMoney((p.pricesExact ?? p.prices)[dispatchLevel])}
                                    </span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="taller-cant" className="text-xs text-muted-foreground">Cant.</Label>
                      <Input
                        id="taller-cant"
                        type="number"
                        step="any"
                        min="0.01"
                        disabled={busy}
                        value={dispatchQty}
                        onChange={(e) => setDispatchQty(e.target.value)}
                        className="h-11 rounded-xl bg-card tabular-nums"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Precio</Label>
                      <Select value={dispatchLevel} onValueChange={setDispatchLevel}>
                        <SelectTrigger aria-label="Nivel de precio" className="h-11 rounded-xl bg-card">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRICE_LEVELS.map((l) => (
                            <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="taller-retiro" className="text-xs text-muted-foreground">Retiró (opc.)</Label>
                      <Input
                        id="taller-retiro"
                        disabled={busy}
                        value={dispatchWithdrawnBy}
                        onChange={(e) => setDispatchWithdrawnBy(e.target.value)}
                        placeholder="Ej. Pedro"
                        className="h-11 rounded-xl bg-card"
                      />
                    </div>
                    <Button
                      type="button"
                      className="h-11 rounded-xl"
                      disabled={busy || !dispatchResults.length || runtime.connection !== "connected"}
                      onClick={() => handleDispatchProduct()}
                    >
                      <Plus className="h-4 w-4" />
                      <span>Despachar</span>
                    </Button>
                  </div>
                </div>
              )}

              {/* Dispatched items list */}
              <div className="overflow-hidden rounded-2xl border border-border bg-card">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <h3 className="text-sm font-semibold">Detalle de despachos ({selectedAccount.items.length})</h3>
                  <span className="text-xs text-muted-foreground">Precio congelado por entrega</span>
                </div>
                {selectedAccount.items.length === 0 ? (
                  <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                    Aún no se han despachado piezas en esta cuenta. Busca arriba para entregar la primera pieza.
                  </p>
                ) : (
                  <ul className="divide-y divide-border">
                    {selectedQuote.lines.map((line) => {
                      const isReturning = returningItemId === line.id;
                      const fullyReturned = line.netQuantity <= 0;
                      return (
                        <li key={line.id} className={cn("space-y-2 px-4 py-3 text-sm", fullyReturned && "bg-muted/30 opacity-70")}>
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="font-mono text-xs text-muted-foreground">{line.code}</span>
                                <span className={cn("font-medium", fullyReturned && "line-through")}>{line.name}</span>
                                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                  {LEVEL_LABELS[line.priceLevel] || "P1"}
                                </span>
                                {!line.taxable && (
                                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Exento</span>
                                )}
                              </div>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {formatBusinessDateTime(line.createdAt)} · Despachó: {line.dispatchedBy}
                                {line.withdrawnBy ? ` · Retiró: ${line.withdrawnBy}` : ""}
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              <div className="text-right tabular-nums">
                                <p className="font-semibold">
                                  {line.netQuantity} × {formatUnitMoney(line.priceExact ?? line.price)} = {formatMoney(line.subtotal)}
                                </p>
                                {line.returnedQuantity > 0 && (
                                  <p className="text-xs text-amber-700 dark:text-amber-400">
                                    Despachado: {line.quantity} · Devuelto: {line.returnedQuantity}
                                  </p>
                                )}
                              </div>
                              {selectedAccount.status === "abierta" && line.netQuantity > 0 && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-9 rounded-xl bg-card"
                                  disabled={busy}
                                  onClick={() => {
                                    if (isReturning) {
                                      setReturningItemId(null);
                                    } else {
                                      setReturningItemId(line.id);
                                      setReturnQty(String(line.netQuantity));
                                      setReturnReason("");
                                      setError("");
                                    }
                                  }}
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                  <span>Devolver</span>
                                </Button>
                              )}
                            </div>
                          </div>

                          {isReturning && (
                            <div className="flex flex-wrap items-end gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                              <div className="w-28 space-y-1">
                                <Label htmlFor={`dev-cant-${line.id}`} className="text-xs">Cant. devolver</Label>
                                <Input
                                  id={`dev-cant-${line.id}`}
                                  type="number"
                                  step="any"
                                  min="0.01"
                                  max={line.netQuantity}
                                  value={returnQty}
                                  onChange={(e) => setReturnQty(e.target.value)}
                                  className="h-10 rounded-xl bg-card tabular-nums"
                                />
                              </div>
                              <div className="min-w-[160px] flex-1 space-y-1">
                                <Label htmlFor={`dev-motivo-${line.id}`} className="text-xs">Motivo (opcional)</Label>
                                <Input
                                  id={`dev-motivo-${line.id}`}
                                  value={returnReason}
                                  onChange={(e) => setReturnReason(e.target.value)}
                                  placeholder="Ej. No le sirvió / sobró"
                                  className="h-10 rounded-xl bg-card"
                                />
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                className="h-10 rounded-xl"
                                disabled={busy}
                                onClick={() => handleReturnItem(line)}
                              >
                                Confirmar devolución
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-10 rounded-xl"
                                disabled={busy}
                                onClick={() => setReturningItemId(null)}
                              >
                                Cancelar
                              </Button>
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Inline cancel confirmation */}
              {selectedAccount.status === "abierta" && confirmCancel && (
                <div className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                  <p className="text-sm font-semibold text-destructive">
                    ¿Cancelar la cuenta #{selectedAccount.id}?
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Todas las piezas pendientes ({selectedQuote.totals.items}) volverán automáticamente al inventario. Esta acción no se puede deshacer.
                  </p>
                  <Input
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    placeholder="Motivo de cancelación (opcional)"
                    className="h-10 rounded-xl bg-card"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="destructive"
                      className="h-10 rounded-xl"
                      disabled={busy}
                      onClick={handleCancelAccount}
                    >
                      {busy ? "Cancelando…" : "Sí, cancelar y devolver piezas"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-10 rounded-xl bg-card"
                      disabled={busy}
                      onClick={() => setConfirmCancel(false)}
                    >
                      Volver
                    </Button>
                  </div>
                </div>
              )}

              {/* Footer actions for open account */}
              {selectedAccount.status === "abierta" && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 rounded-xl bg-card"
                      disabled={busy || selectedQuote.totals.items <= 0}
                      onClick={handlePrintStatement}
                    >
                      <Printer className="h-4 w-4" />
                      <span>Imprimir estado</span>
                    </Button>
                    {!confirmCancel && (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-11 rounded-xl bg-card text-destructive hover:text-destructive"
                        disabled={busy || runtime.connection !== "connected"}
                        onClick={() => setConfirmCancel(true)}
                      >
                        <XCircle className="h-4 w-4" />
                        <span>Cancelar cuenta</span>
                      </Button>
                    )}
                  </div>
                  <Button
                    type="button"
                    className="h-11 rounded-xl"
                    disabled={busy || selectedQuote.totals.items <= 0 || runtime.connection !== "connected"}
                    onClick={openBillView}
                  >
                    <ReceiptText className="h-4 w-4" />
                    <span>Cobrar cuenta ({formatMoney(selectedQuote.totals.total)})</span>
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* BILL VIEW */}
          {view === "bill" && selectedAccount && selectedQuote && (
            <div className="space-y-4">
              {!cashSession?.open && (
                <div className="flex flex-col gap-3 rounded-xl border border-primary/30 bg-accent p-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2.5 text-sm">
                    <Lock className="h-4 w-4 text-primary" />
                    <span>La caja está cerrada. Abre la caja para poder emitir la factura.</span>
                  </div>
                  <Button asChild size="sm" className="h-10 rounded-xl" onClick={() => onOpenChange(false)}>
                    <Link to="/caja">Ir a Caja</Link>
                  </Button>
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Cliente en factura</Label>
                  <Select
                    value={billCustomer ? String(billCustomer.id) : ""}
                    onValueChange={(v) => {
                      const nextId = Number(v);
                      setBillCustomerId(nextId);
                      const picked = customers.find((c) => c.id === nextId);
                      if (picked?.isCashCustomer) {
                        setBillComprobante("B02");
                        setBillCondition("contado");
                      }
                    }}
                  >
                    <SelectTrigger aria-label="Cliente en factura" className="h-11 rounded-xl bg-card">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {customers.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Comprobante</Label>
                  <Select value={billComprobante} onValueChange={setBillComprobante}>
                    <SelectTrigger aria-label="Comprobante" className="h-11 rounded-xl bg-card">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COMPROBANTES.filter((c) => c.value !== "B15").map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Condición de pago</Label>
                  <Select value={billCondition} onValueChange={setBillCondition}>
                    <SelectTrigger aria-label="Condición de pago" className="h-11 rounded-xl bg-card">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONDITIONS.map((c) => (
                        <SelectItem key={c.value} value={c.value}>
                          {c.value === "credito" ? "Crédito (Cuentas x cobrar)" : c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {billCustomer && !billCustomer.isCashCustomer && (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5">
                    <User className="h-3.5 w-3.5" />
                    RNC/Cédula: <strong className="text-foreground">{billCustomer.rnc || "Sin RNC"}</strong>
                    {billCustomer.creditLimit > 0 && (
                      <>
                        <span className="mx-1 text-border">|</span>
                        Crédito disponible:{" "}
                        <strong className="text-foreground tabular-nums">
                          {formatMoney(billCustomer.creditLimit - billCustomer.balance)}
                        </strong>
                      </>
                    )}
                  </span>
                  {nextNcfPreview && (
                    <span className="rounded-lg bg-muted px-2.5 py-1.5 font-mono">
                      Próximo NCF: <strong className="text-foreground">{nextNcfPreview}</strong>
                    </span>
                  )}
                </div>
              )}

              {billCondition === "credito" ? (
                <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3.5 text-sm">
                  <p className="font-medium text-amber-800 dark:text-amber-300">
                    Pasar cuenta a Cuentas x cobrar
                  </p>
                  <p className="text-xs text-muted-foreground">
                    La cuenta de taller se cerrará y el saldo de <strong>{formatMoney(selectedQuote.totals.total)}</strong> quedará registrado en Cuentas x cobrar a nombre de <strong>{billCustomer?.name}</strong> para abonar luego.
                  </p>
                  <div className="max-w-xs space-y-1">
                    <Label htmlFor="taller-vencimiento" className="text-xs text-muted-foreground">
                      Fecha de vencimiento (opcional, por defecto +30 días)
                    </Label>
                    <Input
                      id="taller-vencimiento"
                      type="date"
                      min={todayIso}
                      value={billDueDate}
                      onChange={(e) => setBillDueDate(e.target.value)}
                      className="h-11 rounded-xl bg-card"
                    />
                  </div>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Método de pago</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {PAYMENT_METHODS.map((m) => (
                        <button
                          key={m.value}
                          type="button"
                          onClick={() => setBillMethod(m.value)}
                          className={cn(
                            "min-h-11 rounded-xl border px-2 text-xs font-semibold transition-colors",
                            billMethod === m.value
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-card text-foreground hover:bg-muted/50",
                          )}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {billMethod === "efectivo" && (
                    <div className="space-y-1.5">
                      <Label htmlFor="taller-recibido" className="text-xs text-muted-foreground">
                        Efectivo recibido (RD$)
                      </Label>
                      <Input
                        id="taller-recibido"
                        type="number"
                        step="any"
                        min="0"
                        value={billReceived}
                        onChange={(e) => setBillReceived(e.target.value)}
                        placeholder={selectedQuote.totals.total.toFixed(2)}
                        className="h-11 rounded-xl bg-card tabular-nums"
                      />
                      <div className="flex flex-wrap gap-1.5">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 rounded-lg px-2 text-xs"
                          onClick={() => setBillReceived(selectedQuote.totals.total.toFixed(2))}
                        >
                          Exacto
                        </Button>
                        {QUICK_BILLS.map((amt) => (
                          <Button
                            key={amt}
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 rounded-lg px-2 text-xs tabular-nums"
                            onClick={() => setBillReceived(String(amt))}
                          >
                            {amt}
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Discount + totals box */}
              <div className="grid gap-4 rounded-2xl border border-border bg-muted/30 p-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="taller-descuento" className="text-xs text-muted-foreground">Descuento libre (opcional)</Label>
                  <div className="flex gap-2">
                    <div className="flex shrink-0 rounded-xl border border-border bg-card p-1">
                      <button
                        type="button"
                        className={cn(
                          "rounded-lg px-2.5 py-1 text-xs font-semibold",
                          billDiscountMode === "percent" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                        )}
                        onClick={() => { setBillDiscountMode("percent"); setBillDiscountValue(""); }}
                      >
                        %
                      </button>
                      <button
                        type="button"
                        className={cn(
                          "rounded-lg px-2.5 py-1 text-xs font-semibold",
                          billDiscountMode === "amount" ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                        )}
                        onClick={() => { setBillDiscountMode("amount"); setBillDiscountValue(""); }}
                      >
                        RD$
                      </button>
                    </div>
                    <Input
                      id="taller-descuento"
                      type="text"
                      inputMode="decimal"
                      value={billDiscountValue}
                      onChange={(e) => setBillDiscountValue(e.target.value)}
                      placeholder={billDiscountMode === "percent" ? "0 %" : "0.00"}
                      className="h-11 rounded-xl bg-card tabular-nums"
                    />
                  </div>
                </div>

                <div className="space-y-1 text-sm tabular-nums">
                  {selectedQuote.totals.discount > 0 && (
                    <>
                      <div className="flex justify-between text-muted-foreground">
                        <span>Subtotal bruto</span>
                        <span>{formatMoney(selectedQuote.totals.grossTotal)}</span>
                      </div>
                      <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                        <span>Descuento ({selectedQuote.totals.discountPercent}%)</span>
                        <span>− {formatMoney(selectedQuote.totals.discount)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex justify-between text-muted-foreground">
                    <span>Base imponible</span>
                    <span>{formatMoney(selectedQuote.totals.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>ITBIS ({settings.itbisRate}%)</span>
                    <span>{formatMoney(selectedQuote.totals.itbis)}</span>
                  </div>
                  <div className="flex justify-between border-t border-border pt-1.5 text-base font-bold">
                    <span>Total a cobrar</span>
                    <span>{formatMoney(selectedQuote.totals.total)}</span>
                  </div>
                  {billCondition === "contado" && billMethod === "efectivo" && Number(billReceived) >= selectedQuote.totals.total && (
                    <div className="flex justify-between text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      <span>Cambio</span>
                      <span>{formatMoney(Number(billReceived) - selectedQuote.totals.total)}</span>
                    </div>
                  )}
                </div>
              </div>

              {billDisabledReason && (
                <p role="status" className="flex items-center gap-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-800 dark:text-amber-300">
                  <CircleAlert className="h-4 w-4 shrink-0" />
                  <span>{billDisabledReason}</span>
                </p>
              )}

              <div className="flex flex-wrap justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-xl bg-card"
                  disabled={busy}
                  onClick={() => setView("detail")}
                >
                  Volver al detalle
                </Button>
                <Button
                  type="button"
                  className="h-11 rounded-xl"
                  disabled={busy || Boolean(billDisabledReason)}
                  onClick={handleBillAccount}
                >
                  <ReceiptText className="h-4 w-4" />
                  <span>
                    {busy
                      ? "Facturando…"
                      : billCondition === "credito"
                        ? "Facturar a crédito"
                        : "Confirmar y cobrar"}
                  </span>
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

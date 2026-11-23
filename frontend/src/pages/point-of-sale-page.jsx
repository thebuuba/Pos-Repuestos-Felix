// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { usePosStore } from "../data/pos-context.jsx";
import { useSaleDraft } from "../data/sale-draft.jsx";
import { toLines } from "../lib/cart.js";
import { computeTotals } from "../lib/cart.js";
import { toast as ue } from "sonner";
import { CONDITIONS } from "../data/sales-options.js";
import { PAYMENT_METHODS } from "../data/sales-options.js";
import { PageHeader } from "../components/pos/page-header.jsx";
import { Button } from "../components/ui/button.jsx";
import { CirclePause, RotateCcw, Lock, ChevronDown, LayoutGrid, Play, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { InvoiceSettingsCard } from "../components/pos/invoice-settings-card.jsx";
import { WorkshopTabsBar } from "../components/pos/workshop-tabs-bar.jsx";
import { WorkshopItemsTable } from "../components/pos/workshop-items-table.jsx";
import { quoteWorkshopItems, workshopBillRequest } from "../data/operational-sales.js";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../components/ui/dialog.jsx";
import { formatMoney } from "../lib/format.js";
import { businessTodayIso } from "../lib/dates.js";
import { ProductSearchBar } from "../components/pos/product-search-bar.jsx";
import { QuickProductsGrid } from "../components/pos/quick-products-grid.jsx";
import { CartTable } from "../components/pos/cart-table.jsx";
import { OrderSummaryPanel } from "../components/pos/order-summary-panel.jsx";
import { ReceiptDialog } from "../components/pos/receipt-dialog.jsx";
import { Fragment } from "react";
import { useCallback } from "react";
import { useEffect } from "react";
import { useMemo } from "react";
import { useRef } from "react";
import { useState } from "react";
import { useId } from "react";
function MobileSaleDetails({ label, children }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return <div className="sale-details" data-open={open}>
    <button type="button" className="sale-mobile-only sale-details-toggle" aria-expanded={open}
      aria-controls={id} onClick={() => setOpen(value => !value)}>
      <span>{label}</span><ChevronDown aria-hidden="true" />
    </button>
    <div id={id} className="sale-details-content">{children}</div>
  </div>;
}
function SaleLayout({ invoice, selection, selectionActions, cart, catalog, summary, locked = false }) {
  const SelectionHeading = catalog ? 'h1' : 'h2';
  return (
    <div
      inert={locked ? "" : undefined}
      className="sale-layout grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]"
    >
      <div className="sale-items min-w-0 space-y-6">
        {!catalog && invoice}
        <section className="sale-selection space-y-4 rounded-2xl border border-border bg-card p-5">
          <div className="sale-selection-heading flex items-center gap-2">
            <div className="sale-selection-icon flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-primary">
              <LayoutGrid className="h-4 w-4" />
            </div>
            <SelectionHeading className="text-base font-semibold">{"Agregar productos"}</SelectionHeading>
            {selectionActions && <div className="sale-selection-actions">{selectionActions}</div>}
          </div>
          {selection}
        </section>
        {cart}
        {catalog && invoice}
        {catalog}
      </div>
      <div className="lg:sticky lg:top-24">{summary}</div>
    </div>
  );
}
var DEFAULT_CUSTOMER = "c-000";
function PointOfSalePage() {
  const store = usePosStore();
  const { products, customers, settings, cashSession } = store;
  const [customerId, setCustomerId] = useState(DEFAULT_CUSTOMER);
  const [comprobante, setComprobante] = useState("B02");
  const [condition, setCondition] = useState("contado");
  const [priceLevel, setPriceLevel] = useState(settings.defaultPriceLevel);
  const [items, setItems] = useState([]);
  const [discountPct, setDiscountPct] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("efectivo");
  const [received, setReceived] = useState("");
  const [completed, setCompleted] = useState(null);
  const [receiptOpen, setReceiptOpen] = useState(false);
  const customer = customers.find((c) => c.id === customerId) ?? customers[0];
  const lines = useMemo(
    () => toLines(items, settings.itbisRate / 100),
    [items, settings.itbisRate],
  );
  const totals = useMemo(
    () => computeTotals(lines, discountPct),
    [lines, discountPct],
  );
  const cartQuantities = useMemo(
    () =>
      items.reduce((acc, i) => {
        acc[i.product.id] = (acc[i.product.id] ?? 0) + i.quantity;
        return acc;
      }, {}),
    [items],
  );
  const disabledReason = useMemo(() => {
    if (!cashSession.open) return "La caja está cerrada. Ábrela para facturar.";
    if (comprobante !== "B02" && !customer.rnc)
      return "Selecciona un cliente con RNC para este comprobante.";
    if (condition === "credito" && !customer.creditLimit)
      return "Este cliente no tiene crédito aprobado.";
    if (
      condition === "credito" &&
      customer.balance + totals.total > customer.creditLimit
    )
      return "La venta excede el crédito disponible del cliente.";
    return;
  }, [cashSession.open, comprobante, condition, customer, totals.total]);
  const addProduct = useCallback(
    (product, quantity = 1) => {
      const inCart = items
        .filter((i) => i.product.id === product.id)
        .reduce((s, i) => s + i.quantity, 0);
      if (!settings.allowNegativeStock && inCart + quantity > product.stock) {
        ue.error(
          product.stock === 0
            ? `${product.name} está agotado`
            : `Solo hay ${product.stock} unidades de ${product.name}`,
        );
        return;
      }
      setItems((prev) => {
        const key = `${product.id}-${priceLevel}`;
        const existing = prev.find((i) => i.key === key);
        if (existing) {
          return prev.map((i) =>
            i.key === key
              ? {
                  ...i,
                  quantity: i.quantity + quantity,
                }
              : i,
          );
        }
        return [
          ...prev,
          {
            key,
            product,
            quantity,
            priceLevel,
          },
        ];
      });
    },
    [priceLevel, items, settings.allowNegativeStock],
  );
  const resetSale = () => {
    setItems([]);
    setDiscountPct(0);
    setReceived("");
    setCustomerId(DEFAULT_CUSTOMER);
    setComprobante("B02");
    setCondition("contado");
    setPaymentMethod("efectivo");
  };
  const checkout = () => {
    if (lines.length === 0 || disabledReason) return;
    const isCash = condition === "contado" && paymentMethod === "efectivo";
    const receivedNum = Number(received) || 0;
    if (isCash && receivedNum < totals.total) {
      ue.warning("El monto recibido es menor al total");
      return;
    }
    const sale = store.registerSale({
      customerId: customer.id,
      comprobante,
      condition,
      method: paymentMethod,
      lines: lines.map((l) => ({
        productId: l.product.id,
        code: l.product.code,
        name: l.product.name,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        subtotal: l.subtotal,
        itbis: l.itbis,
      })),
      subtotal: totals.subtotal,
      discount: totals.discount,
      itbis: totals.itbis,
      total: totals.total,
      received: isCash ? receivedNum : undefined,
    });
    setCompleted({
      invoiceNumber: sale.number,
      ncf: sale.ncf,
      itbisRate: settings.itbisRate,
      date: new Date(),
      customerName: customer.name,
      customerRnc: customer.rnc,
      comprobante,
      conditionLabel:
        CONDITIONS.find((c) => c.value === condition)?.label ?? condition,
      paymentLabel:
        condition === "credito"
          ? "Crédito"
          : (PAYMENT_METHODS.find((m) => m.value === paymentMethod)?.label ??
            paymentMethod),
      lines,
      totals,
      received: isCash ? receivedNum : undefined,
    });
    setReceiptOpen(true);
    resetSale();
  };
  const checkoutRef = useRef(checkout);
  checkoutRef.current = checkout;
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "F9") {
        e.preventDefault();
        checkoutRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Facturación / Punto de venta"
        description="Agrega productos, revisa el detalle y cobra en segundos."
        actions={
          <Fragment>
            <Button
              variant="outline"
              className="h-10 rounded-xl bg-card"
              onClick={() => {
                if (items.length === 0) return;
                ue.success("Venta puesta en espera", {
                  description: `${totals.items} unidades guardadas para retomar luego.`,
                });
                resetSale();
              }}
            >
              <CirclePause />
              {"En espera"}
              <span className="rounded-full bg-muted px-1.5 text-[11px] font-semibold">
                {"2"}
              </span>
            </Button>
            <Button
              variant="outline"
              className="h-10 rounded-xl bg-card"
              onClick={resetSale}
            >
              <RotateCcw />
              {"Nueva venta"}
            </Button>
          </Fragment>
        }
      />
      {!cashSession.open && (
        <div className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-accent p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Lock className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-accent-foreground">
                {"La caja está cerrada"}
              </p>
              <p className="text-xs text-accent-foreground/80">
                {"Abre la caja con el fondo inicial para empezar a facturar."}
              </p>
            </div>
          </div>
          <Button asChild={true} className="rounded-xl">
            <Link to="/caja">{"Abrir caja"}</Link>
          </Button>
        </div>
      )}
      <SaleLayout
        invoice={
          <InvoiceSettingsCard
            customers={customers}
            customerId={customerId}
            onCustomerChange={(id) => {
              setCustomerId(id);
              if (id === DEFAULT_CUSTOMER) {
                setComprobante("B02");
                setCondition("contado");
              }
            }}
            comprobante={comprobante}
            onComprobanteChange={setComprobante}
            condition={condition}
            onConditionChange={setCondition}
            nextNcf={store.nextNcf(comprobante)}
          />
        }
        selection={
          <>
            <ProductSearchBar
              products={products}
              priceLevel={priceLevel}
              onPriceLevelChange={setPriceLevel}
              onAdd={addProduct}
            />
            <QuickProductsGrid
              products={products}
              priceLevel={priceLevel}
              onAdd={(p) => addProduct(p, 1)}
              cartQuantities={cartQuantities}
            />
          </>
        }
        cart={
          <CartTable
            lines={lines}
            onQuantityChange={(key, quantity) =>
              setItems((prev) =>
                prev.map((i) =>
                  i.key === key
                    ? {
                        ...i,
                        quantity,
                      }
                    : i,
                ),
              )
            }
            onRemove={(key) =>
              setItems((prev) => prev.filter((i) => i.key !== key))
            }
            onClear={() => setItems([])}
          />
        }
        summary={
          <OrderSummaryPanel
            invoiceNumber={store.nextInvoiceNumber}
            ncf={store.nextNcf(comprobante)}
            itbisRate={settings.itbisRate}
            customerName={customer.name}
            comprobante={comprobante}
            condition={condition}
            totals={totals}
            discountPct={discountPct}
            onDiscountChange={setDiscountPct}
            paymentMethod={paymentMethod}
            onPaymentMethodChange={setPaymentMethod}
            received={received}
            onReceivedChange={setReceived}
            onCheckout={checkout}
            onSaveQuote={() =>
              ue.success("Cotización guardada", {
                description: `Válida por 15 días para ${customer.name}.`,
              })
            }
            onCancel={() => {
              resetSale();
              ue("Venta cancelada");
            }}
            disabledReason={disabledReason}
          />
        }
      />
      <ReceiptDialog
        sale={completed}
        open={receiptOpen}
        onOpenChange={setReceiptOpen}
        onNewSale={() => setReceiptOpen(false)}
        business={settings.business}
        footer={settings.ticketFooter}
      />
    </div>
  );
}
export { PointOfSalePage };

const EMPTY_CATEGORIES = [];
const API_PRICE_LEVELS = { p1: "precio1", p2: "precio2", p3: "precio3" };

export function OperationalPointOfSalePage() {
  const {
    workshopAccounts = [],
    openWorkshopAccount,
    dispatchWorkshopItems,
    returnWorkshopItem,
    cancelWorkshopAccount,
    billWorkshopAccount,
  } = usePosStore();
  const { products, customers, settings, cashSession, runtime, cashCustomer,
    customerId, setCustomerId, comprobante, setComprobante, condition, setCondition,
    paymentMethod, setPaymentMethod, discountMode, setDiscountMode, discountValue, setDiscountValue, discountError,
    discountPercent, setDiscountPercent, received, setReceived, priceLevel, setPriceLevel,
    items, setItems, heldSales, holdCurrentSale, resumeHeldSale, removeHeldSale, openQuote,
    showReceipt, showSaleDocument,
    receipt, failure, sending, customer, lines, totals, cartQuantities,
    locked, disabledReason, resetSale, editQuantity, checkout } = useSaleDraft();
  const [heldOpen, setHeldOpen] = useState(false);
  const [activeWorkshopId, setActiveWorkshopId] = useState(null);
  const [wBusy, setWBusy] = useState(false);
  const [wCustomerId, setWCustomerId] = useState(null);
  const [wComprobante, setWComprobante] = useState("B02");
  const [wCondition, setWCondition] = useState("contado");
  const [wPaymentMethod, setWPaymentMethod] = useState("efectivo");
  const [wDiscountMode, setWDiscountMode] = useState("percent");
  const [wDiscountValue, setWDiscountValue] = useState("");
  const [wReceived, setWReceived] = useState("");

  const openWorkshopAccounts = useMemo(
    () => workshopAccounts.filter((a) => a.status === "abierta"),
    [workshopAccounts],
  );
  const workshopTotalsById = useMemo(() => {
    const map = new Map();
    for (const acc of openWorkshopAccounts) {
      map.set(acc.id, quoteWorkshopItems(acc.items, settings.itbisRate, 0));
    }
    return map;
  }, [openWorkshopAccounts, settings.itbisRate]);
  const activeWorkshop = useMemo(
    () => openWorkshopAccounts.find((a) => a.id === activeWorkshopId) ?? null,
    [openWorkshopAccounts, activeWorkshopId],
  );
  useEffect(() => {
    if (activeWorkshopId !== null && !activeWorkshop) setActiveWorkshopId(null);
  }, [activeWorkshopId, activeWorkshop]);

  const selectWorkshopTab = (acc) => {
    setActiveWorkshopId(acc.id);
    setWCustomerId(acc.customerId);
    setWComprobante("B02");
    setWCondition("contado");
    setWPaymentMethod("efectivo");
    setWDiscountMode("percent");
    setWDiscountValue("");
    setWReceived("");
  };

  const wQuote = useMemo(() => {
    if (!activeWorkshop) return null;
    return quoteWorkshopItems(activeWorkshop.items, settings.itbisRate, {
      mode: wDiscountMode,
      value: wDiscountValue,
    });
  }, [activeWorkshop, settings.itbisRate, wDiscountMode, wDiscountValue]);
  const wCustomer = useMemo(
    () => customers.find((c) => c.id === wCustomerId) ?? cashCustomer,
    [customers, wCustomerId, cashCustomer],
  );
  const wDiscountPercent = wDiscountMode === "percent" ? Number(wDiscountValue) || 0 : 0;
  const setWDiscountPercent = (value) => {
    setWDiscountMode("percent");
    const num = Number(value);
    setWDiscountValue(!value || !Number.isFinite(num) || num <= 0 ? "" : String(value));
  };

  const activeComprobante = activeWorkshop ? wComprobante : comprobante;
  const activeCondition = activeWorkshop ? wCondition : condition;
  const activeCustomer = activeWorkshop ? wCustomer : customer;
  const activeLocked = locked || wBusy;

  const recoveryIssue = runtime.recoveryIssue?.operationId === failure?.operationId ? runtime.recoveryIssue : null;
  const todayIso = businessTodayIso();
  const configuredNcf = !window.__FELIX_DESKTOP__ && (settings.ncf || []).find(s => s.type === activeComprobante && s.active);
  const activeNcf = configuredNcf && configuredNcf.current < configuredNcf.end && configuredNcf.expiresAt >= todayIso ? configuredNcf : null;
  const ncfWarning = configuredNcf && !activeNcf
    ? (configuredNcf.expiresAt < todayIso
      ? `La secuencia NCF ${activeComprobante} venció el ${configuredNcf.expiresAt}. Actualízala en Configuración.`
      : `La secuencia NCF ${activeComprobante} está agotada. Actualízala en Configuración.`)
    : null;
  const nextNcfPreview = activeNcf ? `${activeNcf.prefix}${String(activeNcf.current + 1).padStart(8, "0")}` : null;

  const workshopDisabledReason = useMemo(() => {
    if (!activeWorkshop || !wQuote) return null;
    if (runtime.connection !== "connected") return "Conecta con el servicio para cobrar la cuenta.";
    if (!cashSession?.open) return "La caja está cerrada. Ábrela para cobrar.";
    if (!wCustomer) return "Selecciona un cliente activo.";
    if (wQuote.discountError) return wQuote.discountError;
    if (ncfWarning) return ncfWarning;
    if (wComprobante !== "B02" && !(wCustomer.rnc || "").trim()) return "Selecciona un cliente con RNC.";
    if (wCondition === "credito" && (wCustomer.isCashCustomer || !wCustomer.creditLimit)) {
      return "Selecciona un cliente con crédito aprobado.";
    }
    if (
      wCondition === "credito" &&
      Math.round(wCustomer.balance * 100) + Math.round(wQuote.totals.total * 100) > Math.round(wCustomer.creditLimit * 100)
    ) {
      return "La cuenta excede el crédito disponible del cliente.";
    }
    return null;
  }, [activeWorkshop, wQuote, runtime.connection, cashSession?.open, wCustomer, ncfWarning, wComprobante, wCondition]);

  async function handleCreateWorkshop(label, includeCart) {
    if (wBusy || !runtime.databaseId) return false;
    const pickedCustomer = (!includeCart || !customer || customer.isCashCustomer) ? cashCustomer : customer;
    if (!pickedCustomer) { ue.error("No hay cliente disponible para abrir la cuenta."); return false; }
    setWBusy(true);
    try {
      const payload = {
        databaseId: runtime.databaseId,
        clienteId: pickedCustomer.id,
        ...(pickedCustomer.isCashCustomer ? { clienteNombre: label } : { mecanico: label }),
        ...(includeCart && items.length > 0 ? {
          items: items.map((i) => ({
            productoId: i.product.id,
            versionProducto: i.product.version,
            nivelPrecio: API_PRICE_LEVELS[i.priceLevel] || "precio1",
            cantidad: String(i.quantity),
          })),
        } : {}),
      };
      const snapshot = await openWorkshopAccount(payload);
      if (includeCart && items.length > 0) resetSale();
      const created = snapshot.state.cuentasTaller?.find((a) => a.id === snapshot.result.id);
      setActiveWorkshopId(snapshot.result.id);
      setWCustomerId(created?.clienteId ?? pickedCustomer.id);
      setWComprobante("B02");
      setWCondition("contado");
      setWPaymentMethod("efectivo");
      setWDiscountMode("percent");
      setWDiscountValue("");
      setWReceived("");
      ue.success("Cuenta abierta", { description: label });
      return true;
    } catch (error) {
      ue.error(error.message || "No se pudo abrir la cuenta de taller.");
      return false;
    } finally {
      setWBusy(false);
    }
  }

  async function dispatchToWorkshop(product, qty = 1) {
    if (wBusy || !activeWorkshop || !runtime.databaseId) return false;
    const qtyNum = Number(qty);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      ue.error("Indica una cantidad mayor que cero.");
      return false;
    }
    if (qtyNum > product.stock) {
      ue.error(product.stock === 0 ? `${product.name} está agotado` : `Solo hay ${product.stock} unidades de ${product.name}`);
      return false;
    }
    setWBusy(true);
    try {
      await dispatchWorkshopItems({
        databaseId: runtime.databaseId,
        accountId: activeWorkshop.id,
        version: activeWorkshop.version,
        items: [{
          productoId: product.id,
          versionProducto: product.version,
          nivelPrecio: API_PRICE_LEVELS[priceLevel] || "precio1",
          cantidad: String(qtyNum),
        }],
      });
      ue.success("Despachado", { description: `${qtyNum} × ${product.name}` });
      return true;
    } catch (error) {
      ue.error(error.message || "No se pudo despachar el artículo.");
      return false;
    } finally {
      setWBusy(false);
    }
  }

  async function handleReturnWorkshopItem(line, qty) {
    if (wBusy || !activeWorkshop || !runtime.databaseId) return false;
    setWBusy(true);
    try {
      await returnWorkshopItem({
        databaseId: runtime.databaseId,
        accountId: activeWorkshop.id,
        version: activeWorkshop.version,
        itemId: line.id,
        cantidad: String(qty),
      });
      ue.success("Devuelto al inventario", { description: `${qty} × ${line.name}` });
      return true;
    } catch (error) {
      ue.error(error.message || "No se pudo registrar la devolución.");
      return false;
    } finally {
      setWBusy(false);
    }
  }

  async function handleCancelWorkshop() {
    if (wBusy || !activeWorkshop || !runtime.databaseId) return;
    setWBusy(true);
    try {
      await cancelWorkshopAccount({
        databaseId: runtime.databaseId,
        accountId: activeWorkshop.id,
        version: activeWorkshop.version,
      });
      setActiveWorkshopId(null);
      ue.success("Cuenta cancelada", { description: "Las piezas pendientes regresaron al inventario." });
    } catch (error) {
      ue.error(error.message || "No se pudo cancelar la cuenta.");
    } finally {
      setWBusy(false);
    }
  }

  function printWorkshopStatement() {
    if (!activeWorkshop || !wQuote) return;
    const netLines = wQuote.lines
      .filter((line) => line.netQuantity > 0)
      .map((line) => ({
        key: line.id,
        product: { name: `${line.code} · ${line.name}` },
        quantity: line.netQuantity,
        unitPrice: line.priceExact ?? line.price,
        subtotal: line.subtotal,
      }));
    if (!netLines.length) return;
    showSaleDocument({
      invoiceNumber: `Cuenta taller #${activeWorkshop.id}`,
      dateOnly: todayIso,
      customerName: activeWorkshop.customerName,
      customerRnc: wCustomer?.rnc ?? "",
      mechanic: activeWorkshop.mechanic,
      vehicle: activeWorkshop.vehicle,
      ncf: null,
      comprobante: "Estado",
      itbisRate: settings.itbisRate,
      conditionLabel: "Cuenta abierta",
      paymentLabel: "Pendiente de cobro (No es factura)",
      totals: wQuote.totals,
      lines: netLines,
    }, {
      isQuote: true,
      title: "Estado de cuenta de taller",
      description: "Cuenta abierta en taller. No es factura fiscal.",
    });
  }

  async function checkoutWorkshop() {
    if (wBusy || !activeWorkshop || !wQuote || workshopDisabledReason || wQuote.totals.items <= 0) return;
    const isCash = wCondition === "contado" && wPaymentMethod === "efectivo";
    const receivedNum = Number(wReceived);
    if (isCash && (!Number.isFinite(receivedNum) || receivedNum < wQuote.totals.total)) {
      ue.warning("El monto recibido es menor al total");
      return;
    }
    setWBusy(true);
    try {
      const request = workshopBillRequest(
        activeWorkshop,
        settings,
        wCustomer.id,
        wCondition,
        wComprobante,
        cashSession,
        wPaymentMethod,
        { mode: wDiscountMode, value: wDiscountValue },
      );
      const snapshot = await billWorkshopAccount(request);
      setActiveWorkshopId(null);
      showReceipt(snapshot, isCash ? receivedNum : undefined);
    } catch (error) {
      ue.error(error.message || "No se pudo cobrar la cuenta de taller.");
    } finally {
      setWBusy(false);
    }
  }

  const checkoutRef = useRef(null);
  checkoutRef.current = () => {
    if (activeWorkshop) checkoutWorkshop();
    else if (!ncfWarning) checkout();
  };
  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "F9") {
        event.preventDefault();
        if (!event.repeat) checkoutRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="pos-sale space-y-6">
      {(failure || sending) && (
        <div
          role={failure ? "alert" : "status"}
          className="space-y-2 rounded-xl border border-border bg-card p-4 text-sm"
        >
          <p>{sending ? "Confirmando la venta…" : runtime.recovering && failure?.retry ? "Comprobando la venta…" :
            recoveryIssue ? recoveryIssue.message : failure?.retry && !failure.recoveryStopped ? "La venta está pendiente de confirmación. Conservamos la solicitud para evitar duplicarla." : failure.message}</p>
          {failure?.retry && (
            <Button
              disabled={sending || runtime.busy || runtime.recovering}
              variant="outline"
              onClick={() => checkout(true)}
            >
              Reintentar venta
            </Button>
          )}
        </div>
      )}
      {!cashSession?.open && <div className="flex flex-col gap-3 rounded-2xl border border-primary/30 bg-accent p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground"><Lock className="h-4 w-4" /></div>
          <div><p className="text-sm font-semibold text-accent-foreground">La caja está cerrada</p>
            <p className="text-xs text-accent-foreground/80">Abre la caja con el fondo inicial para empezar a facturar.</p></div>
        </div>
        <Button asChild className="min-h-11 rounded-xl"><Link to="/caja">Abrir caja</Link></Button>
      </div>}
      <WorkshopTabsBar
        openAccounts={openWorkshopAccounts}
        totalsById={workshopTotalsById}
        activeWorkshopId={activeWorkshop?.id ?? null}
        activeWorkshop={activeWorkshop}
        cartCount={items.length}
        busy={activeLocked}
        disabled={runtime.connection !== "connected"}
        onSelectNormal={() => setActiveWorkshopId(null)}
        onSelectWorkshop={selectWorkshopTab}
        onCreateWorkshop={handleCreateWorkshop}
        onPrintStatement={printWorkshopStatement}
        onCancelWorkshop={handleCancelWorkshop}
      />
      <SaleLayout
        locked={activeLocked}
        selectionActions={!activeWorkshop ? <>
          <Button
            disabled={locked || (!items.length && !heldSales.length)}
            variant="outline"
            className="h-11 rounded-xl bg-card"
            onClick={() => {
              if (!heldSales.length && items.length) {
                holdCurrentSale();
              } else {
                setHeldOpen(true);
              }
            }}
          >
            <CirclePause />
            <span>En espera</span>
            {heldSales.length > 0 && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-semibold tabular-nums">
                {heldSales.length}
              </span>
            )}
          </Button>
          <Button disabled={locked} variant="outline" className="h-11 rounded-xl bg-card" onClick={resetSale}>
            <RotateCcw />
            <span className="sale-desktop-only">Nueva venta</span><span className="sale-mobile-only">Limpiar</span>
          </Button>
        </> : null}
        invoice={
          <MobileSaleDetails label={`Datos de factura · ${activeCustomer?.name ?? "Seleccionar cliente"} · ${activeCondition === "contado" ? "Contado" : "Crédito"}`}>
          <InvoiceSettingsCard
            operational
            customers={customers}
            customerId={activeWorkshop ? wCustomerId : customerId}
            onCustomerChange={(id) => {
              if (activeWorkshop) {
                setWCustomerId(id);
                if (id === cashCustomer?.id) {
                  setWCondition("contado");
                  setWComprobante("B02");
                }
              } else {
                setCustomerId(id);
                if (id === cashCustomer?.id) {
                  setCondition("contado");
                  setComprobante("B02");
                }
              }
            }}
            comprobante={activeComprobante}
            onComprobanteChange={activeWorkshop ? setWComprobante : setComprobante}
            condition={activeCondition}
            onConditionChange={activeWorkshop ? setWCondition : setCondition}
            nextNcf={nextNcfPreview}
            ncfWarning={ncfWarning}
          />
          </MobileSaleDetails>
        }
        selection={
            <ProductSearchBar
              operational
              disabled={activeLocked || !!receipt}
              products={products}
              priceLevel={priceLevel}
              onPriceLevelChange={setPriceLevel}
              onAdd={(p, qty) => (activeWorkshop ? dispatchToWorkshop(p, qty) : editQuantity(p, priceLevel, qty))}
            />
        }
        catalog={
          <section className="sale-product-catalog rounded-2xl border border-border bg-card p-5">
            <MobileSaleDetails label="Ver catálogo de productos">
            <h2 className="sale-desktop-only mb-4 text-base font-semibold">Catálogo de productos</h2>
            <QuickProductsGrid
              products={products}
              categories={EMPTY_CATEGORIES}
              pageSize={8}
              priceLevel={priceLevel}
              onAdd={(p) => (activeWorkshop ? dispatchToWorkshop(p, 1) : editQuantity(p, priceLevel, 1))}
              cartQuantities={activeWorkshop ? {} : cartQuantities}
            />
            </MobileSaleDetails>
          </section>
        }
        cart={
          activeWorkshop ? (
            <WorkshopItemsTable
              account={activeWorkshop}
              lines={wQuote?.lines ?? []}
              busy={wBusy}
              onReturnItem={handleReturnWorkshopItem}
            />
          ) : (
            <CartTable
              lines={lines}
              onQuantityChange={(key, quantity) => {
                const item = items.find((row) => row.key === key);
                editQuantity(item.product, item.priceLevel, quantity, true);
              }}
              onRemove={(key) =>
                setItems((prev) => prev.filter((row) => row.key !== key))
              }
              onClear={() => setItems([])}
            />
          )
        }
        summary={
          <OrderSummaryPanel
            operational
            invoiceNumber={activeWorkshop ? `Cuenta taller #${activeWorkshop.id}` : "Pendiente de registro"}
            customerName={activeWorkshop ? activeWorkshop.customerName : customer?.name}
            comprobante={activeComprobante}
            condition={activeCondition}
            totals={activeWorkshop ? (wQuote?.totals ?? totals) : totals}
            discountPct={activeWorkshop ? wDiscountPercent : discountPercent}
            onDiscountChange={activeWorkshop ? setWDiscountPercent : setDiscountPercent}
            discountMode={activeWorkshop ? wDiscountMode : discountMode}
            onDiscountModeChange={activeWorkshop ? setWDiscountMode : setDiscountMode}
            discountValue={activeWorkshop ? wDiscountValue : discountValue}
            onDiscountValueChange={activeWorkshop ? setWDiscountValue : setDiscountValue}
            discountError={activeWorkshop ? wQuote?.discountError : discountError}
            paymentMethod={activeWorkshop ? wPaymentMethod : paymentMethod}
            onPaymentMethodChange={activeWorkshop ? setWPaymentMethod : setPaymentMethod}
            received={activeWorkshop ? wReceived : received}
            onReceivedChange={activeWorkshop ? setWReceived : setReceived}
            itbisRate={settings.itbisRate}
            ncf={nextNcfPreview}
            onSaveQuote={activeWorkshop ? printWorkshopStatement : openQuote}
            onCancel={activeWorkshop ? () => setActiveWorkshopId(null) : resetSale}
            disabledReason={activeWorkshop ? workshopDisabledReason : (disabledReason || ncfWarning)}
            onCheckout={activeWorkshop ? checkoutWorkshop : () => checkout()}
          />
        }
      />
      <Dialog open={heldOpen} onOpenChange={setHeldOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Ventas en espera</DialogTitle>
            <DialogDescription>Borradores guardados en este dispositivo. No descuentan inventario hasta facturarlos.</DialogDescription>
          </DialogHeader>
          {items.length > 0 && (
            <Button
              variant="outline"
              className="h-11 w-full rounded-xl bg-card"
              onClick={() => { holdCurrentSale(); setHeldOpen(false); }}
            >
              <CirclePause />
              {"Poner venta actual en espera"}
            </Button>
          )}
          {heldSales.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No hay ventas en espera.</p>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto">
              {heldSales.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{entry.customerName}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {entry.items.length} {entry.items.length === 1 ? "línea" : "líneas"} · {formatMoney(entry.total)}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button
                      size="sm"
                      className="h-10 rounded-xl"
                      onClick={() => { resumeHeldSale(entry.id); setHeldOpen(false); }}
                    >
                      <Play className="h-3.5 w-3.5" />
                      {"Retomar"}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-10 w-10 rounded-xl text-muted-foreground hover:text-primary"
                      aria-label={`Eliminar venta en espera de ${entry.customerName}`}
                      onClick={() => removeHeldSale(entry.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}

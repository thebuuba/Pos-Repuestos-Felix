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
import { CirclePause, RotateCcw, Lock, ChevronDown, LayoutGrid, Printer } from "lucide-react";
import { Link } from "react-router-dom";
import { InvoiceSettingsCard } from "../components/pos/invoice-settings-card.jsx";
import { HeldSalesDialog } from "../components/pos/held-sales-dialog.jsx";
import { SalesHistoryDialog } from "../components/pos/sales-history-dialog.jsx";
import { receiptFromStoredSale } from "../data/operational-sales.js";
import { businessTodayIso } from "../lib/dates.js";
import { ProductSearchBar } from "../components/pos/product-search-bar.jsx";
import { QuickProductsGrid } from "../components/pos/quick-products-grid.jsx";
import { CartTable } from "../components/pos/cart-table.jsx";
import { OrderSummaryPanel } from "../components/pos/order-summary-panel.jsx";
import { ReceiptDialog } from "../components/pos/receipt-dialog.jsx";
import {
  focusFirstSelector,
  hasOpenModal,
  isPlainAlt,
  isTouchMobile,
} from "../data/keyboard-shortcuts.js";
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
function SaleLayout({ operational = false, invoice, selection, selectionActions, cart, catalog, summary, locked = false }) {
  const SelectionHeading = operational ? 'h1' : 'h2';
  return (
    <div
      inert={locked ? "" : undefined}
      className="sale-layout grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]"
    >
      <div className="sale-items min-w-0 space-y-6">
        {!operational && invoice}
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
        {!operational && catalog}
      </div>
      <div className="sale-summary-rail lg:sticky lg:top-24">{summary}</div>
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

export function OperationalPointOfSalePage() {
  const { sales } = usePosStore();
  const { products, customers, settings, cashSession, runtime, cashCustomer,
    customerId, setCustomerId, comprobante, setComprobante, condition, setCondition,
    paymentMethod, setPaymentMethod, discountMode, setDiscountMode, discountValue, setDiscountValue, discountError,
    discountPercent, setDiscountPercent, received, setReceived, priceLevel, setPriceLevel,
    items, setItems, heldSales, activeHoldLabel, holdCurrentSale, resumeHeldSale, renameHeldSale, removeHeldSale, openQuote,
    receipt, failure, sending, customer, lines, totals,
    locked, disabledReason, resetSale, editQuantity, checkout } = useSaleDraft();
  const [heldOpen, setHeldOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [reprintSale, setReprintSale] = useState(null);

  const recoveryIssue = runtime.recoveryIssue?.operationId === failure?.operationId ? runtime.recoveryIssue : null;
  const todayIso = businessTodayIso();
  const configuredNcf = !window.__FELIX_DESKTOP__ && (settings.ncf || []).find(s => s.type === comprobante && s.active);
  const activeNcf = configuredNcf && configuredNcf.current < configuredNcf.end && configuredNcf.expiresAt >= todayIso ? configuredNcf : null;
  const ncfWarning = configuredNcf && !activeNcf
    ? (configuredNcf.expiresAt < todayIso
      ? `La secuencia NCF ${comprobante} venció el ${configuredNcf.expiresAt}. Actualízala en Configuración.`
      : `La secuencia NCF ${comprobante} está agotada. Actualízala en Configuración.`)
    : null;
  const nextNcfPreview = activeNcf ? `${activeNcf.prefix}${String(activeNcf.current + 1).padStart(8, "0")}` : null;
  const wasOverlayOpenRef = useRef(false);
  const anyOverlayOpen = Boolean(receipt || heldOpen || historyOpen || reprintSale);
  useEffect(() => {
    if (wasOverlayOpenRef.current && !anyOverlayOpen && !locked && !isTouchMobile()) {
      window.requestAnimationFrame(() => focusFirstSelector("[data-sale-search]"));
    }
    wasOverlayOpenRef.current = anyOverlayOpen;
  }, [anyOverlayOpen, locked]);
  const checkoutRef = useRef(null);
  checkoutRef.current = () => {
    if (failure?.retry) {
      if (!sending && !runtime.busy && !runtime.recovering) checkout(true);
      return;
    }
    if (!ncfWarning) checkout();
  };
  const shortcutStateRef = useRef(null);
  shortcutStateRef.current = {
    locked,
    sending,
    lines,
    totals,
    priceLevel,
    setPriceLevel,
    condition,
    setCondition,
    paymentMethod,
    setPaymentMethod,
    comprobante,
    setComprobante,
    setReceived,
    setHeldOpen,
    openQuote,
    resetSale,
  };
  useEffect(() => {
    const LEVEL_ORDER = ["p1", "p2", "p3"];
    const LEVEL_NAMES = { p1: "Precio 1 · Detalle", p2: "Precio 2 · Mayor", p3: "Precio 3 · Taller" };
    const METHOD_ORDER = ["efectivo", "tarjeta", "transferencia"];
    const METHOD_NAMES = { efectivo: "Efectivo", tarjeta: "Tarjeta", transferencia: "Transferencia" };
    const COMP_ORDER = ["B02", "B01", "B14"];
    const COMP_NAMES = { B02: "B02 · Consumo final", B01: "B01 · Crédito fiscal", B14: "B14 · Regímenes especiales" };

    const onKey = (event) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (hasOpenModal()) return;
      const st = shortcutStateRef.current;
      const noMods = !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;

      if (event.key === "F9" && noMods) {
        event.preventDefault();
        if (event.repeat) return;
        const active = document.activeElement;
        if (active instanceof HTMLElement && active.classList.contains("sale-cart-qty-input")) {
          active.blur();
          window.setTimeout(() => checkoutRef.current(), 0);
          return;
        }
        checkoutRef.current();
        return;
      }
      if (st.locked) return;

      if (event.key === "F3" && noMods) {
        event.preventDefault();
        if (event.repeat) return;
        if (!focusFirstSelector(".sale-cart-qty-input", { select: true })) {
          focusFirstSelector("[data-sale-search-qty]", { select: true });
        }
        return;
      }
      if (event.key === "F4" && noMods) {
        event.preventDefault();
        if (event.repeat) return;
        const next = LEVEL_ORDER[(LEVEL_ORDER.indexOf(st.priceLevel) + 1) % LEVEL_ORDER.length];
        st.setPriceLevel(next);
        ue(LEVEL_NAMES[next]);
        return;
      }
      if (event.key === "F6" && noMods) {
        event.preventDefault();
        if (event.repeat) return;
        st.setHeldOpen(true);
        return;
      }
      if (event.key === "F7" && noMods) {
        event.preventDefault();
        if (event.repeat) return;
        if (st.condition !== "contado") {
          st.setCondition("contado");
          st.setPaymentMethod("efectivo");
          ue("Pago: Contado · Efectivo");
          return;
        }
        const next = METHOD_ORDER[(METHOD_ORDER.indexOf(st.paymentMethod) + 1) % METHOD_ORDER.length];
        st.setPaymentMethod(next);
        ue(`Método de pago: ${METHOD_NAMES[next]}`);
        return;
      }
      if (event.key === "F8" && noMods) {
        event.preventDefault();
        if (event.repeat) return;
        if (st.condition !== "contado") st.setCondition("contado");
        if (st.paymentMethod !== "efectivo") st.setPaymentMethod("efectivo");
        const active = document.activeElement;
        if (active instanceof HTMLElement && active.hasAttribute("data-sale-received")) {
          if (st.totals.total > 0) {
            st.setReceived(String(st.totals.total));
            window.requestAnimationFrame(() => focusFirstSelector("[data-sale-received]", { select: true }));
          }
          return;
        }
        window.requestAnimationFrame(() => focusFirstSelector("[data-sale-received]", { select: true }));
        return;
      }
      if (event.key === "F10" && noMods) {
        event.preventDefault();
        if (event.repeat) return;
        if (st.lines.length > 0) st.openQuote();
        return;
      }
      if (isPlainAlt(event)) {
        if (event.code === "KeyE") {
          event.preventDefault();
          if (event.repeat || st.totals.total <= 0) return;
          if (st.condition !== "contado") st.setCondition("contado");
          if (st.paymentMethod !== "efectivo") st.setPaymentMethod("efectivo");
          st.setReceived(String(st.totals.total));
          window.requestAnimationFrame(() => focusFirstSelector("[data-sale-received]", { select: true }));
          return;
        }
        if (event.code === "KeyC") {
          event.preventDefault();
          if (event.repeat) return;
          const trigger = document.querySelector("[data-sale-customer]");
          if (trigger instanceof HTMLElement) {
            trigger.focus();
            trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
          }
          return;
        }
        if (event.code === "KeyB") {
          event.preventDefault();
          if (event.repeat) return;
          const next = COMP_ORDER[(COMP_ORDER.indexOf(st.comprobante) + 1) % COMP_ORDER.length];
          st.setComprobante(next);
          ue(`Comprobante: ${COMP_NAMES[next]}`);
          return;
        }
        if (event.code === "KeyK") {
          event.preventDefault();
          if (event.repeat) return;
          const next = st.condition === "contado" ? "credito" : "contado";
          st.setCondition(next);
          ue(`Condición: ${next === "contado" ? "Contado" : "Crédito"}`);
          return;
        }
        if (event.code === "KeyD") {
          event.preventDefault();
          if (event.repeat) return;
          focusFirstSelector("[data-sale-discount]", { select: true });
          return;
        }
      }
    };
    const onShortcut = (event) => {
      if (event.detail?.action === "primary-new") {
        const st = shortcutStateRef.current;
        if (st.locked || st.sending) return;
        event.preventDefault();
        st.resetSale();
        if (!isTouchMobile()) {
          window.requestAnimationFrame(() => focusFirstSelector("[data-sale-search]"));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("felix:shortcut", onShortcut);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("felix:shortcut", onShortcut);
    };
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
      <SaleLayout
        operational
        locked={locked}
        selectionActions={<>
          {activeHoldLabel && items.length > 0 && (
            <span className="inline-flex h-8 items-center rounded-xl bg-accent px-2.5 text-xs font-medium text-accent-foreground">
              {activeHoldLabel}
            </span>
          )}
          <Button
            disabled={locked || !sales?.length}
            variant="outline"
            size="icon"
            className="sale-history-btn h-11 w-11 rounded-xl bg-card"
            onClick={() => setHistoryOpen(true)}
            title="Facturas recientes / Reimprimir"
            aria-label="Facturas recientes y reimpresión"
          >
            <Printer className="h-4 w-4" />
          </Button>
          <Button
            disabled={locked || (!items.length && !heldSales.length)}
            variant="outline"
            className="h-11 rounded-xl bg-card"
            onClick={() => setHeldOpen(true)}
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
        </>}
        selection={
          <ProductSearchBar
            operational
            disabled={locked || !!receipt}
            products={products}
            priceLevel={priceLevel}
            onPriceLevelChange={setPriceLevel}
            onAdd={(p, qty) => editQuantity(p, priceLevel, qty)}
          />
        }
        cart={
          <CartTable
            operational
            lines={lines}
            onQuantityChange={(key, quantity) => {
              const item = items.find((row) => row.key === key);
              return item ? editQuantity(item.product, item.priceLevel, quantity, true) : false;
            }}
            onRemove={(key) =>
              setItems((prev) => prev.filter((row) => row.key !== key))
            }
            onClear={() => setItems([])}
          />
        }
        summary={
          <OrderSummaryPanel
            operational
            invoiceSlot={
              <MobileSaleDetails label={`Datos de factura · ${customer?.name ?? "Seleccionar cliente"} · ${condition === "contado" ? "Contado" : "Crédito"}`}>
                <InvoiceSettingsCard
                  operational
                  embedded
                  customers={customers}
                  customerId={customerId}
                  onCustomerChange={(id) => {
                    setCustomerId(id);
                    if (id === cashCustomer?.id) {
                      setCondition("contado");
                      setComprobante("B02");
                    }
                  }}
                  comprobante={comprobante}
                  onComprobanteChange={setComprobante}
                  condition={condition}
                  onConditionChange={setCondition}
                  nextNcf={nextNcfPreview}
                  ncfWarning={ncfWarning}
                />
              </MobileSaleDetails>
            }
            invoiceNumber="Pendiente de registro"
            customerName={activeHoldLabel || customer?.name}
            comprobante={comprobante}
            condition={condition}
            totals={totals}
            discountPct={discountPercent}
            onDiscountChange={setDiscountPercent}
            discountMode={discountMode}
            onDiscountModeChange={setDiscountMode}
            discountValue={discountValue}
            onDiscountValueChange={setDiscountValue}
            discountError={discountError}
            paymentMethod={paymentMethod}
            onPaymentMethodChange={setPaymentMethod}
            received={received}
            onReceivedChange={setReceived}
            itbisRate={settings.itbisRate}
            ncf={nextNcfPreview}
            onSaveQuote={openQuote}
            onCancel={resetSale}
            disabledReason={disabledReason || ncfWarning}
            onCheckout={() => checkout()}
          />
        }
      />
      <HeldSalesDialog
        open={heldOpen}
        onOpenChange={setHeldOpen}
        hasCurrentItems={items.length > 0}
        currentItemCount={items.length}
        currentTotal={totals.total}
        customer={customer}
        activeHoldLabel={activeHoldLabel}
        heldSales={heldSales}
        onHoldCurrent={holdCurrentSale}
        onResume={resumeHeldSale}
        onRename={renameHeldSale}
        onRemove={removeHeldSale}
      />
      <SalesHistoryDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        sales={sales}
        onSelect={(sale) => {
          setHistoryOpen(false);
          setReprintSale(sale);
        }}
      />
      <ReceiptDialog
        sale={receiptFromStoredSale(reprintSale)}
        open={Boolean(reprintSale)}
        onOpenChange={(open) => { if (!open) setReprintSale(null); }}
        onNewSale={() => setReprintSale(null)}
        business={settings.business}
        printFormat={settings.printer ?? "Térmica 80 mm"}
        footer={settings.ticketFooter}
        isReprint
      />
    </div>
  );
}

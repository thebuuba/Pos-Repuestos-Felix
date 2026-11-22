// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { usePosStore } from "../../data/pos-context.jsx";
import {
  quoteSale,
  updateSaleLine,
  receiptFromConfirmation,
  saleRequest,
} from "../../data/operational-sales.js";
import { toLines } from "../lib/cart.js";
import { computeTotals } from "../lib/cart.js";
import { toast as ue } from "sonner";
import { CONDITIONS } from "../../data/sales-options.js";
import { PAYMENT_METHODS } from "../../data/sales-options.js";
import { PageHeader } from "../components/page-header.jsx";
import { Button } from "../../components/ui/button.jsx";
import { CirclePause } from "lucide-react";
import { RotateCcw } from "lucide-react";
import { Lock } from "lucide-react";
import { Link } from "react-router-dom";
import { InvoiceSettingsCard } from "../components/invoice-settings-card.jsx";
import { LayoutGrid } from "lucide-react";
import { ProductSearchBar } from "../components/product-search-bar.jsx";
import { QuickProductsGrid } from "../components/quick-products-grid.jsx";
import { CartTable } from "../components/cart-table.jsx";
import { OrderSummaryPanel } from "../components/order-summary-panel.jsx";
import { ReceiptDialog } from "../components/receipt-dialog.jsx";
import { Fragment } from "react";
import { useCallback } from "react";
import { useEffect } from "react";
import { useMemo } from "react";
import { useRef } from "react";
import { useState } from "react";
function SaleLayout({ invoice, selection, cart, summary, locked = false }) {
  return (
    <div
      inert={locked ? "" : undefined}
      className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]"
    >
      <div className="min-w-0 space-y-6">
        {invoice}
        <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-primary">
              <LayoutGrid className="h-4 w-4" />
            </div>
            <h2 className="text-base font-semibold">{"Agregar productos"}</h2>
          </div>
          {selection}
        </section>
        {cart}
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

export function OperationalPointOfSalePage() {
  const { products, customers, categories, settings, cashSession, runtime, registerSale } =
    usePosStore();
  const cashCustomer = customers.find((row) => row.isCashCustomer);
  const [customerId, setCustomerId] = useState(() => cashCustomer?.id ?? null);
  const [comprobante, setComprobante] = useState("B02");
  const [condition, setCondition] = useState("contado");
  const [paymentMethod, setPaymentMethod] = useState("efectivo");
  const [received, setReceived] = useState("");
  const [priceLevel, setPriceLevel] = useState(
    settings.defaultPriceLevel ?? "p1",
  );
  const [items, setItems] = useState([]);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [receipt, setReceipt] = useState(null);
  const [failure, setFailure] = useState(null);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);
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
  const locked = sending || !!failure?.retry || !!runtime.pending || runtime.busy;
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

  function resetSale() {
    itemsRef.current = [];
    setItems([]);
    setCustomerId(cashCustomer?.id ?? null);
    setComprobante("B02");
    setCondition("contado");
    setPaymentMethod("efectivo");
    setReceived("");
    setFailure(null);
  }
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
    try {
      const snapshot = retry
        ? await failure.retry()
        : await registerSale(
            saleRequest(items, settings, customerId, condition, comprobante, cashSession, paymentMethod),
          );
      const config = snapshot.state.configuracion;
      setReceipt({
        sale: receiptFromConfirmation(snapshot),
        footer: config.pieTicket,
        printFormat: config.formatoImpresion ?? "Térmica 80 mm",
        business: {
          name: config.empresa,
          rnc: config.rnc,
          address: config.direccion,
          phone: config.tel,
        },
      });
      resetSale();
    } catch (error) {
      // An exact retry can fail before sending, for example on a database change.
      // Keep its original operation while its outcome is uncertain.
      setFailure({
        message: error.message,
        retry:
          error.retry ?? (retry && !error.definitive ? failure.retry : null),
      });
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }
  const checkoutRef = useRef(null);
  checkoutRef.current = () => checkout();
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
    <div className="space-y-6">
      <PageHeader
        title="Facturación / Punto de venta"
        description="Agrega productos, revisa el detalle y registra la venta."
        actions={
          <>
            <Button
              disabled
              variant="outline"
              className="h-10 rounded-xl bg-card"
              title="Ventas en espera no disponibles"
            >
              <CirclePause />
              En espera
            </Button>
            <Button
              disabled={locked}
              variant="outline"
              className="h-10 rounded-xl bg-card"
              onClick={resetSale}
            >
              <RotateCcw />
              Nueva venta
            </Button>
          </>
        }
      />
      {(failure || sending) && (
        <div
          role={failure ? "alert" : "status"}
          className="space-y-2 rounded-xl border border-border bg-card p-4 text-sm"
        >
          <p>{sending ? "Confirmando la venta…" : failure.message}</p>
          {failure?.retry && (
            <Button
              disabled={sending || runtime.busy}
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
        <Button asChild className="rounded-xl"><Link to="/caja">Abrir caja</Link></Button>
      </div>}
      <SaleLayout
        locked={locked}
        invoice={
          <InvoiceSettingsCard
            operational
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
          />
        }
        selection={
          <>
            <ProductSearchBar
              operational
              disabled={locked || !!receipt}
              products={products}
              priceLevel={priceLevel}
              onPriceLevelChange={setPriceLevel}
              onAdd={(p, qty) => editQuantity(p, priceLevel, qty)}
            />
            <QuickProductsGrid
              products={products}
              categories={categories}
              priceLevel={priceLevel}
              onAdd={(p) => editQuantity(p, priceLevel, 1)}
              cartQuantities={cartQuantities}
            />
          </>
        }
        cart={
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
        }
        summary={
          <OrderSummaryPanel
            operational
            invoiceNumber="Pendiente de registro"
            customerName={customer?.name}
            comprobante={comprobante}
            condition={condition}
            totals={totals}
            discountPct={0}
            paymentMethod={paymentMethod}
            onPaymentMethodChange={setPaymentMethod}
            received={received}
            onReceivedChange={setReceived}
            itbisRate={settings.itbisRate}
            onCancel={resetSale}
            disabledReason={disabledReason}
            onCheckout={() => checkout()}
          />
        }
      />
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
    </div>
  );
}

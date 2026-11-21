// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { usePosStore } from "../../data/pos-context.jsx";
import { toLines } from "../lib/cart.js";
import { computeTotals } from "../lib/cart.js";
import { toast as ue } from "sonner";
import { CONDITIONS } from "../data/pos-data.js";
import { PAYMENT_METHODS } from "../data/pos-data.js";
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
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-6">
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
          <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-primary">
                <LayoutGrid className="h-4 w-4" />
              </div>
              <h2 className="text-base font-semibold">{"Agregar productos"}</h2>
            </div>
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
          </section>
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
        </div>
        <div className="lg:sticky lg:top-24">
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
        </div>
      </div>
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

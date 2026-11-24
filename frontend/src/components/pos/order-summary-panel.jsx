// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { Banknote } from "lucide-react";
import { CreditCard } from "lucide-react";
import { ArrowLeftRight } from "lucide-react";
import { formatCashMoney, formatMoney } from "../../lib/format.js";
import { cn } from "../../lib/utils.js";
import { MoneyDisplay } from "./money-display.jsx";
import { Label } from "../ui/label.jsx";
import { Input } from "../ui/input.jsx";
import { Button } from "../ui/button.jsx";
import { Printer } from "lucide-react";
import { FileClock } from "lucide-react";
import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { focusFirstSelector, isTouchMobile } from "../../data/keyboard-shortcuts.js";
var METHODS = [
  {
    value: "efectivo",
    label: "Efectivo",
    icon: Banknote,
  },
  {
    value: "tarjeta",
    label: "Tarjeta",
    icon: CreditCard,
  },
  {
    value: "transferencia",
    label: "Transfer.",
    icon: ArrowLeftRight,
  },
];
var DISCOUNTS = [0, 5, 10, 15];
function OrderSummaryPanel({
  operational = false,
  invoiceSlot = null,
  invoiceNumber,
  customerName,
  comprobante,
  condition,
  totals,
  discountPct,
  onDiscountChange,
  discountMode = "percent",
  onDiscountModeChange,
  discountValue,
  onDiscountValueChange,
  discountError,
  paymentMethod,
  onPaymentMethodChange,
  received,
  onReceivedChange,
  onCheckout,
  onSaveQuote,
  onCancel,
  disabledReason,
  itbisRate = 18,
  ncf,
}) {
  const empty = totals.items === 0;
  const [paymentOpen, setPaymentOpen] = useState(false);
  const paymentId = useId();
  const summaryRef = useRef(null);
  useEffect(() => { if (empty) setPaymentOpen(false); }, [empty]);
  const isCash = condition === "contado" && paymentMethod === "efectivo";
  const receivedNum = Number(received) || 0;
  const change = receivedNum - totals.total;
  const hasChangeToReturn = !empty && Math.round(change * 100) > 0;
  const insufficient = isCash && !empty && receivedNum < totals.total;
  const showCashBalance = !operational || insufficient || hasChangeToReturn;
  const quickAmounts = [totals.total, 50, 100, 200, 500, 1000, 2000];
  const blocked = empty || insufficient || Boolean(disabledReason);
  return (
    <section ref={summaryRef} data-payment-open={paymentOpen} className="sale-summary flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
      {operational && invoiceSlot ? (
        <div className="sale-summary-invoice">{invoiceSlot}</div>
      ) : !operational ? (
        <div className="sale-summary-heading flex items-start justify-between gap-3 border-b border-dashed border-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{"Factura"}</p>
            <p className="text-lg font-semibold tracking-tight">
              {invoiceNumber}
            </p>
          </div>
          <div className="min-w-0 text-right">
            <p className="truncate text-sm font-medium">{customerName}</p>
            <p className="text-xs text-muted-foreground">
              {comprobante}
              {" · "}
              {condition === "contado" ? "Contado" : "Crédito"}
            </p>
            {ncf && (
              <p className="font-mono text-[11px] text-muted-foreground">
                {"NCF "}
                {ncf}
              </p>
            )}
          </div>
        </div>
      ) : null}
      <div className="sale-summary-breakdown space-y-2.5 px-5 py-4 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">
            {operational && totals.discount > 0 && totals.grossTotal > 0 ? "Subtotal bruto (" : "Subtotal ("}
            {totals.items}
            {" uds.)"}
          </span>
          <span className="font-medium tabular-nums">
            {formatMoney(operational && totals.discount > 0 && totals.grossTotal > 0 ? totals.grossTotal : totals.subtotal)}
          </span>
        </div>
        <div className={cn("sale-summary-discounts", operational ? "sale-discount-compact" : "space-y-2")}>
          <div className="sale-discount-presets flex items-center justify-between gap-2">
            <span className="text-muted-foreground">{"Descuento"}</span>
            <div className="flex items-center gap-1">
              {DISCOUNTS.map((d) => {
                const active =
                  discountMode === "percent" &&
                  (d === 0
                    ? (discountValue === undefined ? discountPct === 0 : discountValue === "" || Number(discountValue) === 0)
                    : (discountValue === undefined ? discountPct === d : Number(discountValue) === d));
                return (
                  <button
                    type="button"
                    disabled={!onDiscountChange && !onDiscountValueChange}
                    onClick={() => {
                      if (onDiscountModeChange && onDiscountValueChange) {
                        onDiscountModeChange("percent");
                        onDiscountValueChange(d === 0 ? "" : String(d));
                      } else {
                        onDiscountChange?.(d);
                      }
                    }}
                    className={cn(
                      "h-6 rounded-md px-1.5 text-[11px] font-semibold transition-colors",
                      active
                        ? "bg-foreground text-background"
                        : "bg-muted text-muted-foreground hover:text-foreground",
                    )}
                    key={d}
                  >
                    {d}
                    {"%"}
                  </button>
                );
              })}
            </div>
          </div>
          {operational && (onDiscountValueChange || onDiscountChange) && (
            <div className="sale-summary-discount-custom flex items-center gap-1.5">
              {onDiscountModeChange && (
                <div
                  onClick={() => {
                    onDiscountModeChange(discountMode === "percent" ? "amount" : "percent");
                    onDiscountValueChange?.("");
                  }}
                  title={discountMode === "percent" ? "Cambiar a descuento en RD$" : "Cambiar a descuento en %"}
                  className="sale-discount-mode-toggle flex shrink-0 cursor-pointer rounded-lg bg-muted p-0.5"
                >
                  <button
                    type="button"
                    aria-label="Descuento en porcentaje"
                    aria-pressed={discountMode === "percent"}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDiscountModeChange(discountMode === "percent" ? "amount" : "percent");
                      onDiscountValueChange?.("");
                    }}
                    className={cn(
                      "h-7 rounded-md px-2 text-[11px] font-semibold transition-colors",
                      discountMode === "percent"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {"%"}
                  </button>
                  <button
                    type="button"
                    aria-label="Descuento en pesos"
                    aria-pressed={discountMode === "amount"}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDiscountModeChange(discountMode === "percent" ? "amount" : "percent");
                      onDiscountValueChange?.("");
                    }}
                    className={cn(
                      "h-7 rounded-md px-2 text-[11px] font-semibold transition-colors",
                      discountMode === "amount"
                        ? "bg-card text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {"RD$"}
                  </button>
                </div>
              )}
              <Input
                type="number"
                inputMode="decimal"
                data-sale-discount="true"
                min="0"
                max={discountMode === "percent" ? "100" : undefined}
                step="0.01"
                aria-label="Descuento personalizado"
                aria-invalid={Boolean(discountError)}
                value={
                  discountValue !== undefined
                    ? discountValue
                    : discountPct > 0
                      ? String(discountPct)
                      : ""
                }
                onChange={(e) => {
                  const val = e.target.value;
                  if (onDiscountValueChange) onDiscountValueChange(val);
                  else onDiscountChange?.(val === "" ? 0 : Math.min(100, Math.max(0, Number(val) || 0)));
                }}
                onKeyDown={(e) => {
                  if (operational && (e.key === "Enter" || e.key === "Escape")) {
                    e.preventDefault();
                    e.currentTarget.blur();
                    if (!isTouchMobile()) focusFirstSelector("[data-sale-search]");
                  }
                }}
                placeholder={discountMode === "amount" ? "RD$" : "%"}
                className="sale-discount-input h-8 flex-1 rounded-lg bg-card px-2.5 text-right text-xs font-medium tabular-nums"
              />
            </div>
          )}
          {discountError && (
            <p role="alert" className="sale-discount-error text-xs font-medium text-primary">
              {discountError}
            </p>
          )}
        </div>
        {totals.discount > 0 && (
          <div className="flex justify-between text-primary">
            <span>
              {"Descuento aplicado"}
              {totals.discountPercent > 0 ? ` (${totals.discountPercent}%)` : ""}
            </span>
            <span className="font-medium tabular-nums">
              {"− "}
              {formatMoney(totals.discount)}
            </span>
          </div>
        )}
        {operational && totals.discount > 0 && totals.grossTotal > 0 && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">{"Base imponible"}</span>
            <span className="font-medium tabular-nums">
              {formatMoney(totals.subtotal)}
            </span>
          </div>
        )}
        <div className="flex justify-between">
          <span className="text-muted-foreground">
            {"ITBIS ("}
            {itbisRate}
            {"%)"}
          </span>
          <span className="font-medium tabular-nums">
            {formatMoney(totals.itbis)}
          </span>
        </div>
        {operational && Boolean(totals.roundingAdjustment) && (
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{"Redondeo a peso"}</span>
            <span className="font-medium tabular-nums">
              {totals.roundingAdjustment > 0 ? "+" : "−"} {formatMoney(Math.abs(totals.roundingAdjustment))}
            </span>
          </div>
        )}
      </div>
      <div className={cn("sale-summary-total rounded-xl bg-accent", operational ? "sale-summary-total-compact" : "mx-5 px-4 py-3.5")}>
        <p className="text-xs font-medium uppercase tracking-wider text-accent-foreground/80">
          {"Total a pagar"}
        </p>
        <MoneyDisplay
          value={totals.total}
          showCents={!operational}
          className={operational ? "sale-summary-total-amount text-primary" : "text-[34px] leading-tight text-primary"}
          symbolClassName="text-primary/70"
          centsClassName="text-primary/50"
        />
      </div>
      {operational && <Button className="sale-mobile-only sale-open-payment" disabled={empty}
        aria-expanded={paymentOpen} aria-controls={paymentId}
        onClick={() => {
          setPaymentOpen(value => !value);
          requestAnimationFrame(() => summaryRef.current?.scrollIntoView({ block: 'start' }));
        }}>
        {paymentOpen ? 'Volver a productos' : 'Cobrar'}
      </Button>}
      <div id={paymentId} className="sale-payment-content">
      {condition === "contado" ? (
        <div className="sale-payment-methods space-y-3 px-5 pt-4">
          <div className="sale-payment-tabs grid grid-cols-3 gap-1.5 rounded-xl bg-muted p-1">
            {METHODS.map((m) => {
              const Icon = m.icon;
              const active = paymentMethod === m.value;
              return (
                <button
                  type="button"
                  onClick={() => onPaymentMethodChange(m.value)}
                  className={cn(
                    "flex h-9 items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-all",
                    active
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  key={m.value}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {m.label}
                </button>
              );
            })}
          </div>
          {isCash && (
            <div className="sale-cash-box space-y-2">
              <div className={operational ? "sale-received-field" : "space-y-2"}>
                <Label className="sale-received-label text-xs text-muted-foreground">
                  {"Monto recibido"}
                </Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    {"RD$"}
                  </span>
                  <Input
                    aria-label="Monto recibido"
                    data-sale-received={operational ? "true" : undefined}
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    value={received}
                    onChange={(e) => onReceivedChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (!operational) return;
                      if (e.key === "Enter" && !blocked) {
                        e.preventDefault();
                        if (!e.repeat) onCheckout?.();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.currentTarget.blur();
                        if (!isTouchMobile()) focusFirstSelector("[data-sale-search]");
                      }
                    }}
                    placeholder="0"
                    className="sale-received-input h-11 rounded-xl pl-11 text-base font-semibold tabular-nums"
                  />
                </div>
              </div>
              {!empty && (
                <div className="sale-quick-amounts flex flex-wrap gap-1.5">
                  {quickAmounts.map((a, index) => (
                    <button
                      type="button"
                      onClick={() => {
                        onReceivedChange(String(a));
                        if (operational && !isTouchMobile()) {
                          window.requestAnimationFrame(() => focusFirstSelector("[data-sale-received]"));
                        }
                      }}
                      className="h-7 rounded-lg border border-border px-2.5 text-xs font-medium tabular-nums text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                      key={index === 0 ? "exacto" : a}
                    >
                      {index === 0
                        ? "Exacto"
                        : formatCashMoney(a)}
                    </button>
                  ))}
                </div>
              )}
              {showCashBalance && (
                <div
                  className={cn(
                    "sale-cash-change flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm",
                    insufficient
                      ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                  )}
                >
                  <span className="font-medium">
                    {insufficient ? "Falta" : "Cambio a devolver"}
                  </span>
                  <span className="sale-cash-change-amount text-base font-semibold tabular-nums">
                    {formatCashMoney(Math.abs(empty ? 0 : change))}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="sale-credit-note mx-5 mt-4 rounded-xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
          {"La factura se registrará en "}
          <span className="font-medium text-foreground">
            {"Cuentas x cobrar"}
          </span>
          {" con vencimiento a 30 días."}
        </div>
      )}
      <div className="sale-payment-actions mt-auto space-y-2 p-5">
        {disabledReason && !empty && (
          <p className="text-center text-xs font-medium text-amber-600 dark:text-amber-400">
            {disabledReason}
          </p>
        )}
        <Button
          onClick={onCheckout}
          disabled={blocked}
          className="sale-checkout-btn h-12 w-full rounded-xl text-[15px] font-semibold shadow-md shadow-primary/20"
        >
          <Printer />
          {operational ? "Registrar venta" : "Guardar e imprimir factura"}
          <kbd aria-hidden="true" className="sale-keyboard-hint ml-1 rounded bg-primary-foreground/20 px-1.5 py-0.5 font-mono text-[10px]">
            {operational ? "Enter" : "F9"}
          </kbd>
        </Button>
        <div className="sale-secondary-actions grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={onSaveQuote}
            disabled={empty || !onSaveQuote}
            className="h-10 rounded-xl bg-card"
          >
            <FileClock />
            {"Cotización"}
          </Button>
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={empty}
            className="h-10 rounded-xl bg-card hover:border-primary/40 hover:text-primary"
          >
            <X />
            {"Cancelar"}
          </Button>
        </div>
      </div>
      </div>
    </section>
  );
}
export { OrderSummaryPanel };

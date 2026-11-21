// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { Banknote } from "lucide-react";
import { CreditCard } from "lucide-react";
import { ArrowLeftRight } from "lucide-react";
import { formatMoney } from "../lib/format.js";
import { cn } from "../../lib/utils.js";
import { MoneyDisplay } from "./money-display.jsx";
import { Label3 } from "../../components/ui/label.jsx";
import { Input } from "../../components/ui/input.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Printer } from "lucide-react";
import { FileClock } from "lucide-react";
import { X } from "lucide-react";
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
  invoiceNumber,
  customerName,
  comprobante,
  condition,
  totals,
  discountPct,
  onDiscountChange,
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
  const isCash = condition === "contado" && paymentMethod === "efectivo";
  const receivedNum = Number(received) || 0;
  const change = receivedNum - totals.total;
  const insufficient = isCash && !empty && receivedNum < totals.total;
  const quickAmounts = Array.from(
    new Set([
      Math.ceil(totals.total),
      Math.ceil(totals.total / 500) * 500,
      Math.ceil(totals.total / 1000) * 1000,
      Math.ceil(totals.total / 1000) * 1000 + 1000,
    ]),
  )
    .filter((v) => v > 0)
    .slice(0, 4);
  const blocked = empty || insufficient || Boolean(disabledReason);
  return (
    <section className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-start justify-between gap-3 border-b border-dashed border-border px-5 py-4">
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
      <div className="space-y-2.5 px-5 py-4 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">
            {"Subtotal ("}
            {totals.items}
            {" uds.)"}
          </span>
          <span className="font-medium tabular-nums">
            {formatMoney(totals.subtotal)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">{"Descuento"}</span>
          <div className="flex items-center gap-1">
            {DISCOUNTS.map((d) => (
              <button
                type="button"
                onClick={() => onDiscountChange(d)}
                className={cn(
                  "h-6 rounded-md px-1.5 text-[11px] font-semibold transition-colors",
                  discountPct === d
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:text-foreground",
                )}
                key={d}
              >
                {d}
                {"%"}
              </button>
            ))}
          </div>
        </div>
        {totals.discount > 0 && (
          <div className="flex justify-between text-primary">
            <span>{"Descuento aplicado"}</span>
            <span className="font-medium tabular-nums">
              {"− "}
              {formatMoney(totals.discount)}
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
      </div>
      <div className="mx-5 rounded-xl bg-accent px-4 py-3.5">
        <p className="text-xs font-medium uppercase tracking-wider text-accent-foreground/80">
          {"Total a pagar"}
        </p>
        <MoneyDisplay
          value={totals.total}
          className="text-[34px] leading-tight text-primary"
          symbolClassName="text-primary/70"
          centsClassName="text-primary/50"
        />
      </div>
      {condition === "contado" ? (
        <div className="space-y-3 px-5 pt-4">
          <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-muted p-1">
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
            <div className="space-y-2">
              <Label3 className="text-xs text-muted-foreground">
                {"Monto recibido"}
              </Label3>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  {"RD$"}
                </span>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={received}
                  onChange={(e) => onReceivedChange(e.target.value)}
                  placeholder="0.00"
                  className="h-11 rounded-xl pl-11 text-base font-semibold tabular-nums"
                />
              </div>
              {!empty && (
                <div className="flex flex-wrap gap-1.5">
                  {quickAmounts.map((a) => (
                    <button
                      type="button"
                      onClick={() => onReceivedChange(String(a))}
                      className="h-7 rounded-lg border border-border px-2.5 text-xs font-medium tabular-nums text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                      key={a}
                    >
                      {a === Math.ceil(totals.total)
                        ? "Exacto"
                        : formatMoney(a)}
                    </button>
                  ))}
                </div>
              )}
              <div
                className={cn(
                  "flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm",
                  insufficient
                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                    : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                )}
              >
                <span className="font-medium">
                  {insufficient ? "Falta" : "Cambio a devolver"}
                </span>
                <span className="text-base font-semibold tabular-nums">
                  {formatMoney(Math.abs(empty ? 0 : change))}
                </span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="mx-5 mt-4 rounded-xl border border-dashed border-border px-4 py-3 text-xs text-muted-foreground">
          {"La factura se registrará en "}
          <span className="font-medium text-foreground">
            {"Cuentas x cobrar"}
          </span>
          {" con vencimiento a 30 días."}
        </div>
      )}
      <div className="mt-auto space-y-2 p-5">
        {disabledReason && !empty && (
          <p className="text-center text-xs font-medium text-amber-600 dark:text-amber-400">
            {disabledReason}
          </p>
        )}
        <Button
          onClick={onCheckout}
          disabled={blocked}
          className="h-12 w-full rounded-xl text-[15px] font-semibold shadow-md shadow-primary/20"
        >
          <Printer />
          {"Guardar e imprimir factura"}
          <kbd className="ml-1 rounded bg-primary-foreground/20 px-1.5 py-0.5 font-mono text-[10px]">
            {"F9"}
          </kbd>
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            onClick={onSaveQuote}
            disabled={empty}
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
    </section>
  );
}
export { OrderSummaryPanel };

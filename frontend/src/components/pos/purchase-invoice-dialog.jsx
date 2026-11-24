import { useEffect, useState } from "react";
import { CircleAlert, Printer, ReceiptText, XCircle } from "lucide-react";
import { formatDate } from "../../lib/accounts.js";
import { formatBusinessDateTime } from "../../lib/dates.js";
import { formatMoney, formatNumber, formatUnitMoney } from "../../lib/format.js";
import { cn } from "../../lib/utils.js";
import { Button } from "../ui/button.jsx";
import { Input } from "../ui/input.jsx";
import { Label } from "../ui/label.jsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.jsx";
import "./receipt-print.css";

export function PurchaseInvoiceDialog({
  purchase,
  supplier,
  business,
  open,
  onOpenChange,
  canVoid = false,
  onVoid,
}) {
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [retryFn, setRetryFn] = useState(null);

  useEffect(() => {
    if (!open) {
      setVoiding(false);
      setReason("");
      setError("");
      setSending(false);
      setRetryFn(null);
    }
  }, [open, purchase?.id]);

  if (!purchase) return null;

  const isVoided = purchase.status === "anulada";
  const hasPayments = (purchase.paid ?? 0) > 0;
  const pendingBalance = Math.max(0, Math.round(((purchase.total ?? 0) - (purchase.paid ?? 0)) * 100) / 100);
  const totalUnits = purchase.lines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
  const supplierName = purchase.supplierName || supplier?.name || "—";
  const supplierRnc = supplier?.rnc || "";

  async function confirmVoid(e) {
    e.preventDefault();
    if (sending || !onVoid) return;
    if (!retryFn && !reason.trim()) {
      setError("Indica el motivo de la anulación.");
      return;
    }
    setSending(true);
    setError("");
    try {
      await onVoid(purchase, reason.trim(), retryFn);
      setRetryFn(null);
      setVoiding(false);
      setReason("");
    } catch (cause) {
      setError(cause.message || "No se pudo anular la compra.");
      if (cause?.uncertain && typeof cause.retry === "function") {
        setRetryFn(() => cause.retry);
      } else if (cause?.definitive) {
        setRetryFn(null);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!sending) onOpenChange(next); }}>
      <DialogContent
        closeDisabled={sending}
        data-print-format="Carta (8.5 x 11)"
        className="pos-receipt-dialog flex max-w-2xl flex-col gap-0 overflow-hidden rounded-2xl p-0"
        style={{ width: "calc(100vw - 1.5rem)", maxHeight: "calc(100dvh - 1.5rem)" }}
      >
        <DialogHeader className="border-b border-border px-5 py-4 text-left sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-2 pr-8">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
                <ReceiptText className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold">
                  Factura de compra {purchase.supplierInvoice || purchase.number}
                </DialogTitle>
                <DialogDescription className="text-xs">
                  {purchase.number} · {formatDate(purchase.date)}
                </DialogDescription>
              </div>
            </div>
            <span
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs font-medium",
                isVoided
                  ? "border-destructive/40 bg-destructive/10 text-destructive"
                  : purchase.condition === "credito"
                    ? "border-foreground/40 text-foreground"
                    : "border-emerald-600/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
              )}
            >
              {isVoided ? "Anulada" : purchase.condition === "credito" ? "A crédito" : "Pagada"}
            </span>
          </div>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
          {/* Printable invoice document */}
          <div className="pos-receipt-document space-y-4 rounded-xl border border-border bg-muted/30 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-dashed border-border pb-3.5">
              <div className="space-y-0.5 text-xs">
                <p className="text-sm font-bold uppercase tracking-tight text-foreground">
                  {business?.name || "Repuestos Félix"}
                </p>
                {business?.rnc && <p className="text-muted-foreground">RNC {business.rnc}</p>}
                {business?.address && <p className="text-muted-foreground">{business.address}</p>}
                {business?.phone && <p className="text-muted-foreground">Tel. {business.phone}</p>}
              </div>
              <div className="space-y-0.5 text-xs sm:text-right">
                <p className="font-semibold uppercase tracking-wider text-muted-foreground">
                  Factura de compra
                </p>
                <p className="font-mono text-sm font-semibold text-foreground">
                  {purchase.supplierInvoice || purchase.number}
                </p>
                <p className="text-muted-foreground">Fecha: {formatDate(purchase.date)}</p>
                {purchase.condition === "credito" && purchase.dueDate && (
                  <p className="text-muted-foreground">Vence: {formatDate(purchase.dueDate)}</p>
                )}
              </div>
            </div>

            <div className="grid gap-2 rounded-xl border border-border bg-card px-3.5 py-2.5 text-xs sm:grid-cols-3">
              <div>
                <p className="text-muted-foreground">Suplidor</p>
                <p className="font-semibold text-foreground">{supplierName}</p>
              </div>
              <div>
                <p className="text-muted-foreground">RNC / Cédula</p>
                <p className="font-medium text-foreground">{supplierRnc || "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Condición</p>
                <p className="font-medium text-foreground">
                  {purchase.condition === "credito" ? "A crédito (Cuentas x pagar)" : "Pagada (contado)"}
                </p>
              </div>
            </div>

            {isVoided && (
              <div className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-0.5">
                  <p className="font-semibold">Compra anulada</p>
                  <p>
                    Motivo: {purchase.voidReason || "—"}
                    {purchase.voidedBy ? ` · por ${purchase.voidedBy}` : ""}
                    {purchase.voidedAt ? ` · ${formatBusinessDateTime(purchase.voidedAt)}` : ""}
                  </p>
                </div>
              </div>
            )}

            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full min-w-[520px] text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/50 text-left text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Artículo</th>
                    <th className="px-2.5 py-2 text-center font-medium">Cant.</th>
                    <th className="px-2.5 py-2 text-right font-medium">Costo unit.</th>
                    <th className="px-2.5 py-2 text-right font-medium">P1 / P2 / P3</th>
                    <th className="px-3 py-2 text-right font-medium">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {purchase.lines.map((line, index) => (
                    <tr key={line.id ?? index}>
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-foreground">{line.name}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">{line.code}</p>
                      </td>
                      <td className="px-2.5 py-2.5 text-center font-medium tabular-nums">
                        {formatNumber(line.quantity)}
                      </td>
                      <td className="px-2.5 py-2.5 text-right tabular-nums">
                        {formatUnitMoney(line.costExact ?? line.cost)}
                      </td>
                      <td className="px-2.5 py-2.5 text-right text-[11px] text-muted-foreground tabular-nums">
                        {formatUnitMoney(line.pricesExact?.p1 ?? line.prices.p1)} /{" "}
                        {formatUnitMoney(line.pricesExact?.p2 ?? line.prices.p2)} /{" "}
                        {formatUnitMoney(line.pricesExact?.p3 ?? line.prices.p3)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-foreground">
                        {formatMoney(line.subtotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-card px-4 py-3 text-xs tabular-nums">
              <div className="flex justify-between text-muted-foreground">
                <span>Artículos / unidades</span>
                <span>
                  {purchase.lines.length} {purchase.lines.length === 1 ? "línea" : "líneas"} ·{" "}
                  {formatNumber(totalUnits)} uds.
                </span>
              </div>
              <div className="flex justify-between pt-1 text-sm font-bold text-foreground">
                <span>TOTAL COMPRA</span>
                <span className={cn(isVoided && "line-through text-muted-foreground")}>
                  {formatMoney(purchase.total)}
                </span>
              </div>
              {purchase.condition === "credito" && !isVoided && (
                <>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Pagado</span>
                    <span>{formatMoney(purchase.paid ?? 0)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-foreground">
                    <span>Saldo pendiente</span>
                    <span>{formatMoney(pendingBalance)}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Inline void confirmation panel */}
          {voiding && !isVoided && (
            <form
              onSubmit={confirmVoid}
              className="space-y-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4"
            >
              <div className="space-y-1">
                <p className="text-sm font-semibold text-destructive">¿Anular esta compra?</p>
                <p className="text-xs text-muted-foreground">
                  Se restarán del inventario las unidades ingresadas, se quitará de Cuentas x pagar si era a crédito y podrás volver a subir la factura corregida con el mismo número.
                </p>
              </div>

              {hasPayments ? (
                <p role="alert" className="flex items-center gap-2 text-xs font-medium text-destructive">
                  <CircleAlert className="h-4 w-4 shrink-0" />
                  <span>Esta compra ya tiene pagos registrados y no puede anularse.</span>
                </p>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="void-purchase-reason" className="text-xs text-muted-foreground">
                    Motivo de anulación
                  </Label>
                  <Input
                    id="void-purchase-reason"
                    autoFocus
                    disabled={sending || Boolean(retryFn)}
                    value={reason}
                    onChange={(e) => { setReason(e.target.value); setError(""); }}
                    placeholder="Ej. Costo o cantidad equivocada"
                    className="h-11 rounded-xl bg-card"
                  />
                </div>
              )}

              {error && (
                <p role="alert" className="flex items-center gap-2 text-xs font-medium text-destructive">
                  <CircleAlert className="h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {!hasPayments && (
                  <Button
                    type="submit"
                    variant="destructive"
                    className="h-11 rounded-xl"
                    disabled={sending || (!retryFn && !reason.trim())}
                  >
                    {sending ? "Anulando…" : retryFn ? "Reintentar anulación" : "Confirmar anulación"}
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 rounded-xl bg-card"
                  disabled={sending}
                  onClick={() => { setVoiding(false); setError(""); setRetryFn(null); }}
                >
                  Volver
                </Button>
              </div>
            </form>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-4 sm:px-6">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-xl bg-card"
              onClick={() => window.print()}
            >
              <Printer className="h-4 w-4" />
              <span>Imprimir</span>
            </Button>
            {canVoid && !isVoided && !voiding && onVoid && (
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-xl bg-card text-destructive hover:text-destructive"
                onClick={() => { setVoiding(true); setError(""); }}
              >
                <XCircle className="h-4 w-4" />
                <span>Anular compra</span>
              </Button>
            )}
          </div>
          <Button
            type="button"
            className="h-11 rounded-xl"
            disabled={sending}
            onClick={() => onOpenChange(false)}
          >
            Cerrar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

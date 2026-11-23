import { History, Printer, ReceiptText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.jsx";
import { Button } from "../ui/button.jsx";
import { balanceOf, formatDate, formatDateTime } from "../../lib/accounts.js";
import { formatMoney } from "../../lib/format.js";
import "./receipt-print.css";

const METHOD_LABELS = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
};

function methodLabel(method) {
  return METHOD_LABELS[method] ?? method ?? "—";
}

function sortedPaymentsWithBalances(doc) {
  const total = Number(doc?.amount ?? 0);
  const chronological = [...(doc?.payments ?? [])].sort(
    (a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")) || (a.id ?? 0) - (b.id ?? 0),
  );
  let paidSoFar = 0;
  return chronological.map((payment, index) => {
    const previousBalance = Math.max(0, Math.round((total - paidSoFar) * 100) / 100);
    paidSoFar = Math.round((paidSoFar + Number(payment.amount ?? 0)) * 100) / 100;
    const remainingAfter = Math.max(0, Math.round((total - paidSoFar) * 100) / 100);
    return {
      ...payment,
      sequence: index + 1,
      previousBalance,
      remainingAfter,
    };
  });
}

export function AccountPaymentsDialog({
  doc,
  partyName,
  partyLabel,
  verb,
  open,
  onOpenChange,
  onPrintPayment,
}) {
  const entries = doc ? sortedPaymentsWithBalances(doc).reverse() : [];
  const balance = doc ? balanceOf(doc) : 0;
  const isReceivable = verb === "Cobrar";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sales-history-dialog max-w-xl gap-0 overflow-hidden rounded-2xl p-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
              <History className="h-5 w-5" />
            </span>
            <div className="min-w-0 text-left">
              <DialogTitle className="text-lg">
                {isReceivable ? "Historial de cobros" : "Historial de pagos"}
                {doc ? ` · ${doc.document}` : ""}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {partyLabel}: {partyName}
                {doc?.date ? ` · Emitida ${formatDate(doc.date)}` : ""}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {doc && (
          <div className="border-y border-border bg-muted/50 px-6 py-3">
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div>
                <p className="text-muted-foreground">{"Monto factura"}</p>
                <p className="mt-0.5 text-sm font-semibold tabular-nums">
                  {formatMoney(doc.amount)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">{"Total abonado"}</p>
                <p className="mt-0.5 text-sm font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
                  {formatMoney(doc.paid)}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">{"Balance"}</p>
                <p className="mt-0.5 text-sm font-semibold text-primary tabular-nums">
                  {formatMoney(balance)}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="sales-history-list overflow-y-auto px-6 py-4">
          {entries.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm font-medium text-foreground">
                {"Sin abonos registrados"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {"Cuando registres un abono parcial o total aparecerá aquí con su recibo imprimible."}
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {entries.map((payment) => (
                <div
                  key={payment.id ?? payment.sequence}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {isReceivable ? `Cobro #${payment.sequence}` : `Pago #${payment.sequence}`}
                      </span>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {methodLabel(payment.method)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                      {formatDateTime(payment.date)}
                      {" · Saldo luego: "}
                      <span className="font-medium text-foreground">
                        {formatMoney(payment.remainingAfter)}
                      </span>
                    </p>
                    {(payment.note || payment.reference) && (
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {[payment.reference, payment.note].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm font-semibold text-emerald-700 tabular-nums dark:text-emerald-400">
                      {formatMoney(payment.amount)}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-xl px-3 text-xs"
                      aria-label={`Imprimir abono #${payment.sequence}`}
                      onClick={() => onPrintPayment?.(payment)}
                    >
                      <Printer className="h-3.5 w-3.5" />
                      <span>{"Recibo"}</span>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function PaymentReceiptDialog({
  receipt,
  business,
  printFormat = "Térmica 80 mm",
  footer = "¡Gracias por su pago!",
  open,
  onOpenChange,
}) {
  const isReceivable = receipt?.verb === "Cobrar";
  const receiptTitle = isReceivable ? "Recibo de cobro" : "Comprobante de pago";
  const receiptBanner = isReceivable ? "RECIBO DE ABONO" : "COMPROBANTE DE PAGO";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-print-format={printFormat}
        className="pos-receipt-dialog max-w-md gap-0 rounded-2xl p-0"
      >
        <DialogHeader className="items-center space-y-2 px-6 pb-4 pt-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-primary">
            <ReceiptText className="h-6 w-6" />
          </div>
          <DialogTitle className="text-lg">{receiptTitle}</DialogTitle>
          <DialogDescription>
            {receipt ? `${receipt.document} · ${receipt.partyName}` : ""}
          </DialogDescription>
        </DialogHeader>

        {receipt && (
          <div className="pos-receipt-document mx-6 max-h-[46vh] overflow-y-auto rounded-xl border border-dashed border-border bg-muted/40 p-4 font-mono text-xs">
            <div className="text-center">
              <p className="text-sm font-bold uppercase">{business?.name || "Repuestos Félix"}</p>
              {business?.rnc && <p className="text-muted-foreground">{"RNC "}{business.rnc}</p>}
              {business?.address && <p className="text-muted-foreground">{business.address}</p>}
              {business?.phone && <p className="text-muted-foreground">{"Tel. "}{business.phone}</p>}
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {`— ${receiptBanner} —`}
              </p>
            </div>
            <div className="my-3 border-t border-dashed border-border" />
            <div className="space-y-0.5">
              {receipt.paymentId != null && (
                <div className="flex justify-between">
                  <span>{"Recibo"}</span>
                  <span className="font-semibold">{`AB-${String(receipt.paymentId).padStart(6, "0")}`}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span>{"Documento"}</span>
                <span className="font-semibold">{receipt.document}</span>
              </div>
              <div className="flex justify-between">
                <span>{"Fecha"}</span>
                <span>{formatDateTime(receipt.date)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span>{receipt.partyLabel}</span>
                <span className="truncate text-right">{receipt.partyName}</span>
              </div>
              <div className="flex justify-between">
                <span>{"Forma de pago"}</span>
                <span>{methodLabel(receipt.method)}</span>
              </div>
              {receipt.note && (
                <div className="flex justify-between gap-3">
                  <span>{"Nota"}</span>
                  <span className="truncate text-right">{receipt.note}</span>
                </div>
              )}
            </div>
            <div className="my-3 border-t border-dashed border-border" />
            <div className="space-y-0.5">
              <div className="flex justify-between">
                <span>{"Total factura"}</span>
                <span>{formatMoney(receipt.docAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span>{"Balance anterior"}</span>
                <span>{formatMoney(receipt.previousBalance)}</span>
              </div>
              <div className="flex justify-between pt-1 text-sm font-bold">
                <span>{"MONTO ABONADO"}</span>
                <span>{formatMoney(receipt.amount)}</span>
              </div>
              <div className="flex justify-between pt-1 font-semibold">
                <span>{"Balance pendiente"}</span>
                <span>{formatMoney(receipt.remainingAfter)}</span>
              </div>
            </div>
            <p className="mt-4 text-center text-muted-foreground">{footer}</p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 p-6">
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-xl bg-card"
            onClick={() => window.print()}
          >
            <Printer />
            {"Imprimir"}
          </Button>
          <Button type="button" className="h-11 rounded-xl" onClick={() => onOpenChange?.(false)}>
            {"Cerrar"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

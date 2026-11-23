// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { balanceOf } from "../../lib/accounts.js";
import { Dialog } from "../ui/dialog.jsx";
import { DialogContent } from "../ui/dialog.jsx";
import { DialogHeader } from "../ui/dialog.jsx";
import { DialogTitle } from "../ui/dialog.jsx";
import { DialogDescription } from "../ui/dialog.jsx";
import { formatDate } from "../../lib/accounts.js";
import { formatMoney } from "../../lib/format.js";
import { Field } from "./form-field.jsx";
import { Input } from "../ui/input.jsx";
import { cn } from "../../lib/utils.js";
import { inputClass } from "./form-field.jsx";
import { PAYMENT_METHODS } from "../../data/sales-options.js";
import { DialogFooter } from "../ui/dialog.jsx";
import { Button } from "../ui/button.jsx";
import { useEffect } from "react";
import { useState } from "react";
function PaymentDialog({ doc, partyName, verb, operational = false, cashOpen = true, onOpenChange, onConfirm }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("efectivo");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [retryFn, setRetryFn] = useState(null);
  const balance = doc ? balanceOf(doc) : 0;
  const docId = doc?.id ?? null;
  useEffect(() => {
    if (doc) {
      setAmount(String(balanceOf(doc)));
      setMethod(operational && !cashOpen ? "transferencia" : "efectivo");
      setNote("");
      setError(null);
      setRetryFn(null);
      setSending(false);
    }
  }, [docId]);
  const trimmedAmount = String(amount).trim();
  const validFormat = /^\d{1,12}(?:\.\d{1,2})?$/.test(trimmedAmount);
  const value = validFormat ? Number(trimmedAmount) : 0;
  const cashBlocked = operational && method === "efectivo" && !cashOpen;
  const tooHigh = validFormat && value > balance + 0.001;
  const invalid = !validFormat || value <= 0 || tooHigh || cashBlocked;
  const locked = sending || Boolean(retryFn);
  return (
    <Dialog open={Boolean(doc)} onOpenChange={(o) => !sending && onOpenChange(o)}>
      <DialogContent className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle>
            {verb} {doc?.document}
          </DialogTitle>
          <DialogDescription>
            {partyName}
            {" · emitida "}
            {doc ? formatDate(doc.date) : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2 rounded-xl bg-muted p-3 text-center text-xs">
          <div>
            <p className="text-muted-foreground">{"Monto"}</p>
            <p className="text-sm font-semibold tabular-nums">
              {formatMoney(doc?.amount ?? 0)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">{"Abonado"}</p>
            <p className="text-sm font-semibold tabular-nums">
              {formatMoney(doc?.paid ?? 0)}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">{"Balance"}</p>
            <p className="text-sm font-semibold text-primary tabular-nums">
              {formatMoney(balance)}
            </p>
          </div>
        </div>
        <Field
          label="Monto a abonar RD$"
          error={
            tooHigh
              ? "No puede ser mayor que el balance"
              : trimmedAmount !== "" && !validFormat
                ? "Indica un monto válido (hasta dos decimales)"
                : undefined
          }
        >
          <Input
            type="number"
            step="0.01"
            min="0.01"
            disabled={locked}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={cn(inputClass, "text-base font-semibold")}
            autoFocus={true}
          />
          <div className="flex gap-1.5 pt-1">
            {[0.25, 0.5, 1].map((f) => (
              <button
                type="button"
                disabled={locked}
                onClick={() =>
                  setAmount(String(Math.round(balance * f * 100) / 100))
                }
                className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                key={f}
              >
                {f === 1 ? "Saldar todo" : `${f * 100}%`}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Forma de pago">
          <div className="grid grid-cols-3 gap-1.5 rounded-xl bg-muted p-1">
            {PAYMENT_METHODS.map((m) => (
              <button
                type="button"
                disabled={locked}
                onClick={() => setMethod(m.value)}
                className={cn(
                  "h-9 rounded-lg text-xs font-medium transition-all disabled:opacity-50",
                  method === m.value
                    ? "bg-card shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
                key={m.value}
              >
                {m.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Nota (opcional)">
          <Input
            disabled={locked}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ej. Recibo #123"
            className={inputClass}
          />
        </Field>
        {cashBlocked && (
          <p role="alert" className="text-xs font-medium text-primary">
            {"Abre la caja para registrar un movimiento en efectivo, o elige tarjeta/transferencia."}
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-primary">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            className="h-11 w-full rounded-xl font-semibold"
            disabled={(!retryFn && invalid) || sending}
            onClick={async () => {
              if ((!retryFn && invalid) || sending) return;
              setSending(true);
              setError(null);
              try {
                await onConfirm(value, method, note.trim() || undefined, retryFn);
                setRetryFn(null);
              } catch (cause) {
                setError(cause?.message || "No se pudo registrar el abono.");
                if (cause?.uncertain && typeof cause.retry === "function") {
                  setRetryFn(() => cause.retry);
                } else if (cause?.definitive) {
                  setRetryFn(null);
                }
              } finally {
                setSending(false);
              }
            }}
          >
            {sending ? "Confirmando…" : retryFn ? `Reintentar ${verb.toLowerCase()}` : `${verb} ${formatMoney(value)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export { PaymentDialog };

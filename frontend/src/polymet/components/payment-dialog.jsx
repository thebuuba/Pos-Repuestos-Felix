// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { balanceOf } from "../lib/accounts.js";
import { Dialog2 } from "../../components/ui/dialog.jsx";
import { DialogContent2 } from "../../components/ui/dialog.jsx";
import { DialogHeader } from "../../components/ui/dialog.jsx";
import { DialogTitle2 } from "../../components/ui/dialog.jsx";
import { DialogDescription2 } from "../../components/ui/dialog.jsx";
import { formatDate } from "../lib/accounts.js";
import { formatMoney } from "../lib/format.js";
import { Field } from "./form-field.jsx";
import { Input } from "../../components/ui/input.jsx";
import { cn } from "../../lib/utils.js";
import { inputClass } from "./form-field.jsx";
import { PAYMENT_METHODS } from "../../data/sales-options.js";
import { DialogFooter } from "../../components/ui/dialog.jsx";
import { Button } from "../../components/ui/button.jsx";
import { useEffect } from "react";
import { useState } from "react";
function PaymentDialog({ doc, partyName, verb, onOpenChange, onConfirm }) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("efectivo");
  const [note, setNote] = useState("");
  const balance = doc ? balanceOf(doc) : 0;
  useEffect(() => {
    if (doc) {
      setAmount(String(balanceOf(doc)));
      setMethod("efectivo");
      setNote("");
    }
  }, [doc]);
  const value = Number(amount) || 0;
  const invalid = value <= 0 || value > balance + 0.001;
  return (
    <Dialog2 open={Boolean(doc)} onOpenChange={onOpenChange}>
      <DialogContent2 className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle2>
            {verb} {doc?.document}
          </DialogTitle2>
          <DialogDescription2>
            {partyName}
            {" · emitida "}
            {doc ? formatDate(doc.date) : ""}
          </DialogDescription2>
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
            value > balance + 0.001
              ? "No puede ser mayor que el balance"
              : undefined
          }
        >
          <Input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={cn(inputClass, "text-base font-semibold")}
            autoFocus={true}
          />
          <div className="flex gap-1.5 pt-1">
            {[0.25, 0.5, 1].map((f) => (
              <button
                type="button"
                onClick={() =>
                  setAmount(String(Math.round(balance * f * 100) / 100))
                }
                className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
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
                onClick={() => setMethod(m.value)}
                className={cn(
                  "h-9 rounded-lg text-xs font-medium transition-all",
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
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ej. Recibo #123"
            className={inputClass}
          />
        </Field>
        <DialogFooter>
          <Button
            className="h-11 w-full rounded-xl font-semibold"
            disabled={invalid}
            onClick={() => onConfirm(value, method, note.trim() || undefined)}
          >
            {verb} {formatMoney(value)}
          </Button>
        </DialogFooter>
      </DialogContent2>
    </Dialog2>
  );
}
export { PaymentDialog };

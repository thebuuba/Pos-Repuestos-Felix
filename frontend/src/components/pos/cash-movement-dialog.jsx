// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { Dialog } from "../ui/dialog.jsx";
import { DialogContent } from "../ui/dialog.jsx";
import { DialogHeader } from "../ui/dialog.jsx";
import { DialogTitle } from "../ui/dialog.jsx";
import { DialogDescription } from "../ui/dialog.jsx";
import { cn } from "../../lib/utils.js";
import { ArrowDownLeft } from "lucide-react";
import { ArrowUpRight } from "lucide-react";
import { Field } from "./form-field.jsx";
import { Input } from "../ui/input.jsx";
import { inputClass } from "./form-field.jsx";
import { DialogFooter } from "../ui/dialog.jsx";
import { Button } from "../ui/button.jsx";
import { useEffect } from "react";
import { useState } from "react";
var SUGGESTIONS = {
  entrada: [
    "Fondo para cambio",
    "Depósito del dueño",
    "Devolución de suplidor",
  ],
  salida: [
    "Almuerzo del personal",
    "Pago de delivery",
    "Compra de materiales",
    "Retiro a banco",
  ],
};
function CashMovementDialog({
  open,
  onOpenChange,
  defaultType = "salida",
  onConfirm,
  disabled = false,
  sending = false,
  failure,
  onRetry,
  retryDisabled = false,
}) {
  const [type, setType] = useState(defaultType);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  useEffect(() => {
    if (open) {
      setType(defaultType);
      setAmount("");
      setDescription("");
    }
  }, [open, defaultType]);
  const valid = /^\d+(?:\.\d{1,2})?$/.test(amount) && Number.isFinite(Number(amount)) && Number(amount) > 0
    && description.trim().length > 0 && description.length <= 2000;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeDisabled={sending || !!failure?.retry} style={{ maxHeight: "calc(100dvh - 2rem)" }} className="max-w-md overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>{"Movimiento de caja"}</DialogTitle>
          <DialogDescription>
            {"Registra dinero que entra o sale de la caja."}
          </DialogDescription>
        </DialogHeader>
        {(sending || failure) && <div role={failure ? "alert" : "status"} className="space-y-2 text-sm">
          <p>{sending ? "Confirmando el movimiento…" : failure.message}</p>
          {failure?.retry && <Button variant="outline" onClick={onRetry} disabled={retryDisabled}>Reintentar movimiento</Button>}
        </div>}
        <div className="grid grid-cols-2 gap-2">
          {["entrada", "salida"].map((t) => (
            <button
              disabled={disabled}
              type="button"
              onClick={() => setType(t)}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-medium transition-colors",
                type === t
                  ? t === "entrada"
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "border-primary bg-accent text-primary"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
              key={t}
            >
              {t === "entrada" ? (
                <ArrowDownLeft className="h-4 w-4" />
              ) : (
                <ArrowUpRight className="h-4 w-4" />
              )}
              {t === "entrada" ? "Entrada" : "Salida"}
            </button>
          ))}
        </div>
        <Field label="Monto RD$" htmlFor="cash-movement-amount">
          <Input
            id="cash-movement-amount"
            disabled={disabled}
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className={cn(inputClass, "text-base font-semibold")}
            autoFocus={true}
          />
        </Field>
        <Field label="Concepto" htmlFor="cash-movement-description">
          <Input
            id="cash-movement-description"
            disabled={disabled}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="¿Para qué es?"
            className={inputClass}
          />
          <div className="flex flex-wrap gap-1.5 pt-1">
            {SUGGESTIONS[type].map((s) => (
              <button
                disabled={disabled}
                type="button"
                onClick={() => setDescription(s)}
                className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                key={s}
              >
                {s}
              </button>
            ))}
          </div>
        </Field>
        <DialogFooter>
          <Button
            className="h-11 w-full rounded-xl"
            disabled={disabled || !valid}
            onClick={() => onConfirm(type, amount, description.trim())}
          >
            {"Registrar "}
            {type}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export { CashMovementDialog };

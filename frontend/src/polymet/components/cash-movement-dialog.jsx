// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { Dialog2 } from "../../components/ui/dialog.jsx";
import { DialogContent2 } from "../../components/ui/dialog.jsx";
import { DialogHeader } from "../../components/ui/dialog.jsx";
import { DialogTitle2 } from "../../components/ui/dialog.jsx";
import { DialogDescription2 } from "../../components/ui/dialog.jsx";
import { cn } from "../../lib/utils.js";
import { ArrowDownLeft } from "lucide-react";
import { ArrowUpRight } from "lucide-react";
import { Field } from "./form-field.jsx";
import { Input } from "../../components/ui/input.jsx";
import { inputClass } from "./form-field.jsx";
import { DialogFooter } from "../../components/ui/dialog.jsx";
import { Button } from "../../components/ui/button.jsx";
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
  const valid = Number(amount) > 0 && description.trim().length > 0;
  return (
    <Dialog2 open={open} onOpenChange={onOpenChange}>
      <DialogContent2 className="max-w-md rounded-2xl">
        <DialogHeader>
          <DialogTitle2>{"Movimiento de caja"}</DialogTitle2>
          <DialogDescription2>
            {"Registra dinero que entra o sale de la caja."}
          </DialogDescription2>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {["entrada", "salida"].map((t) => (
            <button
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
        <Field label="Monto RD$">
          <Input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className={cn(inputClass, "text-base font-semibold")}
            autoFocus={true}
          />
        </Field>
        <Field label="Concepto">
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="¿Para qué es?"
            className={inputClass}
          />
          <div className="flex flex-wrap gap-1.5 pt-1">
            {SUGGESTIONS[type].map((s) => (
              <button
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
            disabled={!valid}
            onClick={() => onConfirm(type, Number(amount), description.trim())}
          >
            {"Registrar "}
            {type}
          </Button>
        </DialogFooter>
      </DialogContent2>
    </Dialog2>
  );
}
export { CashMovementDialog };

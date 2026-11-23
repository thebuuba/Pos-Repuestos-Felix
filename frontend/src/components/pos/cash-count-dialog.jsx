// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { round2 } from "../../lib/format.js";
import { Input } from "../ui/input.jsx";
import { formatMoney } from "../../lib/format.js";
import { Dialog } from "../ui/dialog.jsx";
import { DialogContent } from "../ui/dialog.jsx";
import { DialogHeader } from "../ui/dialog.jsx";
import { DialogTitle } from "../ui/dialog.jsx";
import { DialogDescription } from "../ui/dialog.jsx";
import { cn } from "../../lib/utils.js";
import { DialogFooter } from "../ui/dialog.jsx";
import { Button } from "../ui/button.jsx";
import { useEffect } from "react";
import { useState } from "react";
var BILLS = [2000, 1000, 500, 200, 100, 50];
var COINS = [25, 10, 5, 1];
function CashCountDialog({ open, onOpenChange, expected, onConfirm, disabled = false, sending = false, failure, onRetry, retryDisabled = false }) {
  const [counts, setCounts] = useState({});
  useEffect(() => {
    if (open) setCounts({});
  }, [open]);
  const counted = round2(
    [...BILLS, ...COINS].reduce((s, d) => s + d * (Number(counts[d]) || 0), 0),
  );
  const diff = round2(counted - expected);
  const valid = Object.values(counts).every(value => value === "" || (/^\d+$/.test(value) && Number.isSafeInteger(Number(value))))
    && Number.isSafeInteger(Math.round(counted * 100));
  const renderRow = (d) => (
    <div className="flex items-center gap-2" key={d}>
      <span className="w-16 text-right text-sm font-medium tabular-nums">
        {d.toLocaleString("en-US")}
      </span>
      <span className="text-muted-foreground">{"×"}</span>
      <Input
        disabled={disabled}
        aria-label={`Cantidad de ${d}`}
        type="number"
        min={0}
        step={1}
        value={counts[d] ?? ""}
        onChange={(e) =>
          setCounts((c) => ({
            ...c,
            [d]: e.target.value,
          }))
        }
        placeholder="0"
        className="h-9 w-20 rounded-lg text-center"
      />
      <span className="ml-auto text-xs tabular-nums text-muted-foreground">
        {formatMoney(d * (Number(counts[d]) || 0))}
      </span>
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeDisabled={sending || !!failure?.retry} style={{ maxHeight: "calc(100dvh - 2rem)" }} className="max-w-2xl overflow-y-auto rounded-2xl">
        <DialogHeader>
          <DialogTitle>{"Cierre de caja · conteo de efectivo"}</DialogTitle>
          <DialogDescription>
            {"Cuenta billetes y monedas. El sistema compara con lo esperado."}
          </DialogDescription>
        </DialogHeader>
        {(sending || failure) && <div role={failure ? "alert" : "status"} className="space-y-2 text-sm">
          <p>{sending ? "Confirmando el cierre…" : failure.message}</p>
          {failure?.retry && <Button variant="outline" onClick={onRetry} disabled={retryDisabled}>Reintentar cierre</Button>}
        </div>}
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {"Billetes"}
            </p>
            {BILLS.map(renderRow)}
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {"Monedas"}
            </p>
            {COINS.map(renderRow)}
            <div className="!mt-5 space-y-2 rounded-xl bg-muted p-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">{"Esperado"}</span>
                <span className="font-medium tabular-nums">
                  {formatMoney(expected)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{"Contado"}</span>
                <span className="font-semibold tabular-nums">
                  {formatMoney(counted)}
                </span>
              </div>
              <div
                className={cn(
                  "flex justify-between rounded-lg px-2.5 py-1.5 font-semibold",
                  diff === 0
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : diff > 0
                      ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                      : "bg-accent text-primary",
                )}
              >
                <span>
                  {diff === 0 ? "Cuadrada" : diff > 0 ? "Sobrante" : "Faltante"}
                </span>
                <span className="tabular-nums">
                  {formatMoney(Math.abs(diff))}
                </span>
              </div>
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            className="rounded-xl bg-card"
            disabled={disabled}
            onClick={() => setCounts({})}
          >
            {"Limpiar conteo"}
          </Button>
          <Button disabled={disabled || !valid} className="rounded-xl" onClick={() => onConfirm(counted)}>
            {"Cerrar caja con "}
            {formatMoney(counted)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export { CashCountDialog };

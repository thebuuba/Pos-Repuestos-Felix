import { useState } from "react";
import { Check, PackageOpen, RotateCcw, X } from "lucide-react";
import { formatMoney, formatUnitMoney } from "../../lib/format.js";
import { formatBusinessDateTime } from "../../lib/dates.js";
import { cn } from "../../lib/utils.js";
import { Button } from "../ui/button.jsx";
import { Input } from "../ui/input.jsx";

const LEVEL_LABELS = { precio1: "P1", precio2: "P2", precio3: "P3" };

export function WorkshopItemsTable({ account, lines, busy = false, onReturnItem }) {
  const [returningId, setReturningId] = useState(null);
  const [returnQty, setReturnQty] = useState("");

  const activeCount = lines.filter((l) => l.netQuantity > 0).length;

  async function confirmReturn(line) {
    const qty = Number(returnQty);
    if (!Number.isFinite(qty) || qty <= 0 || qty > line.netQuantity) return;
    const ok = await onReturnItem(line, qty);
    if (ok) {
      setReturningId(null);
      setReturnQty("");
    }
  }

  return (
    <section className="sale-cart overflow-hidden rounded-2xl border border-border bg-card">
      <div className="sale-cart-heading flex items-center justify-between px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">
            Piezas despachadas · {account.customerName}
          </h2>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
            {activeCount} {activeCount === 1 ? "línea" : "líneas"}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">Precios congelados</span>
      </div>

      {lines.length === 0 ? (
        <div className="sale-cart-empty flex flex-col items-center justify-center border-t border-border px-6 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
            <PackageOpen className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="mt-3 text-sm font-semibold">Cuenta abierta sin piezas aún</p>
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
            Escanea o busca un producto arriba, o tócalo en el catálogo para despacharlo directo a esta cuenta.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-y border-border bg-muted/50 text-left text-xs font-medium text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">Producto</th>
                <th className="px-3 py-2.5 text-center font-medium">Cant.</th>
                <th className="px-3 py-2.5 text-right font-medium">Precio unit.</th>
                <th className="px-3 py-2.5 text-right font-medium">ITBIS</th>
                <th className="px-3 py-2.5 text-right font-medium">Subtotal</th>
                <th className="px-3 py-2.5 text-right font-medium">Acción</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const fullyReturned = line.netQuantity <= 0;
                const isReturning = returningId === line.id;
                return (
                  <tr
                    key={line.id}
                    className={cn(
                      "border-b border-border last:border-0 hover:bg-muted/30",
                      fullyReturned && "bg-muted/20 opacity-60",
                    )}
                  >
                    <td className="px-5 py-3">
                      <p className={cn("font-medium text-foreground", fullyReturned && "line-through")}>
                        {line.name}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{line.code}</span>
                        <span className="rounded bg-muted px-1 text-[10px] font-semibold">
                          {LEVEL_LABELS[line.priceLevel] || "P1"}
                        </span>
                        <span>{formatBusinessDateTime(line.createdAt)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center tabular-nums">
                      <span className="font-semibold">{line.netQuantity}</span>
                      {line.returnedQuantity > 0 && (
                        <p className="text-[11px] text-amber-700 dark:text-amber-400">
                          Devuelto: {line.returnedQuantity}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatUnitMoney(line.priceExact ?? line.price)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                      {formatMoney(line.itbis)}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">
                      {formatMoney(line.subtotal)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {fullyReturned ? (
                        <span className="text-xs text-muted-foreground">Devuelto</span>
                      ) : isReturning ? (
                        <div className="inline-flex items-center justify-end gap-1">
                          <Input
                            type="number"
                            step="any"
                            min="0.01"
                            max={line.netQuantity}
                            value={returnQty}
                            disabled={busy}
                            aria-label={`Cantidad a devolver de ${line.name}`}
                            onChange={(e) => setReturnQty(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { e.preventDefault(); confirmReturn(line); }
                              if (e.key === "Escape") setReturningId(null);
                            }}
                            className="h-8 w-16 rounded-lg bg-background px-2 text-center text-xs tabular-nums"
                          />
                          <Button
                            type="button"
                            size="icon"
                            className="h-8 w-8 rounded-lg"
                            disabled={busy}
                            aria-label="Confirmar devolución"
                            onClick={() => confirmReturn(line)}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 rounded-lg"
                            disabled={busy}
                            aria-label="Cancelar devolución"
                            onClick={() => setReturningId(null)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          className="h-8 rounded-lg bg-background px-2.5 text-xs"
                          onClick={() => {
                            setReturningId(line.id);
                            setReturnQty(String(line.netQuantity));
                          }}
                        >
                          <RotateCcw className="h-3 w-3" />
                          <span>Devolver</span>
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

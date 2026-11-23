import { useEffect, useRef, useState } from "react";
import { Check, CirclePause, Pencil, Play, Trash2, X } from "lucide-react";
import { formatMoney } from "../../lib/format.js";
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

export function HeldSalesDialog({
  open,
  onOpenChange,
  hasCurrentItems,
  currentItemCount,
  currentTotal,
  customer,
  activeHoldLabel,
  heldSales,
  onHoldCurrent,
  onResume,
  onRename,
  onRemove,
}) {
  const [holdName, setHoldName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [draftName, setDraftName] = useState("");
  const inputRef = useRef(null);
  const skipReturnFocusRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setEditingId(null);
      setDraftName("");
      return;
    }
    skipReturnFocusRef.current = false;
    setHoldName(activeHoldLabel || "");
    if (hasCurrentItems) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open, activeHoldLabel, hasCurrentItems]);

  function handleSaveHold(e) {
    e.preventDefault();
    if (onHoldCurrent(holdName)) {
      setHoldName("");
      skipReturnFocusRef.current = true;
      onOpenChange(false);
    }
  }

  function handleSaveRename(id) {
    if (draftName.trim()) onRename(id, draftName.trim());
    setEditingId(null);
    setDraftName("");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          if (skipReturnFocusRef.current) {
            event.preventDefault();
            skipReturnFocusRef.current = false;
          }
        }}
        className="max-w-md gap-4 rounded-2xl p-6"
        style={{ width: "calc(100vw - 2rem)", maxHeight: "calc(100dvh - 2rem)" }}
      >
        <DialogHeader className="space-y-1.5 text-left">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
              <CirclePause className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold">Ventas en espera</DialogTitle>
              <DialogDescription className="text-xs">
                Guardadas en este equipo. No descuentan inventario hasta facturarlas.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {hasCurrentItems && (
          <form
            onSubmit={handleSaveHold}
            className="space-y-3 rounded-xl border border-border bg-muted/40 p-3.5"
          >
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="held-sale-name" className="text-xs text-muted-foreground">
                  Nombre o referencia (opcional)
                </Label>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {currentItemCount} {currentItemCount === 1 ? "línea" : "líneas"} · {formatMoney(currentTotal)}
                </span>
              </div>
              <Input
                id="held-sale-name"
                ref={inputRef}
                value={holdName}
                onChange={(e) => setHoldName(e.target.value)}
                placeholder={
                  customer && !customer.isCashCustomer
                    ? customer.name
                    : "Ej. Luis - Corolla (opcional)"
                }
                className="h-11 rounded-xl bg-card"
              />
            </div>
            <Button type="submit" className="h-11 w-full rounded-xl">
              <CirclePause className="h-4 w-4" />
              <span>Poner venta actual en espera</span>
            </Button>
          </form>
        )}

        <div className="space-y-2">
          {heldSales.length > 0 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>En pausa</span>
              <span className="tabular-nums">
                {heldSales.length} {heldSales.length === 1 ? "venta" : "ventas"}
              </span>
            </div>
          )}

          {heldSales.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
              No hay ventas en espera.
            </p>
          ) : (
            <ul className="max-h-72 space-y-2 overflow-y-auto pr-0.5">
              {heldSales.map((entry) => {
                const displayName = entry.label || entry.customerName || "Cliente Contado";
                const showCustomerSub =
                  entry.label &&
                  entry.customerName &&
                  entry.label !== entry.customerName &&
                  entry.customerName !== "Cliente Contado";
                const isEditing = editingId === entry.id;

                return (
                  <li
                    key={entry.id}
                    className="rounded-xl border border-border bg-card p-3 text-sm"
                  >
                    {isEditing ? (
                      <form
                        className="flex items-center gap-1.5"
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleSaveRename(entry.id);
                        }}
                      >
                        <Input
                          autoFocus
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              setEditingId(null);
                              setDraftName("");
                            }
                          }}
                          aria-label="Nuevo nombre de venta en espera"
                          placeholder="Nombre o referencia"
                          className="h-10 flex-1 rounded-xl bg-background text-sm"
                        />
                        <Button
                          type="submit"
                          size="icon"
                          className="h-10 w-10 shrink-0 rounded-xl"
                          aria-label="Guardar nombre"
                        >
                          <Check className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-10 w-10 shrink-0 rounded-xl text-muted-foreground"
                          aria-label="Cancelar cambio de nombre"
                          onClick={() => {
                            setEditingId(null);
                            setDraftName("");
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </form>
                    ) : (
                      <div className="flex items-center justify-between gap-2.5">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{displayName}</p>
                          <p className="truncate text-xs text-muted-foreground tabular-nums">
                            {entry.items.length} {entry.items.length === 1 ? "línea" : "líneas"} ·{" "}
                            {formatMoney(entry.total)}
                            {showCustomerSub ? ` · ${entry.customerName}` : ""}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            size="sm"
                            className="h-10 rounded-xl"
                            onClick={() => {
                              skipReturnFocusRef.current = true;
                              onResume(entry.id);
                              onOpenChange(false);
                            }}
                          >
                            <Play className="h-3.5 w-3.5" />
                            <span>Retomar</span>
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-10 w-10 rounded-xl text-muted-foreground hover:text-foreground"
                            aria-label={`Renombrar venta en espera de ${displayName}`}
                            title="Cambiar nombre"
                            onClick={() => {
                              setEditingId(entry.id);
                              setDraftName(displayName);
                            }}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-10 w-10 rounded-xl text-muted-foreground hover:text-primary"
                            aria-label={`Eliminar venta en espera de ${displayName}`}
                            title="Eliminar"
                            onClick={() => onRemove(entry.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

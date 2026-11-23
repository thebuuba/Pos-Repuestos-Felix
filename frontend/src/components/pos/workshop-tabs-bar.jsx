import { useEffect, useRef, useState } from "react";
import { Plus, Printer, ShoppingBag, Wrench, X, XCircle } from "lucide-react";
import { formatMoney } from "../../lib/format.js";
import { cn } from "../../lib/utils.js";
import { Button } from "../ui/button.jsx";
import { Input } from "../ui/input.jsx";

export function WorkshopTabsBar({
  openAccounts,
  totalsById,
  activeWorkshopId,
  activeWorkshop,
  cartCount = 0,
  busy = false,
  disabled = false,
  onSelectNormal,
  onSelectWorkshop,
  onCreateWorkshop,
  onPrintStatement,
  onCancelWorkshop,
}) {
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [withCart, setWithCart] = useState(true);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    setConfirmingCancel(false);
  }, [activeWorkshopId]);

  useEffect(() => {
    if (creating) {
      setWithCart(cartCount > 0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [creating]);

  async function handleSubmit(e) {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed || busy) return;
    const ok = await onCreateWorkshop(trimmed, withCart && cartCount > 0);
    if (ok) {
      setLabel("");
      setCreating(false);
    }
  }

  return (
    <div className="space-y-2 rounded-2xl border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onSelectNormal}
          className={cn(
            "inline-flex min-h-10 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors",
            activeWorkshopId === null
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-background text-foreground hover:bg-muted/60",
          )}
        >
          <ShoppingBag className="h-3.5 w-3.5" />
          <span>Venta normal</span>
          {cartCount > 0 && (
            <span className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
              activeWorkshopId === null ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-foreground",
            )}>
              {cartCount}
            </span>
          )}
        </button>

        {openAccounts.map((acc) => {
          const isActive = acc.id === activeWorkshopId;
          const total = totalsById.get(acc.id)?.totals.total ?? 0;
          const title = acc.mechanic && acc.customerName !== acc.mechanic
            ? `${acc.customerName} (${acc.mechanic})`
            : acc.customerName;
          return (
            <button
              key={acc.id}
              type="button"
              disabled={busy}
              onClick={() => onSelectWorkshop(acc)}
              className={cn(
                "inline-flex min-h-10 max-w-full items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors",
                isActive
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-amber-500/40 bg-amber-500/10 text-foreground hover:bg-amber-500/20",
              )}
            >
              <Wrench className="h-3.5 w-3.5 shrink-0" />
              <span className="max-w-[160px] truncate">{title}</span>
              <span className={cn(
                "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums",
                isActive ? "bg-primary-foreground/20 text-primary-foreground" : "bg-background/80 text-foreground",
              )}>
                {formatMoney(total)}
              </span>
            </button>
          );
        })}

        {!creating ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy || disabled}
            className="h-10 rounded-xl bg-background"
            onClick={() => setCreating(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Nueva cuenta</span>
          </Button>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
            <Input
              ref={inputRef}
              value={label}
              disabled={busy}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setCreating(false);
                  setLabel("");
                }
              }}
              placeholder="Nombre, mecánico o vehículo…"
              aria-label="Nombre de cuenta de taller"
              className="h-10 w-56 rounded-xl bg-background text-sm sm:w-64"
            />
            {cartCount > 0 && (
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-border bg-muted/40 px-2.5 py-2 text-xs">
                <input
                  type="checkbox"
                  checked={withCart}
                  disabled={busy}
                  onChange={(e) => setWithCart(e.target.checked)}
                  style={{ accentColor: "hsl(var(--primary))" }}
                />
                <span>Con carrito ({cartCount})</span>
              </label>
            )}
            <Button type="submit" size="sm" className="h-10 rounded-xl" disabled={busy || !label.trim()}>
              {busy ? "Abriendo…" : "Abrir"}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-10 w-10 rounded-xl"
              disabled={busy}
              aria-label="Cancelar nueva cuenta"
              onClick={() => { setCreating(false); setLabel(""); }}
            >
              <X className="h-4 w-4" />
            </Button>
          </form>
        )}
      </div>

      {activeWorkshop && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5 text-xs">
          <p className="text-muted-foreground">
            <strong className="text-foreground">Cuenta taller #{activeWorkshop.id} · {activeWorkshop.customerName}</strong>
            {" — cada pieza que agregues descuenta inventario y congela su precio al instante."}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-9 rounded-xl bg-background text-xs"
              disabled={busy || (totalsById.get(activeWorkshop.id)?.totals.items ?? 0) <= 0}
              onClick={onPrintStatement}
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Imprimir lista</span>
            </Button>
            {!confirmingCancel ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-9 rounded-xl text-xs text-destructive hover:text-destructive"
                disabled={busy}
                onClick={() => setConfirmingCancel(true)}
              >
                <XCircle className="h-3.5 w-3.5" />
                <span>Cancelar cuenta</span>
              </Button>
            ) : (
              <div className="flex items-center gap-1.5 rounded-xl border border-destructive/30 bg-destructive/10 px-2.5 py-1">
                <span className="font-medium text-destructive">¿Devolver piezas y cancelar?</span>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="h-7 rounded-lg px-2 text-xs"
                  disabled={busy}
                  onClick={async () => {
                    await onCancelWorkshop();
                    setConfirmingCancel(false);
                  }}
                >
                  Sí
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 rounded-lg px-2 text-xs"
                  disabled={busy}
                  onClick={() => setConfirmingCancel(false)}
                >
                  No
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

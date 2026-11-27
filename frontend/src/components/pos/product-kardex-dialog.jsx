import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  History,
  PackagePlus,
  RefreshCw,
  RotateCcw,
  SlidersHorizontal,
  Wrench,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.jsx";
import { Button } from "../ui/button.jsx";
import { cn } from "../../lib/utils.js";
import { formatDateTime } from "../../lib/accounts.js";
import { formatNumber } from "../../lib/format.js";
import { formatSaleNumber } from "../../data/operational-sales.js";

const MOVEMENT_META = {
  apertura: {
    label: "Apertura",
    icon: PackagePlus,
    tone: "bg-muted text-muted-foreground",
  },
  venta: {
    label: "Venta",
    icon: ArrowUpRight,
    tone: "bg-accent text-primary",
  },
  compra: {
    label: "Compra",
    icon: ArrowDownLeft,
    tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  ajuste: {
    label: "Ajuste",
    icon: SlidersHorizontal,
    tone: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  anulacion_venta: {
    label: "Anulación de venta",
    icon: RotateCcw,
    tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  anulacion_compra: {
    label: "Anulación de compra",
    icon: RotateCcw,
    tone: "bg-accent text-primary",
  },
  taller_despacho: {
    label: "Taller · despacho",
    icon: Wrench,
    tone: "bg-accent text-primary",
  },
  taller_devolucion: {
    label: "Taller · devolución",
    icon: Wrench,
    tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
};

function referenceLabel(m) {
  if (m.saleId != null) return formatSaleNumber(m.saleId);
  if (m.purchaseNumber) return `Compra ${m.purchaseNumber}`;
  if (m.purchaseId != null) return `C-${String(m.purchaseId).padStart(6, "0")}`;
  return "";
}

function ProductKardexDialog({ product, onOpenChange, fetchMovements }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const productId = product?.id ?? null;

  const requestSeqRef = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeqRef.current;
    if (!productId || !fetchMovements) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await fetchMovements(productId);
      if (requestSeqRef.current !== seq) return;
      setData(result);
    } catch (cause) {
      if (requestSeqRef.current !== seq) return;
      setError(cause?.message || "No se pudo cargar el historial de movimientos.");
    } finally {
      if (requestSeqRef.current === seq) setLoading(false);
    }
  }, [productId, fetchMovements]);

  useEffect(() => {
    if (productId) load();
    else {
      requestSeqRef.current += 1;
      setData(null);
      setError(null);
      setLoading(false);
    }
    return () => { requestSeqRef.current += 1; };
  }, [productId, load]);

  const movements = data?.movements ?? [];
  const currentStock = data?.product?.stock ?? product?.stock ?? 0;
  const currentMin = data?.product?.minStock ?? product?.minStock ?? 0;
  const metaParts = [product?.code, product?.reference && `Ref. ${product.reference}`, product?.brand, product?.location].filter(Boolean);

  return (
    <Dialog open={Boolean(product)} onOpenChange={onOpenChange}>
      <DialogContent
        className="gap-0 overflow-hidden rounded-2xl p-0"
        style={{
          display: "flex",
          flexDirection: "column",
          width: "calc(100vw - 2rem)",
          maxWidth: "36rem",
          maxHeight: "calc(100dvh - 2rem)",
        }}
      >
        <div className="border-b border-border bg-card px-5 pb-4 pt-5">
          <DialogHeader className="text-left">
            <DialogTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-primary" />
              <span>{"Historial de movimientos"}</span>
            </DialogTitle>
            {product && (
              <DialogDescription asChild>
                <div className="mt-1 space-y-1.5">
                  <p className="text-sm font-medium text-foreground">{product.name}</p>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="font-mono" style={{ overflowWrap: "anywhere" }}>
                      {metaParts.join(" · ")}
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 font-medium text-foreground tabular-nums">
                      {`Existencia actual: ${formatNumber(currentStock)}`}
                      {currentMin > 0 ? ` · mín. ${formatNumber(currentMin)}` : ""}
                    </span>
                  </div>
                </div>
              </DialogDescription>
            )}
          </DialogHeader>
        </div>

        <div className="flex-1 overflow-y-auto bg-background px-5 py-4" style={{ overscrollBehavior: "contain" }}>
          {!fetchMovements ? (
            <div className="rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
              {"El historial de movimientos está disponible cuando el sistema está conectado a la base de datos."}
            </div>
          ) : loading && !data ? (
            <div role="status" className="flex items-center justify-center gap-2 rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">
              <RefreshCw className="h-4 w-4 animate-spin" />
              <span>{"Cargando movimientos…"}</span>
            </div>
          ) : error ? (
            <div role="alert" className="space-y-3 rounded-xl border border-destructive/30 bg-accent p-4 text-sm">
              <p className="font-medium text-destructive">{error}</p>
              <Button type="button" variant="outline" size="sm" className="rounded-xl bg-card" onClick={load}>
                {"Reintentar"}
              </Button>
            </div>
          ) : movements.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center">
              <History className="mx-auto h-7 w-7 text-muted-foreground" />
              <p className="mt-2.5 text-sm font-semibold text-foreground">{"Sin movimientos registrados"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {"Las ventas, compras, despachos de taller y ajustes aparecerán aquí."}
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <ul className="divide-y divide-border" aria-label="Movimientos del artículo">
                {movements.map((m) => {
                  const meta = MOVEMENT_META[m.type] ?? {
                    label: m.type || "Movimiento",
                    icon: SlidersHorizontal,
                    tone: "bg-muted text-muted-foreground",
                  };
                  const Icon = meta.icon;
                  const positive = m.quantity > 0;
                  const ref = referenceLabel(m);
                  return (
                    <li key={m.id} className="flex items-start gap-3 px-4 py-3">
                      <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl", meta.tone)}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="text-sm font-medium text-foreground">{meta.label}</span>
                          {ref && (
                            <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                              {ref}
                            </span>
                          )}
                        </div>
                        {m.reason && (
                          <p className="mt-0.5 text-xs text-muted-foreground" style={{ overflowWrap: "anywhere" }}>
                            {m.reason}
                          </p>
                        )}
                        <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
                          {formatDateTime(m.date)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right tabular-nums">
                        <p
                          className={cn(
                            "text-sm font-semibold",
                            positive
                              ? "text-emerald-700 dark:text-emerald-400"
                              : "text-primary",
                          )}
                        >
                          {positive ? `+${formatNumber(m.quantity)}` : `−${formatNumber(Math.abs(m.quantity))}`}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {`Saldo: ${formatNumber(m.stockAfter)}`}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 border-t border-border bg-card px-5 py-3.5 sm:justify-between">
          {fetchMovements ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 rounded-xl bg-card"
              disabled={loading}
              onClick={load}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              <span>{"Actualizar"}</span>
            </Button>
          ) : <span />}
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-xl bg-card"
            onClick={() => onOpenChange(false)}
          >
            {"Cerrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { ProductKardexDialog };

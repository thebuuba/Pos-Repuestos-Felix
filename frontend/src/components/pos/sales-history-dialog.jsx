import { useMemo, useState } from "react";
import { Printer, ReceiptText, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.jsx";
import { Button } from "../ui/button.jsx";
import { Input } from "../ui/input.jsx";
import { formatDateTime } from "../../lib/accounts.js";
import { formatMoney } from "../../lib/format.js";
import { businessDay, paymentLabel } from "../../lib/sales-analytics.js";
import { cn } from "../../lib/utils.js";

const STATUS_UI = {
  pagada: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
  pendiente: "border-foreground/50 text-foreground",
  anulada: "border-primary/50 text-primary line-through",
};

export function SalesHistoryDialog({ open, onOpenChange, sales, onSelect }) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("hoy");
  const today = businessDay();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (sales ?? [])
      .filter((s) => scope === "todas" || businessDay(s.date) === today)
      .filter(
        (s) =>
          !q ||
          (s.number || "").toLowerCase().includes(q) ||
          (s.customerName || "").toLowerCase().includes(q) ||
          (s.ncf || "").toLowerCase().includes(q),
      )
      .slice(0, 40);
  }, [sales, scope, today, query]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="sales-history-dialog max-w-2xl rounded-2xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
              <ReceiptText className="h-5 w-5" />
            </span>
            <div className="min-w-0 text-left">
              <DialogTitle className="text-lg">{"Facturas recientes"}</DialogTitle>
              <DialogDescription className="text-xs">
                {"Busca una venta y ábrela para ver o reimprimir el ticket."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 border-y border-border bg-muted/50 px-6 py-3">
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                aria-label="Buscar factura para reimprimir"
                placeholder="Factura, NCF o cliente…"
                className="h-10 rounded-xl bg-card pl-9"
              />
            </div>
            <div className="flex rounded-full bg-card p-1 shadow-sm ring-1 ring-border">
              {[
                { value: "hoy", label: "Hoy" },
                { value: "todas", label: "Todas" },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={scope === option.value}
                  onClick={() => setScope(option.value)}
                  className={cn(
                    "h-8 rounded-full px-3.5 text-xs font-medium transition-colors",
                    scope === option.value
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="sales-history-list overflow-y-auto px-6 py-4">
          {filtered.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm font-medium text-foreground">
                {scope === "hoy" && !query.trim()
                  ? "No hay facturas registradas hoy"
                  : "No se encontraron facturas"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {scope === "hoy" && !query.trim()
                  ? "Cambia a «Todas» para buscar ventas de días anteriores."
                  : "Prueba con otro número de factura, NCF o nombre de cliente."}
              </p>
              {scope === "hoy" && !query.trim() && (sales?.length ?? 0) > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 rounded-xl"
                  onClick={() => setScope("todas")}
                >
                  {"Ver todas las facturas"}
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              {filtered.map((sale) => (
                <div
                  key={sale.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:bg-muted/50"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onSelect(sale)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-foreground">
                        {sale.number}
                      </span>
                      <span
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize",
                          STATUS_UI[sale.status],
                        )}
                      >
                        {sale.status ?? "Registrada"}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-sm text-foreground">
                      {sale.customerName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(sale.createdAt || sale.date)}
                      {" · "}
                      {paymentLabel(sale)}
                      {sale.ncf ? ` · ${sale.ncf}` : ""}
                    </p>
                  </button>
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={cn(
                        "text-sm font-semibold tabular-nums",
                        sale.status === "anulada" && "text-muted-foreground line-through",
                      )}
                    >
                      {formatMoney(sale.total)}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-xl px-3 text-xs"
                      aria-label={`Reimprimir ${sale.number}`}
                      onClick={() => onSelect(sale)}
                    >
                      <Printer className="h-3.5 w-3.5" />
                      <span>{"Reimprimir"}</span>
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

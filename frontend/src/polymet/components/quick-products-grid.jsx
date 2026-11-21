// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { CATEGORIES } from "../data/pos-data.js";
import { cn } from "../../lib/utils.js";
import { Plus } from "lucide-react";
import { formatMoney } from "../lib/format.js";
import { useMemo } from "react";
import { useState } from "react";
var ALL = "Todos";
function QuickProductsGrid({
  products,
  priceLevel,
  onAdd,
  cartQuantities = {},
}) {
  const [category, setCategory] = useState(ALL);
  const filtered = useMemo(
    () =>
      category === ALL
        ? products
        : products.filter((p) => p.category === category),
    [products, category],
  );
  return (
    <div>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {[ALL, ...CATEGORIES].map((c) => (
          <button
            type="button"
            onClick={() => setCategory(c)}
            className={cn(
              "h-8 shrink-0 rounded-full border px-3.5 text-xs font-medium transition-colors",
              category === c
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground",
            )}
            key={c}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="mt-3 grid max-h-[248px] grid-cols-2 gap-2.5 overflow-y-auto pr-1 sm:grid-cols-3 xl:grid-cols-4">
        {filtered.map((p) => {
          const out = p.stock === 0;
          const low = !out && p.stock <= p.minStock;
          const inCart = cartQuantities[p.id];
          return (
            <button
              type="button"
              disabled={out}
              onClick={() => onAdd(p)}
              className={cn(
                "group relative flex flex-col items-start rounded-xl border border-border bg-card p-3 text-left transition-all",
                out
                  ? "cursor-not-allowed opacity-50"
                  : "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md",
                inCart && "border-primary/50 ring-1 ring-primary/30",
              )}
              key={p.id}
            >
              {inCart && (
                <span className="absolute right-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                  {inCart}
                </span>
              )}
              <span className="font-mono text-[10px] text-muted-foreground">
                {p.code}
              </span>
              <span className="mt-0.5 line-clamp-2 min-h-[2.5rem] pr-4 text-[13px] font-medium leading-snug text-foreground">
                {p.name}
              </span>
              <div className="mt-2 flex w-full items-end justify-between gap-2">
                <span className="inline-flex items-center gap-1 text-sm font-semibold tabular-nums transition-colors group-hover:text-primary">
                  {!out && (
                    <Plus className="hidden h-3.5 w-3.5 group-hover:inline" />
                  )}
                  {formatMoney(p.prices[priceLevel])}
                </span>
                <span
                  className={cn(
                    "flex items-center gap-1 text-[10px] font-medium",
                    out
                      ? "text-primary"
                      : low
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-muted-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      out
                        ? "bg-primary"
                        : low
                          ? "bg-amber-500"
                          : "bg-emerald-500",
                    )}
                  />
                  {out ? "Agotado" : p.stock}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
export { QuickProductsGrid };

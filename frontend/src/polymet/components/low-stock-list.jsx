// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { Button } from "../../components/ui/button.jsx";
import { Link } from "react-router-dom";
import { cn } from "../../lib/utils.js";
import { TriangleAlert } from "lucide-react";
function LowStockList({ products }) {
  return (
    <section className="flex h-full flex-col rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[17px] font-medium">
          {"Bajo inventario"}
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
            {products.length}
          </span>
        </h2>
        <Button
          asChild={true}
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
        >
          <Link to="/inventario">{"Ver inventario"}</Link>
        </Button>
      </div>
      {products.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {"Todo el inventario está en niveles saludables."}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {products.map((p) => {
            const pct = Math.min(100, Math.round((p.stock / p.minStock) * 100));
            const out = p.stock === 0;
            return (
              <li className="flex items-center gap-3 py-3" key={p.id}>
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                    out
                      ? "bg-accent text-primary"
                      : "bg-amber-500/10 text-amber-600",
                  )}
                >
                  <TriangleAlert className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    <span
                      className={cn(
                        "shrink-0 text-xs font-semibold tabular-nums",
                        out
                          ? "text-primary"
                          : "text-amber-600 dark:text-amber-400",
                      )}
                    >
                      {p.stock}
                      {"/"}
                      {p.minStock}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        out ? "bg-primary" : "bg-amber-500",
                      )}
                      style={{
                        width: `${Math.max(pct, 4)}%`,
                      }}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
export { LowStockList };

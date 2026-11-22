// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { PackageSearch, Pencil, Search, Trash2 } from "lucide-react";
import { Input } from "../../components/ui/input.jsx";
import { Select2 } from "../../components/ui/select.jsx";
import { SelectTrigger2 } from "../../components/ui/select.jsx";
import { SelectValue2 } from "../../components/ui/select.jsx";
import { SelectContent2 } from "../../components/ui/select.jsx";
import { SelectItem2 } from "../../components/ui/select.jsx";
import { cn } from "../../lib/utils.js";
import { formatNumber, formatUnitMoney } from "../lib/format.js";
import { Button } from "../../components/ui/button.jsx";
import { memo, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
const PAGE_SIZE = 50;
const STOCK_FILTERS = [
  ["all", "Todos"],
  ["ok", "OK"],
  ["low", "Bajo"],
  ["out", "Agotado"],
];
function needsRestock(p) {
  return p.notifyMinStock !== false && (p.stock === 0 || (p.stock > 0 && p.stock <= p.minStock));
}
function stockState(p) {
  if (p.stock === 0) return "out";
  if (needsRestock(p)) return "low";
  return "ok";
}
var STATE_UI = {
  ok: {
    label: "Disponible",
    dot: "bg-emerald-500",
    text: "text-emerald-700 dark:text-emerald-400",
    bg: "bg-emerald-500/10",
  },
  low: {
    label: "Bajo",
    dot: "bg-amber-500",
    text: "text-amber-700 dark:text-amber-400",
    bg: "bg-amber-500/10",
  },
  out: {
    label: "Agotado",
    dot: "bg-primary",
    text: "text-primary",
    bg: "bg-accent",
  },
};
const InventoryTable = memo(function InventoryTable({ products, categories, connected, onEdit, onDelete }) {
  const [params, setParams] = useSearchParams();
  const { key } = useLocation();
  const selectedStock = params.get("existencia");
  const restock = selectedStock === "reposicion";
  const stock = restock || STOCK_FILTERS.some(([value]) => value === selectedStock) ? selectedStock : "all";
  const [filters, setFilters] = useState({ query: "", category: "", page: 0, stock, restockKey: key });
  const { query } = filters;
  const category = categories.includes(filters.category) ? filters.category : "";
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (category && p.category !== category) return false;
      if (restock ? !needsRestock(p) : stock !== "all" && stockState(p) !== stock) return false;
      if (!q) return true;
      return (
        p.code.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q)
      );
    });
  }, [products, query, category, stock, restock]);
  const lastPage = Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1);
  const resetPage = stock !== filters.stock || category !== filters.category;
  const page = resetPage ? 0 : Math.min(filters.page, lastPage);
  if (restock && filters.restockKey !== key) {
    setFilters({ query: "", category: "", page: 0, stock, restockKey: key });
  } else if (resetPage || filters.page !== page) {
    setFilters({ ...filters, category, page, stock });
  }
  const start = page * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, rows.length);
  const paginated = connected || lastPage > 0;
  const range = rows.length ? `${formatNumber(start + 1)}–${formatNumber(end)}` : "0";
  const setStock = (value) => {
    setFilters({ ...filters, page: 0 });
    if (value === stock) return;
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === "all") next.delete("existencia");
        else next.set("existencia", value);
        return next;
      },
      { replace: true },
    );
  };
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-col gap-3 p-5 md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Buscar por código, nombre o marca"
            value={query}
            onChange={(e) => setFilters({ ...filters, query: e.target.value, page: 0 })}
            placeholder="Buscar por código, nombre o marca…"
            className="h-10 rounded-xl pl-9"
          />
        </div>
        <Select2
          value={category ? `categoria:${category}` : "all"}
          onValueChange={(value) => setFilters({
            ...filters,
            category: value === "all" ? "" : value.slice("categoria:".length),
            page: 0,
          })}
        >
          <SelectTrigger2 aria-label="Filtrar por categoría" className="h-10 rounded-xl md:w-[180px]">
            <SelectValue2 />
          </SelectTrigger2>
          <SelectContent2>
            <SelectItem2 value="all">{"Todas las categorías"}</SelectItem2>
            {categories.map((c) => (
              <SelectItem2 value={`categoria:${c}`} key={c}>
                {c}
              </SelectItem2>
            ))}
          </SelectContent2>
        </Select2>
        <div className="mobile-touch-controls grid grid-cols-4 gap-1 rounded-xl bg-muted p-1">
          {STOCK_FILTERS.map(([value, label]) => (
            <button
              type="button"
              aria-pressed={stock === value}
              onClick={() => setStock(value)}
              className={cn(
                "h-8 rounded-lg px-3 text-xs font-medium transition-all focus-visible:ring-1 focus-visible:ring-ring",
                stock === value
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              key={value}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="flex flex-col items-center border-t border-border px-6 py-14 text-center">
          <PackageSearch className="h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-semibold">{"Sin resultados"}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {"Ajusta la búsqueda o los filtros."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-y border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">{"Producto"}</th>
                <th className="px-3 py-2.5 font-medium">{"Categoría"}</th>
                <th className="px-3 py-2.5 font-medium">{"Ubic."}</th>
                <th className="px-3 py-2.5 font-medium">{"Existencia"}</th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {"Costo"}
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {"Precio 1"}
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {"Precio 2"}
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {"Precio 3"}
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {"Margen"}
                </th>
                <th className="w-24 px-5 py-2.5 text-right font-medium">
                  {"Acciones"}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(start, end).map((p) => {
                const state = stockState(p);
                const ui = STATE_UI[state];
                const margin = p.prices.p1 > 0 ? ((p.prices.p1 - p.cost) / p.prices.p1) * 100 : null;
                const fill = p.minStock > 0 ? Math.max(3, Math.min(100, (p.stock / (p.minStock * 3)) * 100)) : 0;
                return (
                  <tr
                    onDoubleClick={() => onEdit?.(p)}
                    className="border-b border-border last:border-0 hover:bg-muted/30"
                    key={p.id}
                  >
                    <td className="px-5 py-3">
                      <p className="font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground">
                        <span
                          className="font-mono"
                          style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                        >
                          {p.code}
                        </span>
                        {" · "}
                        {p.brand}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {p.category}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                      {p.location}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-3">
                        <span
                          className={cn(
                            "inline-flex w-[92px] items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium",
                            ui.bg,
                            ui.text,
                          )}
                        >
                          <span
                            className={cn("h-1.5 w-1.5 rounded-full", ui.dot)}
                          />
                          {ui.label}
                        </span>
                        <div className="w-24" style={{ minWidth: "max-content" }}>
                          <div className="flex justify-between gap-2 whitespace-nowrap text-xs tabular-nums">
                            <span className="font-semibold">{formatNumber(p.stock)}</span>
                            <span className="text-muted-foreground">
                              {"mín. "}
                              {formatNumber(p.minStock)}
                            </span>
                          </div>
                          <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className={cn("h-full rounded-full", ui.dot)}
                              style={{
                                width: `${fill}%`,
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                      {formatUnitMoney(p.costExact ?? p.cost)}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">
                      {formatUnitMoney(p.pricesExact?.p1 ?? p.prices.p1)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatUnitMoney(p.pricesExact?.p2 ?? p.prices.p2)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatUnitMoney(p.pricesExact?.p3 ?? p.prices.p3)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                      {margin === null ? "—" : `${margin.toFixed(1)}%`}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                          onClick={() => onEdit?.(p)}
                          aria-label="Editar"
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:bg-accent hover:text-primary"
                          onClick={() => onDelete?.(p)}
                          aria-label="Eliminar"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-5 py-3 text-xs text-muted-foreground">
        <p role="status" aria-live="polite">
          {restock && "Reposición · "}
          <span>{paginated
            ? `Mostrando ${range} de ${formatNumber(rows.length)} ${rows.length === 1 ? "producto" : "productos"}`
            : `Mostrando ${formatNumber(rows.length)} de ${formatNumber(products.length)} productos`}</span>
        </p>
        {paginated && (
          <nav aria-label="Páginas del inventario" className="mobile-touch-controls flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-xl bg-card"
              disabled={page === 0}
              onClick={() => setFilters({ ...filters, page: page - 1 })}
            >
              {"Anterior"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-xl bg-card"
              disabled={page === lastPage}
              onClick={() => setFilters({ ...filters, page: page + 1 })}
            >
              {"Siguiente"}
            </Button>
          </nav>
        )}
      </div>
    </section>
  );
});
export { InventoryTable, needsRestock, stockState };

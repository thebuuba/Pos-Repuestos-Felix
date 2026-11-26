// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { ArrowDown, ArrowUp, ArrowUpDown, History, PackageSearch, Pencil, Search, Trash2 } from "lucide-react";
import { Input } from "../ui/input.jsx";
import { Select } from "../ui/select.jsx";
import { SelectTrigger } from "../ui/select.jsx";
import { SelectValue } from "../ui/select.jsx";
import { SelectContent } from "../ui/select.jsx";
import { SelectItem } from "../ui/select.jsx";
import { cn } from "../../lib/utils.js";
import { formatNumber, formatUnitMoney } from "../../lib/format.js";
import { Button } from "../ui/button.jsx";
import { memo, useDeferredValue, useMemo, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { filterAndSortCatalog } from "../../data/product-search.js";
const PAGE_SIZE = 50;
const INV_SCOPE_OPTIONS = [
  { key: "all", label: "Todo" },
  { key: "reference", label: "Solo ref." },
  { key: "code", label: "Código" },
  { key: "name", label: "Nombre" },
];
const INV_SORT_OPTIONS = [
  { value: "default:asc", label: "Orden original" },
  { value: "stock:asc", label: "Existencia: 0 → +" },
  { value: "stock:desc", label: "Existencia: + → 0" },
  { value: "reference:asc", label: "Referencia (A–Z)" },
  { value: "code:asc", label: "Código (A–Z)" },
  { value: "name:asc", label: "Nombre (A–Z)" },
  { value: "p1:asc", label: "Precio 1: menor" },
  { value: "p1:desc", label: "Precio 1: mayor" },
];
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
const InventoryTable = memo(function InventoryTable({ products, categories, connected, showCosts = true, onEdit, onDelete, onHistory }) {
  const showActions = Boolean(onEdit || onDelete || onHistory);
  const [params, setParams] = useSearchParams();
  const { key } = useLocation();
  const selectedStock = params.get("existencia");
  const urlQuery = params.get("buscar") ?? "";
  const restock = selectedStock === "reposicion";
  const stock = restock || STOCK_FILTERS.some(([value]) => value === selectedStock) ? selectedStock : "all";
  const [filters, setFilters] = useState({ query: urlQuery, scope: "all", category: "", location: "", sortBy: "default", sortDir: "asc", page: 0, stock, restockKey: key, urlQuery });
  const { query, scope = "all", sortBy = "default", sortDir = "asc" } = filters;
  const deferredQuery = useDeferredValue(query);
  const locations = useMemo(() => {
    const used = new Set();
    for (const p of products) {
      const clean = typeof p.location === "string" ? p.location.trim() : "";
      if (clean) used.add(clean);
    }
    return [...used].sort((a, b) => a.localeCompare(b, "es"));
  }, [products]);
  const category = categories.includes(filters.category) ? filters.category : "";
  const location = locations.includes(filters.location) ? filters.location : "";
  const rows = useMemo(
    () =>
      filterAndSortCatalog(products, {
        query: deferredQuery,
        scope,
        stockFilter: restock ? "restock" : stock,
        category,
        location,
        sortBy,
        sortDir,
      }),
    [products, deferredQuery, scope, category, location, stock, restock, sortBy, sortDir],
  );
  const toggleSort = (column) => {
    setFilters((prev) => ({
      ...prev,
      page: 0,
      sortBy: column,
      sortDir: prev.sortBy === column ? (prev.sortDir === "asc" ? "desc" : "asc") : "asc",
    }));
  };
  const renderSortIcon = (column) => {
    if (sortBy !== column) return <ArrowUpDown className="h-3 w-3 opacity-45" />;
    return sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5 text-primary" /> : <ArrowDown className="h-3.5 w-3.5 text-primary" />;
  };
  const lastPage = Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1);
  const resetPage = stock !== filters.stock || category !== filters.category || location !== filters.location;
  const page = resetPage ? 0 : Math.min(filters.page, lastPage);
  if (urlQuery !== filters.urlQuery) {
    setFilters({ query: urlQuery, scope: "all", category: "", location: "", sortBy: "default", sortDir: "asc", page: 0, stock, restockKey: key, urlQuery });
  } else if (restock && filters.restockKey !== key) {
    setFilters({ query: "", scope: "all", category: "", location: "", sortBy: "default", sortDir: "asc", page: 0, stock, restockKey: key, urlQuery });
  } else if (resetPage || filters.page !== page) {
    setFilters({ ...filters, category, location, page, stock });
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
      <div className="inv-toolbar">
        <div className="inv-toolbar-search">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Buscar por código, nombre o marca"
            data-shortcut-search="true"
            value={query}
            onChange={(e) => setFilters({ ...filters, query: e.target.value, page: 0 })}
            placeholder="Buscar por código, referencia, nombre o marca…"
            className="h-10 rounded-xl pl-9"
          />
        </div>
        <div className="inv-toolbar-controls">
          {connected && (
            <Select
              value={scope}
              onValueChange={(value) => setFilters({ ...filters, scope: value, page: 0 })}
            >
              <SelectTrigger aria-label="Buscar en campo" className="inv-toolbar-select h-10 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INV_SCOPE_OPTIONS.map((opt) => (
                  <SelectItem value={opt.key} key={opt.key}>
                    {`En: ${opt.label}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {connected && (
            <Select
              value={`${sortBy}:${sortDir}`}
              onValueChange={(value) => {
                const [col, dir] = value.split(":");
                setFilters({ ...filters, sortBy: col, sortDir: dir, page: 0 });
              }}
            >
              <SelectTrigger aria-label="Ordenar inventario" className="inv-toolbar-select h-10 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INV_SORT_OPTIONS.map((opt) => (
                  <SelectItem value={opt.value} key={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select
            value={category ? `categoria:${category}` : "all"}
            onValueChange={(value) => setFilters({
              ...filters,
              category: value === "all" ? "" : value.slice("categoria:".length),
              page: 0,
            })}
          >
            <SelectTrigger aria-label="Filtrar por categoría" className="inv-toolbar-select h-10 rounded-xl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{"Todas las categorías"}</SelectItem>
              {categories.map((c) => (
                <SelectItem value={`categoria:${c}`} key={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {locations.length > 0 && (
            <Select
              value={location ? `ubicacion:${location}` : "all"}
              onValueChange={(value) => setFilters({
                ...filters,
                location: value === "all" ? "" : value.slice("ubicacion:".length),
                page: 0,
              })}
            >
              <SelectTrigger aria-label="Filtrar por ubicación" className="inv-toolbar-select h-10 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{"Todas las ubicaciones"}</SelectItem>
                {locations.map((loc) => (
                  <SelectItem value={`ubicacion:${loc}`} key={loc}>
                    {loc}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="inv-toolbar-stock mobile-touch-controls grid grid-cols-4 gap-1 rounded-xl bg-muted p-1">
            {STOCK_FILTERS.map(([value, label]) => (
              <button
                type="button"
                aria-pressed={stock === value}
                onClick={() => setStock(value)}
                className={cn(
                  "h-8 rounded-lg px-3 text-xs font-medium whitespace-nowrap transition-all focus-visible:ring-1 focus-visible:ring-ring",
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
        <>
          <div className="grid gap-3 border-t border-border p-4 lg:hidden">
            {rows.slice(start, end).map((p) => {
              const state = stockState(p);
              const ui = STATE_UI[state];
              const margin = p.prices.p1 > 0 ? ((p.prices.p1 - p.cost) / p.prices.p1) * 100 : null;
              const fill = p.minStock > 0 ? Math.max(3, Math.min(100, (p.stock / (p.minStock * 3)) * 100)) : 0;
              const meta = [p.reference && `Ref. ${p.reference}`, p.brand, p.category, p.location].filter(Boolean).join(" · ");
              return (
                <article
                  key={p.id}
                  className="space-y-3 rounded-2xl border border-border bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium leading-snug text-foreground">{p.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        <span
                          className="font-mono"
                          style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                        >
                          {p.code}
                        </span>
                        {meta ? ` · ${meta}` : ""}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium",
                        ui.bg,
                        ui.text,
                      )}
                    >
                      <span className={cn("h-1.5 w-1.5 rounded-full", ui.dot)} />
                      {ui.label}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center justify-between text-xs tabular-nums">
                      <span className="font-semibold text-foreground">
                        {"Existencia: "}
                        {formatNumber(p.stock)}
                      </span>
                      <span className="text-muted-foreground">
                        {"mín. "}
                        {formatNumber(p.minStock)}
                      </span>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-muted">
                      <div className={cn("h-full rounded-full", ui.dot)} style={{ width: `${fill}%` }} />
                    </div>
                  </div>
                  <div className="space-y-2 rounded-xl bg-muted/50 p-2.5 text-xs tabular-nums">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="min-w-0">
                        <p className="text-[11px] text-muted-foreground">{"P1 · Detalle"}</p>
                        <p className="truncate font-semibold text-foreground">
                          {formatUnitMoney(p.pricesExact?.p1 ?? p.prices.p1)}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[11px] text-muted-foreground">{"P2 · P/Mayor"}</p>
                        <p className="truncate font-medium text-foreground">
                          {formatUnitMoney(p.pricesExact?.p2 ?? p.prices.p2)}
                        </p>
                      </div>
                    </div>
                    {showCosts && (
                      <div className="grid grid-cols-2 gap-2 border-t border-border/60 pt-2">
                        <div className="min-w-0">
                          <p className="text-[11px] text-muted-foreground">{"Costo"}</p>
                          <p className="truncate font-medium text-muted-foreground">
                            {formatUnitMoney(p.costExact ?? p.cost)}
                          </p>
                        </div>
                        <div className="min-w-0 text-right">
                          <p className="text-[11px] text-muted-foreground">{"Margen"}</p>
                          <p className="truncate font-medium text-muted-foreground">
                            {margin === null ? "—" : `${margin.toFixed(1)}%`}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  {showActions && (
                    <div className="flex flex-wrap gap-2 pt-0.5">
                      {onHistory && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-11 flex-1 rounded-xl text-xs"
                          onClick={() => onHistory(p)}
                        >
                          <History className="h-3.5 w-3.5" />
                          <span>{"Historial"}</span>
                        </Button>
                      )}
                      {onEdit && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-11 flex-1 rounded-xl text-xs"
                          onClick={() => onEdit(p)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          <span>{"Editar"}</span>
                        </Button>
                      )}
                      {onDelete && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-11 flex-1 rounded-xl text-xs hover:bg-accent hover:text-primary"
                          onClick={() => onDelete(p)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>{"Eliminar"}</span>
                        </Button>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-y border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">
                  {connected ? (
                    <div className="inline-flex items-center gap-3">
                      <button type="button" onClick={() => toggleSort("name")} className={cn("inv-sort-btn", sortBy === "name" && "inv-sort-btn-active")}>
                        <span>{"Producto"}</span>
                        {renderSortIcon("name")}
                      </button>
                      <button type="button" onClick={() => toggleSort("reference")} className={cn("inv-sort-btn text-[11px]", sortBy === "reference" && "inv-sort-btn-active")}>
                        <span>{"Ref."}</span>
                        {renderSortIcon("reference")}
                      </button>
                    </div>
                  ) : "Producto"}
                </th>
                <th className="px-3 py-2.5 font-medium">
                  {connected ? (
                    <button type="button" onClick={() => toggleSort("category")} className={cn("inv-sort-btn", sortBy === "category" && "inv-sort-btn-active")}>
                      <span>{"Categoría"}</span>
                      {renderSortIcon("category")}
                    </button>
                  ) : "Categoría"}
                </th>
                <th className="px-3 py-2.5 font-medium">{"Ubic."}</th>
                <th className="px-3 py-2.5 font-medium">
                  {connected ? (
                    <button type="button" onClick={() => toggleSort("stock")} className={cn("inv-sort-btn", sortBy === "stock" && "inv-sort-btn-active")}>
                      <span>{"Existencia"}</span>
                      {renderSortIcon("stock")}
                    </button>
                  ) : "Existencia"}
                </th>
                {showCosts && (
                  <th className="px-3 py-2.5 text-right font-medium">
                    {connected ? (
                      <button type="button" onClick={() => toggleSort("cost")} className={cn("inv-sort-btn ml-auto", sortBy === "cost" && "inv-sort-btn-active")}>
                        <span>{"Costo"}</span>
                        {renderSortIcon("cost")}
                      </button>
                    ) : "Costo"}
                  </th>
                )}
                <th className="px-3 py-2.5 text-right font-medium">
                  {connected ? (
                    <button type="button" onClick={() => toggleSort("p1")} className={cn("inv-sort-btn ml-auto", sortBy === "p1" && "inv-sort-btn-active")}>
                      <span>{"Precio 1"}</span>
                      {renderSortIcon("p1")}
                    </button>
                  ) : "Precio 1"}
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {connected ? (
                    <button type="button" onClick={() => toggleSort("p2")} className={cn("inv-sort-btn ml-auto", sortBy === "p2" && "inv-sort-btn-active")}>
                      <span>{"Precio 2"}</span>
                      {renderSortIcon("p2")}
                    </button>
                  ) : "Precio 2"}
                </th>
                {showCosts && (
                  <th className="px-3 py-2.5 text-right font-medium">
                    {connected ? (
                      <button type="button" onClick={() => toggleSort("margin")} className={cn("inv-sort-btn ml-auto", sortBy === "margin" && "inv-sort-btn-active")}>
                        <span>{"Margen"}</span>
                        {renderSortIcon("margin")}
                      </button>
                    ) : "Margen"}
                  </th>
                )}
                {showActions && (
                  <th className="w-28 px-5 py-2.5 text-right font-medium">
                    {"Acciones"}
                  </th>
                )}
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
                        {p.reference && (
                          <>
                            {" · "}
                            <span className="font-mono" style={{ overflowWrap: "anywhere" }}>
                              {"Ref. "}
                              {p.reference}
                            </span>
                          </>
                        )}
                        {p.brand ? ` · ${p.brand}` : ""}
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
                    {showCosts && (
                      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                        {formatUnitMoney(p.costExact ?? p.cost)}
                      </td>
                    )}
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">
                      {formatUnitMoney(p.pricesExact?.p1 ?? p.prices.p1)}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {formatUnitMoney(p.pricesExact?.p2 ?? p.prices.p2)}
                    </td>
                    {showCosts && (
                      <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                        {margin === null ? "—" : `${margin.toFixed(1)}%`}
                      </td>
                    )}
                    {showActions && (
                      <td className="px-5 py-3">
                        <div className="mobile-touch-controls flex justify-end gap-1">
                          {onHistory && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground"
                              onClick={() => onHistory(p)}
                              aria-label="Historial"
                              title="Historial de movimientos"
                            >
                              <History />
                            </Button>
                          )}
                          {onEdit && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground"
                              onClick={() => onEdit(p)}
                              aria-label="Editar"
                              title="Editar artículo"
                            >
                              <Pencil />
                            </Button>
                          )}
                          {onDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:bg-accent hover:text-primary"
                              onClick={() => onDelete(p)}
                              aria-label="Eliminar"
                              title="Eliminar artículo"
                            >
                              <Trash2 />
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </>
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
              data-shortcut-prev="true"
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
              data-shortcut-next="true"
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

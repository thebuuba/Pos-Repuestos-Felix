import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  PackageSearch,
  Plus,
  Search,
  ShoppingCart,
  Truck,
  X,
} from "lucide-react";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog.jsx";
import { Button } from "../ui/button.jsx";
import { Input } from "../ui/input.jsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.jsx";
import { cn } from "../../lib/utils.js";
import { formatNumber, formatUnitMoney } from "../../lib/format.js";
import { filterAndSortCatalog } from "../../data/product-search.js";
import { isTouchMobile } from "../../data/keyboard-shortcuts.js";

const DESKTOP_ROW_HEIGHT = 46;
const MOBILE_CARD_HEIGHT = 142;
const OVERSCAN = 8;

const SCOPE_OPTIONS = [
  { key: "all", label: "Todo" },
  { key: "reference", label: "Referencia" },
];

const STOCK_OPTIONS = [
  { key: "all", label: "Existencias: Todas" },
  { key: "out", label: "Solo en 0" },
  { key: "low", label: "Bajo mínimo" },
  { key: "in", label: "Con existencia" },
];

const MOBILE_SORT_OPTIONS = [
  { value: "default:asc", label: "Orden original" },
  { value: "stock:asc", label: "Existencia: menor a mayor (0 → +)" },
  { value: "stock:desc", label: "Existencia: mayor a menor (+ → 0)" },
  { value: "code:asc", label: "Código (A–Z)" },
  { value: "reference:asc", label: "Referencia (A–Z)" },
  { value: "name:asc", label: "Descripción (A–Z)" },
];

function stockPillStyle(p) {
  if (p.stock === 0) return "catalog-stock-out";
  if (p.notifyMinStock !== false && p.stock <= p.minStock) return "catalog-stock-low";
  return "catalog-stock-ok";
}

function PriceText({ value, emphasis = false, active = false }) {
  const formatted = formatUnitMoney(value);
  const amount = formatted.startsWith("RD$ ") ? formatted.slice(4) : formatted;
  return (
    <span
      className={cn(
        "inline-flex items-baseline justify-end gap-0.5 tabular-nums",
        active
          ? "font-semibold text-primary"
          : emphasis
            ? "font-medium text-foreground"
            : "text-muted-foreground",
      )}
    >
      <span className="text-[10px] font-normal opacity-50">{"RD$"}</span>
      <span>{amount}</span>
    </span>
  );
}

function SortHeaderButton({ column, label, activeSort, sortDir, onSort, align = "left", className = "" }) {
  const isActive = activeSort === column;
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      className={cn(
        "catalog-sort-btn",
        align === "right" && "catalog-sort-btn-right",
        isActive && "catalog-sort-btn-active",
        className,
      )}
      aria-sort={isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
    >
      <span className="truncate">{label}</span>
      {isActive ? (
        sortDir === "asc" ? (
          <ArrowUp className="h-3.5 w-3.5 shrink-0 text-primary" />
        ) : (
          <ArrowDown className="h-3.5 w-3.5 shrink-0 text-primary" />
        )
      ) : (
        <ArrowUpDown className="catalog-sort-idle-icon h-3 w-3 shrink-0" />
      )}
    </button>
  );
}

function CatalogBrowserBody({
  onClose,
  products,
  mode,
  initialQuery,
  initialScope,
  showCosts,
  priceLevel,
  supplierName,
  existingQuantities,
  onQuickAdd,
  onSelect,
  onInspect,
  onGoSale,
  onGoPurchase,
}) {
  const [query, setQuery] = useState(initialQuery || "");
  const deferredQuery = useDeferredValue(query);
  const [scope, setScope] = useState(initialScope || "all");
  const [stockFilter, setStockFilter] = useState("all");
  const [sortBy, setSortBy] = useState("default");
  const [sortDir, setSortDir] = useState("asc");
  const [highlight, setHighlight] = useState(0);
  const [draftQty, setDraftQty] = useState({});
  const [addedFlash, setAddedFlash] = useState(null);
  const [sessionCount, setSessionCount] = useState(0);
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 1024px)").matches : true,
  );
  const [startIndex, setStartIndex] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(500);

  const searchRef = useRef(null);
  const scrollRef = useRef(null);
  const startIndexRef = useRef(0);
  const flashTimerRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setIsDesktop(mq.matches);
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!scrollRef.current || typeof ResizeObserver === "undefined") return undefined;
    const node = scrollRef.current;
    const observer = new ResizeObserver(() => {
      setViewportHeight(node.clientHeight || 500);
    });
    observer.observe(node);
    setViewportHeight(node.clientHeight || 500);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
  }, []);

  const filtered = useMemo(
    () =>
      filterAndSortCatalog(products, {
        query: deferredQuery,
        scope,
        stockFilter,
        sortBy,
        sortDir,
      }),
    [products, deferredQuery, scope, stockFilter, sortBy, sortDir],
  );

  useEffect(() => {
    setHighlight((h) => (filtered.length === 0 ? 0 : Math.min(h, filtered.length - 1)));
  }, [filtered.length]);

  const rowHeight = isDesktop ? DESKTOP_ROW_HEIGHT : MOBILE_CARD_HEIGHT;
  const totalHeight = filtered.length * rowHeight;
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + OVERSCAN * 2;
  const clampedStart = Math.min(startIndex, Math.max(0, filtered.length - 1));
  const endIndex = Math.min(filtered.length, clampedStart + visibleCount);
  const visibleRows = useMemo(
    () => filtered.slice(clampedStart, endIndex),
    [filtered, clampedStart, endIndex],
  );

  const resetScroll = useCallback(() => {
    startIndexRef.current = 0;
    setStartIndex(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, []);

  const handleScroll = useCallback(
    (e) => {
      const nextStart = Math.max(0, Math.floor(e.currentTarget.scrollTop / rowHeight) - OVERSCAN);
      if (nextStart !== startIndexRef.current) {
        startIndexRef.current = nextStart;
        setStartIndex(nextStart);
      }
    },
    [rowHeight],
  );

  const scrollToIndex = useCallback(
    (index) => {
      const container = scrollRef.current;
      if (!container || index < 0 || index >= filtered.length) return;
      const top = index * rowHeight;
      const bottom = top + rowHeight;
      let targetTop = container.scrollTop;
      if (top < container.scrollTop) targetTop = top;
      else if (bottom > container.scrollTop + container.clientHeight) {
        targetTop = Math.max(0, bottom - container.clientHeight);
      }
      if (targetTop !== container.scrollTop) {
        container.scrollTop = targetTop;
        const nextStart = Math.max(0, Math.floor(targetTop / rowHeight) - OVERSCAN);
        if (nextStart !== startIndexRef.current) {
          startIndexRef.current = nextStart;
          setStartIndex(nextStart);
        }
      }
    },
    [filtered.length, rowHeight],
  );

  const toggleSort = useCallback(
    (column) => {
      setSortBy((prevCol) => {
        if (prevCol === column) {
          setSortDir((prevDir) => (prevDir === "asc" ? "desc" : "asc"));
          return prevCol;
        }
        setSortDir("asc");
        return column;
      });
      setHighlight(0);
      resetScroll();
    },
    [resetScroll],
  );

  const existingQtyOf = useCallback(
    (productId) => {
      if (!existingQuantities) return 0;
      if (existingQuantities instanceof Map) return existingQuantities.get(productId) ?? 0;
      return existingQuantities[productId] ?? 0;
    },
    [existingQuantities],
  );

  const triggerFlash = useCallback((message) => {
    setAddedFlash(message);
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setAddedFlash(null), 2200);
  }, []);

  const handleQuickAddRow = useCallback(
    (product, explicitQty = null, advanceToIndex = null) => {
      if (!onQuickAdd) return false;
      const raw = explicitQty ?? draftQty[product.id] ?? "1";
      const ok = onQuickAdd(product, raw);
      if (ok === false) return false;
      setSessionCount((c) => c + 1);
      setDraftQty((prev) => {
        if (!(product.id in prev)) return prev;
        const next = { ...prev };
        delete next[product.id];
        return next;
      });
      if (mode === "sale") {
        onClose();
        return true;
      }
      triggerFlash(`+${raw} · ${product.name}`);
      if (advanceToIndex !== null && advanceToIndex < filtered.length) {
        setHighlight(advanceToIndex);
        scrollToIndex(advanceToIndex);
        if (mode === "purchase" && isDesktop) {
          const nextProduct = filtered[advanceToIndex];
          window.requestAnimationFrame(() => {
            const input = scrollRef.current?.querySelector(
              `input[data-catalog-qty="${nextProduct.id}"]`,
            );
            if (input) {
              input.focus();
              input.select();
            }
          });
        }
      }
      return true;
    },
    [onQuickAdd, draftQty, mode, onClose, triggerFlash, filtered, scrollToIndex, isDesktop],
  );

  const focusRowQty = useCallback(
    (index) => {
      const target = filtered[index];
      if (!target) return;
      setHighlight(index);
      scrollToIndex(index);
      window.requestAnimationFrame(() => {
        const input = scrollRef.current?.querySelector(
          `input[data-catalog-qty="${target.id}"]`,
        );
        if (input) {
          input.focus();
          input.select();
        }
      });
    },
    [filtered, scrollToIndex],
  );

  const handleAcceptRow = useCallback(
    (product, index) => {
      if (!product) return;
      if (mode === "purchase") {
        if (onQuickAdd && isDesktop) focusRowQty(index);
        else if (onSelect) {
          onSelect(product);
          onClose();
        }
        return;
      }
      if (mode === "sale") {
        if (product.stock <= 0) return;
        handleQuickAddRow(product, "1", null);
        return;
      }
      if (onInspect) {
        onInspect(product);
        onClose();
      }
    },
    [mode, onQuickAdd, isDesktop, focusRowQty, onSelect, onClose, handleQuickAddRow, onInspect],
  );

  const handleSearchKeyDown = (e) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!filtered.length) return;
      const next = Math.min(highlight + 1, filtered.length - 1);
      setHighlight(next);
      scrollToIndex(next);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!filtered.length) return;
      const next = Math.max(highlight - 1, 0);
      setHighlight(next);
      scrollToIndex(next);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      if (!filtered.length) return;
      const step = Math.max(5, Math.floor(viewportHeight / rowHeight) - 1);
      const next = Math.min(highlight + step, filtered.length - 1);
      setHighlight(next);
      scrollToIndex(next);
    } else if (e.key === "PageUp") {
      e.preventDefault();
      if (!filtered.length) return;
      const step = Math.max(5, Math.floor(viewportHeight / rowHeight) - 1);
      const next = Math.max(highlight - step, 0);
      setHighlight(next);
      scrollToIndex(next);
    } else if (e.key === "Enter") {
      if (!filtered.length) return;
      e.preventDefault();
      handleAcceptRow(filtered[highlight], highlight);
    }
  };

  const title =
    mode === "purchase"
      ? "Catálogo · Compras"
      : mode === "sale"
        ? "Catálogo de artículos"
        : "Catálogo completo";

  const srDescription =
    mode === "purchase"
      ? "Filtra artículos por referencia, código o nombre, ordena por existencia y agrégalos a la compra."
      : mode === "sale"
        ? "Explora todo el catálogo y agrega artículos a la venta."
        : "Explora todo el catálogo de artículos.";

  const totalExistingItems = useMemo(() => {
    if (!existingQuantities) return 0;
    if (existingQuantities instanceof Map) return existingQuantities.size;
    return Object.keys(existingQuantities).length;
  }, [existingQuantities]);

  const canShowCosts = Boolean(showCosts);
  const gridClass =
    mode === "browse"
      ? canShowCosts
        ? "catalog-grid catalog-grid-browse-costs"
        : "catalog-grid catalog-grid-browse"
      : canShowCosts
        ? "catalog-grid catalog-grid-costs"
        : "catalog-grid catalog-grid-sales";

  return (
    <DialogContent
      instant
      className="catalog-browser-dialog gap-0 overflow-hidden p-0"
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        if (!isTouchMobile()) {
          searchRef.current?.focus();
          searchRef.current?.select();
        }
      }}
    >
      {/* Header */}
      <div className="catalog-browser-header">
        <div className="flex items-center justify-between gap-3 pr-8">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <DialogTitle className="text-[15px] font-semibold tracking-tight text-foreground">
              {title}
            </DialogTitle>
            <DialogDescription className="sr-only">{srDescription}</DialogDescription>
            <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
              {filtered.length === products.length
                ? `${formatNumber(products.length)} artículos`
                : `${formatNumber(filtered.length)} de ${formatNumber(products.length)}`}
            </span>
            {mode === "purchase" && supplierName && (
              <span className="max-w-[200px] truncate text-xs text-muted-foreground">
                {`· ${supplierName}`}
              </span>
            )}
            {mode === "purchase" && totalExistingItems > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium tabular-nums text-emerald-700 dark:text-emerald-300">
                <Check className="h-3 w-3" />
                {`${totalExistingItems} en compra`}
              </span>
            )}
            {mode === "sale" && totalExistingItems > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-xs font-medium tabular-nums text-emerald-700 dark:text-emerald-300">
                <Check className="h-3 w-3" />
                {`${totalExistingItems} en carrito`}
              </span>
            )}
          </div>
        </div>

        {/* Minimal single-row toolbar */}
        <div className="catalog-browser-toolbar">
          <div className="catalog-browser-search">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              aria-label="Filtrar artículos del catálogo completo"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setHighlight(0);
                resetScroll();
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder={
                scope === "reference"
                  ? "Buscar solo en Referencia (ej. CTR1, ZR1, PERCOLI)…"
                  : "Buscar código, referencia o descripción…"
              }
              className={cn("catalog-search-input h-10 rounded-xl pl-9 text-sm shadow-none", query && "pr-9")}
            />
            {query && (
              <button
                type="button"
                aria-label="Limpiar filtro del catálogo"
                onClick={() => {
                  setQuery("");
                  setHighlight(0);
                  resetScroll();
                  searchRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="catalog-browser-chips">
            <div className="catalog-segmented" role="group" aria-label="Buscar en campo">
              {SCOPE_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  aria-pressed={scope === opt.key}
                  onClick={() => {
                    setScope(opt.key);
                    setHighlight(0);
                    resetScroll();
                    if (!isTouchMobile()) searchRef.current?.focus();
                  }}
                  className={cn(
                    "catalog-segmented-btn",
                    scope === opt.key && "catalog-segmented-btn-active",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <Select
              value={stockFilter}
              onValueChange={(val) => {
                setStockFilter(val);
                setHighlight(0);
                resetScroll();
              }}
            >
              <SelectTrigger aria-label="Filtrar existencias" className="h-10 w-[166px] rounded-xl bg-background text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STOCK_OPTIONS.map((opt) => (
                  <SelectItem key={opt.key} value={opt.key}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {!isDesktop && (
              <Select
                value={`${sortBy}:${sortDir}`}
                onValueChange={(val) => {
                  const [col, dir] = val.split(":");
                  setSortBy(col);
                  setSortDir(dir);
                  setHighlight(0);
                  resetScroll();
                }}
              >
                <SelectTrigger aria-label="Ordenar catálogo" className="h-10 min-w-[170px] rounded-xl bg-background text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MOBILE_SORT_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="catalog-browser-body">
        {isDesktop && (
          <div className={cn(gridClass, "catalog-grid-header")}>
            <SortHeaderButton column="code" label="Código" activeSort={sortBy} sortDir={sortDir} onSort={toggleSort} />
            <SortHeaderButton column="reference" label="Referencia" activeSort={sortBy} sortDir={sortDir} onSort={toggleSort} />
            <SortHeaderButton column="name" label="Descripción" activeSort={sortBy} sortDir={sortDir} onSort={toggleSort} />
            <SortHeaderButton column="stock" label="Exist." activeSort={sortBy} sortDir={sortDir} onSort={toggleSort} align="right" />
            {canShowCosts && (
              <SortHeaderButton column="cost" label="Costo" activeSort={sortBy} sortDir={sortDir} onSort={toggleSort} align="right" />
            )}
            <SortHeaderButton
              column="p1"
              label="Detalle"
              activeSort={sortBy}
              sortDir={sortDir}
              onSort={toggleSort}
              align="right"
              className={mode === "sale" && priceLevel === "p1" ? "text-primary" : ""}
            />
            <SortHeaderButton
              column="p2"
              label="P/Mayor"
              activeSort={sortBy}
              sortDir={sortDir}
              onSort={toggleSort}
              align="right"
              className={mode === "sale" && priceLevel === "p2" ? "text-primary" : ""}
            />
            {canShowCosts && (
              <SortHeaderButton column="p3" label="P/Lista" activeSort={sortBy} sortDir={sortDir} onSort={toggleSort} align="right" />
            )}
            <div className="text-right text-[11px] font-medium text-muted-foreground">
              {mode === "purchase" ? "Pedir" : mode === "sale" ? "Acción" : "Ir a"}
            </div>
          </div>
        )}

        {filtered.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
            <PackageSearch className="h-8 w-8 text-muted-foreground/70" />
            <p className="mt-3 text-sm font-semibold text-foreground">{"Sin coincidencias"}</p>
            <p className="mt-1 max-w-md text-xs text-muted-foreground">
              {scope === "reference"
                ? "Ningún artículo coincide en Referencia. Prueba cambiando a «Todo»."
                : "Prueba con otro código, referencia o limpia los filtros."}
            </p>
            {(query || scope !== "all" || stockFilter !== "all") && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4 rounded-xl"
                onClick={() => {
                  setQuery("");
                  setScope("all");
                  setStockFilter("all");
                  resetScroll();
                  searchRef.current?.focus();
                }}
              >
                {"Ver todo el catálogo"}
              </Button>
            )}
          </div>
        ) : (
          <div
            ref={scrollRef}
            className="catalog-browser-scroll"
            role="listbox"
            aria-label="Lista completa de artículos"
            onScroll={handleScroll}
          >
            <div style={{ height: `${totalHeight}px`, position: "relative" }}>
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  transform: `translateY(${clampedStart * rowHeight}px)`,
                }}
              >
                {visibleRows.map((p, offset) => {
                  const index = clampedStart + offset;
                  const isActive = index === highlight;
                  const inDocQty = existingQtyOf(p.id);
                  const rowQtyValue = draftQty[p.id] ?? "1";
                  const p1 = p.pricesExact?.p1 ?? p.prices.p1;
                  const p2 = p.pricesExact?.p2 ?? p.prices.p2;
                  const p3 = p.pricesExact?.p3 ?? p.prices.p3;

                  if (!isDesktop) {
                    return (
                      <div key={p.id} style={{ height: `${MOBILE_CARD_HEIGHT}px` }} className="px-3 py-1.5">
                        <div
                          onClick={() => setHighlight(index)}
                          className={cn(
                            "flex h-full flex-col justify-between rounded-2xl border bg-card p-3",
                            isActive ? "border-foreground/20 bg-muted/35" : "border-border",
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-foreground">{p.name}</p>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                                <span className="font-mono">{p.code}</span>
                                {p.reference && (
                                  <span className="max-w-[170px] truncate font-mono text-[11px]">
                                    {`· ${p.reference}`}
                                  </span>
                                )}
                                {inDocQty > 0 && (
                                  <span
                                    aria-label={mode === "purchase" ? `En compra: ${inDocQty}` : `En carrito: ${inDocQty}`}
                                    className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"
                                  >
                                    <Check className="h-3 w-3" />
                                    {inDocQty}
                                  </span>
                                )}
                              </div>
                            </div>
                            <span className={cn("catalog-stock-pill", stockPillStyle(p))}>
                              {formatNumber(p.stock)}
                            </span>
                          </div>

                          <div className="flex items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs tabular-nums">
                              {canShowCosts && (
                                <span className="text-muted-foreground">
                                  {"Costo "}
                                  <strong className="font-medium text-foreground">{formatUnitMoney(p.costExact ?? p.cost)}</strong>
                                </span>
                              )}
                              <span className="text-muted-foreground">
                                {"P1 "}
                                <strong className="font-medium text-foreground">{formatUnitMoney(p1)}</strong>
                              </span>
                              <span className="text-muted-foreground">
                                {"P2 "}
                                <strong className="font-medium text-foreground">{formatUnitMoney(p2)}</strong>
                              </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              {mode === "purchase" && (
                                <>
                                  <Input
                                    type="number"
                                    inputMode="decimal"
                                    min="1"
                                    step="1"
                                    aria-label={`Cantidad a pedir de ${p.name}`}
                                    value={rowQtyValue}
                                    onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => setDraftQty((prev) => ({ ...prev, [p.id]: e.target.value }))}
                                    className="h-10 w-16 rounded-xl px-2 text-center text-sm tabular-nums"
                                  />
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="h-10 rounded-xl px-3 text-xs"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleQuickAddRow(p);
                                    }}
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                    {"Pedir"}
                                  </Button>
                                </>
                              )}
                              {mode === "sale" && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant={p.stock <= 0 ? "outline" : "default"}
                                  disabled={p.stock <= 0}
                                  className="h-10 rounded-xl px-3 text-xs"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleQuickAddRow(p, "1");
                                  }}
                                >
                                  {p.stock > 0 && <Plus className="h-3.5 w-3.5" />}
                                  {p.stock <= 0 ? "Agotado" : "Agregar"}
                                </Button>
                              )}
                              {mode === "browse" && (
                                <>
                                  {onInspect && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-10 rounded-xl px-3 text-xs"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onInspect(p);
                                        onClose();
                                      }}
                                    >
                                      {"Ver"}
                                    </Button>
                                  )}
                                  {onGoPurchase && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      className="h-10 rounded-xl px-3 text-xs"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onGoPurchase(p);
                                        onClose();
                                      }}
                                    >
                                      {"Comprar"}
                                    </Button>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={p.id}
                      role="option"
                      aria-selected={isActive}
                      style={{ height: `${DESKTOP_ROW_HEIGHT}px` }}
                      onMouseEnter={() => setHighlight(index)}
                      onClick={() => setHighlight(index)}
                      onDoubleClick={() => {
                        if (mode === "purchase" && onSelect) {
                          onSelect(p);
                          onClose();
                        } else if (mode === "sale" && p.stock > 0) {
                          handleQuickAddRow(p, "1");
                        } else if (mode === "browse" && onInspect) {
                          onInspect(p);
                          onClose();
                        }
                      }}
                      className={cn(
                        gridClass,
                        "catalog-grid-row",
                        isActive && "catalog-grid-row-active",
                      )}
                    >
                      <div className="truncate font-mono text-xs text-muted-foreground" title={p.code}>
                        {p.code}
                      </div>
                      <div className="truncate font-mono text-xs text-muted-foreground" title={p.reference || ""}>
                        {p.reference || <span className="opacity-35">{"—"}</span>}
                      </div>
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-[13.5px] font-medium text-foreground" title={p.name}>
                          {p.name}
                        </span>
                        {inDocQty > 0 && (
                          <span
                            title={mode === "purchase" ? `En esta compra: ${inDocQty}` : `En carrito: ${inDocQty}`}
                            aria-label={mode === "purchase" ? `En compra: ${inDocQty}` : `En carrito: ${inDocQty}`}
                            className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-300"
                          >
                            <Check className="h-3 w-3" />
                            {inDocQty}
                          </span>
                        )}
                      </div>
                      <div className="flex justify-end">
                        <span
                          className={cn("catalog-stock-pill", stockPillStyle(p))}
                          title={p.minStock > 0 ? `Mínimo: ${formatNumber(p.minStock)}` : undefined}
                        >
                          {formatNumber(p.stock)}
                        </span>
                      </div>
                      {canShowCosts && (
                        <div className="truncate text-right text-xs">
                          <PriceText value={p.costExact ?? p.cost} />
                        </div>
                      )}
                      <div className="truncate text-right text-xs">
                        <PriceText value={p1} emphasis active={mode === "sale" && priceLevel === "p1"} />
                      </div>
                      <div className="truncate text-right text-xs">
                        <PriceText value={p2} active={mode === "sale" && priceLevel === "p2"} />
                      </div>
                      {canShowCosts && (
                        <div className="truncate text-right text-xs">
                          <PriceText value={p3} />
                        </div>
                      )}
                      <div className="flex items-center justify-end gap-1.5">
                        {mode === "purchase" && (
                          <div className="catalog-order-capsule">
                            <input
                              type="number"
                              inputMode="decimal"
                              min="0.01"
                              step="any"
                              data-catalog-qty={p.id}
                              aria-label={`Cantidad a pedir para ${p.code}`}
                              value={rowQtyValue}
                              onClick={(e) => e.stopPropagation()}
                              onFocus={(e) => {
                                setHighlight(index);
                                e.currentTarget.select();
                              }}
                              onChange={(e) =>
                                setDraftQty((prev) => ({
                                  ...prev,
                                  [p.id]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  handleQuickAddRow(p, e.currentTarget.value, index + 1);
                                } else if (e.key === "ArrowDown") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (index + 1 < filtered.length) focusRowQty(index + 1);
                                } else if (e.key === "ArrowUp") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  if (index - 1 >= 0) focusRowQty(index - 1);
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  searchRef.current?.focus();
                                  searchRef.current?.select();
                                }
                              }}
                              className="catalog-capsule-input"
                            />
                            <button
                              type="button"
                              title="Agregar a la factura de compra"
                              aria-label={`Pedir ${p.code}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleQuickAddRow(p);
                              }}
                              className="catalog-capsule-btn"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                        {mode === "sale" && (
                          p.stock <= 0 ? (
                            <span className="pr-1 text-xs text-muted-foreground/60">
                              {"Agotado"}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleQuickAddRow(p, "1");
                              }}
                              className="catalog-sale-add-btn"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              <span>{"Agregar"}</span>
                            </button>
                          )
                        )}
                        {mode === "browse" && (
                          <>
                            {onGoSale && (
                              <button
                                type="button"
                                title="Vender este artículo"
                                aria-label={`Vender ${p.code}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onGoSale(p);
                                  onClose();
                                }}
                                className="catalog-row-action-ghost"
                              >
                                <ShoppingCart className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {onGoPurchase && (
                              <button
                                type="button"
                                title="Comprar este artículo"
                                aria-label={`Comprar ${p.code}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onGoPurchase(p);
                                  onClose();
                                }}
                                className="catalog-row-action-ghost"
                              >
                                <Truck className="h-3.5 w-3.5" />
                              </button>
                            )}
                            {onInspect && (
                              <button
                                type="button"
                                title="Ver en Inventario"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onInspect(p);
                                  onClose();
                                }}
                                className="catalog-sale-add-btn"
                              >
                                <span>{"Ver"}</span>
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="catalog-browser-footer">
        <div className="flex min-w-0 items-center text-xs text-muted-foreground">
          {addedFlash ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-300">
              <Check className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{addedFlash}</span>
            </span>
          ) : (
            <span className="catalog-footer-hints">
              <span>{"↑↓ Mover"}</span>
              <span>
                {mode === "purchase"
                  ? "Enter Pedir · Doble clic Editar en fila"
                  : mode === "sale"
                    ? "Enter Agregar"
                    : "Enter Ver en inventario"}
              </span>
              <span>{"Esc Cerrar"}</span>
            </span>
          )}
        </div>
        <Button
          type="button"
          variant={mode === "purchase" && (sessionCount > 0 || totalExistingItems > 0) ? "default" : "outline"}
          className="h-9 rounded-full px-4 text-xs"
          onClick={onClose}
        >
          {mode === "purchase" && (sessionCount > 0 || totalExistingItems > 0)
            ? sessionCount > 0
              ? `Listo (${sessionCount} añad.)`
              : `Listo (${totalExistingItems})`
            : "Cerrar"}
        </Button>
      </div>
    </DialogContent>
  );
}

export const CatalogBrowserDialog = memo(function CatalogBrowserDialog({
  open,
  onOpenChange,
  ...props
}) {
  const handleClose = useCallback(() => onOpenChange?.(false), [onOpenChange]);
  if (!open) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <CatalogBrowserBody onClose={handleClose} {...props} />
    </Dialog>
  );
});

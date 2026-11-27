// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { Label } from "../ui/label.jsx";
import { BookOpen, ScanBarcode } from "lucide-react";
import { Input } from "../ui/input.jsx";
import { Search } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { formatNumber, formatUnitMoney } from "../../lib/format.js";
import { Minus } from "lucide-react";
import { Plus } from "lucide-react";
import { X } from "lucide-react";
import { Select } from "../ui/select.jsx";
import { SelectTrigger } from "../ui/select.jsx";
import { SelectValue } from "../ui/select.jsx";
import { SelectContent } from "../ui/select.jsx";
import { PRICE_LEVELS } from "../../data/sales-options.js";
import { SelectItem } from "../ui/select.jsx";
import { Button } from "../ui/button.jsx";
import { useMemo } from "react";
import { useRef } from "react";
import { useState } from "react";
import { useId } from "react";
import { useEffect } from "react";
import { Camera } from "lucide-react";
import { BarcodeCameraDialog } from "./barcode-camera-dialog.jsx";
import { CatalogBrowserDialog } from "./catalog-browser-dialog.jsx";
import { createKeyboardScan, productForBarcode } from "../../data/barcode-scanner.js";
import { countMatchingProducts, searchTopProducts } from "../../data/product-search.js";
import { useScanFeedback } from "../../data/use-scan-feedback.js";
import { hasOpenModal, isEditableElement, isTouchMobile } from "../../data/keyboard-shortcuts.js";
function ProductSearchBar({
  products,
  priceLevel,
  onPriceLevelChange,
  onAdd,
  onEmptyEnter,
  cartQuantities = null,
  initialSearch = "",
  operational = false,
  disabled = false,
}) {
  const [query, setQuery] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [selected, setSelected] = useState(false);
  const [error, setError] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalogSeed, setCatalogSeed] = useState("");
  const appliedInitialSearchRef = useRef("");
  const inputId = useId();
  const inputRef = useRef(null);
  const wrapRef = useRef(null);
  const optionRefs = useRef([]);
  const keyboardScanRef = useRef(createKeyboardScan());
  const typedByHumanRef = useRef(false);
  const { prepareScanAudio, confirmScan, dismissScan } = useScanFeedback();
  const focusSearch = (select = false) => {
    if (isTouchMobile()) inputRef.current?.blur();
    else {
      inputRef.current?.focus();
      if (select) inputRef.current?.select();
    }
  };
  useEffect(() => {
    if (disabled) {
      setCameraOpen(false);
      setCatalogOpen(false);
    }
  }, [disabled]);
  useEffect(() => {
    const clean = (initialSearch || "").trim();
    if (!operational || !clean || appliedInitialSearchRef.current === clean) return;
    appliedInitialSearchRef.current = clean;
    setQuery(clean);
    setOpen(true);
    setHighlight(0);
    setSelected(false);
    typedByHumanRef.current = true;
    focusSearch(true);
  }, [operational, initialSearch]);
  useEffect(() => {
    if (!operational || disabled || isTouchMobile()) return undefined;
    const raf = window.requestAnimationFrame(() => {
      const active = document.activeElement;
      if (!hasOpenModal() && (!active || active === document.body || !isEditableElement(active))) {
        inputRef.current?.focus();
      }
    });
    return () => window.cancelAnimationFrame(raf);
  }, [operational, disabled]);
  useEffect(() => {
    if (!operational) return undefined;
    const onShortcut = (event) => {
      if (event.detail?.action === "open-catalog" && !disabled) {
        event.preventDefault();
        setOpen(false);
        setCameraOpen(false);
        setCatalogSeed(query.trim());
        setCatalogOpen(true);
        return;
      }
      if (event.detail?.action === "focus-search" && !disabled) {
        event.preventDefault();
        focusSearch(true);
      }
    };
    window.addEventListener("felix:shortcut", onShortcut);
    return () => window.removeEventListener("felix:shortcut", onShortcut);
  }, [operational, disabled, query]);
  useEffect(() => {
    if (!operational || !open) return undefined;
    const onPointerDown = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (wrapRef.current?.contains(target)) return;
      if (target.closest("[data-radix-popper-content-wrapper], [role='listbox']")) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [operational, open]);
  const results = useMemo(
    () => searchTopProducts(products, query, operational ? 12 : 6, { preferInStock: operational }),
    [products, query, operational],
  );
  const totalMatches = useMemo(() => (operational && query.trim() ? countMatchingProducts(products, query) : 0), [products, query, operational]);
  useEffect(() => {
    if (!open || !results.length) return;
    optionRefs.current[highlight]?.scrollIntoView?.({ block: "nearest" });
  }, [highlight, open, results.length]);
  const commit = (product) => {
    if (disabled) return false;
    const target = product ?? results[highlight] ?? results[0];
    if (!target) return false;
    if (onAdd(target, operational ? quantity : Math.max(1, quantity)) === false) return false;
    setQuery("");
    setQuantity(1);
    setHighlight(0);
    setOpen(false);
    setSelected(false);
    setError("");
    typedByHumanRef.current = false;
    keyboardScanRef.current.reset();
    if (!cameraOpen) focusSearch();
    return true;
  };
  const scanCode = (code, format) => {
    let feedback = { ok: false, message: 'No se agregó el producto. Revisa cantidad, precio y existencias.' };
    if (disabled) return feedback;
    dismissScan();
    try {
      const product = productForBarcode(products, code, format);
      if (commit(product)) {
        feedback = confirmScan(product, quantity);
      }
    } catch (failure) {
      feedback = { ok: false, message: failure.message };
    }
    if (!feedback.ok) setError(feedback.message);
    // Always consume the reader's text, including rejected scans, so the next
    // physical read cannot be appended to an old barcode.
    setQuery("");
    setOpen(false);
    setSelected(false);
    typedByHumanRef.current = false;
    keyboardScanRef.current.reset();
    if (!cameraOpen) focusSearch();
    return feedback;
  };
  const handleKeyDown = (e) => {
    if (disabled || e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      keyboardScanRef.current.reset();
      setSelected(true);
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      keyboardScanRef.current.reset();
      setSelected(true);
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.repeat) return;
      const fastScan = keyboardScanRef.current.push(e);
      if (operational && !e.currentTarget.value.trim()) {
        typedByHumanRef.current = false;
        onEmptyEnter?.();
        return;
      }
      if (!operational || selected) {
        commit();
        return;
      }
      // Si las teclas llegaron en ráfaga de lector USB (o pegado masivo sin tecleo humano),
      // exige código literal para que una lectura mala nunca venda otra pieza por error.
      if (fastScan !== null || !typedByHumanRef.current) {
        if (e.currentTarget.value) scanCode(e.currentTarget.value);
        return;
      }
      // Escritura manual: agrega el artículo resaltado en la lista (p. ej. "343", "y0858", "rolo").
      if (results.length > 0) {
        commit(results[highlight] ?? results[0]);
      } else if (e.currentTarget.value) {
        scanCode(e.currentTarget.value);
      }
    } else if (e.key === "Escape") {
      keyboardScanRef.current.reset();
      if (open) setOpen(false);
      else if (query || error) {
        setQuery("");
        setError("");
        setSelected(false);
        setHighlight(0);
        typedByHumanRef.current = false;
      }
    } else {
      if (!e.ctrlKey && !e.altKey && !e.metaKey && (e.key.length === 1 || e.key === "Backspace" || e.key === "Delete")) {
        typedByHumanRef.current = true;
      }
      keyboardScanRef.current.push(e);
    }
  };
  const quantityControl = (
    <div className="sale-search-quantity space-y-1.5">
      <Label className="text-xs text-muted-foreground">{"Cantidad"}</Label>
      <div className="flex h-11 items-center rounded-xl border border-input bg-card">
        <button
          type="button"
          onClick={() => setQuantity((q) => {
            const n = Math.round(Number(q) * 100);
            return n <= 100 ? 1 : (n - 100) / 100;
          })}
          className="flex h-full w-10 items-center justify-center text-muted-foreground hover:text-foreground"
          aria-label="Restar"
        >
          <Minus className="h-4 w-4" />
        </button>
        <input
          type="number"
          inputMode="decimal"
          aria-label="Cantidad"
          data-sale-search-qty={operational ? "true" : undefined}
          min={operational ? 0.01 : 1}
          step={operational ? 0.01 : 1}
          value={quantity}
          onChange={(e) => setQuantity(operational ? e.target.value : Number(e.target.value) || 1)}
          onKeyDown={(e) => {
            if (operational && e.key === "Enter") {
              e.preventDefault();
              if (query.trim() && results.length > 0 && selected) commit();
              else focusSearch(true);
            }
          }}
          className="h-full w-full min-w-0 bg-transparent text-center text-sm font-semibold tabular-nums outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button
          type="button"
          onClick={() => setQuantity((q) => (Math.round(Number(q) * 100) + 100) / 100)}
          className="flex h-full w-10 items-center justify-center text-muted-foreground hover:text-foreground"
          aria-label="Sumar"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
  const priceLevelControl = (
    <div className="sale-search-price min-w-0 space-y-1.5">
      <Label className="text-xs text-muted-foreground">
        {"Nivel de precio"}
      </Label>
      <Select
        value={priceLevel}
        onValueChange={(v) => onPriceLevelChange(v)}
      >
        <SelectTrigger aria-label="Nivel de precio" className="h-11 rounded-xl bg-card">
          <SelectValue>{operational ? <>
            <span className="sale-desktop-only">{PRICE_LEVELS.find(level => level.value === priceLevel)?.label ?? PRICE_LEVELS[0].label}</span>
            <span className="sale-mobile-only">{{ p1: 'P1 · Detalle', p2: 'P2 · Mayor' }[priceLevel] ?? 'P1 · Detalle'}</span>
          </> : undefined}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {PRICE_LEVELS.map((l) => (
            <SelectItem value={l.value} key={l.value}>
              {l.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  const addButtonControl = (
    <Button
      aria-label="Agregar"
      onMouseDown={operational ? (e) => e.preventDefault() : undefined}
      onClick={() => commit()}
      disabled={disabled || results.length === 0}
      className="sale-add-button h-11 rounded-xl px-6 font-semibold"
    >
      <Plus />
      <span className="sale-add-label">Agregar</span>
    </Button>
  );
  if (operational) {
    const showCatalog = open && query.trim().length > 0;
    return (
      <div ref={wrapRef} className="sale-search-wrap space-y-3">
        <div className="sale-product-search grid gap-3 rounded-xl bg-muted/60 p-3 md:items-end">
          {quantityControl}
          {priceLevelControl}
          {addButtonControl}
          <div className="sale-search-row">
            <div className="sale-search-input relative space-y-1.5">
              <Label htmlFor={inputId} className="text-xs text-muted-foreground">
                {"Código o nombre del producto"}
              </Label>
              <div className="relative">
                <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id={inputId}
                  ref={inputRef}
                  data-shortcut-search="true"
                  data-sale-search="true"
                  disabled={disabled}
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  aria-invalid={!!error}
                  aria-describedby={error ? `${inputId}-error` : undefined}
                  value={query}
                  onChange={(e) => {
                    const next = e.target.value;
                    if (!next) {
                      typedByHumanRef.current = false;
                      keyboardScanRef.current.reset();
                    }
                    setQuery(next);
                    setHighlight(0);
                    setSelected(false);
                    setError("");
                    setOpen(true);
                  }}
                  onFocus={() => setOpen(true)}
                  onKeyDown={handleKeyDown}
                  placeholder="Escanea o escribe código, referencia o nombre…"
                  className={cn("h-11 rounded-xl bg-card pl-9", query && "pr-9")}
                />
                {query && (
                  <button
                    type="button"
                    aria-label="Limpiar búsqueda"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setQuery("");
                      setHighlight(0);
                      setSelected(false);
                      setError("");
                      setOpen(false);
                      focusSearch();
                    }}
                    className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              aria-label="Abrir catálogo completo (F2)"
              title="Explorar todo el catálogo (F2)"
              className="catalog-trigger-btn h-11 shrink-0 rounded-xl bg-card px-3 text-xs font-medium text-foreground"
              onClick={() => {
                dismissScan();
                setOpen(false);
                setError("");
                setCatalogSeed(query.trim());
                setCatalogOpen(true);
              }}
            >
              <BookOpen className="h-4 w-4 text-primary" aria-hidden="true" />
              <span className="hidden sm:inline">{"Catálogo"}</span>
              <kbd className="hidden rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground lg:inline">
                {"F2"}
              </kbd>
            </Button>
            <Button type="button" variant="outline" size="icon" disabled={disabled}
              aria-label="Escanear con cámara" title="Escanear con cámara"
              className="sale-camera-button h-11 w-11 rounded-xl bg-card text-muted-foreground"
              onClick={() => {
                dismissScan();
                prepareScanAudio(); setOpen(false); setError(""); setCameraOpen(true);
              }}>
              <Camera className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          {error && <p id={`${inputId}-error`} role="alert" className="sale-search-error text-xs text-destructive">{error}</p>}
        </div>
        {showCatalog && (
          <div
            className="sale-search-catalog overflow-hidden rounded-xl border border-border bg-card shadow-sm"
            onMouseDown={(e) => e.preventDefault()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/50 px-3 py-1.5 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground">
                {results.length === 0
                  ? "Sin coincidencias"
                  : totalMatches > results.length
                    ? `Mostrando ${results.length} de ${formatNumber(totalMatches)} productos`
                    : `Catálogo de búsqueda · ${results.length} ${results.length === 1 ? "producto" : "productos"}`}
              </span>
              <div className="flex items-center gap-3">
                {totalMatches > results.length && (
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setOpen(false);
                      setCatalogSeed(query.trim());
                      setCatalogOpen(true);
                    }}
                    className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
                  >
                    <BookOpen className="h-3 w-3" />
                    <span>{`Ver todos (${formatNumber(totalMatches)}) · F2`}</span>
                  </button>
                )}
                <div className="sale-keyboard-hint flex items-center gap-3">
                  <span>{"↑↓ navegar"}</span>
                  <span>{"Enter agregar"}</span>
                  <span>{"Esc cerrar"}</span>
                </div>
              </div>
            </div>
            {results.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-5 text-sm text-muted-foreground">
                <Search className="h-4 w-4 shrink-0" />
                <span>{"No se encontraron productos para “"}{query}{"”"}</span>
              </div>
            ) : (
              <ul className="sale-search-catalog-list divide-y divide-border overflow-y-auto">
                {results.map((p, i) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      ref={(el) => { optionRefs.current[i] = el; }}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => commit(p)}
                      className={cn(
                        "sale-search-result flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors",
                        i === highlight ? "bg-accent" : "hover:bg-muted/40",
                      )}
                    >
                      <span className="w-28 shrink-0 truncate font-mono text-xs text-muted-foreground">
                        {p.code}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground">
                          {p.name}
                        </span>
                        {p.reference && (
                          <span className="block truncate font-mono text-[11px] text-muted-foreground">
                            {"Ref. "}
                            {p.reference}
                          </span>
                        )}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-xs",
                          p.stock === 0
                            ? "text-primary"
                            : p.stock <= p.minStock
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground",
                        )}
                      >
                        {p.stock === 0 ? "Agotado" : `${p.stock} disp.`}
                      </span>
                      <span className="shrink-0 whitespace-nowrap text-right font-semibold tabular-nums">
                        {formatUnitMoney((p.pricesExact ?? p.prices)[priceLevel])}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {cameraOpen && !disabled && <BarcodeCameraDialog
          onClose={() => { setCameraOpen(false); focusSearch(); }}
          onCode={scanCode}
        />}
        <CatalogBrowserDialog
          open={catalogOpen}
          onOpenChange={(next) => {
            setCatalogOpen(next);
            if (!next) focusSearch();
          }}
          products={products}
          mode="sale"
          showCosts={false}
          priceLevel={priceLevel}
          initialQuery={catalogSeed}
          existingQuantities={cartQuantities}
          onQuickAdd={(product) => {
            const ok = onAdd(product, operational ? quantity : Math.max(1, quantity));
            if (ok === false) return false;
            setQuery("");
            setQuantity(1);
            setHighlight(0);
            setOpen(false);
            setSelected(false);
            setError("");
            typedByHumanRef.current = false;
            keyboardScanRef.current.reset();
            return true;
          }}
        />
      </div>
    );
  }
  return (
    <div className="sale-product-search grid gap-3 rounded-xl bg-muted/60 p-3 md:grid-cols-[minmax(0,1fr)_140px_190px_auto] md:items-end">
      <div className="sale-search-input relative space-y-1.5">
        <Label htmlFor={inputId} className="text-xs text-muted-foreground">
          {"Código o nombre del producto"}
        </Label>
        <div className="relative">
          <ScanBarcode className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={inputId}
            ref={inputRef}
            disabled={disabled}
            autoComplete="off"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            aria-invalid={!!error}
            aria-describedby={error ? `${inputId}-error` : undefined}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
              setSelected(false);
              setError("");
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={handleKeyDown}
            placeholder="Escanea o escribe código, referencia o nombre…"
            className="h-11 rounded-xl bg-card pl-9"
          />
        </div>
        {error && <p id={`${inputId}-error`} role="alert" className="text-xs text-destructive">{error}</p>}
        {open && query.trim() && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1.5 overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
            {results.length === 0 ? (
              <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
                <Search className="h-4 w-4" />
                {"No se encontraron productos para “"}
                {query}
                {"”"}
              </div>
            ) : (
              <ul className="max-h-72 overflow-y-auto py-1">
                {results.map((p, i) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      ref={(el) => { optionRefs.current[i] = el; }}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setHighlight(i)}
                      onClick={() => commit(p)}
                      className={cn(
                        "sale-search-result flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm",
                        i === highlight && "bg-accent",
                      )}
                    >
                      <span className="w-28 shrink-0 truncate font-mono text-xs text-muted-foreground">
                        {p.code}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">
                          {p.name}
                        </span>
                        {p.reference && (
                          <span className="block truncate font-mono text-[11px] text-muted-foreground">
                            {"Ref. "}
                            {p.reference}
                          </span>
                        )}
                      </span>
                      <span
                        className={cn(
                          "shrink-0 text-xs",
                          p.stock === 0
                            ? "text-primary"
                            : p.stock <= p.minStock
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground",
                        )}
                      >
                        {p.stock === 0 ? "Agotado" : `${p.stock} disp.`}
                      </span>
                      <span className="w-24 shrink-0 text-right font-semibold tabular-nums">
                        {formatUnitMoney((p.pricesExact ?? p.prices)[priceLevel])}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="sale-keyboard-hint flex items-center gap-3 border-t border-border bg-muted/50 px-3 py-1.5 text-[11px] text-muted-foreground">
              <span>{"↑↓ navegar"}</span>
              <span>{"Enter agregar"}</span>
              <span>{"Esc cerrar"}</span>
            </div>
          </div>
        )}
      </div>
      {quantityControl}
      {priceLevelControl}
      {addButtonControl}
    </div>
  );
}
export { ProductSearchBar };

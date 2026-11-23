// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { purchaseDecimal, purchaseLineAmounts, purchasePrices, purchaseTotals } from "../../data/operational-purchases.js";
import { costUnits, decimalUnits, quantityUnits } from "../../../../src/pos/operation-fields.js";
import { Field } from "./form-field.jsx";
import { Select } from "../ui/select.jsx";
import { SelectTrigger } from "../ui/select.jsx";
import { inputClass } from "./form-field.jsx";
import { SelectValue } from "../ui/select.jsx";
import { SelectContent } from "../ui/select.jsx";
import { SelectItem } from "../ui/select.jsx";
import { Input } from "../ui/input.jsx";
import { formulaSummary } from "../../lib/pricing.js";
import { cn } from "../../lib/utils.js";
import { Button } from "../ui/button.jsx";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { CircleCheck } from "lucide-react";
import { formatMoney, formatNumber, formatUnitMoney } from "../../lib/format.js";
import { CATEGORIES } from "../../data/catalog-options.js";
import { EmptyState } from "./section-card.jsx";
import { PackageOpen } from "lucide-react";
import { PRICE_KEYS } from "../../lib/pricing.js";
import { Trash2 } from "lucide-react";
import { MoneyDisplay } from "./money-display.jsx";
import { Upload } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { businessTodayIso } from "../../lib/dates.js";
import { searchTopProducts } from "../../data/product-search.js";
var EMPTY_ENTRY = {
  code: "",
  name: "",
  category: "Motor",
  quantity: "1",
  cost: "",
};
function catalogFields(product) {
  return {
    productId: product?.id ?? null, productVersion: product?.version ?? null,
    catalogPrices: product?.pricesExact ?? product?.prices,
  };
}
function catalogChanged(line, product) {
  return (line.productId ?? null) !== (product?.id ?? null) ||
    (line.productVersion ?? null) !== (product?.version ?? null);
}
function defaultDueDate(days) {
  const parsed = Number(days);
  const n = days !== null && days !== undefined && days !== "" && Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 30;
  const d = new Date(businessTodayIso() + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function PurchaseEntryForm({
  suppliers,
  formulas,
  products,
  rounding,
  runtime,
  onSubmit,
}) {
  const [supplierId, setSupplierId] = useState("");
  const [invoice, setInvoice] = useState("");
  const [formulaId, setFormulaId] = useState(runtime ? "manual" : String(formulas[0]?.id ?? ""));
  const [condition, setCondition] = useState(runtime ? "contado" : "credito");
  const [dueDate, setDueDate] = useState(() => defaultDueDate(30));
  const [entry, setEntry] = useState(EMPTY_ENTRY);
  const [lines, setLines] = useState([]);
  const [tried, setTried] = useState(false);
  const codeRef = useRef(null);
  const qtyRef = useRef(null);
  const supplierBoxRef = useRef(null);
  const supplierSearchRef = useRef(null);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [supplierQuery, setSupplierQuery] = useState("");
  const [supplierHighlight, setSupplierHighlight] = useState(0);
  const [productMenuOpen, setProductMenuOpen] = useState(false);
  const [productHighlight, setProductHighlight] = useState(0);
  const [error, setError] = useState(null);
  const [retryInput, setRetryInput] = useState(null);
  const [sending, setSending] = useState(false);
  const [databaseId, setDatabaseId] = useState(runtime?.databaseId);
  const inFlight = useRef(false);
  const databaseChanged = databaseId !== runtime?.databaseId;
  const locked = sending || !!retryInput || databaseChanged;
  const supplier = suppliers.find(s => String(s.id) === supplierId);
  const formula = formulas.find(f => String(f.id) === formulaId);
  const { productsByCode, productsByLowerCode, altCodeMap } = useMemo(() => {
    const byCode = new Map();
    const byLower = new Map();
    const byAlt = new Map();
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      byCode.set(p.code, p);
      byLower.set(p.code.toLowerCase(), p);
      if (p.altCodes?.length) {
        for (let j = 0; j < p.altCodes.length; j++) {
          byAlt.set(p.altCodes[j].toLowerCase(), p);
        }
      }
    }
    return { productsByCode: byCode, productsByLowerCode: byLower, altCodeMap: byAlt };
  }, [products]);
  const findProduct = (code) => runtime ? productsByCode.get(code) : productsByLowerCode.get(code.trim().toLowerCase());
  const altCodeOwner = useMemo(() => {
    const q = entry.code.trim().toLowerCase();
    if (!q) return null;
    const owner = altCodeMap.get(q);
    return owner && owner.code !== entry.code ? owner : null;
  }, [entry.code, altCodeMap]);
  const match = findProduct(entry.code);
  const entryChanged = runtime && entry.code && catalogChanged(entry, match);
  const filteredSuppliers = useMemo(() => {
    const q = supplierQuery.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) =>
      (s.name || "").toLowerCase().includes(q) ||
      (s.rnc || "").toLowerCase().includes(q) ||
      (s.contact || "").toLowerCase().includes(q),
    );
  }, [suppliers, supplierQuery]);
  useEffect(() => {
    if (!supplierOpen) return;
    requestAnimationFrame(() => supplierSearchRef.current?.focus());
    const onOutside = (e) => {
      if (supplierBoxRef.current && !supplierBoxRef.current.contains(e.target)) {
        setSupplierOpen(false);
      }
    };
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [supplierOpen]);
  const selectSupplier = (s) => {
    setSupplierId(String(s.id));
    setFormulaId(String(s?.formulaId ?? "manual"));
    setDueDate(defaultDueDate(s?.creditDays ?? 30));
    setSupplierOpen(false);
    setSupplierQuery("");
    setSupplierHighlight(0);
  };
  const productResults = useMemo(() => {
    if (!entry.code.trim()) return [];
    return searchTopProducts(products, entry.code, 8);
  }, [products, entry.code]);
  const pickProduct = (product) => {
    setEntry((e) => ({
      ...e,
      code: product.code,
      ...catalogFields(product),
      name: product.name,
      category: product.category || e.category,
      cost: product.costExact ?? String(product.cost),
    }));
    setProductMenuOpen(false);
    setProductHighlight(0);
    requestAnimationFrame(() => {
      qtyRef.current?.focus();
      qtyRef.current?.select();
    });
  };
  const showNewDescription = Boolean(entry.code.trim() && !match && !altCodeOwner && !(productMenuOpen && productResults.length > 0));
  const evaluate = (line, catalogPrices) => {
    let prices = {}, amounts = {};
    try {
      if (formulaId !== "manual" && !formula) throw new Error("Selecciona una fórmula de precios vigente.");
      prices = { ...purchasePrices(line.cost, formula, rounding, catalogPrices), ...line.overrides };
      amounts = purchaseLineAmounts(line.cost, line.quantity);
      if (line.overrides) {
        for (const k of PRICE_KEYS) costUnits(purchaseDecimal(prices[k] ?? ""), `el precio ${k.toUpperCase()}`);
      }
      return { prices, ...amounts };
    } catch (cause) {
      return { prices, ...amounts, error: cause.message };
    }
  };
  const entryResult = entry.cost === "" ? {} : evaluate(entry, match?.pricesExact ?? match?.prices);
  const entryError = altCodeOwner
    ? `Este código es alternativo de «${altCodeOwner.name}» (${altCodeOwner.code}). Usa el código principal.`
    : !runtime && entryResult.prices && Number(entry.cost) === 0
      ? "Indica un costo unitario mayor que cero." : entryResult.error;
  const entryPrices = !entryError && entryResult.prices;
  const canAddLine = !locked && !entryChanged && !altCodeOwner && !entryError && entryResult.units && entry.code.trim() && entry.name.trim() && lines.length < 1000;
  const { pricedLines, total, units, error: totalError } = useMemo(() => {
    const projectedStock = new Map();
    const evaluated = lines.map(line => {
      const result = evaluate(line, line.catalogPrices);
      const existing = productsByCode.get(line.code);
      result.changed = runtime && catalogChanged(line, existing);
      const stockBefore = projectedStock.get(line.code) ?? quantityUnits(existing?.stock ?? 0, "las existencias");
      if (result.units === undefined) return { ...line, ...result, existing, stockBefore };
      const stockAfter = stockBefore + result.units;
      projectedStock.set(line.code, stockAfter);
      try {
        quantityUnits(decimalUnits(stockAfter, 2), "las existencias");
      } catch (cause) {
        result.error = cause.message;
      }
      return { ...line, ...result, existing, stockBefore, stockAfter };
    });
    return { pricedLines: evaluated, ...purchaseTotals(evaluated) };
  }, [lines, formulaId, formula, rounding, productsByCode, runtime]);
  const hasInvalidLine = !!totalError || pricedLines.some(line => line.error || line.changed);
  const onCodeChange = (code) => {
    const found = findProduct(code);
    setEntry(e => ({
      ...e, code, ...catalogFields(found),
      name: found ? found.name : match ? "" : e.name,
      category: found ? found.category : e.category,
      cost: found ? (found.costExact ?? String(found.cost)) : match ? "" : e.cost,
    }));
  };
  const addLine = () => {
    if (!canAddLine) return;
    // Each receipt line keeps its own unit cost and rounded subtotal.
    setLines(prev => [...prev, {
      key: crypto.randomUUID(), ...catalogFields(match), code: runtime ? entry.code : entry.code.trim().toUpperCase(),
      name: entry.name.trim(), category: entry.category, quantity: purchaseDecimal(entry.quantity), cost: purchaseDecimal(entry.cost),
      overrides: {},
    }]);
    setEntry(EMPTY_ENTRY);
    codeRef.current?.focus();
  };
  const updateLine = (key, patch) =>
    setLines((prev) =>
      prev.map((l) =>
        l.key === key
          ? {
              ...l,
              ...patch,
            }
          : l,
      ),
    );
  const submit = async () => {
    if (inFlight.current || databaseChanged) return;
    setTried(true);
    if (!retryInput && (!supplier || (runtime && !invoice.trim()) || !lines.length || hasInvalidLine)) return;
    const input = retryInput ?? {
      databaseId, supplierId: supplier.id, supplierInvoice: invoice.trim(), formulaId: formula?.id, condition,
      dueDate: condition === "credito" ? dueDate || null : null,
      lines: pricedLines.map(l => ({
        productId: l.productId, productVersion: l.productVersion, code: l.code, name: l.name, category: l.category,
        quantity: runtime ? l.quantity : Number(l.quantity),
        cost: runtime ? l.cost : Number(l.cost),
        prices: runtime ? l.prices : Object.fromEntries(PRICE_KEYS.map(k => [k, Number(l.prices[k])])),
      })),
    };
    setError(null);
    inFlight.current = true;
    setSending(true);
    try {
      await onSubmit(input);
      setLines([]);
      setInvoice("");
      setTried(false);
      setRetryInput(null);
    } catch (cause) {
      setError(cause.message || "No se pudo confirmar la compra.");
      if (cause.uncertain) setRetryInput(input);
      else if (cause.definitive) setRetryInput(null);
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };
  const restart = () => {
    setDatabaseId(runtime.databaseId);
    setSupplierId("");
    setInvoice("");
    setFormulaId("manual");
    setEntry(EMPTY_ENTRY);
    setLines([]);
    setError(null);
    setRetryInput(null);
    setTried(false);
  };
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <fieldset disabled={locked} className="min-w-0 space-y-5 rounded-2xl border border-border bg-card p-5">
        <div className="grid gap-4 md:grid-cols-4">
          <Field
            label="Suplidor"
            className="md:col-span-2"
            error={tried && !supplier ? "Selecciona el suplidor" : undefined}
          >
            <div ref={supplierBoxRef} className="relative">
              <button
                type="button"
                role="combobox"
                aria-label="Suplidor"
                aria-expanded={supplierOpen}
                aria-haspopup="listbox"
                disabled={locked}
                onClick={() => {
                  setSupplierOpen((v) => !v);
                  setSupplierQuery("");
                  setSupplierHighlight(0);
                }}
                className={cn(
                  inputClass,
                  "flex w-full items-center justify-between gap-2 border border-input px-3 text-left text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                  !supplier && "text-muted-foreground",
                )}
              >
                <span className="truncate">{supplier ? supplier.name : "Selecciona un suplidor"}</span>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
              {supplierOpen && (
                <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
                  <div className="relative border-b border-border p-2">
                    <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      ref={supplierSearchRef}
                      value={supplierQuery}
                      onChange={(e) => {
                        setSupplierQuery(e.target.value);
                        setSupplierHighlight(0);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          setSupplierHighlight((h) => Math.min(h + 1, Math.max(0, filteredSuppliers.length - 1)));
                        } else if (e.key === "ArrowUp") {
                          e.preventDefault();
                          setSupplierHighlight((h) => Math.max(h - 1, 0));
                        } else if (e.key === "Enter") {
                          e.preventDefault();
                          const picked = filteredSuppliers[supplierHighlight] ?? filteredSuppliers[0];
                          if (picked) selectSupplier(picked);
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          setSupplierOpen(false);
                        }
                      }}
                      placeholder="Buscar por nombre, RNC o contacto…"
                      aria-label="Buscar suplidor"
                      className="h-9 rounded-lg bg-card pl-8 pr-8 text-sm"
                    />
                    {supplierQuery && (
                      <button
                        type="button"
                        aria-label="Limpiar búsqueda de suplidor"
                        onClick={() => { setSupplierQuery(""); setSupplierHighlight(0); supplierSearchRef.current?.focus(); }}
                        className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <ul role="listbox" aria-label="Suplidores" className="max-h-60 overflow-y-auto py-1">
                    {filteredSuppliers.length === 0 ? (
                      <li className="px-3 py-4 text-center text-xs text-muted-foreground">
                        Sin suplidores para “{supplierQuery}”
                      </li>
                    ) : (
                      filteredSuppliers.map((s, idx) => {
                        const selected = String(s.id) === supplierId;
                        const sub = [s.rnc && `RNC ${s.rnc}`, s.contact].filter(Boolean).join(" · ");
                        return (
                          <li key={s.id}>
                            <button
                              type="button"
                              role="option"
                              aria-label={s.name}
                              aria-selected={selected}
                              onMouseDown={(e) => e.preventDefault()}
                              onMouseEnter={() => setSupplierHighlight(idx)}
                              onClick={() => selectSupplier(s)}
                              className={cn(
                                "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors",
                                idx === supplierHighlight && "bg-accent",
                              )}
                            >
                              <div className="min-w-0">
                                <p className="truncate font-medium text-foreground">{s.name}</p>
                                {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
                              </div>
                              {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                            </button>
                          </li>
                        );
                      })
                    )}
                  </ul>
                </div>
              )}
            </div>
          </Field>
          <Field label="No. factura del suplidor" htmlFor="purchase-invoice" error={tried && runtime && !invoice.trim() ? "Escribe el número de factura" : undefined}>
            <Input
              id="purchase-invoice" maxLength={2000}
              value={invoice}
              onChange={(e) => setInvoice(e.target.value)}
              placeholder="Ej. FAC-4589"
              className={inputClass}
            />
          </Field>
          <Field label="Condición">
            <Select disabled={locked} value={condition} onValueChange={(v) => setCondition(v)}>
              <SelectTrigger aria-label="Condición" className={inputClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="credito">{"A crédito"}</SelectItem>
                <SelectItem value="contado">{"Pagada (contado)"}</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {condition === "credito" && (
            <Field label="Vencimiento" htmlFor="purchase-due-date" className="md:col-span-2">
              <Input
                id="purchase-due-date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={inputClass}
              />
            </Field>
          )}
          <Field
            label="Fórmula de precios"
            className={condition === "credito" ? "md:col-span-2" : "md:col-span-4"}
            hint="Se elige sola según el suplidor. Los precios se recalculan al cambiarla."
          >
            <Select disabled={locked} value={formulaId} onValueChange={setFormulaId}>
              <SelectTrigger aria-label="Fórmula de precios" className={inputClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {runtime && <SelectItem value="manual">Precios manuales</SelectItem>}
                {formulas.map((f) => (
                  <SelectItem value={String(f.id)} key={f.id}>
                    {f.name}
                    {" ("}
                    {formulaSummary(f)}
                    {")"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="space-y-3 rounded-xl bg-muted/60 p-3">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_104px_132px_auto] md:items-end">
            <Field label="Buscar pieza o código nuevo">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  maxLength={2000} ref={codeRef} aria-label="Código"
                  autoComplete="off"
                  value={entry.code}
                  onFocus={() => { setProductMenuOpen(true); setProductHighlight(0); }}
                  onBlur={() => setTimeout(() => setProductMenuOpen(false), 150)}
                  onChange={(e) => {
                    onCodeChange(e.target.value);
                    setProductMenuOpen(true);
                    setProductHighlight(0);
                  }}
                  onKeyDown={(e) => {
                    if (productMenuOpen && productResults.length > 0) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setProductHighlight((h) => Math.min(h + 1, productResults.length - 1));
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setProductHighlight((h) => Math.max(h - 1, 0));
                      } else if (e.key === "Enter") {
                        const exact = findProduct(entry.code);
                        if (exact) {
                          e.preventDefault();
                          pickProduct(exact);
                        } else if (productResults[productHighlight]) {
                          e.preventDefault();
                          pickProduct(productResults[productHighlight]);
                        }
                      } else if (e.key === "Escape") {
                        setProductMenuOpen(false);
                      }
                    }
                  }}
                  placeholder="Código"
                  className={cn(inputClass, "pl-9 font-mono", !runtime && "uppercase")}
                />
                {productMenuOpen && entry.code.trim() && productResults.length > 0 && !(match && productResults.length === 1 && productResults[0].id === match.id) && (
                  <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-border bg-popover shadow-lg">
                    <ul role="listbox" aria-label="Artículos encontrados" className="max-h-64 overflow-y-auto py-1">
                      {productResults.map((p, idx) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={idx === productHighlight}
                            onMouseDown={(e) => e.preventDefault()}
                            onMouseEnter={() => setProductHighlight(idx)}
                            onClick={() => pickProduct(p)}
                            className={cn(
                              "flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors",
                              idx === productHighlight && "bg-accent",
                            )}
                          >
                            <span className="w-24 shrink-0 truncate font-mono text-xs text-muted-foreground sm:w-28">
                              {p.code}
                            </span>
                            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                              {p.name}
                            </span>
                            <span className="hidden shrink-0 text-xs text-muted-foreground tabular-nums sm:inline">
                              Stock {p.stock}
                            </span>
                            <span className="w-20 shrink-0 text-right text-xs font-semibold text-foreground tabular-nums sm:w-24">
                              {formatUnitMoney(p.costExact ?? p.cost)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </Field>
            <Field label="Cant.">
              <Input
                ref={qtyRef}
                type="number"
                inputMode="decimal"
                min="1" step="1" aria-label="Cantidad"
                value={entry.quantity}
                onChange={(e) =>
                  setEntry({
                    ...entry,
                    quantity: e.target.value,
                  })
                }
                onKeyDown={(e) => e.key === "Enter" && addLine()}
                className={cn(inputClass, "tabular-nums")}
              />
            </Field>
            <Field label="Costo unit.">
              <Input
                type="number"
                inputMode="decimal" step="0.0001" min="0" aria-label="Costo unitario"
                aria-invalid={Boolean(entryError)}
                value={entry.cost}
                onChange={(e) =>
                  setEntry({
                    ...entry,
                    cost: e.target.value,
                  })
                }
                onKeyDown={(e) => e.key === "Enter" && addLine()}
                placeholder="0.00"
                className={cn(inputClass, "tabular-nums")}
              />
            </Field>
            <Button
              className="h-10 rounded-xl"
              onClick={addLine}
              disabled={!canAddLine}
            >
              <Plus />
              {"Agregar"}
            </Button>
          </div>
          {showNewDescription && (
            <div className="grid gap-3 border-t border-border/60 pt-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <Field label="Descripción del artículo nuevo">
                <Input
                  maxLength={2000} aria-label="Descripción" value={entry.name}
                  autoComplete="off"
                  onChange={(e) =>
                    setEntry({
                      ...entry,
                      name: e.target.value,
                    })
                  }
                  onKeyDown={(e) => e.key === "Enter" && addLine()}
                  placeholder="Descripción"
                  className={inputClass}
                />
              </Field>
              {!runtime && (
                <Field label="Categoría">
                  <Select
                    value={entry.category}
                    onValueChange={(v) =>
                      setEntry({
                        ...entry,
                        category: v,
                      })
                    }
                  >
                    <SelectTrigger className="h-10 w-[160px] rounded-xl bg-card text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem value={c} key={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {entry.code.trim() &&
              (match ? (
                <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1 font-medium text-emerald-700 dark:text-emerald-400">
                  <CircleCheck className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{match.name}</span>
                  {" · stock "}
                  {match.stock}
                  {" · costo ant. "}
                  {formatUnitMoney(match.costExact ?? match.cost)}
                </span>
              ) : (
                <span className="rounded-md bg-accent px-2 py-1 font-medium text-accent-foreground">
                  {"Artículo nuevo · escribe su descripción arriba"}
                </span>
              ))}
            {entryError && (
              <span role="alert" className="font-medium text-primary">
                {entryError}
              </span>
            )}
            {entryChanged && <span role="alert" className="text-primary">
              {match ? "El artículo cambió." : "El código ya no está disponible. Selecciona un artículo vigente."}
              {match && <Button variant="outline" size="sm" className="ml-2" onClick={() => onCodeChange(entry.code)}>
                Revisar artículo
              </Button>}
            </span>}
            {entryPrices?.p1 !== undefined && (
              <span>
                {"Precios sugeridos:"}{" "}
                <span className="font-medium text-foreground">
                  {"P1 "}
                  {formatUnitMoney(entryPrices.p1)}
                  {" · P2 "}
                  {formatUnitMoney(entryPrices.p2)}
                  {" · P3"} {formatUnitMoney(entryPrices.p3)}
                </span>
              </span>
            )}
          </div>
        </div>
        {lines.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border">
            <EmptyState
              icon={PackageOpen}
              title="Sin artículos en esta compra"
              description="Escribe el código del artículo; si ya existe se completa solo."
            />
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                  <th className="px-3 py-2.5 font-medium">{"Artículo"}</th>
                  <th className="px-2 py-2.5 text-center font-medium">
                    {"Cant."}
                  </th>
                  <th className="px-2 py-2.5 text-right font-medium">
                    {"Costo"}
                  </th>
                  <th className="px-2 py-2.5 text-right font-medium">{"P1"}</th>
                  <th className="px-2 py-2.5 text-right font-medium">{"P2"}</th>
                  <th className="px-2 py-2.5 text-right font-medium">{"P3"}</th>
                  <th className="px-3 py-2.5 text-right font-medium">
                    {"Subtotal"}
                  </th>
                  <th className="w-10 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {pricedLines.map((l) => {
                  const existing = l.existing;
                  return (
                    <tr
                      className="border-b border-border last:border-0"
                      key={l.key}
                    >
                      <td className="px-3 py-2.5">
                        <p className="font-medium">{l.name}</p>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-mono whitespace-pre-wrap">{l.code}</span>
                          {" ·"}{" "}
                          {existing ? (
                            <span>
                              {"stock "}
                              {formatNumber(decimalUnits(l.stockBefore, 2))}
                              {" →"}{" "}
                              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                {l.stockAfter !== undefined ? formatNumber(decimalUnits(l.stockAfter, 2)) : "—"}
                              </span>
                            </span>
                          ) : (
                            <span className="font-medium text-primary">
                              {"nuevo"}
                            </span>
                          )}
                        </p>
                        {l.changed && !locked && <div className="mt-2 space-y-1 text-xs">
                          <p role="alert" className="text-primary">{existing
                            ? `Datos actuales: ${existing.name}, costo ${formatUnitMoney(existing.costExact ?? existing.cost)}.`
                            : "El código ya no está disponible. Quita la línea y selecciona el artículo vigente."}</p>
                          {existing && <>
                            <p className="text-muted-foreground">
                              {PRICE_KEYS.map(k => `${k.toUpperCase()} ${formatUnitMoney(existing.pricesExact?.[k] ?? existing.prices[k])}`).join(" · ")}
                            </p>
                            <p className="text-muted-foreground">Al aceptar se reemplazan la descripción, el costo y los precios de esta línea.</p>
                            <Button variant="outline" size="sm" onClick={() => {
                              updateLine(l.key, { ...catalogFields(existing), name: existing.name, category: existing.category,
                                cost: existing.costExact ?? String(existing.cost), overrides: {} });
                              setError(null);
                            }}>Usar datos actuales</Button>
                          </>}
                        </div>}
                      </td>
                      <td className="px-2 py-2.5">
                        <Input
                          type="number"
                          inputMode="decimal"
                          min="1" step="1" aria-label="Cantidad de la línea"
                          value={l.quantity}
                          onChange={(e) =>
                            updateLine(l.key, {
                              quantity: e.target.value,
                            })
                          }
                          className="mx-auto h-8 w-20 rounded-lg text-center tabular-nums"
                        />
                      </td>
                      <td className="px-2 py-2.5">
                        <Input
                          type="number"
                          step="0.0001" min="0" aria-label="Costo de la línea"
                          value={l.cost}
                          aria-invalid={Boolean(l.error)}
                          onChange={(e) =>
                            updateLine(l.key, {
                              cost: e.target.value,
                            })
                          }
                          className="ml-auto h-8 w-24 rounded-lg text-right"
                        />
                        {l.error && (
                          <p role="alert" className="mt-1 text-xs text-primary">
                            {l.error}
                          </p>
                        )}
                      </td>
                      {PRICE_KEYS.map((k) => (
                        <td className="px-2 py-2.5" key={k}>
                          <Input
                            type="number"
                            step="0.0001" min="0" aria-label={k.toUpperCase()}
                            value={l.prices[k] ?? ""}
                            onChange={(e) =>
                              updateLine(l.key, {
                                overrides: {
                                  ...l.overrides,
                                  [k]: e.target.value,
                                },
                              })
                            }
                            className={cn(
                              "ml-auto h-8 w-24 rounded-lg text-right",
                              l.overrides[k] !== undefined &&
                                "border-amber-500/60",
                            )}
                          />
                        </td>
                      ))}
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums">
                        {l.subtotal === undefined ? "—" : formatMoney(l.subtotal)}
                      </td>
                      <td className="px-2 py-2.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:bg-accent hover:text-primary"
                          onClick={() =>
                            setLines((prev) =>
                              prev.filter((x) => x.key !== l.key),
                            )
                          }
                          aria-label="Quitar"
                        >
                          <Trash2 />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </fieldset>
      <div className="space-y-4 rounded-2xl border border-border bg-card p-5 lg:sticky lg:top-24">
        <div>
          <p className="text-xs text-muted-foreground">
            {"Resumen de la compra"}
          </p>
          <p className="mt-0.5 truncate font-semibold">
            {supplier?.name ?? "Sin suplidor"}
          </p>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{"Artículos"}</span>
            <span className="font-medium">{lines.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{"Unidades"}</span>
            <span className="font-medium tabular-nums">{units === "—" ? units : formatNumber(units)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              {"Nuevos en catálogo"}
            </span>
            <span className="font-medium">
              {new Set(pricedLines.filter(l => !l.existing).map(l => l.code)).size}
            </span>
          </div>
        </div>
        <div className="rounded-xl bg-accent px-4 py-3.5">
          <p className="text-xs font-medium uppercase tracking-wider text-accent-foreground/80">
            {"Total compra"}
          </p>
          {total === null ? (
            <p className="text-[30px] leading-tight text-primary">{"—"}</p>
          ) : (
            <MoneyDisplay
              value={total}
              className="text-[30px] leading-tight text-primary"
              symbolClassName="text-primary/70"
              centsClassName="text-primary/50"
            />
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {condition === "credito"
            ? "Se creará una cuenta por pagar al suplidor."
            : "Se registra como compra pagada."}{" "}
          {"Las existencias, costos y precios se actualizan al subir."}
        </p>
        {tried && lines.length === 0 && (
          <p className="text-xs font-medium text-primary">
            {"Agrega al menos un artículo."}
          </p>
        )}
        {(error || totalError) && <p role="alert" className="text-xs font-medium text-primary">{error || totalError}</p>}
        {databaseChanged && <div role="alert" className="space-y-2 text-sm">
          <p>La base de datos cambió. Revisa esta compra antes de iniciar otra.</p>
          <Button variant="outline" onClick={restart}>Iniciar otra compra</Button>
        </div>}
        <Button
          className="h-12 w-full rounded-xl text-[15px] font-semibold shadow-md shadow-primary/20"
          onClick={submit}
          disabled={sending || databaseChanged || (!retryInput && (hasInvalidLine || !!runtime?.pending || runtime?.connection === "unavailable"))}
        >
          <Upload />
          {sending ? "Confirmando compra…" : retryInput ? "Reintentar compra" : "Subir factura al inventario"}
        </Button>
      </div>
    </div>
  );
}
export { PurchaseEntryForm };

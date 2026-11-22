// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { purchaseDecimal, purchaseLineAmounts, purchasePrices, purchaseTotals } from "../../data/operational-purchases.js";
import { costUnits, decimalUnits, quantityUnits } from "../../../../src/pos/operation-fields.js";
import { Field } from "./form-field.jsx";
import { Select2 } from "../../components/ui/select.jsx";
import { SelectTrigger2 } from "../../components/ui/select.jsx";
import { inputClass } from "./form-field.jsx";
import { SelectValue2 } from "../../components/ui/select.jsx";
import { SelectContent2 } from "../../components/ui/select.jsx";
import { SelectItem2 } from "../../components/ui/select.jsx";
import { Input } from "../../components/ui/input.jsx";
import { formulaSummary } from "../lib/pricing.js";
import { cn } from "../../lib/utils.js";
import { Button } from "../../components/ui/button.jsx";
import { Plus } from "lucide-react";
import { CircleCheck } from "lucide-react";
import { formatMoney, formatNumber, formatUnitMoney } from "../lib/format.js";
import { CATEGORIES } from "../../data/catalog-options.js";
import { EmptyState } from "./section-card.jsx";
import { PackageOpen } from "lucide-react";
import { PRICE_KEYS } from "../lib/pricing.js";
import { Trash2 } from "lucide-react";
import { MoneyDisplay } from "./money-display.jsx";
import { Upload } from "lucide-react";
import { Fragment } from "react";
import { useRef, useMemo } from "react";
import { useState } from "react";
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
  const [condition, setCondition] = useState("credito");
  const [entry, setEntry] = useState(EMPTY_ENTRY);
  const [lines, setLines] = useState([]);
  const [tried, setTried] = useState(false);
  const codeRef = useRef(null);
  const [error, setError] = useState(null);
  const [retryInput, setRetryInput] = useState(null);
  const [sending, setSending] = useState(false);
  const [databaseId, setDatabaseId] = useState(runtime?.databaseId);
  const inFlight = useRef(false);
  const databaseChanged = databaseId !== runtime?.databaseId;
  const locked = sending || !!retryInput || databaseChanged;
  const supplier = suppliers.find(s => String(s.id) === supplierId);
  const formula = formulas.find(f => String(f.id) === formulaId);
  const findProduct = code => products.find(p => runtime ? p.code === code : p.code.toLowerCase() === code.trim().toLowerCase());
  const match = findProduct(entry.code);
  const entryChanged = runtime && entry.code && catalogChanged(entry, match);
  const suggestions = useMemo(() => {
    const query = entry.code.toLowerCase();
    return products.filter(p => p.code.toLowerCase().includes(query)).slice(0, 100);
  }, [entry.code, products]);
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
  const entryError = !runtime && entryResult.prices && Number(entry.cost) === 0
    ? "Indica un costo unitario mayor que cero." : entryResult.error;
  const entryPrices = !entryError && entryResult.prices;
  const canAddLine = !locked && !entryChanged && !entryError && entryResult.units && entry.code.trim() && entry.name.trim() && lines.length < 1000;
  const productsByCode = useMemo(() => new Map(products.map(p => [p.code, p])), [products]);
  const projectedStock = new Map();
  const pricedLines = lines.map(line => {
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
  const { total, units, error: totalError } = purchaseTotals(pricedLines);
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
            <Select2
              disabled={locked} value={supplierId}
              onValueChange={(id) => {
                setSupplierId(id);
                const s = suppliers.find((x) => String(x.id) === id);
                setFormulaId(String(s?.formulaId ?? "manual"));
              }}
            >
              <SelectTrigger2 aria-label="Suplidor" className={inputClass}>
                <SelectValue2 placeholder="Selecciona un suplidor" />
              </SelectTrigger2>
              <SelectContent2>
                {suppliers.map((s) => (
                  <SelectItem2 value={String(s.id)} key={s.id}>
                    {s.name}
                  </SelectItem2>
                ))}
              </SelectContent2>
            </Select2>
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
            <Select2 disabled={!!runtime || locked} value={runtime ? "unavailable" : condition} onValueChange={(v) => setCondition(v)}>
              <SelectTrigger2 className={inputClass}>
                <SelectValue2 />
              </SelectTrigger2>
              <SelectContent2>
                {runtime && <SelectItem2 value="unavailable">Sin registrar</SelectItem2>}
                <SelectItem2 value="credito">{"A crédito"}</SelectItem2>
                <SelectItem2 value="contado">{"Pagada (contado)"}</SelectItem2>
              </SelectContent2>
            </Select2>
          </Field>
          <Field
            label="Fórmula de precios"
            className="md:col-span-4"
            hint="Se elige sola según el suplidor. Los precios se recalculan al cambiarla."
          >
            <Select2 disabled={locked} value={formulaId} onValueChange={setFormulaId}>
              <SelectTrigger2 aria-label="Fórmula de precios" className={inputClass}>
                <SelectValue2 />
              </SelectTrigger2>
              <SelectContent2>
                {runtime && <SelectItem2 value="manual">Precios manuales</SelectItem2>}
                {formulas.map((f) => (
                  <SelectItem2 value={String(f.id)} key={f.id}>
                    {f.name}
                    {" ("}
                    {formulaSummary(f)}
                    {")"}
                  </SelectItem2>
                ))}
              </SelectContent2>
            </Select2>
          </Field>
        </div>
        <div className="rounded-xl bg-muted/60 p-3">
          <div className="grid gap-3 md:grid-cols-[150px_minmax(0,1fr)_90px_120px_auto] md:items-end">
            <Field label="Código">
              <Input
                maxLength={2000} ref={codeRef} aria-label="Código"
                value={entry.code}
                onChange={(e) => onCodeChange(e.target.value)}
                placeholder="Código"
                list="purchase-codes"
                className={cn(inputClass, "font-mono", !runtime && "uppercase")}
              />
              <datalist id="purchase-codes">
                {suggestions.map((p) => (
                  <option value={p.code} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </datalist>
            </Field>
            <Field label="Descripción">
              <Input
                maxLength={2000} aria-label="Descripción" value={entry.name}
                onChange={(e) =>
                  setEntry({
                    ...entry,
                    name: e.target.value,
                  })
                }
                placeholder="Descripción"
                className={inputClass}
              />
            </Field>
            <Field label="Cant.">
              <Input
                type="number"
                min="0.01" step="0.01" aria-label="Cantidad"
                value={entry.quantity}
                onChange={(e) =>
                  setEntry({
                    ...entry,
                    quantity: e.target.value,
                  })
                }
                className={inputClass}
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
                className={inputClass}
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
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {entry.code.trim() &&
              (match ? (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-1 font-medium text-emerald-700 dark:text-emerald-400">
                  <CircleCheck className="h-3 w-3" />
                  {"Ya existe · stock "}
                  {match.stock}
                  {" · costo anterior "}
                  {formatUnitMoney(match.costExact ?? match.cost)}
                </span>
              ) : (
                <Fragment>
                  <span className="rounded-md bg-accent px-2 py-1 font-medium text-accent-foreground">
                    {"Artículo nuevo"}
                  </span>
                  {!runtime && <Select2
                    value={entry.category}
                    onValueChange={(v) =>
                      setEntry({
                        ...entry,
                        category: v,
                      })
                    }
                  >
                    <SelectTrigger2 className="h-7 w-[140px] rounded-lg bg-card text-xs">
                      <SelectValue2 />
                    </SelectTrigger2>
                    <SelectContent2>
                      {CATEGORIES.map((c) => (
                        <SelectItem2 value={c} key={c}>
                          {c}
                        </SelectItem2>
                      ))}
                    </SelectContent2>
                  </Select2>}
                </Fragment>
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
                          min="0.01" step="0.01" aria-label="Cantidad de la línea"
                          value={l.quantity}
                          onChange={(e) =>
                            updateLine(l.key, {
                              quantity: e.target.value,
                            })
                          }
                          className="mx-auto h-8 w-16 rounded-lg text-center"
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
          {runtime ? "La condición de pago no está disponible para esta entrada." : condition === "credito"
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

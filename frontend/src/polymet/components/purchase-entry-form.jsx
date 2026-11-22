// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { pricesFromFormula } from "../lib/pricing.js";
import { round2 } from "../lib/format.js";
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
import { formatMoney } from "../lib/format.js";
import { CATEGORIES } from "../../data/catalog-options.js";
import { EmptyState } from "./section-card.jsx";
import { PackageOpen } from "lucide-react";
import { PRICE_KEYS } from "../lib/pricing.js";
import { Trash2 } from "lucide-react";
import { MoneyDisplay } from "./money-display.jsx";
import { Upload } from "lucide-react";
import { Fragment } from "react";
import { useRef } from "react";
import { useState } from "react";
var EMPTY_ENTRY = {
  code: "",
  name: "",
  category: "Motor",
  quantity: "1",
  cost: "",
};
function PurchaseEntryForm({
  suppliers,
  formulas,
  products,
  rounding,
  onSubmit,
}) {
  const [supplierId, setSupplierId] = useState("");
  const [invoice, setInvoice] = useState("");
  const [formulaId, setFormulaId] = useState(formulas[0]?.id ?? "");
  const [condition, setCondition] = useState("credito");
  const [entry, setEntry] = useState(EMPTY_ENTRY);
  const [lines, setLines] = useState([]);
  const [tried, setTried] = useState(false);
  const codeRef = useRef(null);
  const formula = formulas.find((f) => f.id === formulaId);
  const match = products.find(
    (p) => p.code.toLowerCase() === entry.code.trim().toLowerCase(),
  );
  const suggestionFor = (cost) => {
    const decimal = cost.startsWith(".") ? `0${cost}` : cost;
    try {
      return { prices: pricesFromFormula(decimal, formula, rounding) };
    } catch (cause) {
      return { error: cause.message };
    }
  };
  const entrySuggestion = entry.cost === "" ? {} : suggestionFor(entry.cost);
  const { prices: entryPrices, error: entryError } =
    entrySuggestion.prices && Number(entry.cost) === 0
      ? { error: "Indica un costo unitario mayor que cero." }
      : entrySuggestion;
  const canAddLine = Boolean(
    entryPrices && entry.code.trim() && entry.name.trim(),
  );
  const pricedLines = lines.map((line) => {
    const { prices, error } = suggestionFor(line.cost);
    return { ...line, prices: { ...prices, ...line.overrides }, error };
  });
  const hasInvalidLine = pricedLines.some((line) => line.error);
  const total = hasInvalidLine
    ? null
    : round2(
        lines.reduce((sum, line) => sum + Number(line.cost) * line.quantity, 0),
      );
  const units = lines.reduce((s, l) => s + l.quantity, 0);
  const onCodeChange = (code) => {
    const found = products.find(
      (p) => p.code.toLowerCase() === code.trim().toLowerCase(),
    );
    setEntry((e) => ({
      ...e,
      code,
      name: found ? found.name : e.name,
      category: found ? found.category : e.category,
      cost: found && !e.cost ? String(found.cost) : e.cost,
    }));
  };
  const addLine = () => {
    if (!canAddLine) return;
    const qty = Math.max(1, Number(entry.quantity) || 1);
    setLines((prev) => {
      const existing = prev.find(
        (l) => l.code.toLowerCase() === entry.code.trim().toLowerCase(),
      );
      if (existing) {
        return prev.map((l) =>
          l === existing
            ? {
                ...l,
                quantity: l.quantity + qty,
                cost: entry.cost,
              }
            : l,
        );
      }
      return [
        ...prev,
        {
          key: `${Date.now()}`,
          productId: match?.id,
          code: entry.code.trim().toUpperCase(),
          name: entry.name.trim(),
          category: entry.category,
          quantity: qty,
          cost: entry.cost,
          overrides: {},
        },
      ];
    });
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
  const submit = () => {
    setTried(true);
    if (!supplierId || lines.length === 0 || hasInvalidLine) return;
    onSubmit({
      supplierId,
      supplierInvoice: invoice.trim(),
      formulaId,
      condition,
      lines: pricedLines.map((l) => ({
        productId: l.productId,
        code: l.code,
        name: l.name,
        category: l.category,
        quantity: l.quantity,
        cost: Number(l.cost),
        prices: l.prices,
      })),
    });
    setLines([]);
    setInvoice("");
    setTried(false);
  };
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-5 rounded-2xl border border-border bg-card p-5">
        <div className="grid gap-4 md:grid-cols-4">
          <Field
            label="Suplidor"
            className="md:col-span-2"
            error={tried && !supplierId ? "Selecciona el suplidor" : undefined}
          >
            <Select2
              value={supplierId}
              onValueChange={(id) => {
                setSupplierId(id);
                const s = suppliers.find((x) => x.id === id);
                if (s) setFormulaId(s.formulaId);
              }}
            >
              <SelectTrigger2 className={inputClass}>
                <SelectValue2 placeholder="Selecciona un suplidor" />
              </SelectTrigger2>
              <SelectContent2>
                {suppliers.map((s) => (
                  <SelectItem2 value={s.id} key={s.id}>
                    {s.name}
                  </SelectItem2>
                ))}
              </SelectContent2>
            </Select2>
          </Field>
          <Field label="No. factura del suplidor">
            <Input
              value={invoice}
              onChange={(e) => setInvoice(e.target.value)}
              placeholder="Ej. FAC-4589"
              className={inputClass}
            />
          </Field>
          <Field label="Condición">
            <Select2 value={condition} onValueChange={(v) => setCondition(v)}>
              <SelectTrigger2 className={inputClass}>
                <SelectValue2 />
              </SelectTrigger2>
              <SelectContent2>
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
            <Select2 value={formulaId} onValueChange={setFormulaId}>
              <SelectTrigger2 className={inputClass}>
                <SelectValue2 />
              </SelectTrigger2>
              <SelectContent2>
                {formulas.map((f) => (
                  <SelectItem2 value={f.id} key={f.id}>
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
                ref={codeRef}
                value={entry.code}
                onChange={(e) => onCodeChange(e.target.value)}
                placeholder="Código"
                list="purchase-codes"
                className={cn(inputClass, "font-mono uppercase")}
              />
              <datalist id="purchase-codes">
                {products.map((p) => (
                  <option value={p.code} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </datalist>
            </Field>
            <Field label="Descripción">
              <Input
                value={entry.name}
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
                min={1}
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
                inputMode="decimal"
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
                  {formatMoney(match.cost)}
                </span>
              ) : (
                <Fragment>
                  <span className="rounded-md bg-accent px-2 py-1 font-medium text-accent-foreground">
                    {"Artículo nuevo"}
                  </span>
                  <Select2
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
                  </Select2>
                </Fragment>
              ))}
            {entryError && (
              <span role="alert" className="font-medium text-primary">
                {entryError}
              </span>
            )}
            {entryPrices && (
              <span>
                {"Precios sugeridos:"}{" "}
                <span className="font-medium text-foreground">
                  {"P1 "}
                  {formatMoney(entryPrices.p1)}
                  {" · P2 "}
                  {formatMoney(entryPrices.p2)}
                  {" · P3"} {formatMoney(entryPrices.p3)}
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
                  const existing = products.find((p) => p.id === l.productId);
                  return (
                    <tr
                      className="border-b border-border last:border-0"
                      key={l.key}
                    >
                      <td className="px-3 py-2.5">
                        <p className="font-medium">{l.name}</p>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-mono">{l.code}</span>
                          {" ·"}{" "}
                          {existing ? (
                            <span>
                              {"stock "}
                              {existing.stock}
                              {" →"}{" "}
                              <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                {existing.stock + l.quantity}
                              </span>
                            </span>
                          ) : (
                            <span className="font-medium text-primary">
                              {"nuevo"}
                            </span>
                          )}
                        </p>
                      </td>
                      <td className="px-2 py-2.5">
                        <Input
                          type="number"
                          min={1}
                          value={l.quantity}
                          onChange={(e) =>
                            updateLine(l.key, {
                              quantity: Math.max(
                                1,
                                Number(e.target.value) || 1,
                              ),
                            })
                          }
                          className="mx-auto h-8 w-16 rounded-lg text-center"
                        />
                      </td>
                      <td className="px-2 py-2.5">
                        <Input
                          type="number"
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
                            value={l.prices[k] ?? ""}
                            onChange={(e) =>
                              updateLine(l.key, {
                                overrides: {
                                  ...l.overrides,
                                  [k]: Number(e.target.value) || 0,
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
                        {l.error ? "—" : formatMoney(Number(l.cost) * l.quantity)}
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
      </div>
      <div className="space-y-4 rounded-2xl border border-border bg-card p-5 lg:sticky lg:top-24">
        <div>
          <p className="text-xs text-muted-foreground">
            {"Resumen de la compra"}
          </p>
          <p className="mt-0.5 truncate font-semibold">
            {suppliers.find((s) => s.id === supplierId)?.name ?? "Sin suplidor"}
          </p>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{"Artículos"}</span>
            <span className="font-medium">{lines.length}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{"Unidades"}</span>
            <span className="font-medium tabular-nums">{units}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              {"Nuevos en catálogo"}
            </span>
            <span className="font-medium">
              {lines.filter((l) => !l.productId).length}
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
        <Button
          className="h-12 w-full rounded-xl text-[15px] font-semibold shadow-md shadow-primary/20"
          onClick={submit}
          disabled={hasInvalidLine}
        >
          <Upload />
          {"Subir factura al inventario"}
        </Button>
      </div>
    </div>
  );
}
export { PurchaseEntryForm };

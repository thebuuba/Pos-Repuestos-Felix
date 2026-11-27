// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { ACTIVE_PRICE_KEYS, cascadeFromCost, formulaSummary, marginPct } from "../../lib/pricing.js";
import { Sheet } from "../ui/sheet.jsx";
import { SheetContent } from "../ui/sheet.jsx";
import { SheetHeader } from "../ui/sheet.jsx";
import { SheetTitle } from "../ui/sheet.jsx";
import { SheetDescription } from "../ui/sheet.jsx";
import { Field } from "./form-field.jsx";
import { Input } from "../ui/input.jsx";
import { cn } from "../../lib/utils.js";
import { inputClass } from "./form-field.jsx";
import { Select } from "../ui/select.jsx";
import { SelectTrigger } from "../ui/select.jsx";
import { SelectValue } from "../ui/select.jsx";
import { SelectContent } from "../ui/select.jsx";
import { SelectItem } from "../ui/select.jsx";
import { Button } from "../ui/button.jsx";
import { Sparkles } from "lucide-react";
import { formatMoney } from "../../lib/format.js";
import { Switch } from "../ui/switch.jsx";
import { SheetFooter } from "../ui/sheet.jsx";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { costUnits, OperationError } from "../../../../src/pos/operation-fields.js";
const EMPTY = {
  code: "",
  reference: "",
  altCodes: [],
  name: "",
  brand: "",
  category: "",
  location: "",
  cost: "",
  stock: "0",
  minStock: "5",
  notifyMinStock: true,
  adjustmentReason: "",
  taxable: true,
  prices: {
    p1: "",
    p2: "",
    p3: "",
  },
};
const ADJUSTMENT_SUGGESTIONS = [
  "Conteo físico",
  "Merma / daño",
  "Devolución",
  "Error de digitación",
];
var LEVEL_LABEL2 = {
  p1: "Precio 1 · Detalle",
  p2: "Precio 2 · Por mayor",
};
function fromProduct(p) {
  return {
    code: p.code,
    reference: p.reference ?? "",
    altCodes: [...(p.altCodes || [])],
    name: p.name,
    brand: p.brand,
    category: p.category,
    location: p.location,
    cost: p.costExact ?? String(p.cost),
    stock: String(p.stock),
    minStock: String(p.minStock),
    notifyMinStock: p.notifyMinStock !== false,
    adjustmentReason: "",
    taxable: p.taxable,
    prices: p.pricesExact ?? {
      p1: String(p.prices.p1),
      p2: String(p.prices.p2),
      p3: String(p.prices.p3),
    },
  };
}
const normalizeDecimal = value => value.replace(/^\./, "0.").replace(/^0+(?=\d)/, "");
const normalizeNonNegativeDraft = value => /^0\d/.test(value) ? value.replace(/^0+(?=\d)/, "") : value;
function validQuantity(value) {
  return /^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(value) && Number(value) <= 2147483647;
}
function validUnit(value) {
  try {
    costUnits(normalizeDecimal(value), "el importe unitario");
    return true;
  } catch (error) {
    if (error instanceof OperationError) return false;
    throw error;
  }
}
function ProductFormSheet({
  open,
  onOpenChange,
  draft,
  formulas,
  rounding,
  onSave,
}) {
  const product = draft?.product;
  const categories = draft?.categories ?? [];
  const categoryChoices = product?.category && !categories.includes(product.category)
    ? [product.category, ...categories]
    : categories;
  const [syncedDraft, setSyncedDraft] = useState(null);
  const [form, setForm] = useState(() => (open && product ? fromProduct(product) : EMPTY));
  const [altDraft, setAltDraft] = useState("");
  const [formulaId, setFormulaId] = useState(String(formulas[0]?.id ?? ""));
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [retryPayload, setRetryPayload] = useState(null);
  const inFlight = useRef(false);
  const fields = useRef(null);
  const formId = useId();
  const fieldId = (key) => `${formId}-${key}`;
  const locked = sending || retryPayload !== null;
  const targetSync = open ? (draft ?? "__open__") : null;
  if (open && syncedDraft !== targetSync) {
    setSyncedDraft(targetSync);
    setForm(product ? fromProduct(product) : { ...EMPTY, category: "" });
    setAltDraft("");
    setSubmitted(false);
    setError(null);
    setRetryPayload(null);
  } else if (!open && syncedDraft !== null) {
    setSyncedDraft(null);
  }
  const set = (key, value) =>
    setForm((f) => ({
      ...f,
      [key]: value,
    }));
  const unitError = "Usa un importe válido con hasta cuatro decimales";
  const costDecimal = normalizeDecimal(form.cost);
  const validCost = validUnit(costDecimal);
  const cost = validCost ? Number(costDecimal) : 0;
  const formula = formulas.find((f) => String(f.id) === formulaId) ?? formulas[0];
  let suggested, suggestionError;
  if (formula && form.cost !== "") {
    if (!validCost) suggestionError = unitError;
    else if (cost > 0) {
      try {
        const calc = cascadeFromCost(costDecimal, formula, rounding);
        suggested = { p1: Number(calc.prices.p1), p2: Number(calc.prices.p2) };
      } catch (cause) {
        suggestionError = cause.message;
      }
    }
  }
  const applyFormula = () => {
    if (!suggested) return;
    set("prices", {
      p1: String(suggested.p1),
      p2: String(suggested.p2),
      p3: String(suggested.p2),
    });
  };
  const existingCodesSet = useMemo(() => {
    const src = draft?.existingCodes;
    return src instanceof Set ? src : new Set(src || []);
  }, [draft?.existingCodes]);
  const codeTaken =
    form.code.trim() !== "" &&
    form.code !== product?.code &&
    existingCodesSet.has(form.code);
  const quantityError = "Usa una cantidad entre 0 y 2147483647 con hasta dos decimales";
  const textError = (value) =>
    value.length > 2000 ? "Usa hasta 2000 caracteres" : undefined;
  const name = form.name === product?.name ? form.name : form.name.trim();
  const reference = form.reference === (product?.reference ?? "") ? form.reference : form.reference.trim();
  const brand = form.brand === product?.brand ? form.brand : form.brand.trim();
  const location = form.location === product?.location ? form.location : form.location.trim().toUpperCase();
  const stockDelta = product && validQuantity(form.stock)
    ? Math.round((Number(form.stock) - Number(product.stock)) * 100) / 100
    : 0;
  const errors = {
    code: !form.code.trim()
      ? "Requerido"
      : (textError(form.code) ??
        (codeTaken ? "Ese código ya existe" : undefined)),
    reference: textError(reference),
    name: !form.name.trim() ? "Requerido" : textError(name),
    brand: textError(brand),
    category: textError(form.category),
    location: textError(location),
    adjustmentReason: textError(form.adjustmentReason || ""),
    cost:
      form.cost === ""
        ? "Indica el costo"
        : !validCost
          ? unitError
          : undefined,
    stock: validQuantity(form.stock) ? undefined : quantityError,
    minStock: validQuantity(form.minStock) ? undefined : quantityError,
    p1:
      form.prices.p1 === ""
        ? "Indica el precio"
        : !validUnit(form.prices.p1)
          ? unitError
          : undefined,
    p2: form.prices.p2 && !validUnit(form.prices.p2) ? unitError : undefined,
  };
  const valid = !Object.values(errors).some(Boolean);
  const handleSubmit = async () => {
    if (inFlight.current || !draft) return;
    setError(null);
    let payload = retryPayload;
    if (!payload) {
      setSubmitted(true);
      const badInput = Array.from(
        fields.current.querySelectorAll('input[type="number"]'),
      ).find((input) => input.validity.badInput);
      if (badInput) {
        setError("Revisa los campos numéricos del artículo.");
        badInput.focus();
        return;
      }
      if (!valid) return;
      const p1 = normalizeDecimal(form.prices.p1);
      const p2 = form.prices.p2 === "" ? p1 : normalizeDecimal(form.prices.p2);
      const p3 = p2;
      const cleanReason = (form.adjustmentReason || "").trim();
      payload = {
        id: draft.id,
        databaseId: draft.databaseId,
        ...(draft.version === undefined ? {} : { version: draft.version }),
        code: form.code,
        reference,
        name,
        brand,
        category: form.category === product?.category ? form.category : form.category.trim(),
        location,
        cost: costDecimal,
        stock: Number(form.stock),
        minStock: Number(form.minStock),
        notifyMinStock: form.notifyMinStock !== false,
        taxable: form.taxable,
        ...(stockDelta !== 0 && cleanReason ? { adjustmentReason: cleanReason } : {}),
        prices: { p1: Number(p1), p2: Number(p2), p3: Number(p3) },
        pricesExact: { p1, p2, p3 },
        altCodes: [...(form.altCodes || []), ...(altDraft.trim() ? [altDraft] : [])].filter((c, i, arr) => arr.findIndex(x => x.toLowerCase() === c.toLowerCase()) === i),
      };
    }
    inFlight.current = true;
    setSending(true);
    try {
      await onSave(payload);
    } catch (cause) {
      setError(cause?.message || "No se pudo guardar el artículo.");
      if (cause?.definitive === true) setRetryPayload(null);
      else if (cause?.uncertain) setRetryPayload(payload);
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!inFlight.current) onOpenChange(nextOpen);
      }}
    >
      <SheetContent
        className="flex w-full flex-col gap-0 p-0 sm:max-w-lg"
        aria-busy={sending}
      >
        <SheetHeader className="border-b border-border px-6 py-5 text-left">
          <SheetTitle>
            {product ? "Editar artículo" : "Nuevo artículo"}
          </SheetTitle>
          <SheetDescription>
            {"Los campos con precio se pueden calcular solos con una fórmula."}
          </SheetDescription>
        </SheetHeader>
        <div
          ref={fields}
          className="flex-1 space-y-6 overflow-y-auto px-6 py-5"
        >
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Código"
              htmlFor={fieldId("code")}
              error={submitted ? errors.code : undefined}
            >
              <Input
                id={fieldId("code")}
                disabled={locked}
                aria-invalid={submitted && !!errors.code}
                value={form.code}
                onChange={(e) => set("code", e.target.value)}
                placeholder="Ej. BUJ-C7HSA"
                className={cn(inputClass, "font-mono")}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoFocus={true}
              />
            </Field>
            <Field
              label="Marca"
              htmlFor={fieldId("brand")}
              error={submitted ? errors.brand : undefined}
            >
              <Input
                id={fieldId("brand")}
                disabled={locked}
                value={form.brand}
                onChange={(e) => set("brand", e.target.value)}
                placeholder="Ej. NGK"
                className={inputClass}
              />
            </Field>
            <Field
              label="Nombre"
              htmlFor={fieldId("name")}
              className="col-span-2"
              error={submitted ? errors.name : undefined}
            >
              <Input
                id={fieldId("name")}
                disabled={locked}
                aria-invalid={submitted && !!errors.name}
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Ej. Bujía NGK C7HSA"
                className={inputClass}
              />
            </Field>
            <Field
              label="Referencia"
              htmlFor={fieldId("reference")}
              className="col-span-2"
              hint="Código de pieza de cada compañía o fabricante."
              error={submitted ? errors.reference : undefined}
            >
              <Input
                id={fieldId("reference")}
                disabled={locked}
                aria-invalid={submitted && !!errors.reference}
                value={form.reference}
                onChange={(e) => set("reference", e.target.value)}
                placeholder="Ej. 94701-00242 / código de pieza"
                className={cn(inputClass, "font-mono")}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </Field>
            <Field
              label="Códigos de barras alternativos"
              htmlFor={fieldId("altCodes")}
              className="col-span-2"
              hint="Etiquetas adicionales del empaque; conserva ceros iniciales."
            >
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    id={fieldId("altCodes")}
                    disabled={locked || (form.altCodes?.length ?? 0) >= 20}
                    value={altDraft}
                    onChange={(e) => setAltDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const next = altDraft;
                        if (!next.trim() || (form.altCodes || []).some(c => c.toLowerCase() === next.toLowerCase())) return;
                        set("altCodes", [...(form.altCodes || []), next]);
                        setAltDraft("");
                      }
                    }}
                    placeholder="Escanea o escribe otro código y pulsa Agregar"
                    className={cn(inputClass, "flex-1 font-mono")}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={locked || !altDraft.trim() || (form.altCodes?.length ?? 0) >= 20}
                    className="h-10 rounded-xl bg-card"
                    onClick={() => {
                      const next = altDraft;
                      if (!next.trim() || (form.altCodes || []).some(c => c.toLowerCase() === next.toLowerCase())) return;
                      set("altCodes", [...(form.altCodes || []), next]);
                      setAltDraft("");
                    }}
                  >
                    {"Agregar"}
                  </Button>
                </div>
                {(form.altCodes?.length ?? 0) > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {form.altCodes.map((code) => (
                      <span key={code} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-2.5 py-1 font-mono text-xs">
                        {code}
                        <button
                          type="button"
                          disabled={locked}
                          aria-label={`Quitar código ${code}`}
                          className="text-muted-foreground hover:text-primary"
                          onClick={() => set("altCodes", form.altCodes.filter(c => c !== code))}
                        >
                          {"×"}
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Field>
            <Field
              label="Categoría"
              htmlFor={fieldId("category")}
              error={submitted ? errors.category : undefined}
            >
              <Input
                id={fieldId("category")}
                list={categoryChoices.length > 0 ? fieldId("category-list") : undefined}
                disabled={locked}
                value={form.category}
                onChange={(e) => set("category", e.target.value)}
                placeholder="Sin categoría"
                className={inputClass}
                aria-invalid={submitted && !!errors.category}
              />
              {categoryChoices.length > 0 && (
                <datalist id={fieldId("category-list")}>
                  {categoryChoices.map((c) => (
                    <option value={c} key={c} />
                  ))}
                </datalist>
              )}
            </Field>
            <Field
              label="Ubicación"
              htmlFor={fieldId("location")}
              hint="Pasillo / tramo"
              error={submitted ? errors.location : undefined}
            >
              <Input
                id={fieldId("location")}
                disabled={locked}
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
                placeholder="Ej. A-01"
                className={cn(inputClass, "uppercase")}
              />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-4 rounded-xl bg-muted/60 p-4">
            <Field
              label="Costo base RD$"
              htmlFor={fieldId("cost")}
              error={submitted ? errors.cost : undefined}
            >
              <Input
                id={fieldId("cost")}
                disabled={locked}
                aria-invalid={submitted && !!errors.cost}
                type="number"
                inputMode="decimal"
                step="0.0001"
                value={form.cost}
                onChange={(e) => set("cost", e.target.value)}
                placeholder="0.00"
                className={inputClass}
              />
            </Field>
            <Field
              label="Existencia"
              htmlFor={fieldId("stock")}
              error={submitted ? errors.stock : undefined}
            >
              <Input
                id={fieldId("stock")}
                disabled={locked}
                aria-invalid={submitted && !!errors.stock}
                type="number"
                inputMode="decimal"
                step="0.01"
                value={form.stock}
                onFocus={(e) => {
                  if (e.currentTarget.value === "0") set("stock", "");
                  else e.currentTarget.select();
                }}
                onBlur={() => {
                  if (form.stock === "") set("stock", "0");
                }}
                onChange={(e) => set("stock", normalizeNonNegativeDraft(e.target.value))}
                placeholder="0"
                className={inputClass}
              />
            </Field>
            <Field
              label="Mínimo"
              htmlFor={fieldId("minStock")}
              hint="Avisa al bajar"
              error={submitted ? errors.minStock : undefined}
            >
              <Input
                id={fieldId("minStock")}
                disabled={locked}
                aria-invalid={submitted && !!errors.minStock}
                type="number"
                inputMode="decimal"
                step="0.01"
                value={form.minStock}
                onFocus={(e) => {
                  if (e.currentTarget.value === "0") set("minStock", "");
                  else e.currentTarget.select();
                }}
                onBlur={() => {
                  if (form.minStock === "") set("minStock", "0");
                }}
                onChange={(e) => set("minStock", normalizeNonNegativeDraft(e.target.value))}
                placeholder="0"
                className={inputClass}
              />
            </Field>
          </div>
          {product && stockDelta !== 0 && (
            <div className="space-y-2.5 rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-foreground">{"Ajuste manual de existencia"}</p>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums",
                    stockDelta > 0
                      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                      : "bg-accent text-primary",
                  )}
                >
                  {stockDelta > 0 ? `+${stockDelta} uds.` : `−${Math.abs(stockDelta)} uds.`}
                </span>
              </div>
              <Field
                label="Motivo del ajuste (opcional)"
                htmlFor={fieldId("adjustmentReason")}
                error={submitted ? errors.adjustmentReason : undefined}
              >
                <Input
                  id={fieldId("adjustmentReason")}
                  disabled={locked}
                  maxLength={2000}
                  value={form.adjustmentReason}
                  onChange={(e) => set("adjustmentReason", e.target.value)}
                  placeholder="Ej. Conteo físico del tramo A-1"
                  className={inputClass}
                />
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {ADJUSTMENT_SUGGESTIONS.map((s) => (
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => set("adjustmentReason", s)}
                      className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                      key={s}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </Field>
            </div>
          )}
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-2">
              <Field
                label="Fórmula de precios"
                htmlFor={fieldId("formula")}
                className="min-w-0 flex-1"
              >
                <Select
                  value={String(formula?.id ?? "")}
                  onValueChange={setFormulaId}
                  disabled={locked || !formula}
                >
                  <SelectTrigger
                    id={fieldId("formula")}
                    className={inputClass}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
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
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-xl bg-card"
                onClick={applyFormula}
                disabled={locked || !suggested}
              >
                <Sparkles />
                {"Calcular"}
              </Button>
            </div>
            {suggestionError && (!submitted || validCost) && (
              <p role="alert" className="text-xs font-medium text-primary">
                {suggestionError}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3">
              {ACTIVE_PRICE_KEYS.map((k) => {
                const price = validUnit(form.prices[k])
                  ? Number(form.prices[k])
                  : 0;
                const m = marginPct(price, cost);
                return (
                  <Field
                    label={LEVEL_LABEL2[k]}
                    htmlFor={fieldId(k)}
                    error={submitted ? errors[k] : undefined}
                    hint={
                      price > 0 && cost > 0 ? (
                        <span
                          className={cn(m < 10 && "font-medium text-amber-600")}
                        >
                          {"Margen "}
                          {m.toFixed(1)}
                          {"%"}
                        </span>
                      ) : suggested ? (
                        `Sugerido ${formatMoney(suggested[k])}`
                      ) : undefined
                    }
                    key={k}
                  >
                    <Input
                      id={fieldId(k)}
                      disabled={locked}
                      aria-invalid={submitted && !!errors[k]}
                      type="number"
                      inputMode="decimal"
                      step="0.0001"
                      value={form.prices[k]}
                      onChange={(e) =>
                        set("prices", {
                          ...form.prices,
                          [k]: e.target.value,
                        })
                      }
                      placeholder={suggested ? String(suggested[k]) : "0.00"}
                      className={inputClass}
                    />
                  </Field>
                );
              })}
            </div>
          </div>
          <div className="space-y-2.5">
            <label className="flex items-center justify-between rounded-xl border border-border p-4">
              <div>
                <p className="text-sm font-medium">{"Aplica ITBIS"}</p>
                <p className="text-xs text-muted-foreground">
                  {"Desactiva para artículos exentos."}
                </p>
              </div>
              <Switch
                aria-label="Aplica ITBIS"
                disabled={locked}
                checked={form.taxable}
                onCheckedChange={(v) => set("taxable", v)}
              />
            </label>
            <label className="flex items-center justify-between rounded-xl border border-border p-4">
              <div>
                <p className="text-sm font-medium">{"Alertas de reposición"}</p>
                <p className="text-xs text-muted-foreground">
                  {"Avisa cuando la existencia llegue al nivel mínimo."}
                </p>
              </div>
              <Switch
                aria-label="Alertas de reposición"
                disabled={locked}
                checked={form.notifyMinStock !== false}
                onCheckedChange={(v) => set("notifyMinStock", v)}
              />
            </label>
          </div>
        </div>
        {error && (
          <p role="alert" className="px-6 pb-2 text-sm text-primary">
            {error}
          </p>
        )}
        <SheetFooter className="gap-2 border-t border-border px-6 py-4 sm:space-x-0">
          <Button
            variant="outline"
            className="h-11 rounded-xl bg-card"
            disabled={sending}
            onClick={() => {
              if (inFlight.current) return;
              if (product || retryPayload) onOpenChange(false);
              else {
                setForm({ ...EMPTY, category: "" });
                setAltDraft("");
                setSubmitted(false);
                setError(null);
              }
            }}
          >
            {retryPayload ? "Cerrar" : product ? "Cancelar" : "Limpiar"}
          </Button>
          <Button
            data-shortcut-submit="true"
            className="h-11 flex-1 rounded-xl font-semibold"
            aria-disabled={sending || undefined}
            onClick={handleSubmit}
          >
            {sending
              ? "Guardando…"
              : retryPayload
                ? "Reintentar guardado"
                : product
                  ? "Guardar cambios"
                  : "Guardar artículo"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
export { ProductFormSheet };

// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { pricesFromFormula } from "../lib/pricing.js";
import { Sheet } from "../../components/ui/sheet.jsx";
import { SheetContent } from "../../components/ui/sheet.jsx";
import { SheetHeader } from "../../components/ui/sheet.jsx";
import { SheetTitle } from "../../components/ui/sheet.jsx";
import { SheetDescription } from "../../components/ui/sheet.jsx";
import { Field } from "./form-field.jsx";
import { Input } from "../../components/ui/input.jsx";
import { cn } from "../../lib/utils.js";
import { inputClass } from "./form-field.jsx";
import { Select2 } from "../../components/ui/select.jsx";
import { SelectTrigger2 } from "../../components/ui/select.jsx";
import { SelectValue2 } from "../../components/ui/select.jsx";
import { SelectContent2 } from "../../components/ui/select.jsx";
import { CATEGORIES } from "../../data/catalog-options.js";
import { SelectItem2 } from "../../components/ui/select.jsx";
import { formulaSummary } from "../lib/pricing.js";
import { Button } from "../../components/ui/button.jsx";
import { Sparkles } from "lucide-react";
import { PRICE_KEYS } from "../lib/pricing.js";
import { marginPct } from "../lib/pricing.js";
import { formatMoney } from "../lib/format.js";
import { Switch2 } from "../../components/ui/switch.jsx";
import { SheetFooter } from "../../components/ui/sheet.jsx";
import { useEffect, useId, useRef, useState } from "react";
import { costUnits, OperationError } from "../../../../src/pos/operation-fields.js";
var EMPTY = {
  code: "",
  name: "",
  brand: "",
  category: "Motor",
  location: "",
  cost: "",
  stock: "",
  minStock: "5",
  taxable: true,
  prices: {
    p1: "",
    p2: "",
    p3: "",
  },
};
var LEVEL_LABEL2 = {
  p1: "Precio 1 · Detalle",
  p2: "Precio 2 · Por mayor",
  p3: "Precio 3 · Taller",
};
function fromProduct(p) {
  return {
    code: p.code,
    name: p.name,
    brand: p.brand,
    category: p.category,
    location: p.location,
    cost: p.costExact ?? String(p.cost),
    stock: String(p.stock),
    minStock: String(p.minStock),
    taxable: p.taxable,
    prices: {
      p1: String(p.prices.p1),
      p2: String(p.prices.p2),
      p3: String(p.prices.p3),
    },
  };
}
function validMoney(value) {
  return (
    /^(?:\d+|\d*\.\d{1,2})$/.test(value) && Number(value) <= 999999999999.99
  );
}
function validQuantity(value) {
  return /^(?:\d*|\d*\.\d{1,2})$/.test(value) && Number(value) <= 2147483647;
}
function validBaseCost(value) {
  try {
    costUnits(value, "el costo");
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
  const [form, setForm] = useState(EMPTY);
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
  useEffect(() => {
    if (open) {
      setForm(product ? fromProduct(product) : EMPTY);
      setSubmitted(false);
      setError(null);
      setRetryPayload(null);
    }
  }, [open, draft, product]);
  const set = (key, value) =>
    setForm((f) => ({
      ...f,
      [key]: value,
    }));
  const moneyError = "Usa un importe válido con hasta dos decimales";
  const costError = "Usa un importe válido con hasta cuatro decimales";
  const costDecimal = form.cost.replace(/^\./, "0.").replace(/^0+(?=\d)/, "");
  const validCost = validBaseCost(costDecimal);
  const cost = validCost ? Number(costDecimal) : 0;
  const formula = formulas.find((f) => String(f.id) === formulaId) ?? formulas[0];
  let suggested, suggestionError;
  if (formula && form.cost !== "") {
    if (!validCost) suggestionError = costError;
    else if (cost > 0) {
      try {
        suggested = pricesFromFormula(costDecimal, formula, rounding);
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
      p3: String(suggested.p3),
    });
  };
  const codeTaken =
    form.code.trim() !== "" &&
    draft?.existingCodes.some(
      (c) => c === form.code && c !== product?.code,
    );
  const quantityError = "Usa una cantidad entre 0 y 2147483647 con hasta dos decimales";
  const textError = (value) =>
    value.length > 2000 ? "Usa hasta 2000 caracteres" : undefined;
  const errors = {
    code: !form.code.trim()
      ? "Requerido"
      : (textError(form.code) ??
        (codeTaken ? "Ese código ya existe" : undefined)),
    name: !form.name.trim() ? "Requerido" : textError(form.name.trim()),
    brand: textError(form.brand.trim()),
    category: textError(form.category),
    location: textError(form.location.trim().toUpperCase()),
    cost:
      form.cost === ""
        ? "Indica el costo"
        : !validCost
          ? costError
          : undefined,
    stock: validQuantity(form.stock) ? undefined : quantityError,
    minStock: validQuantity(form.minStock) ? undefined : quantityError,
    p1:
      form.prices.p1 === ""
        ? "Indica el precio"
        : !validMoney(form.prices.p1)
          ? moneyError
          : undefined,
    p2: form.prices.p2 && !validMoney(form.prices.p2) ? moneyError : undefined,
    p3: form.prices.p3 && !validMoney(form.prices.p3) ? moneyError : undefined,
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
      const p1 = Number(form.prices.p1);
      const p2 = form.prices.p2 === "" ? p1 : Number(form.prices.p2);
      const p3 = form.prices.p3 === "" ? p2 : Number(form.prices.p3);
      payload = {
        id: draft.id,
        databaseId: draft.databaseId,
        ...(draft.version === undefined ? {} : { version: draft.version }),
        code: form.code,
        name: form.name.trim(),
        brand: form.brand.trim(),
        category: form.category,
        location: form.location.trim().toUpperCase(),
        cost: costDecimal,
        stock: Number(form.stock),
        minStock: Number(form.minStock),
        taxable: form.taxable,
        prices: { p1, p2, p3 },
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
              label="Descripción"
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
              label="Categoría"
              htmlFor={fieldId("category")}
              error={submitted ? errors.category : undefined}
            >
              <Select2
                value={form.category}
                onValueChange={(v) => set("category", v)}
                disabled={locked}
              >
                <SelectTrigger2 id={fieldId("category")} className={inputClass}>
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
                onChange={(e) => set("stock", e.target.value)}
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
                onChange={(e) => set("minStock", e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-2">
              <Field
                label="Fórmula de precios"
                htmlFor={fieldId("formula")}
                className="min-w-0 flex-1"
              >
                <Select2
                  value={String(formula?.id ?? "")}
                  onValueChange={setFormulaId}
                  disabled={locked || !formula}
                >
                  <SelectTrigger2
                    id={fieldId("formula")}
                    className={inputClass}
                  >
                    <SelectValue2 />
                  </SelectTrigger2>
                  <SelectContent2>
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
            <div className="grid grid-cols-3 gap-3">
              {PRICE_KEYS.map((k) => {
                const price = validMoney(form.prices[k])
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
          <label className="flex items-center justify-between rounded-xl border border-border p-4">
            <div>
              <p className="text-sm font-medium">{"Aplica ITBIS"}</p>
              <p className="text-xs text-muted-foreground">
                {"Desactiva para artículos exentos."}
              </p>
            </div>
            <Switch2
              aria-label="Aplica ITBIS"
              disabled={locked}
              checked={form.taxable}
              onCheckedChange={(v) => set("taxable", v)}
            />
          </label>
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
                setForm(EMPTY);
                setSubmitted(false);
                setError(null);
              }
            }}
          >
            {retryPayload ? "Cerrar" : product ? "Cancelar" : "Limpiar"}
          </Button>
          <Button
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

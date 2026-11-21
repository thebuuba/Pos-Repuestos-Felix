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
import { CATEGORIES } from "../data/pos-data.js";
import { SelectItem2 } from "../../components/ui/select.jsx";
import { formulaSummary } from "../lib/pricing.js";
import { Button } from "../../components/ui/button.jsx";
import { Sparkles } from "lucide-react";
import { PRICE_KEYS } from "../lib/pricing.js";
import { marginPct } from "../lib/pricing.js";
import { formatMoney } from "../lib/format.js";
import { Switch2 } from "../../components/ui/switch.jsx";
import { SheetFooter } from "../../components/ui/sheet.jsx";
import { useEffect } from "react";
import { useState } from "react";
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
    cost: String(p.cost),
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
function ProductFormSheet({
  open,
  onOpenChange,
  product,
  formulas,
  rounding,
  existingCodes,
  onSave,
}) {
  const [form, setForm] = useState(EMPTY);
  const [formulaId, setFormulaId] = useState(formulas[0]?.id ?? "");
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    if (open) {
      setForm(product ? fromProduct(product) : EMPTY);
      setSubmitted(false);
    }
  }, [open, product]);
  const set = (key, value) =>
    setForm((f) => ({
      ...f,
      [key]: value,
    }));
  const cost = Number(form.cost) || 0;
  const formula = formulas.find((f) => f.id === formulaId);
  const suggested = pricesFromFormula(cost, formula, rounding);
  const applyFormula = () =>
    set("prices", {
      p1: String(suggested.p1),
      p2: String(suggested.p2),
      p3: String(suggested.p3),
    });
  const codeTaken =
    form.code.trim() !== "" &&
    existingCodes.some(
      (c) =>
        c.toLowerCase() === form.code.trim().toLowerCase() &&
        c.toLowerCase() !== product?.code.toLowerCase(),
    );
  const errors = {
    code: !form.code.trim()
      ? "Requerido"
      : codeTaken
        ? "Ese código ya existe"
        : undefined,
    name: !form.name.trim() ? "Requerido" : undefined,
    cost: cost <= 0 ? "Indica el costo" : undefined,
    p1: !(Number(form.prices.p1) > 0) ? "Indica el precio" : undefined,
  };
  const valid = !Object.values(errors).some(Boolean);
  const handleSubmit = () => {
    setSubmitted(true);
    if (!valid) return;
    const p1 = Number(form.prices.p1);
    onSave({
      id: product?.id ?? `p-${Date.now().toString(36)}`,
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      brand: form.brand.trim() || "—",
      category: form.category,
      location: form.location.trim().toUpperCase() || "—",
      cost,
      stock: Math.max(0, Number(form.stock) || 0),
      minStock: Math.max(0, Number(form.minStock) || 0),
      taxable: form.taxable,
      prices: {
        p1,
        p2: Number(form.prices.p2) || p1,
        p3: Number(form.prices.p3) || Number(form.prices.p2) || p1,
      },
    });
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border px-6 py-5 text-left">
          <SheetTitle>
            {product ? "Editar artículo" : "Nuevo artículo"}
          </SheetTitle>
          <SheetDescription>
            {"Los campos con precio se pueden calcular solos con una fórmula."}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Código" error={submitted ? errors.code : undefined}>
              <Input
                value={form.code}
                onChange={(e) => set("code", e.target.value)}
                placeholder="Ej. BUJ-C7HSA"
                className={cn(inputClass, "font-mono uppercase")}
                autoFocus={true}
              />
            </Field>
            <Field label="Marca">
              <Input
                value={form.brand}
                onChange={(e) => set("brand", e.target.value)}
                placeholder="Ej. NGK"
                className={inputClass}
              />
            </Field>
            <Field
              label="Descripción"
              className="col-span-2"
              error={submitted ? errors.name : undefined}
            >
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Ej. Bujía NGK C7HSA"
                className={inputClass}
              />
            </Field>
            <Field label="Categoría">
              <Select2
                value={form.category}
                onValueChange={(v) => set("category", v)}
              >
                <SelectTrigger2 className={inputClass}>
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
            <Field label="Ubicación" hint="Pasillo / tramo">
              <Input
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
              error={submitted ? errors.cost : undefined}
            >
              <Input
                type="number"
                inputMode="decimal"
                value={form.cost}
                onChange={(e) => set("cost", e.target.value)}
                placeholder="0.00"
                className={inputClass}
              />
            </Field>
            <Field label="Existencia">
              <Input
                type="number"
                value={form.stock}
                onChange={(e) => set("stock", e.target.value)}
                placeholder="0"
                className={inputClass}
              />
            </Field>
            <Field label="Mínimo" hint="Avisa al bajar">
              <Input
                type="number"
                value={form.minStock}
                onChange={(e) => set("minStock", e.target.value)}
                className={inputClass}
              />
            </Field>
          </div>
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Fórmula de precios" className="min-w-0 flex-1">
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
              <Button
                type="button"
                variant="outline"
                className="h-10 rounded-xl bg-card"
                onClick={applyFormula}
                disabled={cost <= 0}
              >
                <Sparkles />
                {"Calcular"}
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {PRICE_KEYS.map((k) => {
                const price = Number(form.prices[k]) || 0;
                const m = marginPct(price, cost);
                return (
                  <Field
                    label={LEVEL_LABEL2[k]}
                    error={submitted && k === "p1" ? errors.p1 : undefined}
                    hint={
                      price > 0 && cost > 0 ? (
                        <span
                          className={cn(m < 10 && "font-medium text-amber-600")}
                        >
                          {"Margen "}
                          {m.toFixed(1)}
                          {"%"}
                        </span>
                      ) : cost > 0 ? (
                        `Sugerido ${formatMoney(suggested[k])}`
                      ) : undefined
                    }
                    key={k}
                  >
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={form.prices[k]}
                      onChange={(e) =>
                        set("prices", {
                          ...form.prices,
                          [k]: e.target.value,
                        })
                      }
                      placeholder={cost > 0 ? String(suggested[k]) : "0.00"}
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
              checked={form.taxable}
              onCheckedChange={(v) => set("taxable", v)}
            />
          </label>
        </div>
        <SheetFooter className="gap-2 border-t border-border px-6 py-4 sm:space-x-0">
          <Button
            variant="outline"
            className="h-11 rounded-xl bg-card"
            onClick={() => (product ? onOpenChange(false) : setForm(EMPTY))}
          >
            {product ? "Cancelar" : "Limpiar"}
          </Button>
          <Button
            className="h-11 flex-1 rounded-xl font-semibold"
            onClick={handleSubmit}
          >
            {product ? "Guardar cambios" : "Guardar artículo"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
export { ProductFormSheet };

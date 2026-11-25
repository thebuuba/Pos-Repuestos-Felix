// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { useEffect, useMemo, useRef, useState } from "react";
import { Calculator, Plus } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "../ui/sheet.jsx";
import { Field, inputClass } from "./form-field.jsx";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "../ui/select.jsx";
import { Input } from "../ui/input.jsx";
import { Button } from "../ui/button.jsx";
import { cascadeFromListPrice, factorFromPercent, formulaSummary } from "../../lib/pricing.js";
import { formatMoney } from "../../lib/format.js";
import { normalizeFormula } from "../../../../src/domain/pricing.js";
import { newId } from "../../data/new-id.js";

const NEW_FORMULA = "__new__";
const SAMPLE_LIST = "100";

function formulaFromRecord(record) {
  return {
    name: record?.name ?? "",
    costFactor: String(record?.costFactor ?? "1.12"),
    p2: String(record?.margins?.p2 ?? "13"),
    p1: String(record?.margins?.p1 ?? "15"),
  };
}

function SupplierFormSheet({
  open,
  onOpenChange,
  editing,
  creationDatabaseId,
  startWithFormula = false,
  formulas,
  formulaUsage,
  rounding,
  runtime,
  onSaveSupplier,
  onSaveFormula,
}) {
  const [values, setValues] = useState({
    name: "",
    rnc: "",
    phone: "",
    contact: "",
    creditDays: "",
    email: "",
    formulaId: "none",
  });
  const [calcDraft, setCalcDraft] = useState({ name: "", costFactor: "1.12", p2: "13", p1: "15" });
  const [calcNameEdited, setCalcNameEdited] = useState(false);
  const [tried, setTried] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const busy = useRef(false);
  const retryState = useRef(null);
  const scrollBodyRef = useRef(null);
  const calcBoxRef = useRef(null);
  const costFactorRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const linked = editing?.formulaId != null
      ? formulas.find((f) => String(f.id) === String(editing.formulaId))
      : null;
    const initialFormulaId = startWithFormula && !linked
      ? NEW_FORMULA
      : runtime
        ? String(editing?.formulaId ?? "none")
        : String(editing?.formulaId ?? formulas[0]?.id ?? "none");
    const supplierName = editing?.name ?? "";
    setValues({
      name: supplierName,
      rnc: editing?.rnc ?? "",
      phone: editing?.phone ?? "",
      contact: editing?.contact ?? "",
      creditDays: String(editing?.creditDays ?? (runtime ? "" : 30)),
      email: editing?.email ?? "",
      formulaId: initialFormulaId,
    });
    if (linked) {
      setCalcDraft(formulaFromRecord(linked));
      setCalcNameEdited(true);
    } else {
      setCalcDraft({
        name: supplierName.trim() ? `Fórmula ${supplierName.trim()}` : "",
        costFactor: "1.12",
        p2: "13",
        p1: "15",
      });
      setCalcNameEdited(false);
    }
    setTried(false);
    setError(null);
    retryState.current = null;
    if (startWithFormula) {
      const timer = window.setTimeout(() => {
        if (scrollBodyRef.current) {
          scrollBodyRef.current.scrollTop = scrollBodyRef.current.scrollHeight;
        }
        calcBoxRef.current?.scrollIntoView({ block: "end" });
        costFactorRef.current?.focus();
        costFactorRef.current?.select();
      }, 90);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [open, editing, startWithFormula]);

  const selectedExistingFormula = useMemo(() => {
    if (values.formulaId === "none" || values.formulaId === NEW_FORMULA) return null;
    return formulas.find((f) => String(f.id) === String(values.formulaId)) ?? null;
  }, [formulas, values.formulaId]);

  const showFormulaEditor = values.formulaId === NEW_FORMULA || Boolean(selectedExistingFormula);
  const sharedUsageCount = selectedExistingFormula ? (formulaUsage[selectedExistingFormula.id] ?? 0) : 0;

  const effectiveCalcName = calcNameEdited
    ? calcDraft.name
    : values.name.trim()
      ? `Fórmula ${values.name.trim()}`
      : calcDraft.name;

  const formulaDirty = useMemo(() => {
    if (values.formulaId === NEW_FORMULA) return true;
    if (!selectedExistingFormula) return false;
    return (
      effectiveCalcName.trim() !== String(selectedExistingFormula.name ?? "").trim() ||
      String(calcDraft.costFactor).trim() !== String(selectedExistingFormula.costFactor) ||
      String(calcDraft.p2).trim() !== String(selectedExistingFormula.margins?.p2 ?? 0) ||
      String(calcDraft.p1).trim() !== String(selectedExistingFormula.margins?.p1 ?? 0)
    );
  }, [values.formulaId, selectedExistingFormula, effectiveCalcName, calcDraft]);

  const preview = useMemo(() => {
    if (!showFormulaEditor) return null;
    try {
      const calc = cascadeFromListPrice(
        SAMPLE_LIST,
        { costFactor: calcDraft.costFactor, margins: { p1: calcDraft.p1, p2: calcDraft.p2, p3: 0 } },
        rounding,
      );
      return {
        cost: Number(calc.costExact),
        p2: Number(calc.prices.p2),
        p1: Number(calc.prices.p1),
      };
    } catch (cause) {
      return { error: cause.message };
    }
  }, [showFormulaEditor, calcDraft, rounding]);

  const onSelectFormula = (nextValue) => {
    setValues((s) => ({ ...s, formulaId: nextValue }));
    setError(null);
    if (nextValue === NEW_FORMULA) {
      setCalcDraft({
        name: values.name.trim() ? `Fórmula ${values.name.trim()}` : "",
        costFactor: "1.12",
        p2: "13",
        p1: "15",
      });
      setCalcNameEdited(false);
    } else if (nextValue !== "none") {
      const found = formulas.find((f) => String(f.id) === String(nextValue));
      if (found) {
        setCalcDraft(formulaFromRecord(found));
        setCalcNameEdited(true);
      }
    }
  };

  const handleSave = async () => {
    if (busy.current) return;
    setTried(true);
    if (!values.name.trim() && !retryState.current) return;
    busy.current = true;
    setSending(true);
    setError(null);
    try {
      let resolvedFormulaId = retryState.current?.resolvedFormulaId ?? null;
      if (resolvedFormulaId === null && values.formulaId !== "none") {
        if (formulaDirty) {
          const formulaName = effectiveCalcName.trim() || `Fórmula ${values.name.trim()}`;
          const normalizedInput = {
            name: formulaName,
            costFactor: runtime ? calcDraft.costFactor : Number(calcDraft.costFactor),
            margins: {
              p1: runtime ? calcDraft.p1 : Number(calcDraft.p1),
              p2: runtime ? calcDraft.p2 : Number(calcDraft.p2),
              p3: 0,
            },
          };
          normalizeFormula(normalizedInput);
          const formulaDto = retryState.current?.formulaDto ?? (
            selectedExistingFormula
              ? {
                  ...(runtime
                    ? { databaseId: selectedExistingFormula.databaseId ?? creationDatabaseId ?? runtime.databaseId, version: selectedExistingFormula.version }
                    : {}),
                  id: selectedExistingFormula.id,
                  ...normalizedInput,
                }
              : {
                  ...(runtime ? { databaseId: editing?.databaseId ?? creationDatabaseId ?? runtime.databaseId } : {}),
                  id: runtime ? crypto.randomUUID() : newId("f"),
                  ...normalizedInput,
                }
          );
          const savedFormula = await onSaveFormula(formulaDto);
          resolvedFormulaId = runtime ? Number(savedFormula?.result?.id ?? selectedExistingFormula?.id) : formulaDto.id;
          retryState.current = { resolvedFormulaId, formulaDto: null };
        } else {
          resolvedFormulaId = runtime ? Number(values.formulaId) : values.formulaId;
        }
      }

      const supplierDto = retryState.current?.supplierDto ?? {
        ...(runtime ? { databaseId: editing?.databaseId ?? creationDatabaseId ?? runtime.databaseId, version: editing?.version } : {}),
        id: editing?.id ?? (runtime ? crypto.randomUUID() : newId("s")),
        name: values.name.trim(),
        rnc: values.rnc.trim(),
        phone: values.phone.trim(),
        contact: values.contact.trim(),
        email: values.email.trim(),
        creditDays: values.creditDays.trim() === "" ? null : Number(values.creditDays),
        formulaId: values.formulaId === "none" ? null : resolvedFormulaId,
      };
      if (retryState.current) retryState.current.supplierDto = supplierDto;
      await onSaveSupplier(supplierDto, Boolean(formulaDirty && values.formulaId !== "none"));
      retryState.current = null;
      onOpenChange(false);
    } catch (cause) {
      setError(cause.message || "No se pudo guardar el suplidor.");
      if (cause.definitive) retryState.current = null;
    } finally {
      busy.current = false;
      setSending(false);
    }
  };

  const disabledAll = sending || Boolean(retryState.current?.supplierDto);

  return (
    <Sheet open={open} onOpenChange={(value) => { if (!busy.current) onOpenChange(value); }}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b border-border px-6 py-5 text-left">
          <SheetTitle>{editing ? "Editar suplidor" : "Nuevo suplidor"}</SheetTitle>
          <SheetDescription>
            {"Configura sus datos, crédito y el cálculo automático de Costo y sugerencias de precios."}
          </SheetDescription>
        </SheetHeader>
        <fieldset ref={scrollBodyRef} disabled={disabledAll} className="grid flex-1 grid-cols-2 content-start gap-4 overflow-y-auto px-6 py-5">
          <Field
            htmlFor="party-name"
            label="Nombre del suplidor"
            className="col-span-2"
            error={tried && !values.name.trim() ? "Requerido" : undefined}
          >
            <Input
              id="party-name"
              value={values.name}
              onChange={(e) => setValues((s) => ({ ...s, name: e.target.value }))}
              placeholder="Ej. Masotti"
              className={inputClass}
              autoFocus={!startWithFormula}
            />
          </Field>
          <Field htmlFor="party-rnc" label="RNC" className="col-span-1">
            <Input
              id="party-rnc"
              value={values.rnc}
              onChange={(e) => setValues((s) => ({ ...s, rnc: e.target.value }))}
              placeholder="000-00000-0"
              className={inputClass}
            />
          </Field>
          <Field htmlFor="party-phone" label="Teléfono" className="col-span-1">
            <Input
              id="party-phone"
              value={values.phone}
              onChange={(e) => setValues((s) => ({ ...s, phone: e.target.value }))}
              placeholder="809-000-0000"
              className={inputClass}
            />
          </Field>
          <Field htmlFor="party-contact" label="Persona de contacto" className="col-span-1">
            <Input
              id="party-contact"
              value={values.contact}
              onChange={(e) => setValues((s) => ({ ...s, contact: e.target.value }))}
              placeholder="Nombre del vendedor"
              className={inputClass}
            />
          </Field>
          <Field htmlFor="party-creditDays" label="Días de crédito" className="col-span-1">
            <Input
              id="party-creditDays"
              type="number"
              value={values.creditDays}
              onChange={(e) => setValues((s) => ({ ...s, creditDays: e.target.value }))}
              className={inputClass}
            />
          </Field>
          <Field htmlFor="party-email" label="Correo" className="col-span-2">
            <Input
              id="party-email"
              value={values.email}
              onChange={(e) => setValues((s) => ({ ...s, email: e.target.value }))}
              placeholder="ventas@suplidor.com"
              className={inputClass}
            />
          </Field>
          <Field
            htmlFor="party-formulaId"
            label="Fórmula de precios"
            hint="Calcula Costo desde P/Lista y sugiere P/Mayor y Detalle en Compras."
            className="col-span-2"
          >
            <Select disabled={disabledAll} value={values.formulaId} onValueChange={onSelectFormula}>
              <SelectTrigger id="party-formulaId" className={inputClass}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{"Sin fórmula"}</SelectItem>
                <SelectItem value={NEW_FORMULA}>{"+ Crear cálculo propio para este suplidor"}</SelectItem>
                {formulas.map((f) => (
                  <SelectItem value={String(f.id)} key={f.id}>
                    {`${f.name} (${formulaSummary(f)})`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          {values.formulaId === "none" ? (
            <div className="col-span-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 w-full rounded-xl bg-card text-xs"
                onClick={() => onSelectFormula(NEW_FORMULA)}
              >
                <Plus className="h-3.5 w-3.5" />
                {"Configurar cálculo para este suplidor"}
              </Button>
            </div>
          ) : showFormulaEditor ? (
            <div ref={calcBoxRef} className="col-span-2 space-y-3 rounded-xl border border-border bg-muted/50 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Calculator className="h-3.5 w-3.5 text-primary" />
                  {values.formulaId === NEW_FORMULA ? "Nuevo cálculo del suplidor" : "Editar cálculo asignado"}
                </p>
                {selectedExistingFormula && (
                  <button
                    type="button"
                    className="text-xs font-medium text-primary hover:underline"
                    onClick={() => onSelectFormula(NEW_FORMULA)}
                  >
                    {"Crear separado"}
                  </button>
                )}
              </div>
              {sharedUsageCount > 1 && (
                <p className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-snug text-amber-700 dark:text-amber-400">
                  {`Esta fórmula la usan ${sharedUsageCount} suplidores. Si la editas cambiará para todos, o toca «Crear separado».`}
                </p>
              )}
              <Field htmlFor="party-calc-name" label="Nombre de la fórmula">
                <Input
                  id="party-calc-name"
                  aria-label="Nombre de la fórmula del suplidor"
                  value={effectiveCalcName}
                  onChange={(e) => {
                    setCalcNameEdited(true);
                    setCalcDraft((d) => ({ ...d, name: e.target.value }));
                  }}
                  placeholder={values.name.trim() ? `Fórmula ${values.name.trim()}` : "Ej. Fórmula Suplidor"}
                  className="h-9 rounded-lg bg-card text-sm"
                />
              </Field>
              <div className="grid grid-cols-3 items-end gap-2">
                <Field htmlFor="party-calc-cost" label="Costo (×)">
                  <Input
                    ref={costFactorRef}
                    id="party-calc-cost"
                    type="number"
                    step="0.001"
                    aria-label="Factor de costo"
                    value={calcDraft.costFactor}
                    onChange={(e) => setCalcDraft((d) => ({ ...d, costFactor: e.target.value }))}
                    className="h-9 rounded-lg bg-card text-right tabular-nums"
                  />
                </Field>
                <Field htmlFor="party-calc-p2" label="P/Mayor +%">
                  <Input
                    id="party-calc-p2"
                    type="number"
                    step="0.0001"
                    aria-label="Recargo P/Mayor %"
                    value={calcDraft.p2}
                    onChange={(e) => setCalcDraft((d) => ({ ...d, p2: e.target.value }))}
                    className="h-9 rounded-lg bg-card text-right tabular-nums"
                  />
                </Field>
                <Field htmlFor="party-calc-p1" label="Detalle +%">
                  <Input
                    id="party-calc-p1"
                    type="number"
                    step="0.0001"
                    aria-label="Recargo Detalle %"
                    value={calcDraft.p1}
                    onChange={(e) => setCalcDraft((d) => ({ ...d, p1: e.target.value }))}
                    className="h-9 rounded-lg bg-card text-right tabular-nums"
                  />
                </Field>
              </div>
              {preview && !preview.error ? (
                <div className="rounded-lg bg-card px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground tabular-nums">
                  <span className="font-medium text-foreground">{"Ejemplo P/Lista RD$ 100:"}</span>
                  {" Costo "}
                  <strong className="text-foreground">{formatMoney(preview.cost)}</strong>
                  {` · P/Mayor (${factorFromPercent(calcDraft.p2) || "×1"}) `}
                  <strong className="text-foreground">{formatMoney(preview.p2)}</strong>
                  {` · Detalle (${factorFromPercent(calcDraft.p1) || "×1"}) `}
                  <strong className="text-foreground">{formatMoney(preview.p1)}</strong>
                </div>
              ) : preview?.error ? (
                <p role="alert" className="text-xs font-medium text-primary">
                  {preview.error}
                </p>
              ) : null}
            </div>
          ) : null}
        </fieldset>
        {error && <p role="alert" className="px-6 pb-3 text-sm text-primary">{error}</p>}
        <SheetFooter className="gap-2 border-t border-border px-6 py-4 sm:space-x-0">
          <Button
            variant="outline"
            className="h-11 rounded-xl bg-card"
            disabled={sending}
            onClick={() => onOpenChange(false)}
          >
            {"Cancelar"}
          </Button>
          <Button
            data-shortcut-submit="true"
            className="h-11 flex-1 rounded-xl font-semibold"
            disabled={sending}
            onClick={handleSave}
          >
            {sending ? "Guardando…" : retryState.current ? "Reintentar" : editing ? "Guardar cambios" : "Crear suplidor"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export { SupplierFormSheet };

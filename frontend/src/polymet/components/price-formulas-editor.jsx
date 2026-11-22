// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { formatMoney } from "../lib/format.js";
import { Button } from "../../components/ui/button.jsx";
import { newId } from "../../data/new-id.js";
import { Plus } from "lucide-react";
import { pricesFromFormula } from "../lib/pricing.js";
import { Input } from "../../components/ui/input.jsx";
import { PRICE_KEYS } from "../lib/pricing.js";
import { toast as ue } from "sonner";
import { Trash2 } from "lucide-react";
import { Calculator } from "lucide-react";
import { adjustedCost } from "../lib/pricing.js";
import { normalizeFormula } from "../../../../src/domain/pricing.js";
import { ConfirmDialog } from "./confirm-dialog.jsx";
import { useRef, useState } from "react";
var SAMPLE_COST = 1000;
function PriceFormulasEditor({ formulas, rounding, usage, onSave, onDelete, runtime }) {
  const [toDelete, setToDelete] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [uncertain, setUncertain] = useState(false);
  const inFlight = useRef(false);
  const visible = draft && !formulas.some(f => f.id === draft.id) ? [...formulas, draft] : formulas;
  const update = (f, patch) => {
    const next = { ...f, ...patch };
    if (runtime) {
      setError(null);
      setDraft(next);
    } else onSave(next);
  };
  const add = () => {
    if (runtime) {
      setError(null);
      setDraft({ id: crypto.randomUUID(), databaseId: runtime.databaseId, name: "",
        costFactor: 1, margins: { p1: 0, p2: 0, p3: 0 } });
    } else onSave({ id: newId("f"), name: "Nueva fórmula", costFactor: 1, margins: { p1: 35, p2: 25, p3: 15 } });
  };
  const save = async () => {
    if (inFlight.current || !draft) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      normalizeFormula(draft);
      await onSave(draft);
      setDraft(null);
      setUncertain(false);
      ue.success("Fórmula guardada");
    } catch (cause) {
      setError(cause.message);
      setUncertain(Boolean(cause.uncertain));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl bg-muted/60 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground">
          <span className="font-medium text-foreground">
            {"Cómo funciona:"}
          </span>
          {" costo de factura × ajuste ="}{" "}
          <span className="font-medium text-foreground">{"costo real"}</span>
          {
            ". Luego cada precio suma su % de ganancia sobre el costo real y se redondea. Ejemplo con un costo de "
          }
          {formatMoney(SAMPLE_COST)}
          {"."}
        </p>
        <Button
          variant="outline"
          className="shrink-0 rounded-xl bg-card"
          disabled={Boolean(draft)}
          onClick={add}
        >
          <Plus />
          {"Agregar fórmula"}
        </Button>
      </div>
      <div className="space-y-3">
        {visible.map((record) => {
          const editing = draft?.id === record.id;
          const f = editing ? draft : record;
          const locked = busy || uncertain || (draft && !editing);
          let sample, previewError;
          try {
            sample = {
              prices: pricesFromFormula(SAMPLE_COST, f, rounding),
              cost: adjustedCost(SAMPLE_COST, f),
            };
          } catch (cause) {
            previewError = cause.message;
          }
          return (
            <div className="rounded-2xl border border-border p-4" key={f.id}>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[200px] flex-1 space-y-1.5">
                  <p className="text-xs text-muted-foreground">{"Nombre"}</p>
                  <Input
                    disabled={locked}
                    aria-label="Nombre de la fórmula"
                    value={f.name}
                    onChange={(e) =>
                      update(f, {
                        name: e.target.value,
                      })
                    }
                    className="h-10 rounded-xl font-medium"
                  />
                </div>
                <div className="w-28 space-y-1.5">
                  <p className="text-xs text-muted-foreground">
                    {"Ajuste costo ×"}
                  </p>
                  <Input
                    type="number"
                    step="0.001"
                    disabled={locked}
                    aria-label="Ajuste costo"
                    value={f.costFactor}
                    onChange={(e) =>
                      update(f, {
                        costFactor: runtime ? e.target.value : Number(e.target.value) || 1,
                      })
                    }
                    className="h-10 rounded-xl"
                  />
                </div>
                {PRICE_KEYS.map((k) => (
                  <div className="w-24 space-y-1.5" key={k}>
                    <p className="text-xs text-muted-foreground">
                      {k.toUpperCase()}
                      {" ganancia %"}
                    </p>
                    <Input
                      type="number"
                      disabled={locked}
                      step="0.0001"
                      aria-label={`${k.toUpperCase()} ganancia %`}
                      value={f.margins[k]}
                      onChange={(e) =>
                        update(f, {
                          margins: {
                            ...f.margins,
                            [k]: runtime ? e.target.value : Number(e.target.value) || 0,
                          },
                        })
                      }
                      className="h-10 rounded-xl"
                    />
                  </div>
                ))}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-10 w-10 text-muted-foreground hover:bg-accent hover:text-primary"
                  onClick={() =>
                    usage[f.id]
                      ? ue.error("Fórmula en uso", {
                          description: `La usan ${usage[f.id]} suplidor(es).`,
                        })
                      : setToDelete(f)
                  }
                  disabled={Boolean(draft)}
                  aria-label="Eliminar fórmula"
                >
                  <Trash2 />
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {sample ? (
                  <>
                    <span className="inline-flex items-center gap-1.5">
                      <Calculator className="h-3.5 w-3.5 text-primary" />
                      {"Costo real "}
                      <span className="font-medium text-foreground">
                        {formatMoney(sample.cost)}
                      </span>
                    </span>
                    <span>
                      {"P1 "}
                      <span className="font-medium text-foreground">
                        {formatMoney(sample.prices.p1)}
                      </span>
                    </span>
                    <span>
                      {"P2 "}
                      <span className="font-medium text-foreground">
                        {formatMoney(sample.prices.p2)}
                      </span>
                    </span>
                    <span>
                      {"P3 "}
                      <span className="font-medium text-foreground">
                        {formatMoney(sample.prices.p3)}
                      </span>
                    </span>
                  </>
                ) : (
                  <span role="alert" className="font-medium text-primary">
                    {previewError}
                  </span>
                )}
                {usage[f.id] ? (
                  <span className="ml-auto">
                    {"Usada por "}
                    {usage[f.id]}
                    {" suplidor(es)"}
                  </span>
                ) : null}
              </div>
              {editing && <div className="mt-3 space-y-2">
                {error && <p role="alert" className="text-sm text-primary">{error}</p>}
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy || !f.name.trim()} className="rounded-xl" onClick={save}>
                    {busy ? "Confirmando…" : uncertain ? "Reintentar" : "Guardar fórmula"}
                  </Button>
                  <Button variant="outline" disabled={busy || uncertain} className="rounded-xl" onClick={() => { setDraft(null); setError(null); }}>
                    Descartar cambios
                  </Button>
                </div>
              </div>}
            </div>
          );
        })}
      </div>
      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="¿Eliminar fórmula?"
        description={`Se eliminará "${toDelete?.name ?? ""}".`}
        onConfirm={async () => {
          if (toDelete) await onDelete(runtime ? toDelete : toDelete.id);
          setToDelete(null);
        }}
      />
    </div>
  );
}
export { PriceFormulasEditor };

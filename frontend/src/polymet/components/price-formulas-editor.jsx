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
import { ConfirmDialog } from "./confirm-dialog.jsx";
import { useState } from "react";
var SAMPLE_COST = 1000;
function PriceFormulasEditor({ formulas, rounding, usage, onSave, onDelete }) {
  const [toDelete, setToDelete] = useState(null);
  const update = (f, patch) =>
    onSave({
      ...f,
      ...patch,
    });
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
          onClick={() =>
            onSave({
              id: newId("f"),
              name: "Nueva fórmula",
              costFactor: 1,
              margins: {
                p1: 35,
                p2: 25,
                p3: 15,
              },
            })
          }
        >
          <Plus />
          {"Agregar fórmula"}
        </Button>
      </div>
      <div className="space-y-3">
        {formulas.map((f) => {
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
                    value={f.costFactor}
                    onChange={(e) =>
                      update(f, {
                        costFactor: Number(e.target.value) || 1,
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
                      value={f.margins[k]}
                      onChange={(e) =>
                        update(f, {
                          margins: {
                            ...f.margins,
                            [k]: Number(e.target.value) || 0,
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
            </div>
          );
        })}
      </div>
      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="¿Eliminar fórmula?"
        description={`Se eliminará "${toDelete?.name ?? ""}".`}
        onConfirm={() => {
          if (toDelete) onDelete(toDelete.id);
          setToDelete(null);
        }}
      />
    </div>
  );
}
export { PriceFormulasEditor };

// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { usePosStore } from "../data/pos-store.jsx";
import { toast as ue } from "sonner";
import { PageHeader } from "../components/page-header.jsx";
import { Tabs2 } from "../../components/ui/tabs.jsx";
import { TabsList2 } from "../../components/ui/tabs.jsx";
import { TabsTrigger2 } from "../../components/ui/tabs.jsx";
import { Building } from "lucide-react";
import { Calculator } from "lucide-react";
import { FileBadge } from "lucide-react";
import { Printer } from "lucide-react";
import { TabsContent2 } from "../../components/ui/tabs.jsx";
import { SectionCard } from "../components/section-card.jsx";
import { Field } from "../components/form-field.jsx";
import { Input } from "../../components/ui/input.jsx";
import { inputClass } from "../components/form-field.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Save } from "lucide-react";
import { PriceFormulasEditor } from "../components/price-formulas-editor.jsx";
import { cn } from "../../lib/utils.js";
import { Select2 } from "../../components/ui/select.jsx";
import { SelectTrigger2 } from "../../components/ui/select.jsx";
import { SelectValue2 } from "../../components/ui/select.jsx";
import { SelectContent2 } from "../../components/ui/select.jsx";
import { SelectItem2 } from "../../components/ui/select.jsx";
import { PRICE_LEVELS } from "../data/pos-data.js";
import { Textarea } from "../../components/ui/textarea.jsx";
import { Switch2 } from "../../components/ui/switch.jsx";
import { useState } from "react";
var TAB_CLASS =
  "gap-2 rounded-lg px-3.5 data-[state=active]:bg-card data-[state=active]:shadow-sm";
function SettingsPage() {
  const {
    settings,
    updateSettings,
    formulas,
    suppliers,
    saveFormula,
    deleteFormula,
  } = usePosStore();
  const [business, setBusiness] = useState(settings.business);
  const [billing, setBilling] = useState({
    itbisRate: String(settings.itbisRate),
    rounding: String(settings.rounding),
    defaultPriceLevel: settings.defaultPriceLevel,
    allowNegativeStock: settings.allowNegativeStock,
    ticketFooter: settings.ticketFooter,
    printer: settings.printer,
  });
  const [ncf, setNcf] = useState(settings.ncf);
  const usage = suppliers.reduce((acc, s) => {
    acc[s.formulaId] = (acc[s.formulaId] ?? 0) + 1;
    return acc;
  }, {});
  const save = (patch, label) => {
    updateSettings(patch);
    ue.success(`${label} guardado`);
  };
  return (
    <div className="space-y-6">
      <PageHeader
        title="Configuración"
        description="Datos del negocio, fórmulas de precios, comprobantes fiscales y facturación."
      />
      <Tabs2 defaultValue="negocio" className="space-y-6">
        <TabsList2 className="h-auto flex-wrap justify-start gap-1 rounded-xl bg-muted p-1">
          <TabsTrigger2 value="negocio" className={TAB_CLASS}>
            <Building className="h-4 w-4" />
            {"Negocio"}
          </TabsTrigger2>
          <TabsTrigger2 value="precios" className={TAB_CLASS}>
            <Calculator className="h-4 w-4" />
            {"Fórmulas de precios"}
          </TabsTrigger2>
          <TabsTrigger2 value="ncf" className={TAB_CLASS}>
            <FileBadge className="h-4 w-4" />
            {"Comprobantes NCF"}
          </TabsTrigger2>
          <TabsTrigger2 value="facturacion" className={TAB_CLASS}>
            <Printer className="h-4 w-4" />
            {"Facturación"}
          </TabsTrigger2>
        </TabsList2>
        <TabsContent2 value="negocio" className="mt-0">
          <SectionCard
            title="Datos del negocio"
            description="Aparecen en el ticket y en los reportes."
            icon={Building}
          >
            <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
              <Field label="Nombre comercial">
                <Input
                  value={business.name}
                  onChange={(e) =>
                    setBusiness({
                      ...business,
                      name: e.target.value,
                    })
                  }
                  className={inputClass}
                />
              </Field>
              <Field label="RNC">
                <Input
                  value={business.rnc}
                  onChange={(e) =>
                    setBusiness({
                      ...business,
                      rnc: e.target.value,
                    })
                  }
                  className={inputClass}
                />
              </Field>
              <Field label="Teléfono">
                <Input
                  value={business.phone}
                  onChange={(e) =>
                    setBusiness({
                      ...business,
                      phone: e.target.value,
                    })
                  }
                  className={inputClass}
                />
              </Field>
              <Field label="Correo">
                <Input
                  value={business.email}
                  onChange={(e) =>
                    setBusiness({
                      ...business,
                      email: e.target.value,
                    })
                  }
                  className={inputClass}
                />
              </Field>
              <Field label="Dirección" className="sm:col-span-2">
                <Input
                  value={business.address}
                  onChange={(e) =>
                    setBusiness({
                      ...business,
                      address: e.target.value,
                    })
                  }
                  className={inputClass}
                />
              </Field>
            </div>
            <Button
              className="mt-6 rounded-xl"
              onClick={() =>
                save(
                  {
                    business,
                  },
                  "Datos del negocio",
                )
              }
            >
              <Save />
              {"Guardar cambios"}
            </Button>
          </SectionCard>
        </TabsContent2>
        <TabsContent2 value="precios" className="mt-0">
          <SectionCard
            title="Fórmulas de precios"
            description="Se guardan al escribir. Cada suplidor usa una para calcular P1, P2 y P3."
            icon={Calculator}
          >
            <PriceFormulasEditor
              formulas={formulas}
              rounding={settings.rounding}
              usage={usage}
              onSave={saveFormula}
              onDelete={deleteFormula}
            />
          </SectionCard>
        </TabsContent2>
        <TabsContent2 value="ncf" className="mt-0">
          <SectionCard
            title="Secuencias de comprobantes"
            description="Rangos autorizados por la DGII. El sistema asigna el siguiente NCF en cada factura."
            icon={FileBadge}
          >
            <div className="grid gap-4 md:grid-cols-2">
              {ncf.map((n, i) => {
                const used = Math.min(100, (n.next / n.end) * 100);
                const left = n.end - n.next + 1;
                const set = (patch) =>
                  setNcf((prev) =>
                    prev.map((x, j) =>
                      j === i
                        ? {
                            ...x,
                            ...patch,
                          }
                        : x,
                    ),
                  );
                return (
                  <div
                    className="rounded-2xl border border-border p-4"
                    key={n.type}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-mono text-lg font-semibold">
                          {n.type}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {n.label}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs font-medium",
                          left < 50
                            ? "bg-accent text-primary"
                            : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
                        )}
                      >
                        {"Quedan "}
                        {left.toLocaleString("en-US")}
                      </span>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          left < 50 ? "bg-primary" : "bg-foreground/70",
                        )}
                        style={{
                          width: `${used}%`,
                        }}
                      />
                    </div>
                    <div className="mt-4 grid grid-cols-3 gap-3">
                      <Field label="Próximo">
                        <Input
                          type="number"
                          value={n.next}
                          onChange={(e) =>
                            set({
                              next: Number(e.target.value) || 1,
                            })
                          }
                          className="h-9 rounded-lg"
                        />
                      </Field>
                      <Field label="Hasta">
                        <Input
                          type="number"
                          value={n.end}
                          onChange={(e) =>
                            set({
                              end: Number(e.target.value) || n.end,
                            })
                          }
                          className="h-9 rounded-lg"
                        />
                      </Field>
                      <Field label="Vence">
                        <Input
                          type="date"
                          value={n.expires}
                          onChange={(e) =>
                            set({
                              expires: e.target.value,
                            })
                          }
                          className="h-9 rounded-lg"
                        />
                      </Field>
                    </div>
                    <p className="mt-3 font-mono text-xs text-muted-foreground">
                      {"Siguiente: "}
                      {n.type}
                      {String(n.next).padStart(8, "0")}
                    </p>
                  </div>
                );
              })}
            </div>
            <Button
              className="mt-6 rounded-xl"
              onClick={() =>
                save(
                  {
                    ncf,
                  },
                  "Secuencias NCF",
                )
              }
            >
              <Save />
              {"Guardar secuencias"}
            </Button>
          </SectionCard>
        </TabsContent2>
        <TabsContent2 value="facturacion" className="mt-0">
          <SectionCard title="Facturación e impresión" icon={Printer}>
            <div className="grid max-w-3xl gap-4 sm:grid-cols-3">
              <Field label="ITBIS %">
                <Input
                  type="number"
                  value={billing.itbisRate}
                  onChange={(e) =>
                    setBilling({
                      ...billing,
                      itbisRate: e.target.value,
                    })
                  }
                  className={inputClass}
                />
              </Field>
              <Field label="Redondear precios a" hint="Al calcular con fórmula">
                <Select2
                  value={billing.rounding}
                  onValueChange={(v) =>
                    setBilling({
                      ...billing,
                      rounding: v,
                    })
                  }
                >
                  <SelectTrigger2 className={inputClass}>
                    <SelectValue2 />
                  </SelectTrigger2>
                  <SelectContent2>
                    <SelectItem2 value="0">{"Sin redondeo"}</SelectItem2>
                    <SelectItem2 value="1">{"RD$ 1"}</SelectItem2>
                    <SelectItem2 value="5">{"RD$ 5"}</SelectItem2>
                    <SelectItem2 value="10">{"RD$ 10"}</SelectItem2>
                    <SelectItem2 value="25">{"RD$ 25"}</SelectItem2>
                  </SelectContent2>
                </Select2>
              </Field>
              <Field label="Precio por defecto en ventas">
                <Select2
                  value={billing.defaultPriceLevel}
                  onValueChange={(v) =>
                    setBilling({
                      ...billing,
                      defaultPriceLevel: v,
                    })
                  }
                >
                  <SelectTrigger2 className={inputClass}>
                    <SelectValue2 />
                  </SelectTrigger2>
                  <SelectContent2>
                    {PRICE_LEVELS.map((l) => (
                      <SelectItem2 value={l.value} key={l.value}>
                        {l.label}
                      </SelectItem2>
                    ))}
                  </SelectContent2>
                </Select2>
              </Field>
              <Field label="Impresora" className="sm:col-span-3">
                <Select2
                  value={billing.printer}
                  onValueChange={(v) =>
                    setBilling({
                      ...billing,
                      printer: v,
                    })
                  }
                >
                  <SelectTrigger2 className={inputClass}>
                    <SelectValue2 />
                  </SelectTrigger2>
                  <SelectContent2>
                    <SelectItem2 value="Térmica 80 mm">
                      {"Térmica 80 mm"}
                    </SelectItem2>
                    <SelectItem2 value="Térmica 58 mm">
                      {"Térmica 58 mm"}
                    </SelectItem2>
                    <SelectItem2 value="Carta (8.5 x 11)">
                      {"Carta (8.5 x 11)"}
                    </SelectItem2>
                  </SelectContent2>
                </Select2>
              </Field>
              <Field
                label="Mensaje al pie del ticket"
                className="sm:col-span-3"
              >
                <Textarea
                  value={billing.ticketFooter}
                  onChange={(e) =>
                    setBilling({
                      ...billing,
                      ticketFooter: e.target.value,
                    })
                  }
                  className="min-h-[80px] rounded-xl"
                />
              </Field>
              <label className="flex items-center justify-between gap-4 rounded-xl border border-border p-4 sm:col-span-3">
                <div>
                  <p className="text-sm font-medium">
                    {"Permitir vender sin existencia"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {
                      "Si está apagado, el punto de venta bloquea artículos agotados."
                    }
                  </p>
                </div>
                <Switch2
                  checked={billing.allowNegativeStock}
                  onCheckedChange={(v) =>
                    setBilling({
                      ...billing,
                      allowNegativeStock: v,
                    })
                  }
                />
              </label>
            </div>
            <Button
              className="mt-6 rounded-xl"
              onClick={() =>
                save(
                  {
                    itbisRate: Math.max(0, Number(billing.itbisRate) || 0),
                    rounding: Number(billing.rounding) || 0,
                    defaultPriceLevel: billing.defaultPriceLevel,
                    allowNegativeStock: billing.allowNegativeStock,
                    ticketFooter: billing.ticketFooter,
                    printer: billing.printer,
                  },
                  "Configuración de facturación",
                )
              }
            >
              <Save />
              {"Guardar cambios"}
            </Button>
          </SectionCard>
        </TabsContent2>
      </Tabs2>
    </div>
  );
}
export { SettingsPage };

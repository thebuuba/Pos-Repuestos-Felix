// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { usePosStore } from "../../data/pos-context.jsx";
import { toast as ue } from "sonner";
import { PageHeader } from "../components/page-header.jsx";
import { Tabs2 } from "../../components/ui/tabs.jsx";
import { TabsList2 } from "../../components/ui/tabs.jsx";
import { TabsTrigger2 } from "../../components/ui/tabs.jsx";
import { Building } from "lucide-react";
import { Calculator } from "lucide-react";
import { FileBadge } from "lucide-react";
import { Printer } from "lucide-react";
import { UserRound } from "lucide-react";
import { AccountSettings } from "../components/account-settings.jsx";
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
import { PRICE_LEVELS } from "../../data/sales-options.js";
import { Textarea } from "../../components/ui/textarea.jsx";
import { Switch2 } from "../../components/ui/switch.jsx";
import { useRef, useState } from "react";
var TAB_CLASS =
  "gap-2 rounded-lg px-3.5 data-[state=active]:bg-card data-[state=active]:shadow-sm";
function SettingsPage() {
  const {
    settings, runtime,
    updateSettings,
    formulas,
    suppliers,
    saveFormula,
    deleteFormula,
  } = usePosStore();
  const [drafts, setDrafts] = useState({});
  const [request, setRequest] = useState(null);
  const [error, setError] = useState(null);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const business = drafts.negocio?.value ?? settings.business;
  const billing = drafts.facturacion?.value ?? {
    ...settings,
    itbisRate: String(settings.itbisRate),
    rounding: String(settings.rounding),
  };
  const edit = (section, value) => {
    if (sending.current || request) return;
    setError(null);
    setDrafts(prev => ({ ...prev, [section]: {
      databaseId: settings.databaseId, version: settings.version, ...prev[section], value,
    } }));
  };
  const setBusiness = value => edit("negocio", value);
  const setBilling = value => edit("facturacion", value);
  const discard = section => {
    setError(null);
    setDrafts(prev => { const next = { ...prev }; delete next[section]; return next; });
  };
  const [ncf, setNcf] = useState(settings.ncf);
  const usage = suppliers.reduce((acc, s) => {
    acc[s.formulaId] = (acc[s.formulaId] ?? 0) + 1;
    return acc;
  }, {});
  const save = async (patch, label) => {
    const section = patch.business ? "negocio" : patch.ncf ? "ncf" : "facturacion";
    if (sending.current || (request && request.section !== section)) return;
    const draft = drafts[section];
    if (runtime && !request && (!draft || draft.databaseId !== settings.databaseId || draft.version !== settings.version)) {
      setError("La configuración cambió. Carga los datos actuales antes de editar.");
      return;
    }
    if (runtime && section === "facturacion" && (!/^\d{1,3}(?:\.\d{1,4})?$/.test(patch.itbisRate) || Number(patch.itbisRate) > 100)) {
      setError("Indica un ITBIS entre 0 y 100 %, con hasta cuatro decimales.");
      return;
    }
    const dto = request?.dto ?? (runtime ? { ...patch, databaseId: draft.databaseId, version: draft.version } : patch);
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      await updateSettings(dto);
      discard(section);
      setRequest(null);
      ue.success(`${label} guardado`);
    } catch (cause) {
      setError(cause.message);
      setRequest(cause.uncertain ? { section, dto } : null);
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };
  const controls = section => {
    const draft = drafts[section];
    return runtime && draft && !request && (
      <Button type="button" variant="outline" disabled={busy} className="ml-2 mt-6 rounded-xl" onClick={() => discard(section)}>
        {draft.version !== settings.version || draft.databaseId !== settings.databaseId ? "Cargar datos actuales" : "Descartar cambios"}
      </Button>
    );
  };
  const saveDisabled = section => busy || (runtime && !drafts[section]) || (request && request.section !== section);
  const saveLabel = section => busy ? "Confirmando…" : request?.section === section ? "Reintentar" : "Guardar cambios";
  return (
    <div className="space-y-6">
      <PageHeader
        title="Configuración"
        description="Datos del negocio, fórmulas de precios, comprobantes fiscales y facturación."
      />
      {error && <p role="alert" className="text-sm text-primary">{error}</p>}
      <Tabs2 defaultValue="negocio" className="space-y-6">
        <TabsList2 className="mobile-touch-controls h-auto flex-wrap justify-start gap-1 rounded-xl bg-muted p-1">
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
          {runtime && <TabsTrigger2 value="cuenta" className={TAB_CLASS}>
            <UserRound className="h-4 w-4" />Mi cuenta
          </TabsTrigger2>}
        </TabsList2>
        {runtime && <TabsContent2 value="cuenta" className="mt-0"><AccountSettings /></TabsContent2>}
        <TabsContent2 value="negocio" className="mt-0">
          <SectionCard
            title="Datos del negocio"
            description="Aparecen en el ticket y en los reportes."
            icon={Building}
          >
            <fieldset disabled={busy || Boolean(request)} className="grid min-w-0 max-w-3xl gap-4 sm:grid-cols-2">
              <Field label="Nombre comercial" htmlFor="business-name">
                <Input id="business-name"
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
              <Field label="RNC" htmlFor="business-rnc">
                <Input id="business-rnc"
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
              <Field label="Teléfono" htmlFor="business-phone">
                <Input id="business-phone"
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
              <Field label="Correo" htmlFor="business-email">
                <Input id="business-email"
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
              <Field label="Dirección" htmlFor="business-address" className="sm:col-span-2">
                <Input id="business-address"
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
            </fieldset>
            <Button
              disabled={saveDisabled("negocio")}
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
              {saveLabel("negocio")}
            </Button>
            {controls("negocio")}
          </SectionCard>
        </TabsContent2>
        <TabsContent2 value="precios" className="mt-0">
          <SectionCard
            title="Fórmulas de precios"
            description={runtime ? "Guarda cada fórmula para aplicar sus porcentajes en las compras del suplidor." : "Se guardan al escribir. Cada suplidor usa una para calcular P1, P2 y P3."}
            icon={Calculator}
          >
            <PriceFormulasEditor
              runtime={runtime}
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
            description={runtime ? "La emisión de NCF requiere rangos autorizados y configurados." : "Rangos autorizados por la DGII. El sistema asigna el siguiente NCF en cada factura."}
            icon={FileBadge}
          >
            {runtime ? <p className="text-sm text-muted-foreground">Emisión fiscal pendiente de habilitación.</p> : <>
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
            </>}
          </SectionCard>
        </TabsContent2>
        <TabsContent2 value="facturacion" className="mt-0">
          <SectionCard title="Facturación e impresión" icon={Printer}>
            <fieldset disabled={busy || Boolean(request)} className="grid min-w-0 max-w-3xl gap-4 sm:grid-cols-3">
              <Field label="ITBIS %" htmlFor="billing-tax">
                <Input id="billing-tax"
                  type="number"
                  min="0"
                  max="100"
                  step="0.0001"
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
              <Field label="Redondear precios a" htmlFor="billing-rounding" hint="Al calcular con fórmula">
                <Select2
                  value={billing.rounding}
                  onValueChange={(v) =>
                    setBilling({
                      ...billing,
                      rounding: v,
                    })
                  }
                >
                  <SelectTrigger2 id="billing-rounding" className={inputClass}>
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
              <Field label="Precio por defecto en ventas" htmlFor="billing-level">
                <Select2
                  value={billing.defaultPriceLevel ?? ""}
                  onValueChange={(v) =>
                    setBilling({
                      ...billing,
                      defaultPriceLevel: v,
                    })
                  }
                >
                  <SelectTrigger2 id="billing-level" className={inputClass}>
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
              <Field label="Impresora" htmlFor="billing-printer" className="sm:col-span-3">
                <Select2
                  value={billing.printer ?? ""}
                  onValueChange={(v) =>
                    setBilling({
                      ...billing,
                      printer: v,
                    })
                  }
                >
                  <SelectTrigger2 id="billing-printer" className={inputClass}>
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
                label="Mensaje al pie del ticket" htmlFor="billing-footer"
                className="sm:col-span-3"
              >
                <Textarea id="billing-footer"
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
                      runtime ? "El servicio exige existencias suficientes para confirmar la venta." : "Si está apagado, el punto de venta bloquea artículos agotados."
                    }
                  </p>
                </div>
                <Switch2
                  disabled={Boolean(runtime)}
                  checked={billing.allowNegativeStock}
                  onCheckedChange={(v) =>
                    setBilling({
                      ...billing,
                      allowNegativeStock: v,
                    })
                  }
                />
              </label>
            </fieldset>
            <Button
              disabled={saveDisabled("facturacion")}
              className="mt-6 rounded-xl"
              onClick={() =>
                save(
                  {
                    itbisRate: runtime ? billing.itbisRate : Number(billing.itbisRate),
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
              {saveLabel("facturacion")}
            </Button>
            {controls("facturacion")}
          </SectionCard>
        </TabsContent2>
      </Tabs2>
    </div>
  );
}
export { SettingsPage };

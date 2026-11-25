// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { usePosStore } from "../data/pos-context.jsx";
import { toast as ue } from "sonner";
import { PageHeader } from "../components/pos/page-header.jsx";
import { Tabs } from "../components/ui/tabs.jsx";
import { TabsList } from "../components/ui/tabs.jsx";
import { TabsTrigger } from "../components/ui/tabs.jsx";
import { Building } from "lucide-react";
import { Calculator } from "lucide-react";
import { FileBadge } from "lucide-react";
import { Printer } from "lucide-react";
import { UserRound } from "lucide-react";
import { Users } from "lucide-react";
import { AccountSettings } from "../components/pos/account-settings.jsx";
import { UsersSettings } from "../components/pos/users-settings.jsx";
import { TabsContent } from "../components/ui/tabs.jsx";
import { SectionCard } from "../components/pos/section-card.jsx";
import { Field } from "../components/pos/form-field.jsx";
import { Input } from "../components/ui/input.jsx";
import { inputClass } from "../components/pos/form-field.jsx";
import { Button } from "../components/ui/button.jsx";
import { Save } from "lucide-react";
import { PriceFormulasEditor } from "../components/pos/price-formulas-editor.jsx";
import { cn } from "../lib/utils.js";
import { Select } from "../components/ui/select.jsx";
import { SelectTrigger } from "../components/ui/select.jsx";
import { SelectValue } from "../components/ui/select.jsx";
import { SelectContent } from "../components/ui/select.jsx";
import { SelectItem } from "../components/ui/select.jsx";
import { PRICE_LEVELS } from "../data/sales-options.js";
import { Textarea } from "../components/ui/textarea.jsx";
import { Switch } from "../components/ui/switch.jsx";
import { useRef, useState } from "react";
var TAB_CLASS =
  "settings-tab gap-2 rounded-full px-4";
var OPERATIONAL_NCF_TYPES = [
  { type: "B01", label: "Crédito Fiscal" },
  { type: "B02", label: "Consumo" },
  { type: "B14", label: "Regímenes Especiales" },
];
function SettingsPage() {
  const {
    settings, runtime,
    updateSettings,
    saveNcfSequence,
    formulas,
    suppliers,
    saveFormula,
    deleteFormula,
  } = usePosStore();
  const isOwner = !runtime || runtime.isOwner;
  const [drafts, setDrafts] = useState({});
  const [ncfDrafts, setNcfDrafts] = useState({});
  const [ncfRetry, setNcfRetry] = useState({});
  const [ncfBusy, setNcfBusy] = useState(null);
  const [request, setRequest] = useState(null);
  const [error, setError] = useState(null);
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const business = drafts.negocio?.value ?? settings.business;
  const billing = drafts.facturacion?.value ?? {
    ...settings,
    itbisRate: String(settings.itbisRate),
    rounding: String(settings.rounding),
    dailyGoal: settings.dailyGoal != null ? String(settings.dailyGoal) : "",
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
    if (runtime && section === "facturacion" && patch.dailyGoal !== null && !/^\d{1,12}(?:\.\d{1,2})?$/.test(String(patch.dailyGoal))) {
      setError("Indica una meta diaria válida (hasta dos decimales), o déjala vacía.");
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
      <Tabs defaultValue={isOwner ? "negocio" : "cuenta"} key={isOwner ? "owner" : "cashier"} className="space-y-6">
        <TabsList className="settings-tabs mobile-touch-controls h-auto flex-wrap justify-start gap-1 rounded-full p-1">
          {isOwner && (
            <>
              <TabsTrigger value="negocio" className={TAB_CLASS}>
                <Building className="h-4 w-4" />
                {"Negocio"}
              </TabsTrigger>
              <TabsTrigger value="precios" className={TAB_CLASS}>
                <Calculator className="h-4 w-4" />
                {"Fórmulas de precios"}
              </TabsTrigger>
              <TabsTrigger value="ncf" className={TAB_CLASS}>
                <FileBadge className="h-4 w-4" />
                {"Comprobantes NCF"}
              </TabsTrigger>
              <TabsTrigger value="facturacion" className={TAB_CLASS}>
                <Printer className="h-4 w-4" />
                {"Facturación"}
              </TabsTrigger>
              {runtime && (
                <TabsTrigger value="usuarios" className={TAB_CLASS}>
                  <Users className="h-4 w-4" />
                  {"Usuarios"}
                </TabsTrigger>
              )}
            </>
          )}
          {runtime && <TabsTrigger value="cuenta" className={TAB_CLASS}>
            <UserRound className="h-4 w-4" />Mi cuenta
          </TabsTrigger>}
        </TabsList>
        {runtime && isOwner && <TabsContent value="usuarios" className="mt-0"><UsersSettings /></TabsContent>}
        {runtime && <TabsContent value="cuenta" className="mt-0"><AccountSettings /></TabsContent>}
        <TabsContent value="negocio" className="mt-0">
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
        </TabsContent>
        <TabsContent value="precios" className="mt-0">
          <SectionCard
            title="Fórmulas de precios"
            description={runtime ? "Guarda la fórmula en cascada de cada suplidor para calcular Costo y sugerir P/Mayor y Detalle en Compras." : "Se guardan al escribir. Cada suplidor usa su fórmula en cascada para Costo, P/Mayor y Detalle."}
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
        </TabsContent>
        <TabsContent value="ncf" className="mt-0">
          <SectionCard
            title="Secuencias de comprobantes"
            description={
              runtime
                ? "Configura tus rangos autorizados por la DGII. Solo se asigna NCF en ventas en línea cuando la secuencia está activa y vigente."
                : "Rangos autorizados por la DGII. El sistema asigna el siguiente NCF en cada factura."
            }
            icon={FileBadge}
          >
            {runtime ? (
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  {"Por seguridad fiscal, las secuencias inician vacías e inactivas y nunca se emiten sin conexión."}
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  {OPERATIONAL_NCF_TYPES.map(({ type, label }) => {
                    const saved = (settings.ncf ?? []).find((x) => x.type === type);
                    const draft = ncfDrafts[type] ?? {
                      start: saved ? String(saved.start) : "",
                      end: saved ? String(saved.end) : "",
                      current: saved ? String(saved.current + 1) : "",
                      expiresAt: saved?.expiresAt ?? "",
                      active: Boolean(saved?.active),
                      version: saved?.version ?? null,
                      databaseId: runtime.databaseId,
                    };
                    const setField = (patch) => {
                      setError(null);
                      setNcfDrafts((prev) => ({
                        ...prev,
                        [type]: { ...draft, ...patch },
                      }));
                    };
                    const startNum = Number(draft.start);
                    const endNum = Number(draft.end);
                    const currentNum = Number(draft.current);
                    const validRange =
                      Number.isInteger(startNum) &&
                      startNum >= 1 &&
                      startNum <= 99999999 &&
                      Number.isInteger(endNum) &&
                      endNum >= startNum &&
                      endNum <= 99999999 &&
                      Number.isInteger(currentNum) &&
                      currentNum >= startNum &&
                      currentNum <= endNum + 1 &&
                      /^\d{4}-\d{2}-\d{2}$/.test(draft.expiresAt);
                    const left = validRange ? Math.max(0, endNum - currentNum + 1) : 0;
                    const used =
                      validRange && endNum >= startNum
                        ? Math.min(100, Math.max(0, ((currentNum - startNum) / (endNum - startNum + 1)) * 100))
                        : 0;
                    const dirty = Boolean(ncfDrafts[type]);
                    const stale = dirty && ((draft.version ?? null) !== (saved?.version ?? null) || draft.databaseId !== runtime.databaseId);
                    const pendingRetry = ncfRetry[type] ?? null;
                    const cardLocked = ncfBusy === type || Boolean(pendingRetry);
                    return (
                      <div className="rounded-2xl border border-border p-4" key={type}>
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="font-mono text-lg font-semibold">{type}</p>
                            <p className="text-xs text-muted-foreground">{label}</p>
                          </div>
                          <label className="flex items-center gap-2 text-xs font-medium">
                            <Switch
                              aria-label={`Activar secuencia ${type}`}
                              checked={Boolean(draft.active)}
                              disabled={cardLocked}
                              onCheckedChange={(checked) => setField({ active: checked })}
                            />
                            <span>{draft.active ? "Activa" : "Inactiva"}</span>
                          </label>
                        </div>
                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              left < 50 ? "bg-primary" : "bg-foreground/70",
                            )}
                            style={{ width: `${used}%` }}
                          />
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                          <Field label="Desde" htmlFor={`ncf-${type}-start`}>
                            <Input
                              id={`ncf-${type}-start`}
                              type="number"
                              min="1"
                              max="99999999"
                              value={draft.start}
                              disabled={cardLocked}
                              onChange={(e) => setField({ start: e.target.value, ...(draft.current === "" || draft.current === draft.start ? { current: e.target.value } : {}) })}
                              placeholder="1"
                              className="h-9 rounded-lg"
                            />
                          </Field>
                          <Field label="Próximo" htmlFor={`ncf-${type}-current`}>
                            <Input
                              id={`ncf-${type}-current`}
                              type="number"
                              min="1"
                              max="99999999"
                              value={draft.current}
                              disabled={cardLocked}
                              onChange={(e) => setField({ current: e.target.value })}
                              placeholder="1"
                              className="h-9 rounded-lg"
                            />
                          </Field>
                          <Field label="Hasta" htmlFor={`ncf-${type}-end`}>
                            <Input
                              id={`ncf-${type}-end`}
                              type="number"
                              min="1"
                              max="99999999"
                              value={draft.end}
                              disabled={cardLocked}
                              onChange={(e) => setField({ end: e.target.value })}
                              placeholder="1000"
                              className="h-9 rounded-lg"
                            />
                          </Field>
                          <Field label="Vence" htmlFor={`ncf-${type}-expires`}>
                            <Input
                              id={`ncf-${type}-expires`}
                              type="date"
                              value={draft.expiresAt}
                              disabled={cardLocked}
                              onChange={(e) => setField({ expiresAt: e.target.value })}
                              className="h-9 rounded-lg"
                            />
                          </Field>
                        </div>
                        {stale && !pendingRetry && (
                          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
                            <span>{`La secuencia ${type} cambió (próximo actual: ${saved ? saved.current + 1 : "—"}). Recarga antes de guardar.`}</span>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 rounded-md px-2 text-xs"
                              onClick={() => setNcfDrafts((prev) => { const next = { ...prev }; delete next[type]; return next; })}
                            >
                              {"Cargar datos actuales"}
                            </Button>
                          </div>
                        )}
                        {dirty && !validRange && !stale && (
                          <p role="alert" className="mt-2 text-xs text-destructive">
                            {"Verifica que Desde ≤ Próximo ≤ Hasta + 1 y que la fecha de vencimiento sea válida."}
                          </p>
                        )}
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <p className="font-mono text-xs text-muted-foreground">
                            {validRange && draft.active && left > 0
                              ? `Siguiente: ${type}${String(currentNum).padStart(8, "0")} · Quedan ${left.toLocaleString("es-DO")}`
                              : saved
                                ? "Inactiva o agotada · Sin emisión de NCF"
                                : "Sin configurar · Sin emisión de NCF"}
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            className="rounded-lg"
                            disabled={(!pendingRetry && (!dirty || !validRange || stale)) || ncfBusy === type}
                            onClick={async () => {
                              if ((!pendingRetry && (!validRange || stale)) || ncfBusy) return;
                              setNcfBusy(type);
                              setError(null);
                              try {
                                if (pendingRetry) {
                                  await pendingRetry();
                                } else {
                                  await saveNcfSequence({
                                    databaseId: draft.databaseId,
                                    type,
                                    start: startNum,
                                    end: endNum,
                                    current: currentNum - 1,
                                    expiresAt: draft.expiresAt,
                                    active: Boolean(draft.active),
                                    version: draft.version ?? undefined,
                                  });
                                }
                                setNcfDrafts((prev) => {
                                  const next = { ...prev };
                                  delete next[type];
                                  return next;
                                });
                                setNcfRetry((prev) => {
                                  const next = { ...prev };
                                  delete next[type];
                                  return next;
                                });
                                ue.success(`Secuencia ${type} guardada`);
                              } catch (cause) {
                                setError(cause?.message || `No se pudo guardar la secuencia ${type}.`);
                                if (cause?.uncertain && typeof cause.retry === "function") {
                                  setNcfRetry((prev) => ({ ...prev, [type]: cause.retry }));
                                } else if (cause?.definitive) {
                                  setNcfRetry((prev) => { const next = { ...prev }; delete next[type]; return next; });
                                }
                              } finally {
                                setNcfBusy(null);
                              }
                            }}
                          >
                            <Save />
                            {ncfBusy === type ? "Guardando…" : pendingRetry ? "Reintentar" : "Guardar"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : <>
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
        </TabsContent>
        <TabsContent value="facturacion" className="mt-0">
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
                <Select
                  value={billing.rounding}
                  onValueChange={(v) =>
                    setBilling({
                      ...billing,
                      rounding: v,
                    })
                  }
                >
                  <SelectTrigger id="billing-rounding" className={inputClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">{"Sin redondeo"}</SelectItem>
                    <SelectItem value="1">{"RD$ 1"}</SelectItem>
                    <SelectItem value="5">{"RD$ 5"}</SelectItem>
                    <SelectItem value="10">{"RD$ 10"}</SelectItem>
                    <SelectItem value="25">{"RD$ 25"}</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Precio por defecto en ventas" htmlFor="billing-level">
                <Select
                  value={billing.defaultPriceLevel === "p3" ? "p1" : (billing.defaultPriceLevel ?? "")}
                  onValueChange={(v) =>
                    setBilling({
                      ...billing,
                      defaultPriceLevel: v,
                    })
                  }
                >
                  <SelectTrigger id="billing-level" className={inputClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRICE_LEVELS.map((l) => (
                      <SelectItem value={l.value} key={l.value}>
                        {l.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Impresora" htmlFor="billing-printer" className="sm:col-span-2">
                <Select
                  value={billing.printer ?? ""}
                  onValueChange={(v) =>
                    setBilling({
                      ...billing,
                      printer: v,
                    })
                  }
                >
                  <SelectTrigger id="billing-printer" className={inputClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Térmica 80 mm">
                      {"Térmica 80 mm"}
                    </SelectItem>
                    <SelectItem value="Térmica 58 mm">
                      {"Térmica 58 mm"}
                    </SelectItem>
                    <SelectItem value="Carta (8.5 x 11)">
                      {"Carta (8.5 x 11)"}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Meta diaria de ventas (RD$)" htmlFor="billing-daily-goal" hint="Se muestra en el indicador del Panel">
                <Input
                  id="billing-daily-goal"
                  type="number"
                  min="0"
                  step="1"
                  placeholder="Sin meta"
                  value={billing.dailyGoal ?? ""}
                  onChange={(e) =>
                    setBilling({
                      ...billing,
                      dailyGoal: e.target.value,
                    })
                  }
                  className={inputClass}
                />
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
                <Switch
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
                    dailyGoal: billing.dailyGoal === "" || billing.dailyGoal == null ? null : Number(billing.dailyGoal),
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
export { SettingsPage };

// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { usePosStore } from "../data/pos-context.jsx";
import { formulaSummary } from "../lib/pricing.js";
import { PageHeader } from "../components/pos/page-header.jsx";
import { Button } from "../components/ui/button.jsx";
import { LayoutGrid, List, Plus, Search } from "lucide-react";
import { EmptyState, MiniStat } from "../components/pos/section-card.jsx";
import { Input } from "../components/ui/input.jsx";
import { cn } from "../lib/utils.js";
import { Truck } from "lucide-react";
import { Receipt } from "lucide-react";
import { formatMoney } from "../lib/format.js";
import { PackagePlus } from "lucide-react";
import { Pencil } from "lucide-react";
import { toast as ue } from "sonner";
import { Trash2 } from "lucide-react";
import { User } from "lucide-react";
import { Phone } from "lucide-react";
import { Mail } from "lucide-react";
import { Calculator } from "lucide-react";
import { formatDate } from "../lib/accounts.js";
import { Link, useSearchParams } from "react-router-dom";
import { SupplierFormSheet } from "../components/pos/supplier-form-sheet.jsx";
import { ConfirmDialog } from "../components/pos/confirm-dialog.jsx";
import { useEffect, useMemo, useState } from "react";
import { businessMonthIso } from "../lib/dates.js";
const VIEW_STORAGE_KEY = "felix-suppliers-view";
function SuppliersPage() {
  const { runtime, suppliers, formulas, purchases, settings, saveSupplier, saveFormula, deleteSupplier } =
    usePosStore();
  const [params] = useSearchParams();
  const urlQuery = params.get("buscar") ?? "";
  const [query, setQuery] = useState(urlQuery);
  const [view, setView] = useState(() => {
    if (!runtime) return "cards";
    try {
      return localStorage.getItem(VIEW_STORAGE_KEY) === "list" ? "list" : "cards";
    } catch {
      return "cards";
    }
  });
  const changeView = (next) => {
    setView(next);
    if (runtime) {
      try {
        localStorage.setItem(VIEW_STORAGE_KEY, next);
      } catch {
        /* Keep the current view in memory. */
      }
    }
  };
  useEffect(() => {
    if (urlQuery) setQuery(urlQuery);
  }, [urlQuery]);
  const [formOpen, setFormOpen] = useState(false);
  const [startWithFormula, setStartWithFormula] = useState(false);
  const [creationDatabaseId, setCreationDatabaseId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const formulaUsage = useMemo(
    () => suppliers.reduce((acc, s) => {
      if (s.formulaId != null) acc[s.formulaId] = (acc[s.formulaId] ?? 0) + 1;
      return acc;
    }, {}),
    [suppliers],
  );
  const totalOwed = useMemo(() => suppliers.reduce((s, x) => s + x.balance, 0), [suppliers]);
  const monthTotal = useMemo(() => {
    const month = businessMonthIso();
    return purchases
      .filter((p) => p.status !== "anulada" && p.date.slice(0, 7) === month)
      .reduce((s, p) => s + p.total, 0);
  }, [purchases]);
  const formulasById = useMemo(() => new Map(formulas.map((f) => [f.id, f])), [formulas]);
  const purchasesBySupplier = useMemo(() => {
    const map = new Map();
    for (let i = 0; i < purchases.length; i++) {
      const p = purchases[i];
      if (p.status === "anulada") continue;
      const entry = map.get(p.supplierId);
      if (entry) entry.count++;
      else map.set(p.supplierId, { count: 1, last: p });
    }
    return map;
  }, [purchases]);
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => suppliers.filter((s) =>
    !q || [s.name, s.rnc, s.contact, s.phone, s.email].some((v) => v?.toLowerCase().includes(q)),
  ), [suppliers, q]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Suplidores"
        description="Cada suplidor tiene su propia fórmula de precios y condiciones de crédito."
        actions={
          <Button
            data-shortcut-new="true"
            className="h-10 rounded-full px-5 shadow-md shadow-primary/20"
            onClick={() => {
              setEditing(null);
              setStartWithFormula(false);
              setCreationDatabaseId(runtime?.databaseId);
              setFormOpen(true);
            }}
          >
            <Plus />
            {"Nuevo suplidor"}
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <MiniStat
          icon={Truck}
          tone="primary"
          label="Suplidores"
          value={suppliers.length}
        />
        <MiniStat
          icon={Receipt}
          tone="warning"
          label="Les debemos"
          value={formatMoney(totalOwed)}
        />
        <MiniStat
          icon={PackagePlus}
          label="Compras este mes"
          value={formatMoney(monthTotal)}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            data-shortcut-search="true"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por nombre, RNC, contacto o teléfono…"
            aria-label="Buscar suplidor"
            className="h-10 rounded-xl bg-card pl-9"
          />
        </div>
        <div
          role="group"
          aria-label="Vista de suplidores"
          className="inline-flex h-10 shrink-0 items-center gap-1 rounded-xl border border-border bg-card p-1"
        >
          <button
            type="button"
            onClick={() => changeView("cards")}
            aria-pressed={view === "cards"}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors",
              view === "cards"
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            {"Tarjetas"}
          </button>
          <button
            type="button"
            onClick={() => changeView("list")}
            aria-pressed={view === "list"}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors",
              view === "list"
                ? "bg-foreground text-background shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <List className="h-3.5 w-3.5" />
            {"Lista"}
          </button>
        </div>
      </div>
      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card">
          <EmptyState
            icon={Truck}
            title="Sin suplidores"
            description={
              q
                ? "No hay suplidores que coincidan con la búsqueda."
                : "Aún no hay suplidores registrados."
            }
          />
        </div>
      ) : view === "list" ? (
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">{"Suplidor"}</th>
                <th className="px-3 py-2.5 font-medium">{"Contacto"}</th>
                <th className="px-3 py-2.5 font-medium">{"Cálculo"}</th>
                <th className="px-3 py-2.5 font-medium">{"Crédito"}</th>
                <th className="px-3 py-2.5 text-right font-medium">{"Le debemos"}</th>
                <th className="px-5 py-2.5 text-right font-medium">{"Acciones"}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const formula = formulasById.get(s.formulaId);
                const own = purchasesBySupplier.get(s.id);
                const last = own?.last;
                const ownCount = own?.count ?? 0;
                return (
                  <tr
                    key={s.id}
                    className="border-b border-border last:border-0 hover:bg-muted/30"
                  >
                    <td className="px-5 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
                          <Truck className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-foreground">{s.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            <span className="font-mono">{"RNC "}{s.rnc || "—"}</span>
                            {" · "}
                            {last
                              ? `Última compra ${formatDate(last.date)} (${ownCount})`
                              : "Sin compras"}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      <p className="font-medium text-foreground">{s.contact || "—"}</p>
                      <p>{s.phone || "—"}</p>
                      {s.email && <p className="truncate">{s.email}</p>}
                    </td>
                    <td className="px-3 py-3">
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(s);
                          setStartWithFormula(true);
                          setCreationDatabaseId(runtime?.databaseId);
                          setFormOpen(true);
                        }}
                        aria-label={`Editar cálculo de ${s.name}`}
                        className="inline-flex max-w-xs items-center gap-2 rounded-xl bg-muted px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                      >
                        <Calculator className="h-3.5 w-3.5 shrink-0 text-primary" />
                        <span className="min-w-0 truncate">
                          <span className="font-medium text-foreground">
                            {formula ? formulaSummary(formula) : "Sin fórmula"}
                          </span>
                        </span>
                        <span className="shrink-0 font-medium text-primary">
                          {formula ? "Editar" : "Configurar"}
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-xs font-medium">
                      {s.creditDays === null ? "Sin registrar" : `${s.creditDays} días`}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-3 text-right font-semibold tabular-nums whitespace-nowrap",
                        s.balance > 0 && "text-primary",
                      )}
                    >
                      {s.balance === null ? "Pendiente" : formatMoney(s.balance)}
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      <div className="mobile-touch-controls inline-flex items-center justify-end gap-1">
                        <Button
                          asChild={true}
                          variant="outline"
                          className="h-8 rounded-lg bg-card px-2.5 text-xs"
                        >
                          <Link
                            to={`/compras?suplidor=${encodeURIComponent(s.id)}`}
                            aria-label={`Registrar compra con ${s.name}`}
                          >
                            <PackagePlus className="h-3.5 w-3.5" />
                            {"Comprar"}
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground"
                          onClick={() => {
                            setEditing(s);
                            setStartWithFormula(false);
                            setFormOpen(true);
                          }}
                          aria-label="Editar"
                        >
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:bg-accent hover:text-primary"
                          onClick={() =>
                            s.balance > 0
                              ? ue.error("No se puede eliminar", {
                                  description: "Tiene facturas pendientes de pago.",
                                })
                              : setToDelete(s)
                          }
                          aria-label="Eliminar"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      ) : (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((s) => {
          const formula = formulasById.get(s.formulaId);
          const own = purchasesBySupplier.get(s.id);
          const last = own?.last;
          const ownCount = own?.count ?? 0;
          return (
            <div
              className="flex min-w-0 flex-col rounded-2xl border border-border bg-card p-5 transition-shadow hover:shadow-md"
              key={s.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
                    <Truck className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{s.name}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {"RNC "}
                      {s.rnc || "—"}
                    </p>
                  </div>
                </div>
                <div className="mobile-touch-controls flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                    onClick={() => {
                      setEditing(s);
                      setStartWithFormula(false);
                      setFormOpen(true);
                    }}
                    aria-label="Editar"
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:bg-accent hover:text-primary"
                    onClick={() =>
                      s.balance > 0
                        ? ue.error("No se puede eliminar", {
                            description: "Tiene facturas pendientes de pago.",
                          })
                        : setToDelete(s)
                    }
                    aria-label="Eliminar"
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
              <div className="mt-4 min-w-0 space-y-1.5 text-sm text-muted-foreground" style={{overflowWrap:'anywhere'}}>
                <p className="flex items-center gap-2">
                  <User className="h-3.5 w-3.5" />
                  {s.contact || "—"}
                </p>
                <p className="flex items-center gap-2">
                  <Phone className="h-3.5 w-3.5" />
                  {s.phone || "—"}
                </p>
                {s.email && (
                  <p className="flex items-center gap-2">
                    <Mail className="h-3.5 w-3.5" />
                    {s.email}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setEditing(s);
                  setStartWithFormula(true);
                  setCreationDatabaseId(runtime?.databaseId);
                  setFormOpen(true);
                }}
                aria-label={`Editar cálculo de ${s.name}`}
                className="mt-4 flex w-full items-center justify-between gap-2 rounded-xl bg-muted px-3 py-2 text-left text-xs transition-colors hover:bg-accent"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Calculator className="h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="truncate">
                    <span className="font-medium text-foreground">
                      {formula?.name ?? "Sin fórmula"}
                    </span>
                    {formula && (
                      <span className="text-muted-foreground">
                        {" · "}
                        {formulaSummary(formula)}
                      </span>
                    )}
                  </span>
                </span>
                <span className="shrink-0 font-medium text-primary">
                  {formula ? "Editar" : "Configurar"}
                </span>
              </button>
              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-4 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {"Le debemos"}
                  </p>
                  <p
                    className={
                      s.balance > 0
                        ? "font-semibold text-primary tabular-nums"
                        : "font-semibold tabular-nums"
                    }
                  >
                    {s.balance === null ? "Pendiente" : formatMoney(s.balance)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{"Crédito"}</p>
                  <p className="font-semibold">
                    {s.creditDays === null ? "Sin registrar" : s.creditDays + " días"}
                  </p>
                </div>
                <div className="col-span-2 text-xs text-muted-foreground">
                  {last
                    ? `Última compra ${formatDate(last.date)} · ${ownCount} compras registradas`
                    : "Sin compras registradas"}
                </div>
              </div>
              <Button
                asChild={true}
                variant="outline"
                className="mt-4 rounded-xl bg-card"
              >
                <Link to={`/compras?suplidor=${encodeURIComponent(s.id)}`}>
                  <PackagePlus />
                  {"Registrar compra"}
                </Link>
              </Button>
            </div>
          );
        })}
      </div>
      )}
      <SupplierFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        creationDatabaseId={creationDatabaseId}
        startWithFormula={startWithFormula}
        formulas={formulas}
        formulaUsage={formulaUsage}
        rounding={settings.rounding}
        runtime={runtime}
        onSaveFormula={saveFormula}
        onSaveSupplier={async (dto, formulaUpdated) => {
          await saveSupplier(dto);
          ue.success(editing ? "Suplidor actualizado" : "Suplidor creado", {
            description: formulaUpdated ? `${dto.name} · cálculo guardado` : dto.name,
          });
          setFormOpen(false);
        }}
      />
      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="¿Eliminar suplidor?"
        description={`Se eliminará ${toDelete?.name ?? ""}. Las compras anteriores se conservan.`}
        onConfirm={async () => {
          if (toDelete) await deleteSupplier(runtime ? toDelete : toDelete.id);
          setToDelete(null);
          ue("Suplidor eliminado");
        }}
      />
    </div>
  );
}
export { SuppliersPage };

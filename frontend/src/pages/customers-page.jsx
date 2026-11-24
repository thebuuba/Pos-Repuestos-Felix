// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { usePosStore } from "../data/pos-context.jsx";
import { balanceOf } from "../lib/accounts.js";
import { PageHeader } from "../components/pos/page-header.jsx";
import { Button } from "../components/ui/button.jsx";
import { Plus } from "lucide-react";
import { MiniStat } from "../components/pos/section-card.jsx";
import { Users } from "lucide-react";
import { Wallet } from "lucide-react";
import { HandCoins } from "lucide-react";
import { formatMoney } from "../lib/format.js";
import { Search } from "lucide-react";
import { Input } from "../components/ui/input.jsx";
import { EmptyState } from "../components/pos/section-card.jsx";
import { cn } from "../lib/utils.js";
import { Pencil } from "lucide-react";
import { toast as ue } from "sonner";
import { Trash2 } from "lucide-react";
import { PartyFormSheet } from "../components/pos/party-form-sheet.jsx";
import { newId } from "../data/new-id.js";
import { Sheet } from "../components/ui/sheet.jsx";
import { SheetContent } from "../components/ui/sheet.jsx";
import { SheetHeader } from "../components/ui/sheet.jsx";
import { SheetTitle } from "../components/ui/sheet.jsx";
import { SheetDescription } from "../components/ui/sheet.jsx";
import { Phone } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { formatDate } from "../lib/accounts.js";
import { ConfirmDialog } from "../components/pos/confirm-dialog.jsx";
import { Fragment, useEffect, useMemo, useState } from "react";
var FIELDS = [
  {
    key: "name",
    label: "Nombre o razón social",
    placeholder: "Ej. Taller Motos El Primo",
    required: true,
  },
  {
    key: "rnc",
    label: "RNC / Cédula",
    placeholder: "000-0000000-0",
    span: 1,
    hint: "Necesario para B01",
  },
  {
    key: "phone",
    label: "Teléfono",
    placeholder: "809-000-0000",
    span: 1,
  },
  {
    key: "email",
    label: "Correo",
    placeholder: "cliente@correo.com",
  },
  {
    key: "address",
    label: "Dirección",
    placeholder: "Calle, sector, ciudad",
  },
  {
    key: "creditLimit",
    label: "Límite de crédito RD$",
    type: "number",
    placeholder: "0",
    hint: "0 = solo contado",
  },
];
function initials(name) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}
function CustomersPage() {
  const { runtime, customers, sales, receivables, saveCustomer, deleteCustomer } =
    usePosStore();
  const [params] = useSearchParams();
  const urlQuery = params.get("buscar") ?? "";
  const [query, setQuery] = useState(urlQuery);
  const [page, setPage] = useState(0);
  useEffect(() => {
    if (urlQuery) { setQuery(urlQuery); setPage(0); }
  }, [urlQuery]);
  const [formOpen, setFormOpen] = useState(false);
  const [creationDatabaseId, setCreationDatabaseId] = useState(null);
  const [editing, setEditing] = useState(null);
  const [detail, setDetail] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const stats = useMemo(() => {
    const map = {};
    for (const s of sales) {
      if (s.status === "anulada") continue;
      const m = (map[s.customerId] ??= {
        total: 0,
        count: 0,
      });
      m.total += s.total;
      m.count += 1;
      if (!m.last || s.date > m.last) m.last = s.date;
    }
    return map;
  }, [sales]);
  const list = customers
    .filter((c) => runtime ? !c.isCashCustomer : c.id !== "c-000")
    .filter((c) => {
      const q = query.trim().toLowerCase();
      return (
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.rnc?.includes(q) ||
        c.phone?.includes(q)
      );
    });
  const withCredit = customers.filter((c) => c.creditLimit > 0);
  const totalOwed = customers.reduce((s, c) => s + c.balance, 0);
  const detailCustomer = detail
    ? (customers.find((c) => c.id === detail.id) ?? detail)
    : null;
  const detailDocs = detailCustomer
    ? receivables.filter(
        (r) => r.partyId === detailCustomer.id && balanceOf(r) > 0,
      )
    : [];
  const detailSales = detailCustomer
    ? sales.filter((s) => s.customerId === detailCustomer.id).slice(0, 6)
    : [];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Clientes"
        description="Datos fiscales, límites de crédito y balance de cada cliente."
        actions={
          <Button
            className="h-10 rounded-full px-5 shadow-md shadow-primary/20"
            onClick={() => {
              setEditing(null);
              setCreationDatabaseId(runtime?.databaseId);
              setFormOpen(true);
            }}
          >
            <Plus />
            {"Nuevo cliente"}
          </Button>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <MiniStat
          icon={Users}
          tone="primary"
          label="Clientes registrados"
          value={customers.filter(c => runtime ? !c.isCashCustomer : c.id !== "c-000").length}
        />
        <MiniStat
          icon={Wallet}
          label="Con crédito aprobado"
          value={withCredit.length}
        />
        <MiniStat
          icon={HandCoins}
          tone="warning"
          label="Total que nos deben"
          value={formatMoney(totalOwed)}
        />
      </div>
      <section className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="p-5">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setPage(0); }}
              placeholder="Buscar por nombre, RNC o teléfono…"
              className="h-10 rounded-xl pl-9"
            />
          </div>
        </div>
        {list.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Sin clientes"
            description="No hay clientes que coincidan con la búsqueda."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead>
                <tr className="border-y border-border bg-muted/50 text-left text-xs text-muted-foreground">
                  <th className="px-5 py-2.5 font-medium">{"Cliente"}</th>
                  <th className="px-3 py-2.5 font-medium">{"Contacto"}</th>
                  <th className="px-3 py-2.5 text-right font-medium">
                    {"Comprado"}
                  </th>
                  <th className="px-3 py-2.5 font-medium">{"Crédito usado"}</th>
                  <th className="px-3 py-2.5 text-right font-medium">
                    {"Balance"}
                  </th>
                  <th className="w-24 px-5 py-2.5 text-right font-medium">
                    {"Acciones"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {list.slice(page * 50, (page + 1) * 50).map((c) => {
                  const st = stats[c.id];
                  const used = c.creditLimit
                    ? Math.min(100, (c.balance / c.creditLimit) * 100)
                    : 0;
                  return (
                    <tr
                      onClick={() => setDetail(c)}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                      key={c.id}
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-primary">
                            {initials(c.name)}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{c.name}</p>
                            <p className="font-mono text-xs text-muted-foreground">
                              {c.rnc || "Sin RNC"}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-muted-foreground">
                        <p>{c.phone || "—"}</p>
                        {c.email && <p className="text-xs">{c.email}</p>}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums">
                        <p className="font-medium">
                          {formatMoney(st?.total ?? 0)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {st?.count ?? 0}
                          {" facturas"}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        {c.creditLimit ? (
                          <div className="w-40">
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>
                                {used.toFixed(0)}
                                {"%"}
                              </span>
                              <span>
                                {"de "}
                                {formatMoney(c.creditLimit)}
                              </span>
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                              <div
                                className={cn(
                                  "h-full rounded-full",
                                  used > 85
                                    ? "bg-primary"
                                    : used > 60
                                      ? "bg-amber-500"
                                      : "bg-emerald-500",
                                )}
                                style={{
                                  width: `${Math.max(used, 2)}%`,
                                }}
                              />
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            {"Solo contado"}
                          </span>
                        )}
                      </td>
                      <td
                        className={cn(
                          "px-3 py-3 text-right font-semibold tabular-nums",
                          c.balance > 0 && "text-primary",
                        )}
                      >
                        {formatMoney(c.balance)}
                      </td>
                      <td
                        className="px-5 py-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="mobile-touch-controls flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground"
                            onClick={() => {
                              setEditing(c);
                              setFormOpen(true);
                            }}
                            aria-label="Editar"
                          >
                            <Pencil />
                          </Button>
                          {(!runtime || runtime.isOwner) && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:bg-accent hover:text-primary"
                              onClick={() => {
                                if (c.balance > 0) {
                                  ue.error("No se puede eliminar", {
                                    description:
                                      "El cliente tiene balance pendiente.",
                                  });
                                  return;
                                }
                                setToDelete(c);
                              }}
                              aria-label="Eliminar"
                            >
                              <Trash2 />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {list.length > 50 && <div className="flex items-center justify-between gap-3 border-t p-4 text-sm">
          <Button variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Anterior</Button>
          <span>Página {page + 1} de {Math.ceil(list.length / 50)}</span>
          <Button variant="outline" disabled={(page + 1) * 50 >= list.length} onClick={() => setPage(p => p + 1)}>Siguiente</Button>
        </div>}
      </section>
      <PartyFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? "Editar cliente" : "Nuevo cliente"}
        description="Si el cliente pide crédito fiscal (B01), registra su RNC."
        fields={FIELDS}
        initial={{
          name: editing?.name ?? "",
          rnc: editing?.rnc ?? "",
          phone: editing?.phone ?? "",
          email: editing?.email ?? "",
          address: editing?.address ?? "",
          creditLimit: String(editing?.creditLimit ?? 0),
        }}
        submitLabel={editing ? "Guardar cambios" : "Crear cliente"}
        onSave={async (v) => {
          await saveCustomer({
            ...(runtime ? {databaseId: editing?.databaseId ?? creationDatabaseId, version: editing?.version} : {}),
            id: editing?.id ?? (runtime ? crypto.randomUUID() : newId("c")),
            name: v.name.trim(),
            rnc: v.rnc.trim(),
            phone: v.phone.trim(),
            email: v.email.trim(),
            address: v.address.trim(),
            creditLimit: v.creditLimit.trim() === "" ? null : v.creditLimit,
            balance: editing?.balance ?? 0,
          });
          ue.success(editing ? "Cliente actualizado" : "Cliente creado", {
            description: v.name,
          });
          setFormOpen(false);
        }}
      />
      <Sheet open={Boolean(detail)} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {detailCustomer && (
            <Fragment>
              <SheetHeader className="text-left">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-sm font-semibold text-primary">
                  {initials(detailCustomer.name)}
                </div>
                <SheetTitle>{detailCustomer.name}</SheetTitle>
                <SheetDescription className="flex flex-wrap gap-x-3">
                  <span className="font-mono">
                    {detailCustomer.rnc || "Sin RNC"}
                  </span>
                  {detailCustomer.phone && (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3 w-3" />
                      {detailCustomer.phone}
                    </span>
                  )}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-accent p-3">
                  <p className="text-xs text-accent-foreground/80">
                    {"Balance pendiente"}
                  </p>
                  <p className="text-lg font-semibold text-primary tabular-nums">
                    {formatMoney(detailCustomer.balance)}
                  </p>
                </div>
                <div className="rounded-xl bg-muted p-3">
                  <p className="text-xs text-muted-foreground">
                    {"Crédito disponible"}
                  </p>
                  <p className="text-lg font-semibold tabular-nums">
                    {detailCustomer.creditLimit === null ? "Sin crédito aprobado" : formatMoney(
                      Math.max(
                        0,
                        detailCustomer.creditLimit - detailCustomer.balance,
                      ),
                    )}
                  </p>
                </div>
              </div>
              {detailDocs.length > 0 && (
                <Button asChild={true} className="mt-3 w-full rounded-xl">
                  <Link to={`/cuentas-por-cobrar?cliente=${detailCustomer.id}`}>
                    <HandCoins />
                    {"Registrar cobro"}
                  </Link>
                </Button>
              )}
              <div className="mt-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {"Facturas pendientes"}
                </p>
                {detailDocs.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {runtime && detailCustomer.balance > 0
                      ? "Sin facturas pendientes del POS; el balance mostrado incluye saldos históricos de apertura."
                      : "No tiene facturas pendientes."}
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-border">
                    {detailDocs.map((d) => (
                      <li
                        className="flex justify-between py-2 text-sm"
                        key={d.id}
                      >
                        <span>
                          <span className="font-medium">{d.document}</span>
                          {d.dueDate && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              {"vence "}
                              {formatDate(d.dueDate)}
                            </span>
                          )}
                        </span>
                        <span className="font-medium tabular-nums">
                          {formatMoney(balanceOf(d))}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="mt-6">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {"Últimas compras"}
                </p>
                {detailSales.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {"Aún no tiene compras."}
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-border">
                    {detailSales.map((s) => (
                      <li
                        className="flex justify-between py-2 text-sm"
                        key={s.id}
                      >
                        <span>
                          <span className="font-medium">{s.number}</span>
                          <span className="ml-2 text-xs text-muted-foreground">
                            {formatDate(s.date)}
                          </span>
                        </span>
                        <span className="tabular-nums">
                          {formatMoney(s.total)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Fragment>
          )}
        </SheetContent>
      </Sheet>
      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="¿Eliminar cliente?"
        description={`Se eliminará ${toDelete?.name ?? ""}. Sus facturas anteriores se conservan.`}
        onConfirm={async () => {
          if (toDelete) await deleteCustomer(runtime ? toDelete : toDelete.id);
          setToDelete(null);
          ue("Cliente eliminado");
        }}
      />
    </div>
  );
}
export { CustomersPage };

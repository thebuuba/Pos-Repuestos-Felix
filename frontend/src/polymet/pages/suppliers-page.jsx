// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { usePosStore } from "../../data/pos-context.jsx";
import { formulaSummary } from "../lib/pricing.js";
import { PageHeader } from "../components/page-header.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Plus } from "lucide-react";
import { MiniStat } from "../components/section-card.jsx";
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
import { Link } from "react-router-dom";
import { PartyFormSheet } from "../components/party-form-sheet.jsx";
import { newId } from "../../data/new-id.js";
import { ConfirmDialog } from "../components/confirm-dialog.jsx";
import { useState } from "react";
function SuppliersPage() {
  const { suppliers, formulas, purchases, saveSupplier, deleteSupplier } =
    usePosStore();
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const fields = [
    {
      key: "name",
      label: "Nombre del suplidor",
      placeholder: "Ej. Masotti",
      required: true,
    },
    {
      key: "rnc",
      label: "RNC",
      placeholder: "000-00000-0",
      span: 1,
    },
    {
      key: "phone",
      label: "Teléfono",
      placeholder: "809-000-0000",
      span: 1,
    },
    {
      key: "contact",
      label: "Persona de contacto",
      placeholder: "Nombre del vendedor",
      span: 1,
    },
    {
      key: "creditDays",
      label: "Días de crédito",
      type: "number",
      span: 1,
    },
    {
      key: "email",
      label: "Correo",
      placeholder: "ventas@suplidor.com",
    },
    {
      key: "formulaId",
      label: "Fórmula de precios",
      type: "select",
      options: formulas.map((f) => ({
        value: f.id,
        label: `${f.name} (${formulaSummary(f)})`,
      })),
      hint: "Se aplica sola al subir sus facturas de compra.",
    },
  ];
  const totalOwed = suppliers.reduce((s, x) => s + x.balance, 0);
  const monthStart = new Date();
  monthStart.setDate(1);
  const monthTotal = purchases
    .filter((p) => new Date(p.date) >= monthStart)
    .reduce((s, p) => s + p.total, 0);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Suplidores"
        description="Cada suplidor tiene su propia fórmula de precios y condiciones de crédito."
        actions={
          <Button
            className="h-10 rounded-full px-5 shadow-md shadow-primary/20"
            onClick={() => {
              setEditing(null);
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
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {suppliers.map((s) => {
          const formula = formulas.find((f) => f.id === s.formulaId);
          const own = purchases.filter((p) => p.supplierId === s.id);
          const last = own[0];
          return (
            <div
              className="flex flex-col rounded-2xl border border-border bg-card p-5 transition-shadow hover:shadow-md"
              key={s.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-foreground text-background">
                    <Truck className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{s.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {"RNC "}
                      {s.rnc || "—"}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground"
                    onClick={() => {
                      setEditing(s);
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
              <div className="mt-4 space-y-1.5 text-sm text-muted-foreground">
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
              <div className="mt-4 flex items-center gap-2 rounded-xl bg-muted px-3 py-2 text-xs">
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
              </div>
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
                    {formatMoney(s.balance)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{"Crédito"}</p>
                  <p className="font-semibold">
                    {s.creditDays}
                    {" días"}
                  </p>
                </div>
                <div className="col-span-2 text-xs text-muted-foreground">
                  {last
                    ? `Última compra ${formatDate(last.date)} · ${own.length} compras registradas`
                    : "Sin compras registradas"}
                </div>
              </div>
              <Button
                asChild={true}
                variant="outline"
                className="mt-4 rounded-xl bg-card"
              >
                <Link to="/compras">
                  <PackagePlus />
                  {"Registrar compra"}
                </Link>
              </Button>
            </div>
          );
        })}
      </div>
      <PartyFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editing ? "Editar suplidor" : "Nuevo suplidor"}
        description="La fórmula elegida calcula P1, P2 y P3 al registrar sus compras."
        fields={fields}
        initial={{
          name: editing?.name ?? "",
          rnc: editing?.rnc ?? "",
          phone: editing?.phone ?? "",
          contact: editing?.contact ?? "",
          creditDays: String(editing?.creditDays ?? 30),
          email: editing?.email ?? "",
          formulaId: editing?.formulaId ?? formulas[0]?.id ?? "",
        }}
        submitLabel={editing ? "Guardar cambios" : "Crear suplidor"}
        onSave={(v) => {
          saveSupplier({
            id: editing?.id ?? newId("s"),
            name: v.name.trim(),
            rnc: v.rnc.trim(),
            phone: v.phone.trim(),
            contact: v.contact.trim(),
            email: v.email.trim() || undefined,
            creditDays: Math.max(0, Number(v.creditDays) || 0),
            formulaId: v.formulaId,
          });
          ue.success(editing ? "Suplidor actualizado" : "Suplidor creado", {
            description: v.name,
          });
          setFormOpen(false);
        }}
      />
      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="¿Eliminar suplidor?"
        description={`Se eliminará ${toDelete?.name ?? ""}. Las compras anteriores se conservan.`}
        onConfirm={() => {
          if (toDelete) deleteSupplier(toDelete.id);
          setToDelete(null);
          ue("Suplidor eliminado");
        }}
      />
    </div>
  );
}
export { SuppliersPage };

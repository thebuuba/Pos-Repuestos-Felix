// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { SectionCard } from "./section-card.jsx";
import { Eye, ReceiptText } from "lucide-react";
import { EmptyState } from "./section-card.jsx";
import { formatDate } from "../../lib/accounts.js";
import { cn } from "../../lib/utils.js";
import { formatMoney } from "../../lib/format.js";
import { useMemo, useState } from "react";
import { Button } from "../ui/button.jsx";
import { PurchaseInvoiceDialog } from "./purchase-invoice-dialog.jsx";
const PAGE_SIZE = 50;
function PurchasesHistoryTable({ purchases, suppliers, business, canVoid = false, onVoidPurchase }) {
  const [selectedId, setSelectedId] = useState(null);
  const [page, setPage] = useState(1);
  const suppliersById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const supplierName = (id) => suppliersById.get(id)?.name ?? "—";
  const selectedPurchase = useMemo(
    () => purchases.find((p) => p.id === selectedId) ?? null,
    [purchases, selectedId],
  );
  const totalPages = Math.max(1, Math.ceil(purchases.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = useMemo(
    () => purchases.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [purchases, safePage],
  );
  return (
    <SectionCard
      title="Compras registradas"
      description="Toca una compra para ver su factura, imprimirla o anularla."
      icon={ReceiptText}
      bodyClassName="p-0 pt-4"
    >
      {purchases.length === 0 ? (
        <EmptyState icon={ReceiptText} title="Aún no hay compras" />
      ) : (
        <>
          <div className="grid gap-3 border-t border-border p-4 lg:hidden">
            {visible.map((p) => {
              const isVoided = p.status === "anulada";
              return (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  aria-label={`Ver factura de ${p.number}`}
                  className={cn(
                    "w-full space-y-2.5 rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:bg-muted/30",
                    isVoided && "opacity-65",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-foreground">{p.number}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {p.supplierInvoice || "Sin número"}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                        isVoided
                          ? "border-destructive/40 bg-destructive/10 text-destructive"
                          : p.condition === "credito"
                            ? "border-foreground/50"
                            : p.condition === "contado"
                              ? "border-emerald-600/40 text-emerald-700 dark:text-emerald-400"
                              : "text-muted-foreground",
                      )}
                    >
                      {isVoided
                        ? "Anulada"
                        : p.condition === "credito"
                          ? "Crédito"
                          : p.condition === "contado"
                            ? "Al contado"
                            : "Sin registrar"}
                    </span>
                  </div>
                  <div className="space-y-0.5">
                    <p className="truncate text-sm font-medium text-foreground">
                      {p.supplierName ?? supplierName(p.supplierId)}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatDate(p.date)}</p>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-2.5">
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Eye className="h-3.5 w-3.5" />
                      <span>{"Ver factura"}</span>
                    </span>
                    <span className={cn("text-sm font-semibold tabular-nums text-foreground", isVoided && "line-through text-muted-foreground")}>
                      {formatMoney(p.total)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-y border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">{"No."}</th>
                <th className="px-3 py-2.5 font-medium">{"Fecha"}</th>
                <th className="px-3 py-2.5 font-medium">{"Suplidor"}</th>
                <th className="px-3 py-2.5 font-medium">{"Factura"}</th>
                <th className="px-3 py-2.5 font-medium">{"Condición"}</th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {"Total"}
                </th>
                <th className="w-10 px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const isVoided = p.status === "anulada";
                return (
                  <tr
                    key={p.id}
                    onClick={() => setSelectedId(p.id)}
                    className={cn(
                      "cursor-pointer border-b border-border hover:bg-muted/30",
                      isVoided && "opacity-65",
                    )}
                  >
                    <td className="px-5 py-3 font-medium">
                      <button
                        type="button"
                        aria-label={`Ver factura de ${p.number}`}
                        className="text-left hover:text-primary"
                      >
                        {p.number}
                      </button>
                    </td>
                    <td className="px-3 py-3 text-muted-foreground">
                      {formatDate(p.date)}
                    </td>
                    <td className="px-3 py-3">
                      {p.supplierName ?? supplierName(p.supplierId)}
                    </td>
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground">
                      {p.supplierInvoice || "—"}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={cn(
                          "rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                          isVoided
                            ? "border-destructive/40 bg-destructive/10 text-destructive"
                            : p.condition === "credito"
                              ? "border-foreground/50"
                              : p.condition === "contado"
                                ? "border-emerald-600/40 text-emerald-700 dark:text-emerald-400"
                                : "text-muted-foreground",
                        )}
                      >
                        {isVoided
                          ? "Anulada"
                          : p.condition === "credito"
                            ? "Crédito"
                            : p.condition === "contado"
                              ? "Al contado"
                              : "Sin registrar"}
                      </span>
                    </td>
                    <td className={cn("px-3 py-3 text-right font-semibold tabular-nums", isVoided && "line-through text-muted-foreground")}>
                      {formatMoney(p.total)}
                    </td>
                    <td className="px-5 py-3">
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground">
              <span>{`${purchases.length} compras · Página ${safePage} de ${totalPages}`}</span>
              <div className="flex items-center gap-1.5">
                <Button type="button" size="sm" variant="outline" className="h-7 rounded-lg px-2 text-xs" disabled={safePage <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  {"Anterior"}
                </Button>
                <Button type="button" size="sm" variant="outline" className="h-7 rounded-lg px-2 text-xs" disabled={safePage >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                  {"Siguiente"}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
      <PurchaseInvoiceDialog
        purchase={selectedPurchase}
        supplier={selectedPurchase ? suppliersById.get(selectedPurchase.supplierId) : null}
        business={business}
        open={Boolean(selectedPurchase)}
        onOpenChange={(open) => { if (!open) setSelectedId(null); }}
        canVoid={canVoid}
        onVoid={onVoidPurchase}
      />
    </SectionCard>
  );
}
export { PurchasesHistoryTable };

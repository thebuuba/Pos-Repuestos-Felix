// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { SectionCard } from "./section-card.jsx";
import { ReceiptText } from "lucide-react";
import { EmptyState } from "./section-card.jsx";
import { formatDate } from "../../lib/accounts.js";
import { cn } from "../../lib/utils.js";
import { formatMoney, formatUnitMoney, formatNumber } from "../../lib/format.js";
import { ChevronDown } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Button } from "../ui/button.jsx";
const PAGE_SIZE = 50;
function PurchasesHistoryTable({ purchases, suppliers }) {
  const [expanded, setExpanded] = useState(null);
  const [page, setPage] = useState(1);
  const supplierNames = useMemo(() => new Map(suppliers.map((s) => [s.id, s.name])), [suppliers]);
  const supplierName = (id) => supplierNames.get(id) ?? "—";
  const totalPages = Math.max(1, Math.ceil(purchases.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const visible = useMemo(
    () => purchases.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [purchases, safePage],
  );
  return (
    <SectionCard
      title="Compras registradas"
      description="Toca una compra para ver sus artículos."
      icon={ReceiptText}
      bodyClassName="p-0 pt-4"
    >
      {purchases.length === 0 ? (
        <EmptyState icon={ReceiptText} title="Aún no hay compras" />
      ) : (
        <div className="overflow-x-auto">
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
                const open = expanded === p.id;
                return (
                  <Fragment key={p.id}>
                    <tr
                      onClick={() => setExpanded(open ? null : p.id)}
                      className="cursor-pointer border-b border-border hover:bg-muted/30"
                    >
                      <td className="px-5 py-3 font-medium">
                        <button type="button" aria-expanded={open} aria-label={`Artículos de ${p.number}`}>{p.number}</button>
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
                            p.condition === "credito"
                              ? "border-foreground/50"
                              : p.condition === "contado" ? "border-emerald-600/40 text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
                          )}
                        >
                          {p.condition === "credito" ? "Crédito" : p.condition === "contado" ? "Pagada" : "Sin registrar"}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right font-semibold tabular-nums">
                        {formatMoney(p.total)}
                      </td>
                      <td className="px-5 py-3">
                        <ChevronDown
                          className={cn(
                            "h-4 w-4 text-muted-foreground transition-transform",
                            open && "rotate-180",
                          )}
                        />
                      </td>
                    </tr>
                    {open && (
                      <tr className="border-b border-border bg-muted/30">
                        <td colSpan={7} className="px-5 py-3">
                          <div className="grid gap-1.5">
                            {p.lines.map((l, index) => (
                              <div
                                className="flex flex-wrap items-center justify-between gap-2 text-xs"
                                key={l.id ?? index}
                              >
                                <span>
                                  <span className="font-mono text-muted-foreground">
                                    {l.code}
                                  </span>{" "}
                                  {l.name}
                                </span>
                                <span className="tabular-nums text-muted-foreground">
                                  {formatNumber(l.quantity)}
                                  {" × "}
                                  {formatUnitMoney(l.costExact ?? l.cost)}
                                  {" · P1 "}
                                  {formatUnitMoney(l.pricesExact?.p1 ?? l.prices.p1)}
                                  {" · P2"} {formatUnitMoney(l.pricesExact?.p2 ?? l.prices.p2)}
                                  {" · P3 "}
                                  {formatUnitMoney(l.pricesExact?.p3 ?? l.prices.p3)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
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
        </div>
      )}
    </SectionCard>
  );
}
export { PurchasesHistoryTable };

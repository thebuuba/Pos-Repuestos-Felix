// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { SectionCard } from "./section-card.jsx";
import { ReceiptText } from "lucide-react";
import { EmptyState } from "./section-card.jsx";
import { formatDate } from "../lib/accounts.js";
import { cn } from "../../lib/utils.js";
import { formatMoney } from "../lib/format.js";
import { ChevronDown } from "lucide-react";
import { Fragment } from "react";
import { useState } from "react";
function PurchasesHistoryTable({ purchases, suppliers }) {
  const [expanded, setExpanded] = useState(null);
  const supplierName = (id) => suppliers.find((s) => s.id === id)?.name ?? "—";
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
              {purchases.map((p) => {
                const open = expanded === p.id;
                return (
                  <Fragment key={p.id}>
                    <tr
                      onClick={() => setExpanded(open ? null : p.id)}
                      className="cursor-pointer border-b border-border hover:bg-muted/30"
                    >
                      <td className="px-5 py-3 font-medium">{p.number}</td>
                      <td className="px-3 py-3 text-muted-foreground">
                        {formatDate(p.date)}
                      </td>
                      <td className="px-3 py-3">
                        {supplierName(p.supplierId)}
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
                              : "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
                          )}
                        >
                          {p.condition === "credito" ? "Crédito" : "Pagada"}
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
                            {p.lines.map((l) => (
                              <div
                                className="flex flex-wrap items-center justify-between gap-2 text-xs"
                                key={l.code}
                              >
                                <span>
                                  <span className="font-mono text-muted-foreground">
                                    {l.code}
                                  </span>{" "}
                                  {l.name}
                                </span>
                                <span className="tabular-nums text-muted-foreground">
                                  {l.quantity}
                                  {" × "}
                                  {formatMoney(l.cost)}
                                  {" · P1 "}
                                  {formatMoney(l.prices.p1)}
                                  {" · P2"} {formatMoney(l.prices.p2)}
                                  {" · P3 "}
                                  {formatMoney(l.prices.p3)}
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
        </div>
      )}
    </SectionCard>
  );
}
export { PurchasesHistoryTable };

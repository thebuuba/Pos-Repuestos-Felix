// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { Search } from "lucide-react";
import { Input } from "../../components/ui/input.jsx";
import { EmptyState } from "./section-card.jsx";
import { ReceiptText } from "lucide-react";
import { formatDateTime } from "../lib/accounts.js";
import { formatMoney } from "../lib/format.js";
import { cn } from "../../lib/utils.js";
import { Button } from "../../components/ui/button.jsx";
import { Ban } from "lucide-react";
import { ConfirmDialog } from "./confirm-dialog.jsx";
import { toast as ue } from "sonner";
import { useState } from "react";
import { paymentLabel } from "../lib/sales-analytics.js";
var STATUS_UI = {
  pagada: "border-emerald-600/40 text-emerald-700 dark:text-emerald-400",
  pendiente: "border-foreground/50 text-foreground",
  anulada: "border-primary/50 text-primary line-through",
};
function SalesReportTable({ sales, onVoid }) {
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(15);
  const [toVoid, setToVoid] = useState(null);
  const q = query.trim().toLowerCase();
  const filtered = sales.filter(
    (s) =>
      !q ||
      s.number.toLowerCase().includes(q) ||
      s.customerName.toLowerCase().includes(q) ||
      s.ncf?.toLowerCase().includes(q),
  );
  const rows = filtered.slice(0, limit);
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">{"Facturas del período"}</h2>
          <p className="text-xs text-muted-foreground">
            {onVoid ? "Busca y anula facturas. Al anular, la mercancía vuelve al inventario." : "Busca por número de registro, NCF o cliente. La anulación no está habilitada."}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            aria-label="Buscar facturas"
            onChange={(e) => { setQuery(e.target.value); setLimit(15); }}
            placeholder="Factura, NCF o cliente…"
            className="h-10 rounded-xl pl-9"
          />
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={ReceiptText} title="Sin facturas" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-y border-border bg-muted/50 text-left text-xs text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">{"Factura"}</th>
                <th className="px-3 py-2.5 font-medium">{"Fecha"}</th>
                <th className="px-3 py-2.5 font-medium">{"Cliente"}</th>
                <th className="px-3 py-2.5 font-medium">{"Pago"}</th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {"ITBIS"}
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  {"Total"}
                </th>
                <th className="px-3 py-2.5 font-medium">{"Estado"}</th>
                <th className="w-12 px-5 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr
                  className="border-b border-border last:border-0 hover:bg-muted/30"
                  key={s.id}
                >
                  <td className="px-5 py-3">
                    <p className="font-medium">{s.number}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">
                      {s.ncf ?? s.comprobante}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {formatDateTime(s.date)}
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-3">
                    {s.customerName}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {paymentLabel(s)}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                    {formatMoney(s.itbis)}
                  </td>
                  <td className="px-3 py-3 text-right font-semibold tabular-nums">
                    {formatMoney(s.total)}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize",
                        STATUS_UI[s.status],
                      )}
                    >
                      {s.status ?? "Registrada"}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {onVoid && s.status !== "anulada" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:bg-accent hover:text-primary"
                        onClick={() => setToVoid(s)}
                        aria-label="Anular"
                      >
                        <Ban />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground">
        <span>
          {"Mostrando "}
          {rows.length}
          {" de "}
          {filtered.length}
        </span>
        {filtered.length > limit && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLimit((l) => l + 15)}
          >
            {"Ver más"}
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(toVoid)}
        onOpenChange={(o) => !o && setToVoid(null)}
        title={`¿Anular la factura ${toVoid?.number ?? ""}?`}
        description="La mercancía regresará al inventario y, si era a crédito, se elimina la cuenta por cobrar."
        confirmLabel="Anular factura"
        onConfirm={async () => {
          if (toVoid) {
            await onVoid(toVoid.id);
            ue(`Factura ${toVoid.number} anulada`);
          }
          setToVoid(null);
        }}
      />
    </section>
  );
}
export { SalesReportTable };

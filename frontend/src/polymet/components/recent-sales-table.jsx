// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { Button } from "../../components/ui/button.jsx";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { formatMoney } from "../lib/format.js";
import { cn } from "../../lib/utils.js";
var STATUS = {
  pagada: {
    label: "Pagada",
    className:
      "border-emerald-600/40 text-emerald-700 dark:border-emerald-400/40 dark:text-emerald-400",
  },
  pendiente: {
    label: "Pendiente",
    className: "border-foreground/60 text-foreground",
  },
  anulada: {
    label: "Anulada",
    className: "border-primary/50 text-primary line-through decoration-1",
  },
};
function RecentSalesTable({ sales }) {
  return (
    <section className="flex h-full flex-col rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-medium">{"Ventas recientes"}</h2>
        <Button
          asChild={true}
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
        >
          <Link to="/reportes">
            {"Ver todas"}
            <ArrowRight />
          </Link>
        </Button>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[620px] border-separate border-spacing-y-1.5 text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="px-3 py-1 font-medium">{"Factura"}</th>
              <th className="px-3 py-1 font-medium">{"Cliente"}</th>
              <th className="px-3 py-1 font-medium">{"Pago"}</th>
              <th className="px-3 py-1 text-center font-medium">{"Art."}</th>
              <th className="px-3 py-1 text-right font-medium">{"Monto"}</th>
              <th className="px-3 py-1 font-medium">{"Estado"}</th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => (
              <tr
                className="bg-muted/60 transition-colors hover:bg-muted"
                key={s.id}
              >
                <td className="rounded-l-xl px-3 py-3">
                  <p className="font-medium">
                    {"#"}
                    {s.invoice}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{s.time}</p>
                </td>
                <td className="px-3 py-3">
                  <p className="max-w-[200px] truncate">{s.customer}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {s.comprobante}
                  </p>
                </td>
                <td className="px-3 py-3 text-muted-foreground">{s.method}</td>
                <td className="px-3 py-3 text-center tabular-nums">
                  {s.items}
                </td>
                <td className="px-3 py-3 text-right font-semibold tabular-nums">
                  {formatMoney(s.amount)}
                </td>
                <td className="rounded-r-xl px-3 py-3">
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                      STATUS[s.status].className,
                    )}
                  >
                    {STATUS[s.status].label}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
export { RecentSalesTable };

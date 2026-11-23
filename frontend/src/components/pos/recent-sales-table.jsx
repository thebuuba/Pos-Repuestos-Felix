// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { Button } from "../ui/button.jsx";
import { Link } from "react-router-dom";
import { ArrowRight, Printer } from "lucide-react";
import { formatMoney } from "../../lib/format.js";
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
function RecentSalesTable({ sales, showAllLink = true, onSelect }) {
  return (
    <section className="flex h-full flex-col rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-medium">{"Ventas recientes"}</h2>
        {showAllLink && (
          <Button
            asChild={true}
            variant="ghost"
            size="sm"
            className="min-h-11 sm:min-h-8 text-muted-foreground"
          >
            <Link to="/reportes">
              {"Ver todas"}
              <ArrowRight />
            </Link>
          </Button>
        )}
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
              {onSelect && <th className="w-10 px-2 py-1" />}
            </tr>
          </thead>
          <tbody>
            {!sales.length && <tr><td colSpan={onSelect ? 7 : 6} className="px-3 py-3 text-muted-foreground">Sin ventas registradas.</td></tr>}
            {sales.map((s) => (
              <tr
                className={cn(
                  "bg-muted/60 transition-colors hover:bg-muted",
                  onSelect && "cursor-pointer",
                )}
                onClick={onSelect ? () => onSelect(s.id) : undefined}
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
                <td className={cn("px-3 py-3", !onSelect && "rounded-r-xl")}>
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-medium",
                      STATUS[s.status]?.className,
                    )}
                  >
                    {STATUS[s.status]?.label ?? "Registrada"}
                  </span>
                </td>
                {onSelect && (
                  <td className="rounded-r-xl px-2 py-3 text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:bg-card hover:text-foreground"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(s.id);
                      }}
                      title={`Reimprimir ${s.invoice}`}
                      aria-label={`Reimprimir ${s.invoice}`}
                    >
                      <Printer className="h-4 w-4" />
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
export { RecentSalesTable };

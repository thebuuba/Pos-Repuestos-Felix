// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { usePosStore } from "../../data/pos-context.jsx";
import { round2 } from "../lib/format.js";
import { PageHeader } from "../components/page-header.jsx";
import { cn } from "../../lib/utils.js";
import { Button } from "../../components/ui/button.jsx";
import { toast as ue } from "sonner";
import { Download } from "lucide-react";
import { MiniStat } from "../components/section-card.jsx";
import { Wallet } from "lucide-react";
import { formatMoney } from "../lib/format.js";
import { TrendingUp } from "lucide-react";
import { Receipt } from "lucide-react";
import { BadgePercent } from "lucide-react";
import { SectionCard } from "../components/section-card.jsx";
import { ChartContainer } from "../../components/ui/chart.jsx";
import { BarChart } from "recharts";
import { ChartTooltip } from "../../components/ui/chart.jsx";
import { ChartTooltipContent } from "../../components/ui/chart.jsx";
import { XAxis } from "recharts";
import { Bar } from "recharts";
import { Coins } from "lucide-react";
import { Trophy } from "lucide-react";
import { SalesReportTable } from "../components/sales-report-table.jsx";
import { Fragment } from "react";
import { useMemo } from "react";
import { useState } from "react";
var PERIODS = [
  {
    value: "hoy",
    label: "Hoy",
  },
  {
    value: "7d",
    label: "7 días",
  },
  {
    value: "30d",
    label: "30 días",
  },
  {
    value: "mes",
    label: "Este mes",
  },
];
function periodStart(p) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  if (p === "7d") d.setDate(d.getDate() - 6);
  if (p === "30d") d.setDate(d.getDate() - 29);
  if (p === "mes") d.setDate(1);
  return d;
}
var dayFmt = new Intl.DateTimeFormat("es-DO", {
  day: "numeric",
  month: "short",
});
var hourFmt = (h) => `${h % 12 || 12}${h < 12 ? "a" : "p"}`;
var METHOD_LABELS = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  credito: "Crédito",
};
function ReportsPage() {
  const { sales, products, voidSale } = usePosStore();
  const [period, setPeriod] = useState("30d");
  const data = useMemo(() => {
    const start = periodStart(period);
    const inPeriod = sales.filter((s) => new Date(s.date) >= start);
    const valid = inPeriod.filter((s) => s.status !== "anulada");
    const costOf = (id) => products.find((p) => p.id === id)?.cost ?? 0;
    const net = valid.reduce((s, x) => s + x.subtotal - x.discount, 0);
    const itbis = valid.reduce((s, x) => s + x.itbis, 0);
    const total = valid.reduce((s, x) => s + x.total, 0);
    const cost = valid.reduce(
      (s, x) =>
        s + x.lines.reduce((t, l) => t + costOf(l.productId) * l.quantity, 0),
      0,
    );
    const series = [];
    if (period === "hoy") {
      for (let h = 8; h <= 18; h++) {
        series.push({
          label: hourFmt(h),
          total: round2(
            valid
              .filter((s) => new Date(s.date).getHours() === h)
              .reduce((t, s) => t + s.total, 0),
          ),
        });
      }
    } else {
      const cursor = new Date(start);
      const today = new Date();
      while (cursor <= today) {
        const key = cursor.toDateString();
        series.push({
          label: dayFmt.format(cursor),
          total: round2(
            valid
              .filter((s) => new Date(s.date).toDateString() === key)
              .reduce((t, s) => t + s.total, 0),
          ),
        });
        cursor.setDate(cursor.getDate() + 1);
      }
    }
    const methods = Object.keys(METHOD_LABELS).map((m) => ({
      key: m,
      label: METHOD_LABELS[m],
      total: round2(
        valid.filter((s) => s.method === m).reduce((t, s) => t + s.total, 0),
      ),
      count: valid.filter((s) => s.method === m).length,
    }));
    const map = new Map();
    for (const s of valid) {
      for (const l of s.lines) {
        const row = map.get(l.productId) ?? {
          name: l.name,
          code: l.code,
          qty: 0,
          revenue: 0,
          cost: 0,
        };
        row.qty += l.quantity;
        row.revenue += l.subtotal;
        row.cost += costOf(l.productId) * l.quantity;
        map.set(l.productId, row);
      }
    }
    const top = [...map.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 7);
    const catMap = new Map();
    for (const s of valid) {
      for (const l of s.lines) {
        const cat =
          products.find((p) => p.id === l.productId)?.category ?? "Otros";
        catMap.set(cat, (catMap.get(cat) ?? 0) + l.subtotal);
      }
    }
    const categories = [...catMap.entries()].sort((a, b) => b[1] - a[1]);
    const fiscal = ["B01", "B02", "B14", "B15"].map((t) => {
      const list = valid.filter((s) => s.comprobante === t);
      return {
        type: t,
        count: list.length,
        base: round2(list.reduce((x, s) => x + s.subtotal - s.discount, 0)),
        itbis: round2(list.reduce((x, s) => x + s.itbis, 0)),
      };
    });
    return {
      inPeriod,
      valid,
      net,
      itbis,
      total,
      profit: net - cost,
      series,
      methods,
      top,
      categories,
      fiscal,
      voided: inPeriod.length - valid.length,
    };
  }, [sales, products, period]);
  const maxMethod = Math.max(...data.methods.map((m) => m.total), 1);
  const maxCat = Math.max(...data.categories.map((c) => c[1]), 1);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Reportes"
        description="Cómo va el negocio: ventas, ganancias, productos más vendidos e impuestos."
        actions={
          <Fragment>
            <div className="flex rounded-full bg-card p-1 shadow-sm ring-1 ring-border">
              {PERIODS.map((p) => (
                <button
                  type="button"
                  onClick={() => setPeriod(p.value)}
                  className={cn(
                    "h-8 rounded-full px-3.5 text-xs font-medium transition-colors",
                    period === p.value
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  key={p.value}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <Button
              variant="outline"
              className="h-10 rounded-full bg-card px-5"
              onClick={() =>
                ue.success("Reporte exportado", {
                  description: "Se descargó el archivo Excel del período.",
                })
              }
            >
              <Download />
              {"Exportar"}
            </Button>
          </Fragment>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat
          icon={Wallet}
          tone="primary"
          label="Ventas totales"
          value={formatMoney(data.total)}
          hint={`${data.valid.length} facturas · ${data.voided} anuladas`}
        />
        <MiniStat
          icon={TrendingUp}
          tone="success"
          label="Ganancia bruta"
          value={formatMoney(data.profit)}
          hint={`Margen ${data.net ? ((data.profit / data.net) * 100).toFixed(1) : 0}% sobre venta neta`}
        />
        <MiniStat
          icon={Receipt}
          label="Ticket promedio"
          value={formatMoney(
            data.valid.length ? data.total / data.valid.length : 0,
          )}
        />
        <MiniStat
          icon={BadgePercent}
          tone="warning"
          label="ITBIS cobrado"
          value={formatMoney(data.itbis)}
          hint="A declarar en el IT-1"
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard
          title="Ventas por día"
          icon={TrendingUp}
          className="lg:col-span-2"
          bodyClassName="pt-2"
        >
          <ChartContainer
            config={{}}
            className="aspect-[none] h-[240px] w-full"
          >
            <BarChart
              data={data.series}
              margin={{
                top: 8,
                left: 0,
                right: 0,
                bottom: 0,
              }}
            >
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    hideIndicator={true}
                    formatter={(v) => (
                      <span className="font-semibold tabular-nums">
                        {formatMoney(Number(v))}
                      </span>
                    )}
                  />
                }
              />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tickMargin={8}
                tick={{
                  fontSize: 11,
                }}
                interval="preserveStartEnd"
                minTickGap={16}
              />
              <Bar
                dataKey="total"
                fill="hsl(var(--chart-1))"
                radius={[6, 6, 6, 6]}
                maxBarSize={32}
              />
            </BarChart>
          </ChartContainer>
        </SectionCard>
        <SectionCard title="Formas de pago" icon={Coins}>
          <div className="space-y-4">
            {data.methods.map((m) => (
              <div key={m.key}>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">
                    {m.label}{" "}
                    <span className="text-xs">
                      {"· "}
                      {m.count}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatMoney(m.total)}
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{
                      width: `${(m.total / maxMethod) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard
          title="Más vendidos"
          icon={Trophy}
          className="lg:col-span-2"
          bodyClassName="p-0 pt-4"
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-y border-border bg-muted/50 text-left text-xs text-muted-foreground">
                  <th className="w-10 px-5 py-2.5 font-medium">{"#"}</th>
                  <th className="px-3 py-2.5 font-medium">{"Artículo"}</th>
                  <th className="px-3 py-2.5 text-right font-medium">
                    {"Unidades"}
                  </th>
                  <th className="px-3 py-2.5 text-right font-medium">
                    {"Venta"}
                  </th>
                  <th className="px-5 py-2.5 text-right font-medium">
                    {"Ganancia"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.top.map((t, i) => (
                  <tr
                    className="border-b border-border last:border-0"
                    key={t.code}
                  >
                    <td className="px-5 py-3">
                      <span
                        className={cn(
                          "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                          i === 0
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground",
                        )}
                      >
                        {i + 1}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <p className="font-medium">{t.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {t.code}
                      </p>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {t.qty}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums">
                      {formatMoney(t.revenue)}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                      {formatMoney(t.revenue - t.cost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
        <div className="space-y-4">
          <SectionCard title="Por categoría">
            <div className="space-y-3">
              {data.categories.map(([cat, value]) => (
                <div className="flex items-center gap-3 text-sm" key={cat}>
                  <span className="w-24 shrink-0 truncate text-muted-foreground">
                    {cat}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{
                        width: `${(value / maxCat) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-xs font-medium tabular-nums">
                    {formatMoney(value)}
                  </span>
                </div>
              ))}
            </div>
          </SectionCard>
          <SectionCard
            title="Resumen fiscal (607)"
            description="Base imponible e ITBIS por comprobante"
          >
            <div className="space-y-2 text-sm">
              {data.fiscal.map((f) => (
                <div
                  className="flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2"
                  key={f.type}
                >
                  <span>
                    <span className="font-mono font-semibold">{f.type}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {f.count}
                      {" fact."}
                    </span>
                  </span>
                  <span className="text-right text-xs tabular-nums">
                    <span className="block font-medium">
                      {formatMoney(f.base)}
                    </span>
                    <span className="text-muted-foreground">
                      {"ITBIS "}
                      {formatMoney(f.itbis)}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      </div>
      <SalesReportTable sales={data.inPeriod} onVoid={voidSale} />
    </div>
  );
}
export { ReportsPage };

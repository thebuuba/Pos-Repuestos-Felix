// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { usePosStore } from "../data/pos-context.jsx";
import { averageAmount, businessDay, downloadSales, reportData } from "../lib/sales-analytics.js";
import { PageHeader } from "../components/pos/page-header.jsx";
import { cn } from "../lib/utils.js";
import { Button } from "../components/ui/button.jsx";
import { Download } from "lucide-react";
import { MiniStat } from "../components/pos/section-card.jsx";
import { Wallet } from "lucide-react";
import { formatMoney } from "../lib/format.js";
import { TrendingUp } from "lucide-react";
import { Receipt } from "lucide-react";
import { BadgePercent } from "lucide-react";
import { SectionCard } from "../components/pos/section-card.jsx";
import { ChartContainer } from "../components/ui/chart.jsx";
import { BarChart } from "recharts";
import { ChartTooltip } from "../components/ui/chart.jsx";
import { ChartTooltipContent } from "../components/ui/chart.jsx";
import { XAxis } from "recharts";
import { Bar } from "recharts";
import { Coins } from "lucide-react";
import { Trophy } from "lucide-react";
import { SalesReportTable } from "../components/pos/sales-report-table.jsx";
import { ReceiptDialog } from "../components/pos/receipt-dialog.jsx";
import { receiptFromStoredSale } from "../data/operational-sales.js";
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
function ReportsPage() {
  const { sales, products, settings, voidSale, runtime } = usePosStore();
  const [period, setPeriod] = useState("30d");
  const [reprintSale, setReprintSale] = useState(null);
  const today = businessDay();
  const operational = Boolean(runtime);
  const data = useMemo(() => reportData(sales, products, period, today, operational), [sales, products, period, today, operational]);
  const seriesData = useMemo(() => data.series.map(row => ({ ...row, plot: Number(row.total) })), [data.series]);
  const maxMethod = Math.max(...data.methods.map((m) => m.total), 1);
  const maxCat = Math.max(...data.categories.map((c) => c[1]), 1);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Reportes"
        description="Cómo va el negocio: ventas, ganancias, productos más vendidos e impuestos."
        actions={
          <Fragment>
            <div className="mobile-touch-controls flex flex-wrap rounded-full bg-card p-1 shadow-sm ring-1 ring-border">
              {PERIODS.map((p) => (
                <button
                  type="button"
                  aria-pressed={period === p.value}
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
              onClick={() => downloadSales(data.inPeriod, `ventas-${period}-${today}`)}
            >
              <Download />
              {"Exportar"}
            </Button>
          </Fragment>
        }
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MiniStat
          icon={Wallet}
          tone="primary"
          label="Ventas totales"
          value={formatMoney(data.total)}
          hint={data.voided > 0 || !operational ? `${data.valid.length} facturas · ${data.voided} anuladas` : `${data.valid.length} facturas registradas`}
        />
        <MiniStat
          icon={TrendingUp}
          tone="success"
          label="Ganancia bruta"
          value={data.profit === null ? "—" : formatMoney(data.profit)}
          hint={data.profit === null ? "Costo histórico de venta no registrado" : `Margen ${Number(data.net) ? ((data.profit / data.net) * 100).toFixed(1) : 0}% sobre venta neta`}
        />
        <MiniStat
          icon={Receipt}
          label="Ticket promedio"
          value={formatMoney(
            averageAmount(data.total, data.valid.length),
          )}
        />
        <MiniStat
          icon={BadgePercent}
          tone="warning"
          label="ITBIS cobrado"
          value={formatMoney(data.itbis)}
          hint={operational ? "ITBIS registrado en las ventas" : "A declarar en el IT-1"}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
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
              data={seriesData}
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
                    formatter={(_value, _name, item) => (
                      <span className="font-semibold tabular-nums">
                        {formatMoney(item.payload.total)}
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
                dataKey="plot"
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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <SectionCard
          title="Más vendidos"
          icon={Trophy}
          className="lg:col-span-2"
          bodyClassName="p-0 pt-4"
        >
          {data.top.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">
              {"Sin ventas en el período."}
            </p>
          ) : (
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
                    key={t.id}
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
                      {t.profit === null ? "—" : formatMoney(t.profit)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </SectionCard>
        <div className="space-y-4">
          <SectionCard title="Por categoría" description={operational ? "Venta neta por categoría actual" : undefined}>
            <div className="space-y-3">
              {!data.categories.length && <p className="text-sm text-muted-foreground">Sin ventas en el período.</p>}
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
            title={operational ? "Comprobantes registrados" : "Resumen fiscal (607)"}
            description="Base imponible e ITBIS por comprobante"
          >
            <div className="space-y-2 text-sm">
              {!data.fiscal.length && <p className="text-muted-foreground">Sin comprobantes en el período.</p>}
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
      <SalesReportTable
        key={period}
        sales={data.inPeriod}
        operational={operational}
        onReprint={setReprintSale}
        onVoid={
          operational
            ? runtime.isOwner
              ? (sale, reason) =>
                  voidSale({
                    databaseId: sale.databaseId,
                    saleId: sale.id,
                    version: sale.version,
                    reason,
                  })
              : undefined
            : (sale) => voidSale(sale.id)
        }
      />
      <ReceiptDialog
        sale={receiptFromStoredSale(reprintSale)}
        open={Boolean(reprintSale)}
        onOpenChange={(open) => { if (!open) setReprintSale(null); }}
        onNewSale={() => setReprintSale(null)}
        business={settings.business}
        printFormat={settings.printFormat}
        footer={settings.ticketFooter}
        isReprint
      />
    </div>
  );
}
export { ReportsPage };

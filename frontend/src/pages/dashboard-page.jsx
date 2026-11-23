// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { usePosStore } from "../data/pos-context.jsx";
import { formatDate } from "../lib/accounts.js";
import { averageAmount, businessDay, downloadSales, monthlyActivity, paymentGroups, paymentLabel, salesTotal, shiftDay, sumAmounts } from "../lib/sales-analytics.js";
import { useMemo } from "react";
import { balanceOf } from "../lib/accounts.js";
import { formatTime } from "../lib/accounts.js";
import { PageHeader } from "../components/pos/page-header.jsx";
import { Button } from "../components/ui/button.jsx";
import { Download } from "lucide-react";
import { Link } from "react-router-dom";
import { ShoppingCart } from "lucide-react";
import { StatCard } from "../components/pos/stat-card.jsx";
import { SalesActivityChart } from "../components/pos/sales-activity-chart.jsx";
import { SalesGoalGauge } from "../components/pos/sales-goal-gauge.jsx";
import { PeakHoursHeatmap } from "../components/pos/peak-hours-heatmap.jsx";
import { RecentSalesTable } from "../components/pos/recent-sales-table.jsx";
import { Fragment } from "react";
const barColors = ["bg-primary", "bg-primary/45", "bg-primary/20", "bg-foreground/70"];
const utcWeekdayFmt = new Intl.DateTimeFormat("es-DO", { weekday: "long", timeZone: "UTC" });
function pctChange(now, before) {
  if (!Number(before)) return undefined;
  return Math.round(((now - before) / before) * 1000) / 10;
}
function DashboardPage({ reference }) {
  const { sales, receivables, customers, settings, cashSession, runtime } = usePosStore();
  const isOwner = !runtime || runtime.isOwner;
  const end = businessDay();
  const lastWeekDay = shiftDay(end, -7);
  const { today, lastWeek, salesToday, salesLastWeek, avgToday, avgLastWeek, breakdown, recent } = useMemo(() => {
    const valid = sales.filter(s => s.status !== "anulada");
    const todayRows = valid.filter(s => businessDay(s.date) === end);
    const lastWeekRows = valid.filter(s => businessDay(s.date) === lastWeekDay);
    const totalToday = salesTotal(todayRows);
    const totalLastWeek = salesTotal(lastWeekRows);
    return {
      today: todayRows,
      lastWeek: lastWeekRows,
      salesToday: totalToday,
      salesLastWeek: totalLastWeek,
      avgToday: averageAmount(totalToday, todayRows.length),
      avgLastWeek: averageAmount(totalLastWeek, lastWeekRows.length),
      breakdown: paymentGroups(todayRows, Boolean(runtime)).map((group, index) => ({
        label: group.label, value: group.total, className: barColors[index % barColors.length],
      })),
      recent: sales.slice(0, 5).map((s) => ({
        id: s.id, invoice: s.number, customer: s.customerName, comprobante: s.ncf ?? s.comprobante,
        method: paymentLabel(s), items: Number(sumAmounts(s.lines.map(line => line.quantity))).toLocaleString("es-DO"),
        amount: s.total, time: formatTime(s.date) || formatDate(s.date), status: s.status,
      })),
    };
  }, [sales, end, lastWeekDay, runtime]);
  const { balanceCount, balanceSum } = useMemo(() => {
    const list = runtime ? customers.map(c => c.balance).filter(v => v > 0) : receivables.map(balanceOf).filter(v => v > 0);
    return { balanceCount: list.length, balanceSum: sumAmounts(list) };
  }, [runtime, customers, receivables]);
  const activity = useMemo(() => reference?.activity ?? monthlyActivity(sales, end), [reference, sales, end]);
  const weekday = utcWeekdayFmt.format(new Date(lastWeekDay));
  const business = settings.business.name;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Panel"
        description={cashSession?.cashier ? `Hola ${cashSession.cashier.split(" ")[0]}, este es el resumen de ${business} hoy.` : `Resumen de ${business || "ventas"} hoy.`}
        actions={
          <Fragment>
            <Button
              variant="outline"
              onClick={() => downloadSales(sales.filter(s => businessDay(s.date) === end), `ventas-hoy-${end}`)}
              className="h-10 rounded-full bg-card px-5"
            >
              <Download />
              {"Exportar"}
            </Button>
            <Button
              asChild={true}
              className="h-10 rounded-full px-5 shadow-md shadow-primary/20"
            >
              <Link to="/ventas">
                <ShoppingCart />
                {"Nueva venta"}
              </Link>
            </Button>
          </Fragment>
        }
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Ventas de hoy"
          value={salesToday} scrollableValue={Boolean(runtime)}
          change={pctChange(salesToday, salesLastWeek)}
          footer={`Comparado con el ${weekday} pasado`}
          to={isOwner ? "/reportes" : undefined}
          highlight={true}
        />
        <StatCard
          title="Ticket promedio"
          value={avgToday} scrollableValue={Boolean(runtime)}
          change={pctChange(avgToday, avgLastWeek)}
          footer="Promedio por factura emitida hoy"
          to={isOwner ? "/reportes" : undefined}
        />
        <StatCard
          title="Facturas emitidas"
          value={today.length}
          format="number"
          change={pctChange(today.length, lastWeek.length)}
          footer={
            cashSession?.open
              ? `Caja abierta desde las ${formatTime(cashSession.openedAt)}`
              : cashSession ? "Caja cerrada" : "Facturas registradas hoy"
          }
          to="/ventas"
        />
        <StatCard
          title="Cuentas x cobrar"
          value={balanceSum} scrollableValue={Boolean(runtime)}
          footer={`${balanceCount} ${runtime ? balanceCount === 1 ? "cliente con saldo pendiente" : "clientes con saldo pendiente" : "facturas pendientes de cobro"}`}
          to="/cuentas-por-cobrar"
        />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <SalesActivityChart {...activity} />
        </div>
        <SalesGoalGauge
          goal={reference?.goal ?? (settings.dailyGoal > 0 ? settings.dailyGoal : null)}
          achieved={salesToday}
          breakdown={breakdown}
        />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <PeakHoursHeatmap {...reference?.peak} />
        <div className="min-w-0 lg:col-span-2">
          <RecentSalesTable sales={recent} showAllLink={isOwner} />
        </div>
      </div>
    </div>
  );
}
export { DashboardPage };

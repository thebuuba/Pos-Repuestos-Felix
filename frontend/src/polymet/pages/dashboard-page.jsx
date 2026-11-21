// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { usePosStore } from "../data/pos-store.jsx";
import { isSameDay } from "../lib/accounts.js";
import { balanceOf } from "../lib/accounts.js";
import { formatTime } from "../lib/accounts.js";
import { PageHeader } from "../components/page-header.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Download } from "lucide-react";
import { Link } from "react-router-dom";
import { ShoppingCart } from "lucide-react";
import { StatCard } from "../components/stat-card.jsx";
import { SalesActivityChart } from "../components/sales-activity-chart.jsx";
import { MONTHLY_SALES } from "../data/dashboard-data.js";
import { CURRENT_MONTH_INDEX } from "../data/dashboard-data.js";
import { SalesGoalGauge } from "../components/sales-goal-gauge.jsx";
import { DAILY_GOAL } from "../data/dashboard-data.js";
import { PeakHoursHeatmap } from "../components/peak-hours-heatmap.jsx";
import { PEAK_HOURS } from "../data/dashboard-data.js";
import { RecentSalesTable } from "../components/recent-sales-table.jsx";
import { Fragment } from "react";
var METHOD = {
  efectivo: "Efectivo",
  tarjeta: "Tarjeta",
  transferencia: "Transferencia",
  credito: "Crédito",
};
function pctChange(now, before) {
  if (!before) return 0;
  return Math.round(((now - before) / before) * 1000) / 10;
}
function DashboardPage() {
  const { sales, receivables, settings, cashSession } = usePosStore();
  const valid = sales.filter((s) => s.status !== "anulada");
  const today = valid.filter((s) => isSameDay(s.date));
  const lastWeekRef = new Date();
  lastWeekRef.setDate(lastWeekRef.getDate() - 7);
  const lastWeek = valid.filter((s) => isSameDay(s.date, lastWeekRef));
  const sum = (list) => list.reduce((t, s) => t + s.total, 0);
  const salesToday = sum(today);
  const avgToday = today.length ? salesToday / today.length : 0;
  const avgLastWeek = lastWeek.length ? sum(lastWeek) / lastWeek.length : 0;
  const openDocs = receivables.filter((r) => balanceOf(r) > 0);
  const receivablesTotal = openDocs.reduce((t, r) => t + balanceOf(r), 0);
  const byMethod = (m) => sum(today.filter((s) => s.method === m));
  const weekday = new Intl.DateTimeFormat("es-DO", {
    weekday: "long",
  }).format(lastWeekRef);
  const recent = sales.slice(0, 5).map((s) => ({
    id: s.id,
    invoice: s.number,
    customer: s.customerName,
    comprobante: s.ncf ?? s.comprobante,
    method: METHOD[s.method],
    items: s.lines.reduce((t, l) => t + l.quantity, 0),
    amount: s.total,
    time: formatTime(s.date),
    status: s.status,
  }));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Panel"
        description={`Hola ${cashSession.cashier.split(" ")[0]}, este es el resumen de ${settings.business.name} hoy.`}
        actions={
          <Fragment>
            <Button
              variant="outline"
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
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="Ventas de hoy"
          value={salesToday}
          change={pctChange(salesToday, sum(lastWeek))}
          footer={`Comparado con el ${weekday} pasado`}
          to="/reportes"
          highlight={true}
        />
        <StatCard
          title="Ticket promedio"
          value={avgToday}
          change={pctChange(avgToday, avgLastWeek)}
          footer="Promedio por factura emitida hoy"
          to="/reportes"
        />
        <StatCard
          title="Facturas emitidas"
          value={today.length}
          format="number"
          change={pctChange(today.length, lastWeek.length)}
          footer={
            cashSession.open
              ? `Caja abierta desde las ${formatTime(cashSession.openedAt)}`
              : "Caja cerrada"
          }
          to="/ventas"
        />
        <StatCard
          title="Cuentas x cobrar"
          value={receivablesTotal}
          footer={`${openDocs.length} facturas pendientes de cobro`}
          to="/cuentas-por-cobrar"
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SalesActivityChart
            data={MONTHLY_SALES}
            currentIndex={CURRENT_MONTH_INDEX}
          />
        </div>
        <SalesGoalGauge
          goal={DAILY_GOAL.goal}
          achieved={salesToday}
          breakdown={[
            {
              label: "Efectivo",
              value: byMethod("efectivo"),
              className: "bg-primary",
            },
            {
              label: "Tarjeta",
              value: byMethod("tarjeta"),
              className: "bg-primary/45",
            },
            {
              label: "Transferencia",
              value: byMethod("transferencia"),
              className: "bg-primary/20",
            },
            {
              label: "Crédito",
              value: byMethod("credito"),
              className: "bg-foreground/70",
            },
          ]}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <PeakHoursHeatmap
          days={PEAK_HOURS.days}
          hours={PEAK_HOURS.hours}
          values={PEAK_HOURS.values}
        />
        <div className="lg:col-span-2">
          <RecentSalesTable sales={recent} />
        </div>
      </div>
    </div>
  );
}
export { DashboardPage };

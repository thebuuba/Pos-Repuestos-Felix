// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { averageAmount, salesTotal } from "../../lib/sales-analytics.js";
import { MoneyDisplay } from "./money-display.jsx";
import { Select } from "../ui/select.jsx";
import { SelectTrigger } from "../ui/select.jsx";
import { SelectValue } from "../ui/select.jsx";
import { SelectContent } from "../ui/select.jsx";
import { SelectItem } from "../ui/select.jsx";
import { formatMoney } from "../../lib/format.js";
import { ChartContainer } from "../ui/chart.jsx";
import { BarChart } from "recharts";
import { ChartTooltip } from "../ui/chart.jsx";
import { ChartTooltipContent } from "../ui/chart.jsx";
import { XAxis } from "recharts";
import { Bar } from "recharts";
import { Cell } from "recharts";
import { useMemo } from "react";
import { useState } from "react";
function SalesActivityChart({ data, currentIndex, lastSix }) {
  const [range, setRange] = useState("year");
  const visible = useMemo(() => {
    if (range === "6m" && lastSix) return lastSix.map((row, i) => ({ ...row, current: i === 5 }));
    const start = range === "6m" ? Math.max(0, currentIndex - 5) : 0;
    const end = range === "6m" ? currentIndex + 1 : data.length;
    return data.slice(start, end).map((d, i) => ({
      ...d,
      current: start + i === currentIndex,
    }));
  }, [data, currentIndex, lastSix, range]);
  const chartData = useMemo(() => visible.map(row => ({ ...row, plot: Number(row.total) })), [visible]);
  const withSales = visible.filter((d) => d.total > 0);
  const total = salesTotal(withSales);
  const average = averageAmount(total, withSales.length);
  return (
    <section className="flex h-full flex-col rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-medium">{"Actividad de ventas"}</h2>
          <MoneyDisplay
            value={total}
            className="mt-1 text-[32px] leading-tight"
          />
        </div>
        <div className="flex flex-col items-end gap-3">
          <Select value={range} onValueChange={setRange}>
            <SelectTrigger aria-label="Período de actividad" className="h-9 w-[150px] rounded-full border-transparent bg-muted shadow-none">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="year">{"Este año"}</SelectItem>
              <SelectItem value="6m">{"Últimos 6 meses"}</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-primary" />
              {"Mes actual"}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
              {"Promedio "}
              {formatMoney(average)}
            </span>
          </div>
        </div>
      </div>
      <ChartContainer
        config={{}}
        className="mt-4 aspect-[none] h-[220px] w-full"
      >
        <BarChart
          data={chartData}
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
          <defs>
            <pattern
              id="sales-stripes"
              patternUnits="userSpaceOnUse"
              width="7"
              height="7"
              patternTransform="rotate(45)"
            >
              <rect width="7" height="7" fill="hsl(var(--muted))" />
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="7"
                stroke="hsl(var(--border))"
                strokeWidth="3"
              />
            </pattern>
          </defs>
          <XAxis
            dataKey="month"
            axisLine={false}
            tickLine={false}
            tickMargin={10}
            tick={{
              fontSize: 12,
            }}
          />
          <Bar dataKey="plot" radius={[10, 10, 10, 10]} maxBarSize={44}>
            {visible.map((d) => (
              <Cell
                fill={d.current ? "hsl(var(--chart-1))" : "url(#sales-stripes)"}
                key={d.month}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
    </section>
  );
}
export { SalesActivityChart };

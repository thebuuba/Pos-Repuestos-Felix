// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { formatMoney } from "../lib/format.js";
function SalesGoalGauge({ goal, achieved, breakdown }) {
  const pct = Math.min(100, Math.round((achieved / goal) * 100));
  const remaining = Math.max(0, goal - achieved);
  return (
    <section className="flex h-full flex-col rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-medium">{"Meta del día"}</h2>
        <span className="text-xs text-muted-foreground">
          {formatMoney(goal)}
        </span>
      </div>
      <div className="relative mx-auto mt-4 w-full max-w-[260px]">
        <svg viewBox="0 0 240 132" className="w-full">
          <defs>
            <pattern
              id="gauge-stripes"
              patternUnits="userSpaceOnUse"
              width="6"
              height="6"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="hsl(var(--muted))" />
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="6"
                stroke="hsl(var(--border))"
                strokeWidth="3"
              />
            </pattern>
          </defs>
          <path
            d="M 22 120 A 98 98 0 0 1 218 120"
            fill="none"
            stroke="url(#gauge-stripes)"
            strokeWidth="28"
          />
          <path
            d="M 22 120 A 98 98 0 0 1 218 120"
            fill="none"
            stroke="hsl(var(--chart-1))"
            strokeWidth="28"
            pathLength={100}
            strokeDasharray={`${pct} 100`}
          />
        </svg>
        <div className="absolute inset-x-0 bottom-0 text-center">
          <p className="text-[36px] font-semibold leading-none tracking-tight tabular-nums">
            {pct}
            {"%"}
          </p>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {"Faltan "}
            {formatMoney(remaining)}
          </p>
        </div>
      </div>
      <div className="mt-6 space-y-2.5">
        {breakdown.map((b) => (
          <div
            className="flex items-center justify-between text-sm"
            key={b.label}
          >
            <span className="flex items-center gap-2 text-muted-foreground">
              <span className={`h-1.5 w-4 rounded-full ${b.className}`} />
              {b.label}
            </span>
            <span className="font-medium tabular-nums">
              {formatMoney(b.value)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
export { SalesGoalGauge };

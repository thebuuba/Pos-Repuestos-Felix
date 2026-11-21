// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { cn } from "../../lib/utils.js";
function intensityClass(value, max) {
  const r = value / max;
  if (r >= 0.9) return "bg-primary";
  if (r >= 0.7) return "bg-primary/75";
  if (r >= 0.5) return "bg-primary/50";
  if (r >= 0.3) return "bg-primary/25";
  if (r > 0.15) return "bg-primary/10";
  return "bg-muted";
}
function PeakHoursHeatmap({ days, hours, values }) {
  const max = Math.max(...values.flat());
  return (
    <section className="flex h-full flex-col rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-medium">{"Horas pico"}</h2>
        <span className="text-xs text-muted-foreground">
          {"Facturas por hora"}
        </span>
      </div>
      <div className="mt-4 overflow-x-auto">
        <div className="min-w-[340px]">
          <div className="grid grid-cols-[32px_repeat(11,minmax(0,1fr))] gap-1.5">
            {days.map((day, d) => (
              <div className="contents" key={day}>
                <span className="flex items-center text-[11px] text-muted-foreground">
                  {day}
                </span>
                {hours.map((hour, h) => {
                  const v = values[d][h];
                  return (
                    <div
                      title={`${day} ${hour}: ${v} facturas`}
                      className={cn(
                        "aspect-square rounded-md transition-transform hover:scale-110",
                        intensityClass(v, max),
                      )}
                      key={hour}
                    />
                  );
                })}
              </div>
            ))}
            <span />
            {hours.map((hour, h) => (
              <span
                className="text-center text-[10px] text-muted-foreground"
                key={hour}
              >
                {h % 2 === 0 ? hour : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-end gap-1.5 text-[11px] text-muted-foreground">
        {"Menos"}
        <span className="h-3 w-3 rounded bg-muted" />
        <span className="h-3 w-3 rounded bg-primary/25" />
        <span className="h-3 w-3 rounded bg-primary/50" />
        <span className="h-3 w-3 rounded bg-primary/75" />
        <span className="h-3 w-3 rounded bg-primary" />
        {"Más"}
      </div>
    </section>
  );
}
export { PeakHoursHeatmap };

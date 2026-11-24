// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { cn } from "../../lib/utils.js";
import { Wrench } from "lucide-react";
function BrandLogo({ className, compact = false }) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
        <Wrench className="h-[18px] w-[18px] -rotate-45" strokeWidth={2.4} />
      </div>
      {!compact && (
        <div className="leading-tight">
          <p className="text-[15px] font-extrabold uppercase tracking-tight text-foreground">
            {"Rep."}
            <span className="text-primary">{"Felix"}</span>
          </p>
          <p className="text-[11px] font-medium text-muted-foreground">
            {"829-782-3872"}
          </p>
        </div>
      )}
    </div>
  );
}
export { BrandLogo };

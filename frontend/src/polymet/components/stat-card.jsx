// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { cn } from "../../lib/utils.js";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { MoneyDisplay } from "./money-display.jsx";
import { formatNumber } from "../lib/format.js";
import { TrendingUp } from "lucide-react";
import { TrendingDown } from "lucide-react";
function StatCard({
  title,
  value,
  format = "money",
  change,
  footer,
  to = "/",
  highlight = false,
}) {
  const positive = (change ?? 0) >= 0;
  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border p-5 transition-shadow hover:shadow-md",
        highlight
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p
          className={cn(
            "text-[15px] font-medium",
            highlight ? "text-primary-foreground/85" : "text-foreground",
          )}
        >
          {title}
        </p>
        <Link
          to={to}
          aria-label={`Ver ${title}`}
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors",
            highlight
              ? "bg-primary-foreground/15 hover:bg-primary-foreground/25"
              : "bg-muted hover:bg-accent hover:text-primary",
          )}
        >
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {format === "money" ? (
          <MoneyDisplay
            value={value}
            className="text-[30px] leading-tight"
            symbolClassName={cn(highlight && "text-primary-foreground/70")}
            centsClassName={cn(highlight && "text-primary-foreground/55")}
          />
        ) : (
          <span className="text-[30px] font-semibold leading-tight tracking-tight tabular-nums">
            {formatNumber(value)}
          </span>
        )}
        {change !== undefined && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
              highlight
                ? "bg-primary-foreground/15 text-primary-foreground"
                : positive
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-accent text-primary",
            )}
          >
            {positive ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {positive ? "+" : ""}
            {change}
            {"%"}
          </span>
        )}
      </div>
      <div
        className={cn(
          "mt-4 border-t pt-3 text-xs",
          highlight
            ? "border-primary-foreground/20 text-primary-foreground/75"
            : "border-border text-muted-foreground",
        )}
      >
        {footer}
      </div>
    </div>
  );
}
export { StatCard };

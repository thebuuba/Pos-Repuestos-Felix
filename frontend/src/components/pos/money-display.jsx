// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { splitMoney } from "../../lib/format.js";
import { cn } from "../../lib/utils.js";
import { CURRENCY } from "../../lib/format.js";
function MoneyDisplay({
  value,
  className,
  symbolClassName,
  centsClassName,
  showSymbol = true,
  showCents = true,
}) {
  const { whole, cents } = splitMoney(value);
  const displayCents = showCents || cents !== "00";
  return (
    <span
      className={cn(
        "inline-flex items-baseline font-semibold tabular-nums tracking-tight",
        className,
      )}
    >
      {showSymbol && (
        <span
          className={cn(
            "mr-1 text-[0.5em] font-medium text-muted-foreground",
            symbolClassName,
          )}
        >
          {CURRENCY}
        </span>
      )}
      {whole}
      {displayCents && (
        <span className={cn("text-muted-foreground/70", centsClassName)}>
          {"."}
          {cents}
        </span>
      )}
    </span>
  );
}
export { MoneyDisplay };

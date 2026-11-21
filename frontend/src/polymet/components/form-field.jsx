// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { cn } from "../../lib/utils.js";
import { Label3 } from "../../components/ui/label.jsx";
function Field({ label, htmlFor, hint, error, children, className }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label3
        htmlFor={htmlFor}
        className="text-xs font-medium text-muted-foreground"
      >
        {label}
      </Label3>
      {children}
      {error ? (
        <p className="text-[11px] font-medium text-primary">{error}</p>
      ) : (
        hint && <p className="text-[11px] text-muted-foreground">{hint}</p>
      )}
    </div>
  );
}
var inputClass = "h-10 rounded-xl bg-card";
export { Field, inputClass };

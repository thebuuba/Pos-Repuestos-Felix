// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { Switch } from "@radix-ui/react-switch";
import { cn } from "../../lib/utils.js";
import { SwitchThumb } from "@radix-ui/react-switch";
import * as React from "react";
var Switch2 = React.forwardRef(({ className, ...props }, ref) => (
  <Switch
    className={cn(
      "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input",
      className,
    )}
    {...props}
    ref={ref}
  >
    <SwitchThumb
      className={cn(
        "pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0",
      )}
    />
  </Switch>
));
Switch2.displayName = Switch.displayName;
export { Switch2 };

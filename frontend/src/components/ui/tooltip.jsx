// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { Tooltip } from "@radix-ui/react-tooltip";
import { TooltipTrigger } from "@radix-ui/react-tooltip";
import { TooltipPortal } from "@radix-ui/react-tooltip";
import { TooltipContent } from "@radix-ui/react-tooltip";
import { cn } from "../../lib/utils.js";
import * as React from "react";
var TooltipProvider2 = TooltipProvider;
var Tooltip2 = Tooltip;
var TooltipTrigger2 = TooltipTrigger;
var TooltipContent2 = React.forwardRef(
  ({ className, sideOffset = 4, ...props }, ref) => (
    <TooltipPortal>
      <TooltipContent
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          "z-50 overflow-hidden rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className,
        )}
        {...props}
      />
    </TooltipPortal>
  ),
);
TooltipContent2.displayName = TooltipContent.displayName;
export { TooltipProvider2, Tooltip2, TooltipTrigger2, TooltipContent2 };

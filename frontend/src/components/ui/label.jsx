// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { cva } from "class-variance-authority";
import { Label as Label2 } from "@radix-ui/react-label";
import { cn } from "../../lib/utils.js";
import * as React from "react";
var labelVariants = cva(
  "text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
);
var Label3 = React.forwardRef(({ className, ...props }, ref) => (
  <Label2 ref={ref} className={cn(labelVariants(), className)} {...props} />
));
Label3.displayName = Label2.displayName;
export { Label3 };

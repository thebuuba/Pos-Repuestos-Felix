// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { Accordion } from "@radix-ui/react-accordion";
import { AccordionItem } from "@radix-ui/react-accordion";
import { cn } from "../../lib/utils.js";
import { AccordionHeader } from "@radix-ui/react-accordion";
import { AccordionTrigger } from "@radix-ui/react-accordion";
import { ChevronDownIcon } from "@radix-ui/react-icons";
import { AccordionContent } from "@radix-ui/react-accordion";
import * as React from "react";
var Accordion2 = Accordion;
var AccordionItem2 = React.forwardRef(({ className, ...props }, ref) => (
  <AccordionItem ref={ref} className={cn("border-b", className)} {...props} />
));
AccordionItem2.displayName = "AccordionItem";
var AccordionTrigger2 = React.forwardRef(
  ({ className, children, ...props }, ref) => (
    <AccordionHeader className="flex">
      <AccordionTrigger
        ref={ref}
        className={cn(
          "flex flex-1 items-center justify-between py-4 text-sm font-medium transition-all hover:underline [&[data-state=open]>svg]:rotate-180",
          className,
        )}
        {...props}
      >
        {children}
        <ChevronDownIcon className="h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200" />
      </AccordionTrigger>
    </AccordionHeader>
  ),
);
AccordionTrigger2.displayName = AccordionTrigger.displayName;
var AccordionContent2 = React.forwardRef(
  ({ className, children, ...props }, ref) => (
    <AccordionContent
      ref={ref}
      className="overflow-hidden text-sm data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down"
      {...props}
    >
      <div className={cn("pb-4 pt-0", className)}>{children}</div>
    </AccordionContent>
  ),
);
AccordionContent2.displayName = AccordionContent.displayName;
export { Accordion2, AccordionItem2, AccordionTrigger2, AccordionContent2 };

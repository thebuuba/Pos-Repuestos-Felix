// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { Dialog } from "@radix-ui/react-dialog";
import { DialogPortal } from "@radix-ui/react-dialog";
import { DialogOverlay } from "@radix-ui/react-dialog";
import { cn } from "../../lib/utils.js";
import { DialogContent } from "@radix-ui/react-dialog";
import { DialogClose } from "@radix-ui/react-dialog";
import { Cross2Icon } from "@radix-ui/react-icons";
import { DialogTitle } from "@radix-ui/react-dialog";
import { DialogDescription } from "@radix-ui/react-dialog";
import * as React from "react";
var Dialog2 = Dialog;
var DialogPortal2 = DialogPortal;
var DialogOverlay2 = React.forwardRef(({ className, ...props }, ref) => (
  <DialogOverlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80  data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay2.displayName = DialogOverlay.displayName;
var DialogContent2 = React.forwardRef(
  ({ className, children, ...props }, ref) => (
    <DialogPortal2>
      <DialogOverlay2 />
      <DialogContent
        ref={ref}
        className={cn(
          "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
          className,
        )}
        {...props}
      >
        {children}
        <DialogClose className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
          <Cross2Icon className="h-4 w-4" />
          <span className="sr-only">{"Close"}</span>
        </DialogClose>
      </DialogContent>
    </DialogPortal2>
  ),
);
DialogContent2.displayName = DialogContent.displayName;
var DialogHeader = ({ className, ...props }) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";
var DialogFooter = ({ className, ...props }) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";
var DialogTitle2 = React.forwardRef(({ className, ...props }, ref) => (
  <DialogTitle
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className,
    )}
    {...props}
  />
));
DialogTitle2.displayName = DialogTitle.displayName;
var DialogDescription2 = React.forwardRef(({ className, ...props }, ref) => (
  <DialogDescription
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription2.displayName = DialogDescription.displayName;
export {
  Dialog2,
  DialogContent2,
  DialogHeader,
  DialogTitle2,
  DialogDescription2,
  DialogFooter,
};

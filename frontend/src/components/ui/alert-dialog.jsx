// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { AlertDialog } from "@radix-ui/react-alert-dialog";
import { AlertDialogPortal } from "@radix-ui/react-alert-dialog";
import { AlertDialogOverlay } from "@radix-ui/react-alert-dialog";
import { cn } from "../../lib/utils.js";
import { AlertDialogContent } from "@radix-ui/react-alert-dialog";
import { AlertDialogTitle } from "@radix-ui/react-alert-dialog";
import { AlertDialogDescription } from "@radix-ui/react-alert-dialog";
import { AlertDialogAction } from "@radix-ui/react-alert-dialog";
import { buttonVariants } from "./button.jsx";
import { AlertDialogCancel } from "@radix-ui/react-alert-dialog";
import * as React from "react";
var AlertDialog2 = AlertDialog;
var AlertDialogPortal2 = AlertDialogPortal;
var AlertDialogOverlay2 = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogOverlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
    ref={ref}
  />
));
AlertDialogOverlay2.displayName = AlertDialogOverlay.displayName;
var AlertDialogContent2 = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogPortal2>
    <AlertDialogOverlay2 />
    <AlertDialogContent
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className,
      )}
      {...props}
    />
  </AlertDialogPortal2>
));
AlertDialogContent2.displayName = AlertDialogContent.displayName;
var AlertDialogHeader = ({ className, ...props }) => (
  <div
    className={cn(
      "flex flex-col space-y-2 text-center sm:text-left",
      className,
    )}
    {...props}
  />
);
AlertDialogHeader.displayName = "AlertDialogHeader";
var AlertDialogFooter = ({ className, ...props }) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className,
    )}
    {...props}
  />
);
AlertDialogFooter.displayName = "AlertDialogFooter";
var AlertDialogTitle2 = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogTitle
    ref={ref}
    className={cn("text-lg font-semibold", className)}
    {...props}
  />
));
AlertDialogTitle2.displayName = AlertDialogTitle.displayName;
var AlertDialogDescription2 = React.forwardRef(
  ({ className, ...props }, ref) => (
    <AlertDialogDescription
      ref={ref}
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  ),
);
AlertDialogDescription2.displayName = AlertDialogDescription.displayName;
var AlertDialogAction2 = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogAction
    ref={ref}
    className={cn(buttonVariants(), className)}
    {...props}
  />
));
AlertDialogAction2.displayName = AlertDialogAction.displayName;
var AlertDialogCancel2 = React.forwardRef(({ className, ...props }, ref) => (
  <AlertDialogCancel
    ref={ref}
    className={cn(
      buttonVariants({
        variant: "outline",
      }),
      "mt-2 sm:mt-0",
      className,
    )}
    {...props}
  />
));
AlertDialogCancel2.displayName = AlertDialogCancel.displayName;
export {
  AlertDialog2,
  AlertDialogContent2,
  AlertDialogHeader,
  AlertDialogTitle2,
  AlertDialogDescription2,
  AlertDialogFooter,
  AlertDialogCancel2,
  AlertDialogAction2,
};

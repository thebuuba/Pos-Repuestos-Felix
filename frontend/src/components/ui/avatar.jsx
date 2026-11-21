// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { Avatar } from "@radix-ui/react-avatar";
import { cn } from "../../lib/utils.js";
import { AvatarImage } from "@radix-ui/react-avatar";
import { AvatarFallback } from "@radix-ui/react-avatar";
import * as React from "react";
var Avatar2 = React.forwardRef(({ className, ...props }, ref) => (
  <Avatar
    ref={ref}
    className={cn(
      "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
      className,
    )}
    {...props}
  />
));
Avatar2.displayName = Avatar.displayName;
var AvatarImage2 = React.forwardRef(({ className, ...props }, ref) => (
  <AvatarImage
    ref={ref}
    className={cn("aspect-square h-full w-full", className)}
    {...props}
  />
));
AvatarImage2.displayName = AvatarImage.displayName;
var AvatarFallback2 = React.forwardRef(({ className, ...props }, ref) => (
  <AvatarFallback
    ref={ref}
    className={cn(
      "flex h-full w-full items-center justify-center rounded-full bg-muted",
      className,
    )}
    {...props}
  />
));
AvatarFallback2.displayName = AvatarFallback.displayName;
export { Avatar2, AvatarImage2, AvatarFallback2 };

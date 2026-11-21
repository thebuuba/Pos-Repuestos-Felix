// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { twMerge } from "tailwind-merge";
import { clsx } from "clsx";
function cn(...inputs) {
  return twMerge(clsx(inputs));
}
export { cn };

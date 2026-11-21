// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { useTheme as j } from "next-themes";
import { Toaster as $e } from "sonner";
var Toaster = ({ ...props }) => {
  const { theme = "system" } = j();
  return (
    <$e
      theme={theme}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};
export { Toaster };

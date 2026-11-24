import { Keyboard } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.jsx";
import { MODULE_SHORTCUTS, filteredShortcutSections } from "../../data/keyboard-shortcuts.js";

export function ShortcutsDialog({ open, onOpenChange, isOwner = true, pathname = "" }) {
  const sections = filteredShortcutSections(isOwner, pathname);
  const primarySection = sections.find((s) => s.id === "ventas") ?? sections[0];
  const secondarySections = sections.filter((s) => s.id !== primarySection?.id);
  const modules = MODULE_SHORTCUTS.filter((m) => isOwner || !m.ownerOnly);

  const renderSection = (section) => (
    <div key={section.id} className="space-y-2.5 rounded-xl border border-border bg-muted/30 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {section.title}
      </h3>
      <ul className="space-y-2">
        {section.items.map((item) => (
          <li key={section.id + item.keys} className="flex items-start justify-between gap-3 text-xs">
            <span className="text-foreground leading-snug">{item.label}</span>
            <kbd className="shrink-0 rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-[11px] font-medium text-foreground">
              {item.keys}
            </kbd>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl gap-4 rounded-2xl p-6 overflow-y-auto"
        style={{ width: "calc(100vw - 2rem)", maxHeight: "calc(100dvh - 2rem)" }}
      >
        <DialogHeader className="text-left">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
              <Keyboard className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-lg">{"Atajos de teclado"}</DialogTitle>
              <DialogDescription className="text-xs">
                {"Opera ventas, compras y módulos desde el teclado sin interferir con el lector de códigos."}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid items-start gap-4 md:grid-cols-2">
          {primarySection && renderSection(primarySection)}
          <div className="space-y-4">
            {secondarySections.map(renderSection)}
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-border bg-card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {"Acceso directo a módulos"}
          </h3>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
            {modules.map((mod) => (
              <div key={mod.path} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-muted-foreground">{mod.label}</span>
                <kbd className="shrink-0 rounded-md border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                  {mod.shortcut}
                </kbd>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

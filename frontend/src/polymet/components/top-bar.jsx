// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { TooltipProvider2 } from "../../components/ui/tooltip.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Menu } from "lucide-react";
import { Search } from "lucide-react";
import { Input } from "../../components/ui/input.jsx";
import { RefreshCw } from "lucide-react";
import { cn } from "../../lib/utils.js";
import { Tooltip2 } from "../../components/ui/tooltip.jsx";
import { TooltipTrigger2 } from "../../components/ui/tooltip.jsx";
import { Download } from "lucide-react";
import { TooltipContent2 } from "../../components/ui/tooltip.jsx";
import { Sun } from "lucide-react";
import { Moon } from "lucide-react";
import { Bell } from "lucide-react";
import { LogOut } from "lucide-react";
import { toast } from "sonner";
import { useEffect } from "react";
import { useState } from "react";
import { usePosStore } from "../../data/pos-context.jsx";
var dateFormatter = new Intl.DateTimeFormat("es-DO", {
  timeZone: "America/Santo_Domingo",
  weekday: "long",
  day: "numeric",
  month: "short",
});
var timeFormatter = new Intl.DateTimeFormat("es-DO", {
  timeZone: "America/Santo_Domingo",
  hour: "numeric",
  minute: "2-digit",
});
function TopBar({ onOpenMenu }) {
  const { runtime } = usePosStore();
  const [now, setNow] = useState(() => new Date());
  const [dark, setDark] = useState(false);
  const [demoSyncing, setSyncing] = useState(false);
  const syncing = runtime ? runtime.busy : demoSyncing;
  const connected = !runtime || runtime.connection === "connected";
  const serviceStatus = connected ? "Conectado" : runtime.connection === "checking" ? "Verificando…" : "Sin conexión al servicio";
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  const handleSync = () => {
    if (runtime) {
      runtime.reload().catch(() => {});
      return;
    }
    setSyncing(true);
    window.setTimeout(() => setSyncing(false), 1200);
  };
  return (
    <TooltipProvider2 delayDuration={200}>
      <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card/85 px-4 backdrop-blur-md lg:px-6">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={onOpenMenu}
          aria-label="Abrir menú"
        >
          <Menu />
        </Button>
        <div className="relative hidden w-full max-w-sm md:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            disabled={!!runtime}
            placeholder="Buscar producto, cliente o factura…"
            className="h-10 rounded-xl border-transparent bg-muted pl-9 pr-14 shadow-none focus-visible:bg-card"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {"Ctrl K"}
          </kbd>
        </div>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <div className="hidden items-center gap-3 pr-2 xl:flex">
            <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", connected ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
              <span className="relative flex h-2 w-2">
                {connected && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />}
                <span className={cn("relative inline-flex h-2 w-2 rounded-full", connected ? "bg-emerald-500" : "bg-muted-foreground")} />
              </span>
              {serviceStatus}
            </span>
            <div className="text-right leading-tight">
              <p className="text-sm font-semibold tabular-nums text-foreground">
                {timeFormatter.format(now)}
              </p>
              <p className="text-[11px] capitalize text-muted-foreground">
                {dateFormatter.format(now)}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            className={cn("h-10 rounded-xl bg-card", !runtime && "hidden sm:inline-flex")}
            aria-label="Actualizar datos"
            disabled={!!runtime && syncing}
            onClick={handleSync}
          >
            <RefreshCw className={cn(syncing && "animate-spin")} />
            <span className="hidden lg:inline">
              {syncing ? "Actualizando…" : "Actualizar datos"}
            </span>
          </Button>
          <Tooltip2>
            <TooltipTrigger2 asChild={true}>
              <Button
                variant="outline"
                size="icon"
                className="hidden h-10 w-10 rounded-xl bg-card sm:inline-flex"
                aria-label="Instalar app"
                disabled={!!runtime}
              >
                <Download />
              </Button>
            </TooltipTrigger2>
            <TooltipContent2>{"Instalar app"}</TooltipContent2>
          </Tooltip2>
          <Tooltip2>
            <TooltipTrigger2 asChild={true}>
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 rounded-xl bg-card"
                onClick={() => setDark((d) => !d)}
                aria-label="Cambiar tema"
              >
                {dark ? <Sun /> : <Moon />}
              </Button>
            </TooltipTrigger2>
            <TooltipContent2>
              {dark ? "Modo claro" : "Modo oscuro"}
            </TooltipContent2>
          </Tooltip2>
          <Button
            variant="outline"
            size="icon"
            className="relative h-10 w-10 rounded-xl bg-card"
            aria-label="Notificaciones"
            disabled={!!runtime}
          >
            <Bell />
            {(!runtime || runtime.pending || runtime.error) && <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-primary ring-2 ring-card" />}
          </Button>
          {runtime?.logout && <Button variant="outline" size="icon" className="h-10 w-10 rounded-xl bg-card" aria-label="Cerrar sesión"
            onClick={() => runtime.logout().catch(error => toast.error(error.message))}><LogOut /></Button>}
        </div>
      </header>
    </TooltipProvider2>
  );
}
export { TopBar };

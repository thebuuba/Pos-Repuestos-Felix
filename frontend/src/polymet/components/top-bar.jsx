// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { TooltipProvider2 } from "../../components/ui/tooltip.jsx";
import { Button } from "../../components/ui/button.jsx";
import { Link, useNavigate } from "react-router-dom";
import { BrandLogo } from "./brand-logo.jsx";
import { Search, RefreshCw, Download, Sun, Moon, Bell, LogOut, Box, Users, Truck, ReceiptText, AlertTriangle } from "lucide-react";
import { Input } from "../../components/ui/input.jsx";
import { cn } from "../../lib/utils.js";
import { Tooltip2, TooltipTrigger2, TooltipContent2 } from "../../components/ui/tooltip.jsx";
import { Dialog2, DialogContent2, DialogHeader, DialogTitle2, DialogDescription2 } from "../../components/ui/dialog.jsx";
import { toast } from "sonner";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePosStore } from "../../data/pos-context.jsx";
import { usePwa } from "../../pwa.jsx";
import { DesktopSyncStatus } from "../../desktop-status.jsx";
import { SalesScanner } from './sales-scanner.jsx';
import { formatMoney } from "../lib/format.js";

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

function TopBar({ onBrandClick } = {}) {
  const { runtime, products = [], customers = [], suppliers = [], sales = [], settings, cashSession } = usePosStore();
  const navigate = useNavigate();
  const pwa = usePwa();
  const [now, setNow] = useState(() => new Date());
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const [demoSyncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const searchRef = useRef(null);
  const searchBoxRef = useRef(null);
  const syncing = runtime ? runtime.busy : demoSyncing;
  const connected = !runtime || runtime.connection === "connected";
  const desktop = !!window.__FELIX_DESKTOP__;
  const isOwner = !runtime || runtime.isOwner !== false;
  const serviceStatus = connected ? "Conectado" : runtime.connection === "checking" ? "Verificando…" : "Sin conexión al servicio";

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    if (runtime) try { localStorage.setItem('felix-theme', dark ? 'dark' : 'light'); } catch { /* Keep the current theme in memory. */ }
  }, [dark, !!runtime]);
  useEffect(() => {
    const onKey = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
        setSearchOpen(true);
      } else if (event.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
      }
    };
    const onClickOutside = (event) => {
      if (searchBoxRef.current && !searchBoxRef.current.contains(event.target)) setSearchOpen(false);
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClickOutside);
    };
  }, [searchOpen]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const items = [];
    for (const p of products) {
      if (p.code.toLowerCase().includes(q) || (p.altCodes || []).some(c => c.toLowerCase().includes(q)) ||
          p.name.toLowerCase().includes(q) || (p.brand || "").toLowerCase().includes(q)) {
        items.push({ kind: "Producto", icon: Box, title: p.name, subtitle: `${p.code} · Stock ${p.stock} · ${formatMoney(p.prices.p1)}`, to: `/inventario?buscar=${encodeURIComponent(p.code)}` });
        if (items.length >= 5) break;
      }
    }
    let count = 0;
    for (const c of customers) {
      if (c.name.toLowerCase().includes(q) || (c.rnc || "").toLowerCase().includes(q) || (c.phone || "").toLowerCase().includes(q)) {
        items.push({ kind: "Cliente", icon: Users, title: c.name, subtitle: c.rnc ? `RNC ${c.rnc}` : c.phone || "Cliente", to: `/clientes?buscar=${encodeURIComponent(c.name)}` });
        if (++count >= 3) break;
      }
    }
    if (isOwner) {
      count = 0;
      for (const s of suppliers) {
        if (s.name.toLowerCase().includes(q) || (s.rnc || "").toLowerCase().includes(q) || (s.contact || "").toLowerCase().includes(q)) {
          items.push({ kind: "Suplidor", icon: Truck, title: s.name, subtitle: s.contact || s.phone || "Suplidor", to: `/suplidores?buscar=${encodeURIComponent(s.name)}` });
          if (++count >= 3) break;
        }
      }
    }
    count = 0;
    for (const sale of sales) {
      if ((sale.number || "").toLowerCase().includes(q) || (sale.ncf || "").toLowerCase().includes(q) || (sale.customerName || "").toLowerCase().includes(q)) {
        const ref = sale.ncf || sale.number;
        items.push({ kind: "Factura", icon: ReceiptText, title: ref, subtitle: `${sale.customerName} · ${formatMoney(sale.total)}`, to: isOwner ? `/reportes?buscar=${encodeURIComponent(ref)}` : "/ventas" });
        if (++count >= 3) break;
      }
    }
    return items;
  }, [searchQuery, products, customers, suppliers, sales, isOwner]);

  const notifications = useMemo(() => {
    const list = [];
    if (runtime && !cashSession?.open) {
      list.push({ id: 'cash-closed', tone: 'warning', title: 'Caja cerrada',
        description: 'Abre la caja para registrar ventas y cobros en efectivo.', to: '/caja' });
    }
    const lowStock = products.filter(p => p.notifyMinStock !== false && p.stock <= p.minStock);
    const outOfStock = lowStock.filter(p => p.stock <= 0);
    if (outOfStock.length) {
      list.push({ id: 'out', tone: 'primary', title: `${outOfStock.length} ${outOfStock.length === 1 ? 'artículo agotado' : 'artículos agotados'}`,
        description: outOfStock.slice(0, 3).map(p => p.name).join(', '), to: '/inventario?existencia=out' });
    }
    if (lowStock.length > outOfStock.length) {
      const n = lowStock.length - outOfStock.length;
      list.push({ id: 'low', tone: 'warning', title: `${n} ${n === 1 ? 'artículo bajo mínimo' : 'artículos bajo mínimo'}`,
        description: 'Revisa las alertas de reposición en Inventario.', to: '/inventario?existencia=low' });
    }
    const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(now);
    for (const seq of (settings?.ncf || [])) {
      if (!seq.active) continue;
      const remaining = seq.end - seq.current;
      if (seq.expiresAt < todayIso) {
        list.push({ id: 'ncf-exp-' + seq.type, tone: 'primary', title: `Secuencia NCF ${seq.type} vencida`,
          description: `Venció el ${seq.expiresAt}. Actualízala en Configuración.`, to: '/configuracion' });
      } else if (remaining <= 20) {
        list.push({ id: 'ncf-low-' + seq.type, tone: 'warning', title: `Secuencia NCF ${seq.type} por agotarse`,
          description: `Quedan ${remaining} comprobantes disponibles.`, to: '/configuracion' });
      }
    }
    const hasPending = Boolean(runtime?.pending && runtime.inFlightOperationId !== runtime.pending.id);
    if (hasPending) {
      list.push({ id: 'pending', tone: 'primary', title: 'Solicitud pendiente de confirmación',
        description: 'Revisa el aviso en la parte superior para confirmar o archivar.', to: '/ventas' });
    }
    return list;
  }, [products, settings?.ncf, runtime?.pending, runtime?.inFlightOperationId, runtime, cashSession?.open, now]);

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
        <Link to="/ventas" className="lg:hidden" aria-label="Repuestos Félix · Ventas" onClick={onBrandClick}><BrandLogo compact /></Link>
        <div ref={searchBoxRef} className="relative hidden w-full max-w-sm md:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && searchResults[0]) {
                e.preventDefault();
                navigate(searchResults[0].to);
                setSearchQuery("");
                setSearchOpen(false);
              }
            }}
            aria-label="Buscar en el sistema"
            placeholder="Buscar producto, cliente o factura…"
            className="h-10 rounded-xl border-transparent bg-muted pl-9 pr-14 shadow-none focus-visible:bg-card"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {"Ctrl K"}
          </kbd>
          {searchOpen && searchQuery.trim() && (
            <div role="listbox" aria-label="Resultados de búsqueda" className="absolute left-0 right-0 top-full z-40 mt-1.5 max-h-80 overflow-y-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-lg">
              {searchResults.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">Sin coincidencias para «{searchQuery.trim()}».</p>
              ) : (
                searchResults.map((item, idx) => {
                  const Icon = item.icon;
                  return (
                    <button
                      type="button"
                      role="option"
                      key={item.kind + idx + item.title}
                      onClick={() => { navigate(item.to); setSearchQuery(""); setSearchOpen(false); }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-muted"
                    >
                      <Icon className="h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{item.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>
                      </span>
                      <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{item.kind}</span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <div className="hidden items-center gap-3 pr-2 xl:flex">
            {!desktop && <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", connected ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
              <span className="relative flex h-2 w-2">
                {connected && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />}
                <span className={cn("relative inline-flex h-2 w-2 rounded-full", connected ? "bg-emerald-500" : "bg-muted-foreground")} />
              </span>
              {serviceStatus}
            </span>}
            <div className="text-right leading-tight">
              <p className="text-sm font-semibold tabular-nums text-foreground">
                {timeFormatter.format(now)}
              </p>
              <p className="text-[11px] capitalize text-muted-foreground">
                {dateFormatter.format(now)}
              </p>
            </div>
          </div>
          {desktop ? <DesktopSyncStatus onSync={() => runtime?.reload?.({ background: true })} /> : <Button
            variant="outline"
            className="desktop-data-refresh h-10 rounded-xl bg-card"
            aria-label="Actualizar datos"
            disabled={!!runtime && syncing}
            onClick={handleSync}
          >
            <RefreshCw className={cn(syncing && "animate-spin")} />
            <span className="hidden lg:inline">
              {syncing ? "Actualizando…" : "Actualizar datos"}
            </span>
          </Button>}
          {(!runtime || (pwa && !pwa.installed)) && <Tooltip2>
            <TooltipTrigger2 asChild={true}>
              <Button
                variant="outline"
                size="icon"
                className={cn("h-10 w-10 rounded-xl bg-card", !runtime && "hidden sm:inline-flex")}
                aria-label="Instalar app"
                onClick={pwa?.openHelp}
              >
                <Download />
              </Button>
            </TooltipTrigger2>
            <TooltipContent2>{"Instalar app"}</TooltipContent2>
          </Tooltip2>}
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
          {runtime && <SalesScanner />}
          <Button
            variant="outline"
            size="icon"
            className="desktop-notifications relative h-10 w-10 rounded-xl bg-card"
            aria-label="Notificaciones"
            onClick={() => setNotifOpen(true)}
          >
            <Bell />
            {(notifications.length > 0 || runtime?.error) && <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-primary ring-2 ring-card" />}
          </Button>
          {runtime?.logout && <Button variant="outline" size="icon" className="h-10 w-10 rounded-xl bg-card" aria-label="Cerrar sesión"
            onClick={() => runtime.logout().catch(error => toast.error(error.message))}><LogOut /></Button>}
        </div>
      </header>
      <Dialog2 open={notifOpen} onOpenChange={setNotifOpen}>
        <DialogContent2 className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle2>Notificaciones</DialogTitle2>
            <DialogDescription2>Alertas actuales de inventario, comprobantes y estado del servicio.</DialogDescription2>
          </DialogHeader>
          {notifications.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Todo está al día. No hay alertas activas.</p>
          ) : (
            <ul className="space-y-2">
              {notifications.map(n => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => { setNotifOpen(false); navigate(n.to); }}
                    className="flex w-full items-start gap-3 rounded-xl border border-border bg-card p-3 text-left text-sm hover:bg-muted"
                  >
                    <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", n.tone === 'primary' ? 'text-primary' : 'text-amber-600')} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{n.title}</span>
                      <span className="block text-xs text-muted-foreground">{n.description}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent2>
      </Dialog2>
    </TooltipProvider2>
  );
}
export { TopBar };

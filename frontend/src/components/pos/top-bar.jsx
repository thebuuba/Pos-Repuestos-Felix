// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { TooltipProvider } from "../ui/tooltip.jsx";
import { Button } from "../ui/button.jsx";
import { Link, useNavigate } from "react-router-dom";
import { BrandLogo } from "./brand-logo.jsx";
import { Search, RefreshCw, Download, Sun, Moon, Bell, Box, Users, Truck, ReceiptText, AlertTriangle, CornerDownLeft } from "lucide-react";
import { Input } from "../ui/input.jsx";
import { cn } from "../../lib/utils.js";
import { Tooltip, TooltipTrigger, TooltipContent } from "../ui/tooltip.jsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "../ui/dialog.jsx";
import { toast } from "sonner";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { usePosStore } from "../../data/pos-context.jsx";
import { usePwa } from "../../pwa.jsx";
import { DesktopSyncStatus } from "../../desktop-status.jsx";
import { SalesScanner } from './sales-scanner.jsx';
import { formatMoney } from "../../lib/format.js";
import { businessTodayIso } from "../../lib/dates.js";
import { searchTopProducts } from "../../data/product-search.js";
import { EXTRA_MODULES, MODULE_SHORTCUTS } from "../../data/keyboard-shortcuts.js";

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

function TopBarClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="text-right leading-tight">
      <p className="text-sm font-semibold tabular-nums text-foreground">
        {timeFormatter.format(now)}
      </p>
      <p className="text-[11px] capitalize text-muted-foreground">
        {dateFormatter.format(now)}
      </p>
    </div>
  );
}

function TopBar({ onBrandClick } = {}) {
  const { runtime, products = [], customers = [], suppliers = [], sales = [], settings, cashSession } = usePosStore();
  const navigate = useNavigate();
  const pwa = usePwa();
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const [demoSyncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const searchRef = useRef(null);
  const searchBoxRef = useRef(null);
  const optionRefs = useRef([]);
  const syncing = runtime ? runtime.busy : demoSyncing;
  const connected = !runtime || runtime.connection === "connected";
  const desktop = !!window.__FELIX_DESKTOP__;
  const isOwner = !runtime || runtime.isOwner !== false;
  const serviceStatus = connected ? "Conectado" : runtime.connection === "checking" ? "Verificando…" : "Sin conexión al servicio";

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
        searchRef.current?.select();
        setHighlight(0);
        setSearchOpen(true);
      } else if (event.key === 'Escape' && searchOpen) {
        event.preventDefault();
        setSearchOpen(false);
        searchRef.current?.blur();
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

  const buildSearchResults = (raw) => {
    const q = raw.trim().toLowerCase();
    if (!q) return [];
    const items = [];
    for (const p of searchTopProducts(products, raw, 5)) {
      items.push({ kind: "Producto", icon: Box, title: p.name, subtitle: `${p.code} · Stock ${p.stock} · ${formatMoney(p.prices.p1)}`, to: `/inventario?buscar=${encodeURIComponent(p.code)}` });
    }
    let count = 0;
    for (const c of customers) {
      if (c.isCashCustomer) continue;
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
    if (isOwner) {
      count = 0;
      for (const sale of sales) {
        if ((sale.number || "").toLowerCase().includes(q) || (sale.ncf || "").toLowerCase().includes(q) || (sale.customerName || "").toLowerCase().includes(q)) {
          const ref = sale.ncf || sale.number;
          items.push({ kind: "Factura", icon: ReceiptText, title: ref, subtitle: `${sale.customerName} · ${formatMoney(sale.total)}`, to: `/reportes?buscar=${encodeURIComponent(ref)}` });
          if (++count >= 3) break;
        }
      }
    }
    const navMods = [...MODULE_SHORTCUTS, ...EXTRA_MODULES];
    let modCount = 0;
    for (const mod of navMods) {
      if (mod.ownerOnly && !isOwner) continue;
      const hay = `${mod.label} ${mod.keywords || ""} ${mod.shortcut || ""}`.toLowerCase();
      if (hay.includes(q)) {
        items.push({ kind: "Módulo", icon: CornerDownLeft, title: mod.label, subtitle: mod.shortcut ? `Atajo ${mod.shortcut}` : "Ir a esta pantalla", to: mod.path });
        if (++modCount >= 4) break;
      }
    }
    return items;
  };
  const searchResults = useMemo(
    () => buildSearchResults(deferredSearchQuery),
    [deferredSearchQuery, products, customers, suppliers, sales, isOwner],
  );
  useEffect(() => {
    setHighlight((h) => (searchResults.length === 0 ? 0 : Math.min(h, searchResults.length - 1)));
  }, [searchResults.length]);
  useEffect(() => {
    if (!searchOpen) return;
    optionRefs.current[highlight]?.scrollIntoView?.({ block: "nearest" });
  }, [highlight, searchOpen]);

  const stockAlerts = useMemo(() => {
    const outNames = [];
    let outCount = 0;
    let lowCount = 0;
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      if (p.notifyMinStock === false || p.stock > p.minStock) continue;
      if (p.stock <= 0) {
        outCount++;
        if (outNames.length < 3) outNames.push(p.name);
      } else {
        lowCount++;
      }
    }
    const list = [];
    if (outCount) {
      list.push({ id: 'out', tone: 'primary', title: `${outCount} ${outCount === 1 ? 'artículo agotado' : 'artículos agotados'}`,
        description: outNames.join(', '), to: '/inventario?existencia=out' });
    }
    if (lowCount) {
      list.push({ id: 'low', tone: 'warning', title: `${lowCount} ${lowCount === 1 ? 'artículo bajo mínimo' : 'artículos bajo mínimo'}`,
        description: 'Revisa las alertas de reposición en Inventario.', to: '/inventario?existencia=low' });
    }
    return list;
  }, [products]);

  const hasRuntime = Boolean(runtime);
  const pendingId = runtime?.pending?.id ?? null;
  const inFlightId = runtime?.inFlightOperationId ?? null;
  const notifications = useMemo(() => {
    const list = [];
    if (hasRuntime && !cashSession?.open) {
      list.push({ id: 'cash-closed', tone: 'warning', title: 'Caja cerrada',
        description: 'Abre la caja para registrar ventas y cobros en efectivo.', to: '/caja' });
    }
    list.push(...stockAlerts);
    if (isOwner) {
      const todayIso = businessTodayIso();
      for (const seq of (settings?.ncf || [])) {
        if (!seq.active) continue;
        const remaining = seq.end - seq.current;
        if (seq.expiresAt < todayIso) {
          list.push({ id: 'ncf-exp-' + seq.type, tone: 'primary', title: `Secuencia NCF ${seq.type} vencida`,
            description: `Venció el ${seq.expiresAt}. Actualízala en Configuración.`, to: '/configuracion' });
        } else if (remaining <= 0) {
          list.push({ id: 'ncf-empty-' + seq.type, tone: 'primary', title: `Secuencia NCF ${seq.type} agotada`,
            description: 'No quedan comprobantes disponibles. Configura un nuevo rango.', to: '/configuracion' });
        } else if (remaining <= 20) {
          list.push({ id: 'ncf-low-' + seq.type, tone: 'warning', title: `Secuencia NCF ${seq.type} por agotarse`,
            description: `Quedan ${remaining} comprobantes disponibles.`, to: '/configuracion' });
        }
      }
    }
    if (pendingId && inFlightId !== pendingId) {
      list.push({ id: 'pending', tone: 'primary', title: 'Solicitud pendiente de confirmación',
        description: 'Revisa el aviso en la parte superior para confirmar o archivar.', to: '/ventas' });
    }
    return list;
  }, [stockAlerts, settings?.ncf, pendingId, inFlightId, hasRuntime, cashSession?.open, isOwner]);

  const handleSync = () => {
    if (runtime) {
      runtime.reload().catch(() => {});
      return;
    }
    setSyncing(true);
    window.setTimeout(() => setSyncing(false), 1200);
  };

  return (
    <TooltipProvider delayDuration={200}>
      <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-card/85 px-4 backdrop-blur-md lg:px-6">
        <Link to="/ventas" className="lg:hidden" aria-label="Repuestos Félix · Ventas" onClick={onBrandClick}><BrandLogo compact /></Link>
        <div ref={searchBoxRef} className="relative hidden w-full max-w-sm md:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setHighlight(0); setSearchOpen(true); }}
            onFocus={() => setSearchOpen(true)}
            onKeyDown={(e) => {
              const immediate = searchQuery === deferredSearchQuery ? searchResults : buildSearchResults(searchQuery);
              if (e.key === 'ArrowDown') {
                if (immediate.length > 0) {
                  e.preventDefault();
                  setSearchOpen(true);
                  setHighlight((h) => (h + 1) % immediate.length);
                }
              } else if (e.key === 'ArrowUp') {
                if (immediate.length > 0) {
                  e.preventDefault();
                  setSearchOpen(true);
                  setHighlight((h) => (h - 1 + immediate.length) % immediate.length);
                }
              } else if (e.key === 'Home' && searchOpen && immediate.length > 0) {
                e.preventDefault();
                setHighlight(0);
              } else if (e.key === 'End' && searchOpen && immediate.length > 0) {
                e.preventDefault();
                setHighlight(immediate.length - 1);
              } else if (e.key === 'Enter') {
                const chosen = immediate[highlight] ?? immediate[0];
                if (chosen) {
                  e.preventDefault();
                  navigate(chosen.to);
                  setSearchQuery("");
                  setHighlight(0);
                  setSearchOpen(false);
                  searchRef.current?.blur();
                }
              }
            }}
            aria-label="Buscar en el sistema"
            placeholder="Buscar producto, cliente, factura o módulo…"
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
                  const active = idx === highlight;
                  return (
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      ref={(el) => { optionRefs.current[idx] = el; }}
                      key={item.kind + idx + item.title}
                      onMouseEnter={() => setHighlight(idx)}
                      onClick={() => { navigate(item.to); setSearchQuery(""); setHighlight(0); setSearchOpen(false); }}
                      className={cn(
                        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                        active ? "bg-muted text-foreground" : "hover:bg-muted",
                      )}
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
            <TopBarClock />
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
          {(!runtime || (pwa && !pwa.installed)) && <Tooltip>
            <TooltipTrigger asChild={true}>
              <Button
                variant="outline"
                size="icon"
                className={cn("h-10 w-10 rounded-xl bg-card", !runtime && "hidden sm:inline-flex")}
                aria-label="Instalar app"
                onClick={pwa?.openHelp}
              >
                <Download />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{"Instalar app"}</TooltipContent>
          </Tooltip>}
          <Tooltip>
            <TooltipTrigger asChild={true}>
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 rounded-xl bg-card"
                onClick={() => setDark((d) => !d)}
                aria-label="Cambiar tema"
              >
                {dark ? <Sun /> : <Moon />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {dark ? "Modo claro" : "Modo oscuro"}
            </TooltipContent>
          </Tooltip>
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
        </div>
      </header>
      <Dialog open={notifOpen} onOpenChange={setNotifOpen}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle>Notificaciones</DialogTitle>
            <DialogDescription>Alertas actuales de inventario, comprobantes y estado del servicio.</DialogDescription>
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
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
export { TopBar };

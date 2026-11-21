// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { useLocation } from "react-router-dom";
import { usePosStore } from "../../data/pos-context.jsx";
import { balanceOf } from "../lib/accounts.js";
import { cn } from "../../lib/utils.js";
import { Link } from "react-router-dom";
import { BrandLogo } from "./brand-logo.jsx";
import { NAV_GROUPS } from "../data/navigation.js";
import { Avatar2 } from "../../components/ui/avatar.jsx";
import { AvatarImage2 } from "../../components/ui/avatar.jsx";
import { AvatarFallback2 } from "../../components/ui/avatar.jsx";
import { formatTime } from "../lib/accounts.js";
import { formatMoney } from "../lib/format.js";
import { Button } from "../../components/ui/button.jsx";
import { Lock } from "lucide-react";
import { LockOpen } from "lucide-react";
function isActive(item, pathname) {
  return item.path === "/"
    ? pathname === "/"
    : pathname === item.path || pathname.startsWith(`${item.path}/`);
}
function AppSidebar({ onNavigate, className }) {
  const { pathname } = useLocation();
  const { receivables, payables, products, cashSession, cashSummary, cashierAvatar } =
    usePosStore();
  const badges = {
    "/cuentas-por-cobrar": receivables?.filter((r) => balanceOf(r) > 0).length,
    "/cuentas-por-pagar": payables?.filter((p) => balanceOf(p) > 0).length,
    "/inventario": products.filter((p) => p.stock <= p.minStock).length,
  };
  return (
    <div
      className={cn(
        "flex h-full w-full flex-col bg-sidebar text-sidebar-foreground",
        className,
      )}
    >
      <div className="flex h-16 shrink-0 items-center px-5">
        <Link to="/" onClick={onNavigate}>
          <BrandLogo />
        </Link>
      </div>
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4 pt-3">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
              {group.label}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item, pathname);
                const Icon = item.icon;
                const badge = badges[item.path];
                return (
                  <li className="relative" key={item.path}>
                    {active && (
                      <span className="absolute -left-3 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-primary" />
                    )}
                    <Link
                      to={item.path}
                      onClick={onNavigate}
                      className={cn(
                        "group flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground"
                          : "text-sidebar-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-[18px] w-[18px] shrink-0",
                          active
                            ? "text-primary"
                            : "text-muted-foreground group-hover:text-foreground",
                        )}
                      />
                      <span className="flex-1 truncate">{item.label}</span>
                      {badge > 0 && (
                        <span
                          className={cn(
                            "flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold",
                            active
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-foreground",
                          )}
                        >
                          {badge}
                        </span>
                      )}
                      {item.shortcut && !badge && (
                        <kbd className="hidden rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground xl:inline-block">
                          {item.shortcut}
                        </kbd>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      {cashSession && <div className="shrink-0 p-3">
        <div className="relative overflow-hidden rounded-2xl bg-foreground p-4 text-background">
          <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-primary/40 blur-2xl" />
          <div className="relative flex items-center gap-3">
            <Avatar2 className="h-9 w-9 ring-2 ring-background/20">
              <AvatarImage2 src={cashierAvatar} />
              <AvatarFallback2>{"FR"}</AvatarFallback2>
            </Avatar2>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold">
                {cashSession.cashier}
              </p>
              <p className="flex items-center gap-1.5 text-[11px] text-background/60">
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    cashSession.open ? "bg-emerald-400" : "bg-background/40",
                  )}
                />
                {cashSession.open
                  ? `Caja 01 · abierta ${formatTime(cashSession.openedAt)}`
                  : "Caja 01 · cerrada"}
              </p>
            </div>
          </div>
          <div className="relative mt-4">
            <p className="text-[11px] text-background/60">
              {cashSession.open
                ? "Efectivo esperado en caja"
                : "Abre la caja para vender"}
            </p>
            <p className="text-lg font-semibold tabular-nums">
              {cashSession.open ? formatMoney(cashSummary.expected) : "—"}
            </p>
          </div>
          <Button
            asChild={true}
            size="sm"
            className="relative mt-3 w-full rounded-xl bg-background text-foreground hover:bg-background/90"
          >
            <Link to="/caja" onClick={onNavigate}>
              {cashSession.open ? <Lock /> : <LockOpen />}
              {cashSession.open ? "Cerrar caja" : "Abrir caja"}
            </Link>
          </Button>
        </div>
      </div>}
    </div>
  );
}
export { AppSidebar };

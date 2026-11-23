// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { usePosStore } from "../../data/pos-context.jsx";
import { balanceOf } from "../../lib/accounts.js";
import { needsRestock } from "./inventory-table.jsx";
import { cn } from "../../lib/utils.js";
import { Link } from "react-router-dom";
import { BrandLogo } from "./brand-logo.jsx";
import { NAV_GROUPS } from "../../data/navigation.js";
function isActive(item, pathname) {
  return item.path === "/"
    ? pathname === "/"
    : pathname === item.path || pathname.startsWith(`${item.path}/`);
}
const OWNER_ONLY_PATHS = new Set(["/compras", "/suplidores", "/reportes", "/cuentas-por-pagar"]);
// Polymet's menu list, shared by the desktop sidebar and the phone «Más» panel.
function SidebarNav({ onNavigate, className, groupsClassName, touch = false, ...props }) {
  const { pathname } = useLocation();
  const { receivables, payables, products, runtime } =
    usePosStore();
  const isOwner = !runtime || runtime.isOwner;
  const groups = useMemo(() => NAV_GROUPS.map((group) => ({
    ...group,
    items: isOwner ? group.items : group.items.filter((item) => !OWNER_ONLY_PATHS.has(item.path)),
  })).filter((group) => group.items.length > 0), [isOwner]);
  const badges = useMemo(() => {
    let lowStock = 0;
    for (let i = 0; i < products.length; i++) {
      if (needsRestock(products[i])) lowStock++;
    }
    return {
      "/cuentas-por-cobrar": receivables?.filter((r) => balanceOf(r) > 0).length,
      "/cuentas-por-pagar": payables?.filter((p) => balanceOf(p) > 0).length,
      "/inventario": lowStock,
    };
  }, [receivables, payables, products]);
  return (
    <nav className={className} {...props}>
      <div className={cn("space-y-6", groupsClassName)}>
        {groups.map((group) => (
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
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group flex items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
                        touch ? "h-11" : "h-10",
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
                      {item.shortcut && !badge && !touch && (
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
      </div>
    </nav>
  );
}
function AppSidebar({ onNavigate, className }) {
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
      <SidebarNav
        onNavigate={onNavigate}
        className="flex-1 overflow-y-auto px-3 pb-4 pt-3"
      />
    </div>
  );
}
export { AppSidebar, SidebarNav };

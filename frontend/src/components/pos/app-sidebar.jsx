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
import { Button } from "../ui/button.jsx";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../ui/tooltip.jsx";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
function isActive(item, pathname) {
  return item.path === "/"
    ? pathname === "/"
    : pathname === item.path || pathname.startsWith(`${item.path}/`);
}
const OWNER_ONLY_PATHS = new Set(["/compras", "/suplidores", "/reportes", "/cuentas-por-pagar"]);
// Polymet's menu list, shared by the desktop sidebar and the phone «Más» panel.
function SidebarNav({ onNavigate, className, groupsClassName, touch = false, collapsed = false, ...props }) {
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
  if (collapsed) {
    return (
      <nav className={className} {...props}>
        <div className={cn("pos-sidebar-mini-groups", groupsClassName)}>
          {groups.map((group, groupIndex) => (
            <div key={group.label} className="pos-sidebar-mini-group">
              {groupIndex > 0 && <div className="pos-sidebar-mini-divider" aria-hidden="true" />}
              <ul className="pos-sidebar-mini-list">
                {group.items.map((item) => {
                  const active = isActive(item, pathname);
                  const Icon = item.icon;
                  const badge = badges[item.path];
                  const tooltipText = badge > 0 ? `${item.label} (${badge})` : item.label;
                  return (
                    <li className="pos-sidebar-mini-item" key={item.path}>
                      {active && <span className="pos-sidebar-mini-indicator" aria-hidden="true" />}
                      <Tooltip>
                        <TooltipTrigger asChild={true}>
                          <Link
                            to={item.path}
                            onClick={onNavigate}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "pos-sidebar-mini-link group transition-colors",
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
                            <span className="pos-sidebar-mini-label">{item.label}</span>
                            {badge > 0 && (
                              <span
                                aria-hidden="true"
                                className={cn(
                                  "pos-sidebar-mini-badge",
                                  active
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-foreground",
                                )}
                              >
                                {badge > 99 ? "99+" : badge}
                              </span>
                            )}
                          </Link>
                        </TooltipTrigger>
                        <TooltipContent side="right" sideOffset={8}>
                          {tooltipText}
                        </TooltipContent>
                      </Tooltip>
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
                      {!runtime && item.shortcut && !badge && !touch && (
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
function AppSidebar({ onNavigate, collapsed = false, onToggle, toggleRef, className }) {
  const content = (
    <div
      className={cn(
        "flex h-full w-full flex-col bg-sidebar text-sidebar-foreground",
        className,
      )}
    >
      {collapsed ? (
        <>
          <div className="pos-sidebar-mini-header flex h-16 shrink-0 items-center justify-center">
            <Link to="/" onClick={onNavigate} aria-label="Repuestos Félix · Panel">
              <BrandLogo compact />
            </Link>
          </div>
          {onToggle && (
            <div className="pos-sidebar-expand-row">
              <Tooltip>
                <TooltipTrigger asChild={true}>
                  <Button
                    ref={toggleRef}
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={onToggle}
                    aria-label="Expandir menú lateral"
                    aria-expanded={false}
                    aria-controls="pos-desktop-sidebar"
                    className="pos-sidebar-internal-toggle h-9 w-9 rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <PanelLeftOpen className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {"Expandir menú"}
                </TooltipContent>
              </Tooltip>
            </div>
          )}
          <SidebarNav
            collapsed={true}
            onNavigate={onNavigate}
            className="pos-sidebar-mini-nav flex-1 overflow-y-auto"
          />
        </>
      ) : (
        <>
          <div className="flex h-16 shrink-0 items-center justify-between gap-1.5 px-5">
            <Link to="/" onClick={onNavigate} className="min-w-0 shrink-0">
              <BrandLogo />
            </Link>
            {onToggle && (
              <Tooltip>
                <TooltipTrigger asChild={true}>
                  <Button
                    ref={toggleRef}
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={onToggle}
                    aria-label="Contraer menú lateral"
                    aria-expanded={true}
                    aria-controls="pos-desktop-sidebar"
                    className="pos-sidebar-internal-toggle h-8 w-8 shrink-0 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <PanelLeftClose className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8}>
                  {"Contraer menú"}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <SidebarNav
            onNavigate={onNavigate}
            className="flex-1 overflow-y-auto px-3 pb-4 pt-3"
          />
        </>
      )}
    </div>
  );
  if (collapsed || onToggle) {
    return <TooltipProvider delayDuration={150}>{content}</TooltipProvider>;
  }
  return content;
}
export { AppSidebar, SidebarNav };

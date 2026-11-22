// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { AppSidebar } from "../components/app-sidebar.jsx";
import { Dialog2, DialogContent2, DialogTitle2, DialogDescription2 } from "../../components/ui/dialog.jsx";
import { TopBar } from "../components/top-bar.jsx";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { LayoutGrid } from "lucide-react";
import { NAV_GROUPS } from "../data/navigation.js";
import { usePosStore } from "../../data/pos-context.jsx";
import { balanceOf } from "../lib/accounts.js";
const quickLinks = ["/ventas", "/inventario", "/caja"].map(path =>
  NAV_GROUPS[0].items.find(item => item.path === path),
);
function PosLayout({ children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTrigger = useRef(null);
  const { pathname } = useLocation();
  const { runtime, products, receivables, payables } = usePosStore();
  const reload = runtime?.reload;
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    reload?.({ background: true }).catch(() => {});
  }, [pathname, reload]);
  const badges = {
    "/inventario": products.filter(product => product.stock <= product.minStock).length,
    "/cuentas-por-cobrar": receivables?.filter(row => balanceOf(row) > 0).length,
    "/cuentas-por-pagar": payables?.filter(row => balanceOf(row) > 0).length,
  };
  const openMenu = event => {
    menuTrigger.current = event.currentTarget;
    setMenuOpen(true);
  };
  return (
    <div className="pos-layout flex min-h-screen bg-background">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-sidebar-border lg:block">
        <AppSidebar />
      </aside>
      <Dialog2 open={menuOpen} onOpenChange={setMenuOpen}>
        <DialogContent2 id="pos-mobile-menu" className="mobile-more-panel"
          onCloseAutoFocus={event => { event.preventDefault(); menuTrigger.current?.focus(); }}>
          <div className="pr-10">
            <DialogTitle2>Más opciones</DialogTitle2>
            <DialogDescription2 className="mt-2">Todos los módulos de Repuestos Félix.</DialogDescription2>
          </div>
          <nav aria-label="Todos los módulos" className="space-y-5">
            {NAV_GROUPS.map(group => <section key={group.label}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.label}</h2>
              <div className="mobile-more-grid">
                {group.items.map(item => {
                  const Icon = item.icon;
                  const active = pathname === item.path;
                  return <Link key={item.path} to={item.path} className="mobile-more-link"
                    aria-current={active ? "page" : undefined}
                    onClick={() => { setMenuOpen(false); window.scrollTo(0, 0); }}>
                    <Icon aria-hidden="true" />
                    <span>{item.label}</span>
                    {badges[item.path] > 0 && <span className="mobile-more-badge">{badges[item.path]}</span>}
                  </Link>;
                })}
              </div>
            </section>)}
          </nav>
        </DialogContent2>
      </Dialog2>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="pos-main flex-1 p-4 md:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-[1480px]">{children}</div>
        </main>
      </div>
      <nav className="mobile-bottom-nav" aria-label="Navegación rápida">
        {quickLinks.map(item => {
          const active = pathname === item.path || pathname.startsWith(item.path + "/");
          const Icon = item.icon;
          return <Link key={item.path} to={item.path} className="mobile-bottom-nav-item"
            aria-current={active ? "page" : undefined} data-active={active}
            onClick={() => window.scrollTo(0, 0)}>
            <Icon aria-hidden="true" />
            <span>{item.path === "/ventas" ? "Ventas" : item.label}</span>
          </Link>;
        })}
        <button type="button" className="mobile-bottom-nav-item" onClick={openMenu}
          aria-expanded={menuOpen} aria-controls="pos-mobile-menu" aria-haspopup="dialog"
          data-active={!quickLinks.some(item => pathname === item.path || pathname.startsWith(item.path + "/"))}>
          <LayoutGrid aria-hidden="true" />
          <span>Más</span>
        </button>
      </nav>
    </div>
  );
}
export { PosLayout };

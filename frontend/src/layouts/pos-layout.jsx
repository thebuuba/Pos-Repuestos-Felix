// Recovered from the approved Polymet reference; see docs/design/polymet-reference.json.
import { AppSidebar, SidebarNav } from "../components/pos/app-sidebar.jsx";
import { TopBar } from "../components/pos/top-bar.jsx";
import { ShortcutsDialog } from "../components/pos/shortcuts-dialog.jsx";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { LayoutGrid } from "lucide-react";
import { NAV_GROUPS } from "../data/navigation.js";
import { usePosStore } from "../data/pos-context.jsx";
import {
  MODULE_SHORTCUTS,
  clickFirstSelector,
  dispatchShortcut,
  focusFirstSelector,
  hasOpenModal,
  isPlainAlt,
  isPrimaryMod,
  submitActiveDialog,
} from "../data/keyboard-shortcuts.js";
const quickLinks = ["/ventas", "/inventario", "/caja"].map(path =>
  NAV_GROUPS[0].items.find(item => item.path === path),
);
const COMPACT_DESKTOP_MQ = "(min-width: 1024px) and (max-width: 1399px)";
const matchesCompactDesktop = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(COMPACT_DESKTOP_MQ).matches
    : false;
const isQuickActive = (item, pathname) => pathname === item.path || pathname.startsWith(item.path + "/");
function PosLayout({ children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [compactDesktop, setCompactDesktop] = useState(matchesCompactDesktop);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [wideCollapsed, setWideCollapsed] = useState(false);
  const menuTrigger = useRef(null);
  const menuPanel = useRef(null);
  const sidebarTriggerRef = useRef(null);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { runtime } = usePosStore();
  const isOwner = !runtime || (runtime.isOwner !== false && (!runtime.accountDetailsAvailable || Boolean(runtime.account?.username)));
  const reload = runtime?.reload;
  const previousPath = useRef(pathname);
  const useCompactDrawer = Boolean(runtime && compactDesktop);
  const sidebarExpanded = runtime ? (useCompactDrawer ? drawerOpen : !wideCollapsed) : true;
  const sidebarCollapsed = Boolean(runtime && !sidebarExpanded);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mq = window.matchMedia(COMPACT_DESKTOP_MQ);
    const sync = () => {
      setCompactDesktop(mq.matches);
      if (!mq.matches) setDrawerOpen(false);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    if (!useCompactDrawer || !drawerOpen) return undefined;
    const onEscape = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector("[role=dialog][data-state=open], [role=alertdialog][data-state=open]")) return;
      setDrawerOpen(false);
      window.requestAnimationFrame(() => sidebarTriggerRef.current?.focus());
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [useCompactDrawer, drawerOpen]);
  useEffect(() => {
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    setMenuOpen(false);
    setDrawerOpen(false);
    reload?.({ background: true }).catch(() => {});
  }, [pathname, reload]);
  // Atajos globales de escritorio (solo en modo operativo; nunca interfieren con AltGr ni lector USB).
  useEffect(() => {
    if (!runtime) return undefined;
    const onKeyDown = (event) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (isPrimaryMod(event) && event.key === "Enter") {
        if (hasOpenModal()) {
          event.preventDefault();
          if (!event.repeat) submitActiveDialog();
        }
        return;
      }
      if (isPlainAlt(event) && event.code === "KeyH") {
        if (shortcutsOpen) {
          event.preventDefault();
          setShortcutsOpen(false);
          return;
        }
        if (!hasOpenModal() && !menuOpen) {
          event.preventDefault();
          setShortcutsOpen(true);
        }
        return;
      }
      if (isPlainAlt(event) && event.code === "KeyA") {
        const notifOpen = Boolean(document.querySelector('.notif-popover[data-state="open"]'));
        if (notifOpen || (!hasOpenModal() && !menuOpen)) {
          event.preventDefault();
          if (!event.repeat) dispatchShortcut("toggle-notifications");
        }
        return;
      }
      if (menuOpen || hasOpenModal()) return;
      if (event.key === "F1" && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        if (event.repeat) return;
        if (pathname === "/ventas") {
          if (!dispatchShortcut("focus-search")) {
            focusFirstSelector("[data-shortcut-search]", { select: true });
          }
        } else {
          navigate("/ventas");
        }
        return;
      }
      if (event.key === "F2" && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
        event.preventDefault();
        if (event.repeat) return;
        if (!dispatchShortcut("focus-search")) {
          focusFirstSelector("[data-shortcut-search]", { select: true });
        }
        return;
      }
      if (isPlainAlt(event)) {
        const mod = MODULE_SHORTCUTS.find((item) => item.digit === event.code);
        if (mod) {
          event.preventDefault();
          if (event.repeat) return;
          if (!mod.ownerOnly || isOwner) {
            if (pathname === mod.path) {
              if (!dispatchShortcut("focus-search")) {
                focusFirstSelector("[data-shortcut-search]", { select: true });
              }
            } else {
              navigate(mod.path);
            }
          }
          return;
        }
        if (event.code === "KeyN") {
          event.preventDefault();
          if (event.repeat) return;
          if (!dispatchShortcut("primary-new")) {
            clickFirstSelector("[data-shortcut-new]");
          }
          return;
        }
        if (event.key === "ArrowLeft") {
          if (dispatchShortcut("page-prev") || clickFirstSelector("[data-shortcut-prev]")) {
            event.preventDefault();
          }
          return;
        }
        if (event.key === "ArrowRight") {
          if (dispatchShortcut("page-next") || clickFirstSelector("[data-shortcut-next]")) {
            event.preventDefault();
          }
          return;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runtime, isOwner, pathname, navigate, menuOpen, shortcutsOpen]);
  // «Más» is a full page between the top bar and the bottom navigation, below lg only.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => { if (desktop.matches) setMenuOpen(false); };
    const closeOnEscape = event => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector("[role=dialog][data-state=open], [role=alertdialog][data-state=open]")) return;
      setMenuOpen(false);
      menuTrigger.current?.focus();
    };
    closeOnDesktop();
    desktop.addEventListener("change", closeOnDesktop);
    document.addEventListener("keydown", closeOnEscape);
    document.documentElement.classList.add("mobile-more-open");
    menuPanel.current?.focus({ preventScroll: true });
    return () => {
      desktop.removeEventListener("change", closeOnDesktop);
      document.removeEventListener("keydown", closeOnEscape);
      document.documentElement.classList.remove("mobile-more-open");
    };
  }, [menuOpen]);
  const toggleMenu = event => {
    menuTrigger.current = event.currentTarget;
    setMenuOpen(open => !open);
  };
  const closeMenu = () => {
    setMenuOpen(false);
    setDrawerOpen(false);
  };
  const toggleSidebar = () => {
    if (useCompactDrawer) setDrawerOpen((open) => !open);
    else setWideCollapsed((collapsed) => !collapsed);
  };
  return (
    <div
      className="pos-layout flex min-h-screen bg-background"
      data-operational={runtime ? "true" : undefined}
      data-sidebar-expanded={runtime ? String(sidebarExpanded) : undefined}
    >
      {useCompactDrawer && drawerOpen && (
        <>
          <div className="pos-sidebar-spacer" aria-hidden="true" />
          <div
            className="pos-sidebar-backdrop"
            aria-hidden="true"
            onClick={() => setDrawerOpen(false)}
          />
        </>
      )}
      <aside
        id="pos-desktop-sidebar"
        aria-label="Menú lateral"
        className={
          useCompactDrawer && drawerOpen
            ? "pos-sidebar pos-sidebar-drawer border-r border-sidebar-border"
            : sidebarCollapsed
              ? "pos-sidebar pos-sidebar-mini sticky top-0 hidden h-screen shrink-0 border-r border-sidebar-border lg:block"
              : "pos-sidebar sticky top-0 hidden h-screen w-64 shrink-0 border-r border-sidebar-border lg:block"
        }
      >
        <AppSidebar
          collapsed={sidebarCollapsed}
          onNavigate={useCompactDrawer ? () => setDrawerOpen(false) : undefined}
          onToggle={runtime ? toggleSidebar : undefined}
          toggleRef={sidebarTriggerRef}
        />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onBrandClick={closeMenu} />
        <main className="pos-main flex-1 p-4 md:p-6 lg:p-8"
          inert={menuOpen ? "" : undefined} aria-hidden={menuOpen || undefined}>
          <div className="mx-auto w-full max-w-[1480px]">{children}</div>
        </main>
      </div>
      {menuOpen && <section id="pos-mobile-menu" ref={menuPanel} tabIndex={-1}
        role="dialog" aria-modal="false" aria-labelledby="pos-mobile-menu-title" aria-describedby="pos-mobile-menu-description"
        className="mobile-more-panel bg-sidebar text-sidebar-foreground">
        <div className="w-full px-3 pb-6 pt-4 md:pt-6">
          <div className="min-w-0 px-3">
            <h2 id="pos-mobile-menu-title" className="text-2xl font-semibold tracking-tight text-foreground md:text-[28px]">Más opciones</h2>
            <p id="pos-mobile-menu-description" className="mt-1 text-sm text-muted-foreground">Todos los módulos de Repuestos Félix.</p>
          </div>
          <SidebarNav touch aria-label="Todos los módulos" className="mt-6"
            onNavigate={() => { closeMenu(); window.scrollTo(0, 0); }} />
        </div>
      </section>}
      <nav className="mobile-bottom-nav" aria-label="Navegación rápida">
        {quickLinks.map(item => {
          const active = !menuOpen && isQuickActive(item, pathname);
          const Icon = item.icon;
          return <Link key={item.path} to={item.path} className="mobile-bottom-nav-item"
            aria-current={active ? "page" : undefined} data-active={active}
            onClick={() => { closeMenu(); window.scrollTo(0, 0); }}>
            <Icon aria-hidden="true" />
            <span>{item.path === "/ventas" ? "Ventas" : item.label}</span>
          </Link>;
        })}
        <button type="button" className="mobile-bottom-nav-item" onClick={toggleMenu}
          aria-expanded={menuOpen} aria-controls="pos-mobile-menu" aria-haspopup="dialog"
          data-active={menuOpen || !quickLinks.some(item => isQuickActive(item, pathname))}>
          <LayoutGrid aria-hidden="true" />
          <span>Más</span>
        </button>
      </nav>
      {runtime && (
        <ShortcutsDialog
          open={shortcutsOpen}
          onOpenChange={setShortcutsOpen}
          isOwner={isOwner}
          pathname={pathname}
        />
      )}
    </div>
  );
}
export { PosLayout };

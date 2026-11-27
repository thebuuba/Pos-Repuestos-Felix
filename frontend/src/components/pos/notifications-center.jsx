import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  BellRing,
  Box,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  Clock,
  HandCoins,
  RotateCcw,
  ShieldAlert,
  TrendingDown,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "../ui/button.jsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.jsx";
import { cn } from "../../lib/utils.js";
import { usePosStore } from "../../data/pos-context.jsx";
import { useDesktopSyncSnapshot } from "../../desktop-status.jsx";
import {
  buildSmartNotifications,
  NOTIFICATION_CATEGORIES,
} from "../../data/smart-notifications.js";
import {
  detectLiveArrivals,
  isStockLiveToastSuppressed,
  markAlertSeen,
  markAllAlertsSeen,
  notificationStorageKey,
  partitionNotifications,
  readNotificationState,
  snoozeAlertUntilTomorrow,
  unsnoozeAlert,
  writeNotificationState,
} from "../../data/notification-state.js";

function alertIconFor(alert) {
  if (alert.id === "sync-conflict" || alert.id === "pending") return ShieldAlert;
  if (alert.id?.startsWith("reminders-")) return BellRing;
  if (alert.id === "stock-velocity") return TrendingDown;
  if (alert.category === "inventario") return Box;
  if (alert.category === "cuentas") return HandCoins;
  if (alert.id === "cash-closed" || alert.id === "cash-stale") return Wallet;
  if (alert.severity === "info") return CircleCheck;
  return AlertTriangle;
}

export function NotificationsCenter({ onNavigate }) {
  const {
    runtime,
    products = [],
    sales = [],
    customers = [],
    suppliers = [],
    receivables = [],
    payables = [],
    workshopAccounts = [],
    reminders = [],
    settings,
    cashSession,
  } = usePosStore();
  const navigate = useNavigate();
  const desktopStatus = useDesktopSyncSnapshot();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const [expandedId, setExpandedId] = useState(null);
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [bellPulse, setBellPulse] = useState(false);
  const [tick, setTick] = useState(() => Date.now());
  const containerRef = useRef(null);
  const bellRef = useRef(null);
  const prevFingerprintsRef = useRef(null);
  const prevStorageKeyRef = useRef(null);
  const pulseTimerRef = useRef(null);
  const suppressNextArrivalRef = useRef(false);

  // Fail-closed mientras resuelve /api/account para no exponer alertas de dueño al cajero.
  const isOwner = !runtime || (runtime.isOwner !== false && (!runtime.accountDetailsAvailable || Boolean(runtime.account?.username)));
  const hasRuntime = Boolean(runtime);
  const pending = runtime?.pending ?? null;
  const inFlightOperationId = runtime?.inFlightOperationId ?? null;
  const hasServiceError = Boolean(runtime?.error);

  const storageKey = useMemo(
    () => notificationStorageKey(runtime?.databaseId, runtime?.account?.username || runtime?.account?.id || "local"),
    [runtime?.databaseId, runtime?.account?.username, runtime?.account?.id],
  );
  const [notifState, setNotifState] = useState(() => readNotificationState(storageKey));

  useEffect(() => {
    setNotifState(readNotificationState(storageKey));
  }, [storageKey]);

  // Recalcula reloj cada 5 min para cambios de día de negocio / vencimientos.
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  // Atajo Alt+A despachado desde PosLayout.
  useEffect(() => {
    const onShortcut = (event) => {
      if (event.detail?.action !== "toggle-notifications") return;
      event.preventDefault();
      setTick(Date.now());
      setOpen((prev) => !prev);
    };
    window.addEventListener("felix:shortcut", onShortcut);
    return () => window.removeEventListener("felix:shortcut", onShortcut);
  }, []);

  // Cerrar popover al hacer clic afuera o pulsar Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        setOpen(false);
        bellRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const updateState = (updater) => {
    setNotifState((prev) => {
      const next = updater(prev);
      if (next !== prev) writeNotificationState(storageKey, next);
      return next;
    });
  };

  const now = useMemo(() => new Date(tick), [tick]);

  const rawAlerts = useMemo(
    () =>
      buildSmartNotifications({
        now,
        hasRuntime,
        isOwner,
        products,
        sales,
        customers,
        suppliers,
        receivables,
        payables,
        workshopAccounts,
        reminders,
        cashSession,
        settings,
        pending,
        inFlightOperationId,
        desktopStatus,
      }),
    [
      now,
      hasRuntime,
      isOwner,
      products,
      sales,
      customers,
      suppliers,
      receivables,
      payables,
      workshopAccounts,
      reminders,
      cashSession,
      settings,
      pending,
      inFlightOperationId,
      desktopStatus,
    ],
  );

  const { active, snoozed, unreadCount, unreadCriticalCount } = useMemo(
    () => partitionNotifications(rawAlerts, notifState, now),
    [rawAlerts, notifState, now],
  );

  // Espera a conocer cuenta/snapshot antes de fijar la línea base silenciosa de la sesión.
  const baselineReady = !hasRuntime || (Boolean(runtime?.snapshot) && (!runtime?.accountDetailsAvailable || Boolean(runtime?.account?.username)));
  const openRef = useRef(open);
  openRef.current = open;
  const goToRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pulseTimerRef.current != null) window.clearTimeout(pulseTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!baselineReady) return;
    if (prevStorageKeyRef.current !== storageKey) {
      prevStorageKeyRef.current = storageKey;
      prevFingerprintsRef.current = null;
    }
    const { arrived, toastCandidates, nextFingerprints } = detectLiveArrivals(
      active,
      prevFingerprintsRef.current,
      { suppressStockToast: isStockLiveToastSuppressed() },
    );
    prevFingerprintsRef.current = nextFingerprints;

    if (suppressNextArrivalRef.current) {
      suppressNextArrivalRef.current = false;
      return;
    }
    if (!arrived.length || openRef.current) return;

    // Pulso sutil 1 sola vez en la campana (sin sonido).
    setBellPulse(false);
    if (pulseTimerRef.current != null) window.clearTimeout(pulseTimerRef.current);
    const startPulse = window.requestAnimationFrame(() => {
      setBellPulse(true);
      pulseTimerRef.current = window.setTimeout(() => setBellPulse(false), 900);
    });

    if (toastCandidates.length > 0) {
      const top = toastCandidates[0];
      const extra = toastCandidates.length > 1 ? ` (+${toastCandidates.length - 1} más)` : "";
      const notifyFn = top.id === "daily-goal-hit" ? toast.success : toast.warning;
      notifyFn(`${top.title}${extra}`, {
        id: `felix-live-notif-${top.id}`,
        duration: 5000,
        description: top.description,
        action: {
          label: "Ver",
          onClick: () => goToRef.current?.(top, top.to),
        },
      });
    }

    return () => window.cancelAnimationFrame(startPulse);
  }, [active, baselineReady, storageKey]);

  const counts = useMemo(() => {
    const map = { all: active.length, critical: 0, inventario: 0, cuentas: 0, operacion: 0 };
    for (const item of active) {
      if (item.severity === "critical") map.critical += 1;
      if (Object.hasOwn(map, item.category)) map[item.category] += 1;
    }
    return map;
  }, [active]);

  const visibleTabs = useMemo(
    () => NOTIFICATION_CATEGORIES.filter((cat) => cat.id === "all" || counts[cat.id] > 0),
    [counts],
  );

  const effectiveFilter = filter !== "all" && counts[filter] === 0 ? "all" : filter;

  const filteredAlerts = useMemo(() => {
    if (effectiveFilter === "all") return active;
    if (effectiveFilter === "critical") return active.filter((a) => a.severity === "critical");
    return active.filter((a) => a.category === effectiveFilter);
  }, [active, effectiveFilter]);

  const canMarkAnyRead = useMemo(
    () => active.some((a) => !a.seen && a.snoozeable !== false),
    [active],
  );

  const toggleOpen = () => {
    setOpen((prev) => {
      if (!prev) setTick(Date.now());
      return !prev;
    });
  };

  const goTo = (alert, targetPath) => {
    if (alert) updateState((prev) => markAlertSeen(prev, alert));
    setOpen(false);
    onNavigate?.();
    navigate(targetPath || alert?.to || "/");
  };
  goToRef.current = goTo;

  const handleSnooze = (event, alert) => {
    event.stopPropagation();
    updateState((prev) => snoozeAlertUntilTomorrow(prev, alert, new Date()));
    toast("Alerta pospuesta hasta mañana", {
      description: "Volverá a avisar automáticamente si cambia la situación.",
    });
  };

  const handleUnsnooze = (alertId) => {
    suppressNextArrivalRef.current = true;
    updateState((prev) => unsnoozeAlert(prev, alertId));
  };

  const handleMarkAllRead = () => {
    updateState((prev) => markAllAlertsSeen(prev, active));
  };

  const badgeText = unreadCount > 99 ? "99+" : String(unreadCount);
  const tooltipLabel = unreadCount > 0
    ? `Notificaciones · ${unreadCount} sin leer (Alt+A)`
    : "Notificaciones (Alt+A)";

  return (
    <div ref={containerRef} className="relative">
      <Tooltip>
        <TooltipTrigger asChild={true}>
          <Button
            ref={bellRef}
            variant="outline"
            size="icon"
            className={cn(
              "notif-bell-btn relative h-10 w-10 rounded-xl bg-card",
              open && "bg-muted",
              bellPulse && "notif-bell-pulse",
            )}
            aria-label="Notificaciones"
            aria-expanded={open}
            aria-haspopup="dialog"
            data-unread-count={unreadCount}
            data-critical-count={unreadCriticalCount}
            data-pulsing={bellPulse ? "true" : undefined}
            onClick={toggleOpen}
          >
            <Bell />
            {unreadCount > 0 ? (
              <span
                aria-hidden="true"
                className={cn(
                  "notif-bell-badge tabular-nums",
                  unreadCriticalCount > 0 ? "notif-bell-badge-critical" : "notif-bell-badge-default",
                )}
              >
                {badgeText}
              </span>
            ) : (active.length > 0 || hasServiceError) ? (
              <span aria-hidden="true" className="notif-bell-dot" />
            ) : null}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltipLabel}</TooltipContent>
      </Tooltip>

      {open && (
        <section
          role="dialog"
          aria-label="Notificaciones"
          data-state="open"
          className="notif-popover"
        >
          <div className="notif-popover-head">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
                  Notificaciones
                </h2>
                {unreadCount > 0 && (
                  <span className="notif-count-pill tabular-nums">
                    {unreadCount}
                  </span>
                )}
              </div>
              {canMarkAnyRead ? (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  className="notif-mark-all-btn"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  <span>Marcar leídas</span>
                </button>
              ) : (
                <kbd className="notif-kbd">Alt+A</kbd>
              )}
            </div>

            {visibleTabs.length > 1 && (
              <div className="notif-filter-bar mt-2.5" role="tablist" aria-label="Filtrar notificaciones">
                {visibleTabs.map((tab) => {
                  const selected = effectiveFilter === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      data-active={selected ? "true" : "false"}
                      onClick={() => setFilter(tab.id)}
                      className="notif-filter-tab"
                    >
                      <span>{tab.label}</span>
                      <span className="notif-filter-count tabular-nums">{counts[tab.id]}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="notif-scroll">
            {filteredAlerts.length === 0 ? (
              <div className="notif-empty">
                <div className="notif-empty-icon">
                  <CircleCheck className="h-5 w-5" />
                </div>
                <p className="text-sm font-medium text-foreground">Todo está al día</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  No hay alertas activas en este momento.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {filteredAlerts.map((alert) => {
                  const Icon = alertIconFor(alert);
                  const hasItems = Array.isArray(alert.items) && alert.items.length > 0;
                  const expanded = expandedId === alert.id;
                  return (
                    <li
                      key={alert.id}
                      data-alert-id={alert.id}
                      data-severity={alert.severity}
                      data-seen={alert.seen ? "true" : "false"}
                      className={cn("notif-row", alert.seen && "notif-row-seen")}
                    >
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() => goTo(alert, alert.to)}
                          className="notif-row-main"
                        >
                          <span className={cn("notif-row-icon", `notif-icon-${alert.severity}`)}>
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-start justify-between gap-2">
                              <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium leading-snug text-foreground">
                                {!alert.seen && <span className="notif-unread-dot" aria-hidden="true" />}
                                <span>{alert.title}</span>
                              </span>
                              {alert.metric && (
                                <span className={cn("notif-metric-text shrink-0 tabular-nums", `notif-metric-text-${alert.severity}`)}>
                                  {alert.metric}
                                </span>
                              )}
                            </span>
                            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                              {alert.description}
                            </span>
                          </span>
                        </button>

                        {alert.snoozeable !== false && (
                          <button
                            type="button"
                            onClick={(e) => handleSnooze(e, alert)}
                            aria-label="Posponer"
                            title="Posponer hasta mañana"
                            className="notif-snooze-icon"
                          >
                            <Clock className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      {hasItems && (
                        <div className="notif-detail-wrap">
                          <div className="flex items-center justify-between gap-2">
                            <button
                              type="button"
                              aria-expanded={expanded}
                              onClick={() => setExpandedId(expanded ? null : alert.id)}
                              className="notif-detail-toggle"
                            >
                              <span>
                                {expanded
                                  ? "Ocultar detalle"
                                  : `Ver detalle (${alert.items.length})`}
                              </span>
                              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} />
                            </button>
                            <button
                              type="button"
                              onClick={() => goTo(alert, alert.to)}
                              className="notif-inline-action"
                            >
                              <span>{alert.actionLabel || "Abrir"}</span>
                              <ChevronRight className="h-3 w-3" />
                            </button>
                          </div>

                          {expanded && (
                            <ul className="notif-sublist mt-1.5 divide-y divide-border">
                              {alert.items.map((sub, idx) => (
                                <li key={`${alert.id}-sub-${idx}`}>
                                  <button
                                    type="button"
                                    onClick={() => goTo(alert, sub.to)}
                                    className="notif-subrow"
                                  >
                                    <span className="min-w-0 flex-1 truncate text-foreground">
                                      {sub.label}
                                    </span>
                                    <span className="shrink-0 tabular-nums text-muted-foreground">
                                      {sub.meta}
                                    </span>
                                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {snoozed.length > 0 && (
            <div className="notif-popover-foot">
              <button
                type="button"
                onClick={() => setShowSnoozed((prev) => !prev)}
                className="notif-snoozed-toggle"
              >
                <Clock className="h-3.5 w-3.5" />
                <span>
                  {showSnoozed
                    ? `Ocultar pospuestas (${snoozed.length})`
                    : `Pospuestas hasta mañana (${snoozed.length})`}
                </span>
              </button>
              {showSnoozed && (
                <ul className="mt-2 space-y-1">
                  {snoozed.map((alert) => (
                    <li key={`snoozed-${alert.id}`} className="notif-snoozed-row">
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {alert.title}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleUnsnooze(alert.id)}
                        className="notif-unsnooze-btn"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>Reactivar</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Bell,
  Box,
  CheckCheck,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.jsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip.jsx";
import { cn } from "../../lib/utils.js";
import { usePosStore } from "../../data/pos-context.jsx";
import { useDesktopSyncSnapshot } from "../../desktop-status.jsx";
import {
  buildSmartNotifications,
  NOTIFICATION_CATEGORIES,
} from "../../data/smart-notifications.js";
import {
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
    receivables = [],
    payables = [],
    workshopAccounts = [],
    settings,
    cashSession,
  } = usePosStore();
  const navigate = useNavigate();
  const desktopStatus = useDesktopSyncSnapshot();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const [showSnoozed, setShowSnoozed] = useState(false);
  const [tick, setTick] = useState(() => Date.now());

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

  // Recalcula reloj cada 5 min para cambios de día de negocio / vencimientos sin re-render constante.
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
        receivables,
        payables,
        workshopAccounts,
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
      receivables,
      payables,
      workshopAccounts,
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

  const handleOpen = (nextOpen) => {
    if (nextOpen) setTick(Date.now());
    setOpen(nextOpen);
  };

  const goTo = (alert, targetPath) => {
    if (alert) updateState((prev) => markAlertSeen(prev, alert));
    setOpen(false);
    onNavigate?.();
    navigate(targetPath || alert?.to || "/");
  };

  const handleSnooze = (alert) => {
    updateState((prev) => snoozeAlertUntilTomorrow(prev, alert, new Date()));
    toast("Alerta pospuesta hasta mañana", {
      description: "Volverá a avisar automáticamente si la situación cambia.",
    });
  };

  const handleUnsnooze = (alertId) => {
    updateState((prev) => unsnoozeAlert(prev, alertId));
  };

  const handleMarkAllRead = () => {
    updateState((prev) => markAllAlertsSeen(prev, active));
  };

  const badgeText = unreadCount > 99 ? "99+" : String(unreadCount);
  const summaryParts = [];
  if (counts.critical > 0) summaryParts.push(`${counts.critical} ${counts.critical === 1 ? "crítica" : "críticas"}`);
  const nonCritical = active.length - counts.critical;
  if (nonCritical > 0) summaryParts.push(`${nonCritical} ${nonCritical === 1 ? "aviso" : "avisos"}`);
  const summaryText = summaryParts.length > 0
    ? summaryParts.join(" · ")
    : "Todo está al día. No hay alertas activas.";

  const tooltipLabel = unreadCount > 0
    ? `Notificaciones · ${unreadCount} sin leer (Alt+A)`
    : "Notificaciones (Alt+A)";

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild={true}>
          <Button
            variant="outline"
            size="icon"
            className="notif-bell-btn relative h-10 w-10 rounded-xl bg-card"
            aria-label="Notificaciones"
            data-unread-count={unreadCount}
            data-critical-count={unreadCriticalCount}
            onClick={() => handleOpen(true)}
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
              <span
                aria-hidden="true"
                className="notif-bell-dot"
              />
            ) : null}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{tooltipLabel}</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={handleOpen}>
        <DialogContent
          className="notif-dialog rounded-2xl p-0"
          style={{ width: "calc(100vw - 1.5rem)", maxWidth: "34rem", maxHeight: "calc(100dvh - 2rem)" }}
        >
          <div className="notif-dialog-head">
            <DialogHeader className="text-left">
              <div className="flex flex-wrap items-center gap-2 pr-8">
                <DialogTitle>Notificaciones</DialogTitle>
                {unreadCount > 0 && (
                  <span className="notif-header-pill tabular-nums">
                    {unreadCount} {unreadCount === 1 ? "nueva" : "nuevas"}
                  </span>
                )}
                <kbd className="notif-kbd">Alt+A</kbd>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <DialogDescription>{summaryText}</DialogDescription>
                {canMarkAnyRead && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="notif-mark-all h-7 rounded-lg px-2 text-xs"
                    onClick={handleMarkAllRead}
                  >
                    <CheckCheck className="h-3.5 w-3.5" />
                    {"Marcar leídas"}
                  </Button>
                )}
              </div>
            </DialogHeader>

            {visibleTabs.length > 1 && (
              <div className="notif-tabs mt-3" role="tablist" aria-label="Filtrar notificaciones">
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
                      className="notif-tab"
                    >
                      <span>{tab.label}</span>
                      <span className="notif-tab-count tabular-nums">{counts[tab.id]}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="notif-list">
            {filteredAlerts.length === 0 ? (
              <div className="notif-empty">
                <div className="notif-empty-icon">
                  <CircleCheck className="h-6 w-6" />
                </div>
                <p className="text-sm font-medium text-foreground">Todo está al día</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  No hay alertas activas en esta categoría.
                </p>
              </div>
            ) : (
              <ul className="space-y-2.5">
                {filteredAlerts.map((alert) => {
                  const Icon = alertIconFor(alert);
                  return (
                    <li
                      key={alert.id}
                      data-alert-id={alert.id}
                      data-severity={alert.severity}
                      data-seen={alert.seen ? "true" : "false"}
                      className={cn(
                        "notif-card",
                        `notif-card-${alert.severity}`,
                        alert.seen && "notif-card-seen",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <span className={cn("notif-card-icon", `notif-icon-${alert.severity}`)}>
                          <Icon className="h-4 w-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="flex items-center gap-1.5 text-sm font-semibold leading-snug text-foreground">
                              {!alert.seen && <span className="notif-unread-dot" aria-hidden="true" />}
                              <span>{alert.title}</span>
                            </p>
                            {alert.metric && (
                              <span className={cn("notif-metric tabular-nums", `notif-metric-${alert.severity}`)}>
                                {alert.metric}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                            {alert.description}
                          </p>

                          {Array.isArray(alert.items) && alert.items.length > 0 && (
                            <ul className="notif-subitems mt-2.5">
                              {alert.items.map((sub, idx) => (
                                <li key={`${alert.id}-sub-${idx}`}>
                                  <button
                                    type="button"
                                    onClick={() => goTo(alert, sub.to)}
                                    className="notif-subitem-btn"
                                  >
                                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                                      {sub.label}
                                    </span>
                                    <span className="shrink-0 tabular-nums text-muted-foreground">
                                      {sub.meta}
                                    </span>
                                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}

                          <div className="notif-card-actions mt-3">
                            <button
                              type="button"
                              onClick={() => goTo(alert, alert.to)}
                              className="notif-primary-action"
                            >
                              <span>{alert.actionLabel || "Revisar"}</span>
                              <ChevronRight className="h-3.5 w-3.5" />
                            </button>
                            {alert.snoozeable !== false && (
                              <button
                                type="button"
                                onClick={() => handleSnooze(alert)}
                                title="Ocultar hasta mañana; vuelve a avisar si la situación cambia"
                                className="notif-snooze-btn"
                              >
                                <Clock className="h-3.5 w-3.5" />
                                <span>Posponer</span>
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {snoozed.length > 0 && (
              <div className="notif-snoozed-wrap mt-4">
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
                  <ul className="mt-2 space-y-1.5">
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
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

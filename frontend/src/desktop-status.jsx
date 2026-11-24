import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleCheck, CloudUpload, CloudOff, CloudAlert, RefreshCw, Download } from 'lucide-react';
import { Button } from './components/ui/button.jsx';
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './components/ui/dialog.jsx';
import { cn } from './lib/utils.js';
import { formatMoney } from './lib/format.js';
import { formatBusinessDateTime } from './lib/dates.js';

const dateLabel = value => formatBusinessDateTime(value);
const connectionLabels = { checking: 'Comprobando…', offline: 'Sin conexión', online: 'Al día', conflict: 'Revisar sincronización', authentication: 'Iniciar sesión' };
const validUpdateStates = new Set(['available', 'downloading', 'installing', 'error', 'checking', 'up_to_date', 'check_error']);
const bannerUpdateStates = new Set(['available', 'downloading', 'installing', 'error']);

let latestUpdate = null;
const updateListeners = new Set();
let latestSyncSnapshot = null;
const syncSnapshotListeners = new Set();
function publishSyncSnapshot(next) {
  const summary = next
    ? { connection: next.connection, pending: next.pending, lastSync: next.lastSync, initialized: next.initialized }
    : null;
  if (JSON.stringify(summary) === JSON.stringify(latestSyncSnapshot)) return;
  latestSyncSnapshot = summary;
  syncSnapshotListeners.forEach(listener => listener(summary));
}
export function useDesktopSyncSnapshot() {
  const [snap, setSnap] = useState(() => (window.__FELIX_DESKTOP__ ? latestSyncSnapshot : null));
  useEffect(() => {
    if (!window.__FELIX_DESKTOP__) return undefined;
    setSnap(latestSyncSnapshot);
    syncSnapshotListeners.add(setSnap);
    return () => { syncSnapshotListeners.delete(setSnap); };
  }, []);
  return snap;
}
function normalizeUpdate(value) {
  if (!value || typeof value !== 'object' || !validUpdateStates.has(value.state)) return null;
  return {
    state: value.state,
    version: typeof value.version === 'string' ? value.version : '',
    error: typeof value.error === 'string' && value.error ? value.error : null,
  };
}
function publishUpdate(value) {
  const next = normalizeUpdate(value);
  if (JSON.stringify(next) === JSON.stringify(latestUpdate)) return;
  latestUpdate = next;
  updateListeners.forEach(listener => listener(next));
}
async function requestDesktopUpdate() {
  const response = await fetch('/api/desktop/update', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'No se pudo iniciar la actualización.');
  if (data?.update) publishUpdate(data.update);
  return data?.update ?? null;
}
async function requestDesktopUpdateCheck({ silent = false } = {}) {
  const response = await fetch('/api/desktop/update/check', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ silent }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'No se pudo buscar actualizaciones.');
  if (data?.update) publishUpdate(data.update);
  return data?.update ?? null;
}

function validStatus(value) {
  return value && typeof value.initialized === 'boolean' && Object.hasOwn(connectionLabels, value.connection) &&
    Number.isSafeInteger(value.pending) && value.pending >= 0 &&
    (value.lastSync == null || typeof value.lastSync === 'string');
}

export function DesktopSyncStatus(props) {
  return window.__FELIX_DESKTOP__ ? <DesktopStatus {...props} /> : null;
}

export function DesktopUpdateNotice() {
  return window.__FELIX_DESKTOP__ ? <DesktopUpdateBanner /> : null;
}

function DesktopUpdateBanner() {
  const [update, setUpdate] = useState(latestUpdate);
  const [dismissed, setDismissed] = useState(null);
  const [requestError, setRequestError] = useState('');

  useEffect(() => {
    setUpdate(latestUpdate);
    const onChange = next => {
      setUpdate(next);
      if (next && next.state !== 'available') setDismissed(null);
    };
    updateListeners.add(onChange);
    return () => { updateListeners.delete(onChange); };
  }, []);

  useEffect(() => {
    if (!update || !['downloading', 'installing'].includes(update.state)) return;
    let active = true;
    const poll = window.setInterval(async () => {
      try {
        const res = await fetch('/api/desktop/status', { credentials: 'same-origin', cache: 'no-store' });
        if (!res.ok || !active) return;
        const data = await res.json();
        if (active && validStatus(data)) publishUpdate(data.update ?? null);
      } catch { /* host may be restarting during install */ }
    }, 1500);
    return () => { active = false; window.clearInterval(poll); };
  }, [update?.state]);

  if (!update || !bannerUpdateStates.has(update.state)) return null;
  const key = update.version || 'latest';
  if (update.state === 'available' && dismissed === key) return null;
  const busy = update.state === 'downloading' || update.state === 'installing';
  const verLabel = update.version ? ` (v${update.version})` : '';
  const detail = requestError || (update.state === 'error' ? update.error : null);

  async function apply() {
    if (busy) return;
    setRequestError('');
    try {
      await requestDesktopUpdate();
    } catch (cause) {
      setRequestError(cause.message || 'No se pudo iniciar la actualización.');
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-4 flex flex-col gap-3 rounded-2xl border border-primary/30 bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent text-primary">
          {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        </div>
        <div className="min-w-0 space-y-0.5 text-sm">
          <p className="font-semibold text-foreground">
            {update.state === 'installing'
              ? `Instalando Repuestos Félix${verLabel}…`
              : update.state === 'downloading'
                ? `Descargando actualización${verLabel}…`
                : `Actualización disponible${verLabel}`}
          </p>
          <p className={cn('text-xs', detail ? 'text-destructive' : 'text-muted-foreground')}>
            {detail
              || (update.state === 'installing'
                ? 'El programa se reiniciará automáticamente al terminar. Tus datos y ventas pendientes se conservan.'
                : update.state === 'downloading'
                  ? 'Descargando en segundo plano. No cierres el programa.'
                  : 'Tus datos locales y ventas pendientes se conservan al actualizar.')}
          </p>
        </div>
      </div>
      {!busy && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button type="button" size="sm" className="h-9 rounded-xl px-4" onClick={apply}>
            <Download className="h-3.5 w-3.5" />
            <span>{update.state === 'error' ? 'Reintentar' : 'Actualizar ahora'}</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 rounded-xl px-3"
            onClick={() => setDismissed(key)}
          >
            Más tarde
          </Button>
        </div>
      )}
    </div>
  );
}

function DesktopStatus({ onSync }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [open, setOpen] = useState(false);
  const [review, setReview] = useState(null);
  const [reviewing, setReviewing] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const current = useRef(null);
  const lastSilentCheck = useRef(0);
  const request = useRef(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);
  const refresh = useRef(onSync);
  refresh.current = onSync;

  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const response = await fetch('/api/desktop/status', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error();
      const next = await response.json();
      if (!validStatus(next)) throw new Error();
      if (!mounted.current || controller.signal.aborted) return;
      const previous = current.current;
      current.current = next;
      setStatus(next); setError('');
      publishSyncSnapshot(next);
      publishUpdate(next.update ?? null);
      if (previous?.connection === 'offline' && next.connection === 'online' && Date.now() - lastSilentCheck.current > 60_000) {
        lastSilentCheck.current = Date.now();
        requestDesktopUpdateCheck({ silent: true }).catch(() => {});
      }
      if (previous && next.initialized && (!previous.initialized || previous.lastSync !== next.lastSync)) {
        // Refresh the shared catalog after the desktop host adopts server changes.
        Promise.resolve(refresh.current?.()).catch(() => {});
      }
      return next;
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted)
        setError('No se pudo comprobar la sincronización. La información anterior puede estar desactualizada.');
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    const poll = setInterval(load, 15_000);
    const focus = () => { if (!document.hidden) load(); };
    const onOnline = () => {
      load();
      if (Date.now() - lastSilentCheck.current > 60_000) {
        lastSilentCheck.current = Date.now();
        requestDesktopUpdateCheck({ silent: true }).catch(() => {});
      }
    };
    window.addEventListener('focus', focus);
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', focus);
    return () => {
      mounted.current = false; request.current?.abort(); clearInterval(poll);
      window.removeEventListener('focus', focus);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [load]);

  async function checkUpdates() {
    if (checkingUpdate || syncing) return;
    setCheckingUpdate(true);
    setError('');
    try {
      await requestDesktopUpdateCheck({ silent: false });
      for (let attempt = 0; attempt < 12 && mounted.current; attempt++) {
        await new Promise(resolve => window.setTimeout(resolve, 750));
        const next = await load();
        if (next?.update && next.update.state !== 'checking') break;
      }
    } catch (cause) {
      if (mounted.current) setError(cause.message || 'No se pudo buscar actualizaciones.');
    } finally {
      if (mounted.current) setCheckingUpdate(false);
    }
  }

  async function synchronize() {
    if (inFlight.current) return;
    inFlight.current = true; setSyncing(true); setError('');
    let failure = '';
    try {
      const response = await fetch('/api/desktop/sync', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      if (!response.ok) failure = 'No se pudo completar la sincronización. Las operaciones locales se conservan.';
    } catch {
      failure = 'No se pudo completar la sincronización. Las operaciones locales se conservan.';
    } finally {
      await load();
      inFlight.current = false;
      if (mounted.current) { setSyncing(false); if (failure) setError(failure); }
    }
  }

  async function reviewPending() {
    if (inFlight.current) return;
    inFlight.current = true; setReviewing(true); setError(''); setAcknowledged(false);
    try {
      const response = await fetch('/api/desktop/reconciliation', { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'No se pudo consultar la revisión.');
      if (!Array.isArray(data.operationIds) || !Array.isArray(data.operations) || !data.operationIds.length)
        throw new Error('La lista de pendientes cambió. Comprueba la sincronización.');
      if (mounted.current) setReview(data);
    } catch (failure) { if (mounted.current) setError(failure.message); }
    finally { inFlight.current = false; if (mounted.current) setReviewing(false); }
  }

  async function archivePending() {
    if (inFlight.current || !review || !acknowledged) return;
    inFlight.current = true; setReviewing(true); setError('');
    let failure = '';
    try {
      const response = await fetch('/api/desktop/reconcile', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: review.deviceId,
          databaseId: review.databaseId, operationIds: review.operationIds, acknowledged: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'La revisión espera confirmación del servidor.');
      if (!validStatus(data)) throw new Error('No se recibió la confirmación de la revisión.');
      if (mounted.current) { setReview(null); setAcknowledged(false); }
    } catch (cause) { failure = cause.message || 'La revisión espera confirmación del servidor. Reanúdala al reconectar.'; }
    finally {
      await load(); inFlight.current = false;
      if (mounted.current) { setReviewing(false); if (failure) { setError(failure); setReview(null); setAcknowledged(false); } }
    }
  }

  const needsReview = !!(error || status?.conflict || status?.connection === 'conflict' || status?.connection === 'authentication' || (status?.error && status.connection !== 'offline'));
  const label = syncing ? 'Sincronizando…' : needsReview ? (status?.connection === 'authentication' ? 'Iniciar sesión' : 'Revisar sincronización') :
    !status ? 'Comprobando…' : !status.initialized ? 'Preparar equipo' : status.connection === 'online' && status.pending ? 'Pendientes' : connectionLabels[status.connection];
  const pendingLabel = status?.pending ? `${status.pending} ${status.pending === 1 ? 'operación pendiente' : 'operaciones pendientes'}` : 'Sin operaciones pendientes';
  const checking = syncing || !status || status.connection === 'checking';
  const Icon = checking ? RefreshCw : needsReview ? CloudAlert : status.connection === 'offline' ? CloudOff : status.pending ? CloudUpload : CircleCheck;
  const stale = status && (status.connection !== 'online' || status.pending > 0 || needsReview);
  const summary = `${label}${status ? `. ${pendingLabel}. Última sincronización: ${dateLabel(status.lastSync)}.${stale ? ' Inventario y saldos sin actualizar.' : ''}` : ''}`;

  const tone = checking ? 'neutral' : needsReview ? 'danger' : stale ? 'warning' : 'success';
  const showUpdateBanner = Boolean(status?.update && bannerUpdateStates.has(status.update.state));
  const checkingUpdateNow = checkingUpdate || status?.update?.state === 'checking';

  return <Dialog open={open} onOpenChange={setOpen}>
    <span role="status" aria-atomic="true" className="sr-only">{summary}</span>
    <DialogTrigger asChild>
      <Button variant="outline" className={cn('h-10 rounded-xl bg-card', needsReview ? 'text-destructive' : stale ? 'text-amber-700 dark:text-amber-400' : status && 'text-emerald-700 dark:text-emerald-400')}
        aria-label={`Sincronización: ${label}${status?.pending ? `, ${pendingLabel}` : ''}`} title={summary}>
        <Icon className={cn(checking && 'animate-spin')} />
        <span className="hidden lg:inline">{label}</span>
        {status?.pending > 0 && <span className="rounded-full bg-muted px-1.5 text-xs font-semibold tabular-nums">{status.pending}</span>}
      </Button>
    </DialogTrigger>
    {open && <DialogContent
      className="sync-dialog rounded-2xl p-0"
      style={{ width: 'calc(100vw - 2rem)', maxWidth: '31rem', maxHeight: 'calc(100dvh - 2rem)' }}
    >
      <div className="sync-dialog-head">
        <DialogHeader className="text-left">
          <DialogTitle>Sincronización</DialogTitle>
          <DialogDescription>Consulta cuándo se actualizaron tus datos y las operaciones pendientes.</DialogDescription>
        </DialogHeader>
      </div>

      <div className="sync-dialog-body space-y-3">
        <div className={cn('sync-status-card', `sync-status-card-${tone}`)}>
          <div className="flex items-start gap-3">
            <span className={cn('sync-status-icon', `sync-status-icon-${tone}`)}>
              <Icon className={cn('h-5 w-5', checking && 'animate-spin')} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-snug text-foreground">{label}</p>
              {status && (
                <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                  {!status.initialized
                    ? 'Conecta a internet e inicia sesión para descargar los datos del negocio antes de trabajar sin conexión.'
                    : `${pendingLabel}.`}
                </p>
              )}
            </div>
          </div>
          {status && (
            <div className="sync-status-meta">
              <span className="text-xs text-muted-foreground tabular-nums">
                {`Última sincronización: ${dateLabel(status.lastSync)}`}
              </span>
            </div>
          )}
        </div>

        {(error || (status && (stale || status.connection === 'authentication' || status.connection === 'conflict' || status.conflict || status.error))) && (
          <div className={cn('sync-notice-box', needsReview ? 'sync-notice-danger' : 'sync-notice-warning')}>
            {error && <p role="alert" className="text-xs font-medium text-destructive">{error}</p>}
            {status && stale && (
              <p className="text-xs leading-relaxed text-foreground">
                El inventario y los saldos pueden estar desactualizados. Tus operaciones guardadas se conservan en este equipo.
              </p>
            )}
            {status?.connection === 'authentication' && (
              <p className="text-xs leading-relaxed text-foreground">
                Vuelve a iniciar sesión con internet para continuar la sincronización.
              </p>
            )}
            {(status?.connection === 'conflict' || status?.conflict) && (
              <p className="text-xs leading-relaxed text-foreground">
                Hay operaciones que requieren revisión. Los datos no se sobrescriben automáticamente.
              </p>
            )}
            {(status?.conflict || status?.error) && (
              <p className="text-xs font-medium text-destructive" style={{ overflowWrap: 'anywhere' }}>
                {status.conflict || status.error}
              </p>
            )}
          </div>
        )}

        {!review && (
          <PendingOperations
            refreshKey={[status?.pending, status?.lastSync, status?.conflict].join(':')}
            hasPendingHint={Boolean(status?.pending > 0 || status?.conflict || status?.connection === 'conflict')}
          />
        )}

        {status?.archived > 0 && (
          <div className="sync-section-card space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">
                  {`${status.archived} ${status.archived === 1 ? 'operación archivada' : 'operaciones archivadas'} para revisión.`}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Los originales se conservan. Archivar no confirma una venta en el servidor.
                </p>
              </div>
              <Button asChild variant="outline" size="sm" className="h-8 rounded-xl text-xs">
                <a href="/api/desktop/archive" download="historial-revision-felix.json">
                  <Download className="h-3.5 w-3.5" />
                  <span>Descargar historial de revisión</span>
                </a>
              </Button>
            </div>
          </div>
        )}

        {review && (
          <section className="sync-review-card space-y-3" aria-label="Revisión de pendientes">
            <div>
              <p className="text-sm font-semibold text-foreground">Revisa antes de continuar</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Estas operaciones dejarán de enviarse. Se conservará una copia completa en este equipo y se cargarán los datos del servidor. Revisa las ventas y los cobros antes de volver a registrarlos.
              </p>
            </div>
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {review.operations.map(row => (
                <li key={row.reference} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs">
                  <span className="text-foreground">{row.operation} · {dateLabel(row.date)}</span>
                  {row.total != null && <strong className="tabular-nums text-foreground">{formatMoney(row.total)}</strong>}
                </li>
              ))}
            </ul>
            <label className="flex cursor-pointer items-start gap-3 text-xs leading-relaxed" style={{ minHeight: 44 }}>
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" style={{ accentColor: 'hsl(var(--primary))' }} checked={acknowledged} disabled={reviewing} onChange={event => setAcknowledged(event.target.checked)} />
              <span>He revisado las operaciones y entiendo que quedarán archivadas para conciliación, sin enviarse como ventas nuevas.</span>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button style={{ minHeight: 44 }} className="rounded-xl" disabled={!acknowledged || reviewing} onClick={archivePending}>
                {reviewing ? 'Confirmando revisión…' : 'Archivar y actualizar'}
              </Button>
              <Button variant="outline" style={{ minHeight: 44 }} className="rounded-xl" disabled={reviewing} onClick={() => { setReview(null); setAcknowledged(false); }}>
                Volver
              </Button>
              <Button asChild variant="outline" style={{ minHeight: 44 }} className="rounded-xl">
                <a href="/api/desktop/export" download="operaciones-pendientes-felix.json">
                  <Download />
                  <span>Descargar operaciones</span>
                </a>
              </Button>
            </div>
          </section>
        )}

        {!review && (
          <div className={cn('sync-update-row', showUpdateBanner && 'sync-update-row-highlight')}>
            <div className="sync-update-copy min-w-0">
              <p className="text-xs font-semibold text-foreground">
                {showUpdateBanner
                  ? status.update.state === 'installing'
                    ? `Instalando actualización${status.update.version ? ` (v${status.update.version})` : ''}…`
                    : status.update.state === 'downloading'
                      ? `Descargando actualización${status.update.version ? ` (v${status.update.version})` : ''}…`
                      : `Actualización disponible${status.update.version ? ` (v${status.update.version})` : ''}`
                  : 'Actualizaciones'}
              </p>
              {showUpdateBanner ? (
                <p className={cn('mt-0.5 text-xs', status.update.state === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
                  {status.update.error || 'Tus datos y ventas pendientes se conservan.'}
                </p>
              ) : status?.update?.state === 'up_to_date' ? (
                <p role="status" className="mt-0.5 text-xs text-muted-foreground">
                  {`Tienes la última versión instalada${status.update.version ? ` (v${status.update.version})` : ''}.`}
                </p>
              ) : status?.update?.state === 'check_error' ? (
                <p role="alert" className="mt-0.5 text-xs text-destructive">
                  {status.update.error || 'No se pudo buscar actualizaciones.'}
                </p>
              ) : (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Comprueba si hay una versión nueva del POS.
                </p>
              )}
            </div>
            {showUpdateBanner && ['available', 'error'].includes(status.update.state) ? (
              <Button
                type="button"
                size="sm"
                className="h-9 shrink-0 rounded-xl"
                onClick={() => requestDesktopUpdate().catch(cause => setError(cause.message || 'No se pudo iniciar la actualización.'))}
              >
                <Download className="h-3.5 w-3.5" />
                <span>{status.update.state === 'error' ? 'Reintentar' : 'Actualizar ahora'}</span>
              </Button>
            ) : !['downloading', 'installing'].includes(status?.update?.state) ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 shrink-0 rounded-xl bg-card"
                disabled={checkingUpdateNow || syncing}
                onClick={checkUpdates}
              >
                <Download className={cn('h-3.5 w-3.5', checkingUpdateNow && 'animate-pulse')} />
                <span>{checkingUpdateNow ? 'Buscando…' : 'Buscar actualizaciones'}</span>
              </Button>
            ) : null}
          </div>
        )}
      </div>

      <div className="sync-dialog-foot">
        <div className="flex flex-wrap items-center gap-2">
          {!review && (status?.conflict || status?.connection === 'conflict' || status?.reconciling) && (
            <Button variant="outline" size="sm" className="h-9 rounded-xl" disabled={syncing || reviewing} onClick={reviewPending}>
              {reviewing ? 'Consultando pendientes…' : status?.reconciling ? 'Reanudar revisión' : 'Revisar pendientes'}
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button variant="outline" className="h-9 rounded-xl bg-card" onClick={() => setOpen(false)}>Cerrar</Button>
          <Button className="h-9 rounded-xl" disabled={syncing || reviewing || !!review || status?.reconciling} onClick={synchronize}>
            <RefreshCw className={cn('h-4 w-4', syncing && 'animate-spin')} />
            <span>{syncing ? 'Sincronizando…' : 'Sincronizar ahora'}</span>
          </Button>
        </div>
      </div>
    </DialogContent>}
  </Dialog>;
}

function PendingOperations({ refreshKey, hasPendingHint = false }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    fetch('/api/desktop/pending', { credentials: 'same-origin', cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!Array.isArray(data)) throw new Error();
        if (!controller.signal.aborted) setRows(data);
      }).catch(() => { if (!controller.signal.aborted) setError('No se pudo consultar la lista de operaciones locales.'); });
    return () => controller.abort();
  }, [refreshKey]);

  if (error) {
    return <p role="alert" className="text-xs text-destructive">{error}</p>;
  }
  if (!rows) {
    return hasPendingHint ? <p role="status" className="text-xs text-muted-foreground">Cargando operaciones…</p> : null;
  }
  if (rows.length === 0) {
    return null;
  }
  return (
    <div className="sync-pending-box">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3.5 py-2.5">
        <p className="text-xs font-semibold text-foreground">
          {`Operaciones pendientes (${rows.length})`}
        </p>
        <a
          href="/api/desktop/export"
          download="operaciones-pendientes-felix.json"
          className="sync-export-link"
        >
          <Download className="h-3.5 w-3.5" />
          <span>Descargar operaciones</span>
        </a>
      </div>
      <ul className="divide-y divide-border">
        {rows.map(row => (
          <li key={row.reference} className="px-3.5 py-2.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong className="font-semibold text-foreground">{row.operation}</strong>
              <span className={cn(
                'font-medium',
                row.status === 'conflict' ? 'text-primary' : 'text-amber-700 dark:text-amber-400',
              )}>
                {row.status === 'conflict' ? 'Requiere revisión' : 'Pendiente'}
              </span>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
              <span className="tabular-nums">{dateLabel(row.date)}</span>
              {row.total != null && <span className="font-semibold tabular-nums text-foreground">{formatMoney(row.total)}</span>}
            </div>
            {row.error && (
              <p className="mt-1 text-destructive" style={{ overflowWrap: 'anywhere' }}>{row.error}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

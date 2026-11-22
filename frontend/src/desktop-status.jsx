import { useCallback, useEffect, useRef, useState } from 'react';
import { CircleCheck, CloudUpload, CloudOff, CloudAlert, RefreshCw, Download } from 'lucide-react';
import { DialogTrigger } from '@radix-ui/react-dialog';
import { Button } from './components/ui/button.jsx';
import { Dialog2, DialogContent2, DialogHeader, DialogTitle2, DialogDescription2 } from './components/ui/dialog.jsx';
import { cn } from './lib/utils.js';
import { formatMoney } from './polymet/lib/format.js';

const dateFormat = new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo', dateStyle: 'short', timeStyle: 'short' });
const dateLabel = value => value && Number.isFinite(new Date(value).getTime()) ? dateFormat.format(new Date(value)) : 'No registrada';
const connectionLabels = { offline: 'Sin conexión', online: 'Al día', conflict: 'Revisar sincronización', authentication: 'Iniciar sesión' };

function validStatus(value) {
  return value && typeof value.initialized === 'boolean' && Object.hasOwn(connectionLabels, value.connection) &&
    Number.isSafeInteger(value.pending) && value.pending >= 0 &&
    (value.lastSync == null || typeof value.lastSync === 'string');
}

export function DesktopSyncStatus(props) {
  return window.__FELIX_DESKTOP__ ? <DesktopStatus {...props} /> : null;
}

function DesktopStatus({ onSync }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [open, setOpen] = useState(false);
  const current = useRef(null);
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
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => {
      mounted.current = false; request.current?.abort(); clearInterval(poll);
      window.removeEventListener('focus', focus);
      document.removeEventListener('visibilitychange', focus);
    };
  }, [load]);

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

  const needsReview = !!(error || status?.conflict || status?.connection === 'conflict' || status?.connection === 'authentication' || (status?.error && status.connection !== 'offline'));
  const label = syncing ? 'Sincronizando…' : needsReview ? (status?.connection === 'authentication' ? 'Iniciar sesión' : 'Revisar sincronización') :
    !status ? 'Comprobando…' : !status.initialized ? 'Preparar equipo' : status.connection === 'online' && status.pending ? 'Pendientes' : connectionLabels[status.connection];
  const pendingLabel = status?.pending ? `${status.pending} ${status.pending === 1 ? 'operación pendiente' : 'operaciones pendientes'}` : 'Sin operaciones pendientes';
  const Icon = syncing || !status ? RefreshCw : needsReview ? CloudAlert : status.connection === 'offline' ? CloudOff : status.pending ? CloudUpload : CircleCheck;
  const stale = status && (status.connection !== 'online' || status.pending > 0 || needsReview);
  const summary = `${label}${status ? `. ${pendingLabel}. Última sincronización: ${dateLabel(status.lastSync)}.${stale ? ' Inventario y saldos sin actualizar.' : ''}` : ''}`;

  return <Dialog2 open={open} onOpenChange={setOpen}>
    <span role="status" aria-atomic="true" className="sr-only">{summary}</span>
    <DialogTrigger asChild>
      <Button variant="outline" className={cn('h-10 rounded-xl bg-card', needsReview ? 'text-destructive' : stale ? 'text-amber-700 dark:text-amber-400' : status && 'text-emerald-700 dark:text-emerald-400')}
        aria-label={`Sincronización: ${label}${status?.pending ? `, ${pendingLabel}` : ''}`} title={summary}>
        <Icon className={cn(syncing && 'animate-spin')} />
        <span className="hidden lg:inline">{label}</span>
        {status?.pending > 0 && <span className="rounded-full bg-muted px-1.5 text-xs font-semibold tabular-nums">{status.pending}</span>}
      </Button>
    </DialogTrigger>
    {open && <DialogContent2 className="max-w-lg overflow-y-auto rounded-2xl" style={{ width: 'calc(100vw - 2rem)', maxHeight: 'calc(100dvh - 2rem)' }}>
      <DialogHeader><DialogTitle2>Sincronización</DialogTitle2>
        <DialogDescription2>Consulta cuándo se actualizaron tus datos y las operaciones pendientes.</DialogDescription2></DialogHeader>
      <div className="space-y-2 text-sm">
        <p className="font-semibold">{label}</p>
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {status && <>
          {!status.initialized ? <p>Conecta a internet e inicia sesión para descargar los datos del negocio antes de trabajar sin conexión.</p> : <p>{pendingLabel}.</p>}
          <p className="text-muted-foreground">Última sincronización: {dateLabel(status.lastSync)}.</p>
          {stale && <p>El inventario y los saldos pueden estar desactualizados. Tus operaciones guardadas se conservan en este equipo.</p>}
          {status.connection === 'authentication' && <p>Vuelve a iniciar sesión con internet para continuar la sincronización.</p>}
          {(status.connection === 'conflict' || status.conflict) && <p>Hay operaciones que requieren revisión. Los datos no se sobrescriben automáticamente.</p>}
          {(status.conflict || status.error) && <p className="text-destructive" style={{ overflowWrap: 'anywhere' }}>{status.conflict || status.error}</p>}
        </>}
      </div>
      <PendingOperations refreshKey={[status?.pending, status?.lastSync, status?.conflict].join(':')} />
      <div className="flex flex-wrap gap-2">
        <Button disabled={syncing} onClick={synchronize}><RefreshCw className={cn(syncing && 'animate-spin')} />{syncing ? 'Sincronizando…' : 'Sincronizar ahora'}</Button>
        <Button variant="outline" onClick={() => setOpen(false)}>Cerrar</Button>
      </div>
    </DialogContent2>}
  </Dialog2>;
}

function PendingOperations({ refreshKey }) {
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
  return <>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!rows ? !error && <p role="status">Cargando operaciones…</p> : rows.length === 0 ? <p>No hay operaciones locales pendientes.</p> :
        <ul className="space-y-3">{rows.map(row => <li key={row.reference} className="space-y-1 rounded-xl border border-border bg-card p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><strong>{row.operation}</strong><span>{row.status === 'conflict' ? 'Requiere revisión' : 'Pendiente'}</span></div>
          <p className="text-xs text-muted-foreground">{dateLabel(row.date)}</p>
          {row.total != null && <p className="font-semibold tabular-nums">{formatMoney(row.total)}</p>}
          {row.error && <p className="text-destructive" style={{ overflowWrap: 'anywhere' }}>{row.error}</p>}
        </li>)}</ul>}
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline"><a href="/api/desktop/export" download="operaciones-pendientes-felix.json"><Download />Descargar operaciones</a></Button>
      </div>
  </>;
}

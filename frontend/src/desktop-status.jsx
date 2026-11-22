import { useCallback, useEffect, useRef, useState } from 'react';
import { HardDrive, RefreshCw, Download } from 'lucide-react';
import { Button } from './components/ui/button.jsx';
import { Dialog2, DialogContent2, DialogHeader, DialogTitle2, DialogDescription2 } from './components/ui/dialog.jsx';
import { formatMoney } from './polymet/lib/format.js';

const dateFormat = new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo', dateStyle: 'short', timeStyle: 'short' });
const dateLabel = value => value && Number.isFinite(new Date(value).getTime()) ? dateFormat.format(new Date(value)) : 'No registrada';
const connectionLabels = { offline: 'Sin conexión al servidor', online: 'Servidor disponible', conflict: 'Conflicto de sincronización', authentication: 'Sesión del servidor pendiente' };

function validStatus(value) {
  return value && typeof value.initialized === 'boolean' && Object.hasOwn(connectionLabels, value.connection) &&
    Number.isSafeInteger(value.pending) && value.pending >= 0 &&
    (value.lastSync == null || typeof value.lastSync === 'string');
}

export function DesktopNotice(props) {
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
        setError('No se pudo consultar el estado local. La información anterior puede estar desactualizada.');
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

  return <section aria-label="Estado de Windows" className="mb-4 space-y-3 rounded-xl border border-border bg-card p-4 text-sm">
    <div className="flex items-center gap-2 font-semibold"><HardDrive className="h-4 w-4 text-primary" />Este equipo · almacenamiento local</div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!status ? <p role="status">Consultando almacenamiento local…</p> : <div role="status" className="space-y-1">
      <p className="font-semibold">{connectionLabels[status.connection]}</p>
      {!status.initialized ? <>
        <p>Este equipo aún no tiene datos del negocio.</p>
        <p>Conecta con el servidor e inicia sesión para completar la primera descarga antes de trabajar sin internet.</p>
      </> : <>
        <p>Las operaciones confirmadas localmente quedan guardadas en este equipo.</p>
        <p>{status.pending ? `${status.pending} ${status.pending === 1 ? 'operación pendiente' : 'operaciones pendientes'} de confirmación del servidor.` : 'Sin operaciones pendientes'}</p>
      </>}
      <p>Última sincronización: {dateLabel(status.lastSync)}.</p>
      {(status.connection !== 'online' || status.pending > 0) && <p>Datos del servidor desactualizados. El inventario y los saldos globales pueden haber cambiado.</p>}
      {status.connection === 'authentication' && <p>Renueva la sesión del servidor. Las operaciones locales no se han descartado.</p>}
      {(status.connection === 'conflict' || status.conflict) && <p>Revisa el conflicto antes de continuar la sincronización. Los datos no se sobrescriben automáticamente.</p>}
      {(status.conflict || status.error) && <p className="text-destructive" style={{ overflowWrap: 'anywhere' }}>{status.conflict || status.error}</p>}
    </div>}
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={syncing} onClick={synchronize}><RefreshCw />{syncing ? 'Sincronizando…' : 'Sincronizar ahora'}</Button>
      <Button variant="outline" onClick={() => setOpen(true)}>Ver operaciones locales</Button>
    </div>
    {open && <PendingOperations onClose={() => setOpen(false)} refreshKey={[status?.pending, status?.lastSync, status?.conflict].join(':')} />}
  </section>;
}

function PendingOperations({ onClose, refreshKey }) {
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
  return <Dialog2 open onOpenChange={value => { if (!value) onClose(); }}>
    <DialogContent2 className="max-w-lg overflow-y-auto rounded-2xl" style={{ width: 'calc(100vw - 2rem)', maxHeight: 'calc(100dvh - 2rem)' }}>
      <DialogHeader><DialogTitle2>Operaciones de este equipo</DialogTitle2>
        <DialogDescription2>Guardadas localmente y pendientes de confirmación del servidor. Los conflictos no se sobrescriben automáticamente.</DialogDescription2></DialogHeader>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!rows ? !error && <p role="status">Cargando operaciones…</p> : rows.length === 0 ? <p>No hay operaciones locales pendientes.</p> :
        <ul className="space-y-3">{rows.map(row => <li key={row.reference} className="space-y-1 rounded-xl border border-border bg-card p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2"><strong>{row.operation}</strong><span>{row.status === 'conflict' ? 'Requiere revisión' : 'Pendiente'}</span></div>
          <p className="text-xs text-muted-foreground">{dateLabel(row.date)}</p>
          <p className="font-mono text-xs" style={{ overflowWrap: 'anywhere' }}>{row.reference}</p>
          {row.total != null && <p className="font-semibold tabular-nums">{formatMoney(row.total)}</p>}
          {row.error && <p className="text-destructive" style={{ overflowWrap: 'anywhere' }}>{row.error}</p>}
        </li>)}</ul>}
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline"><a href="/api/desktop/export" download="operaciones-pendientes-felix.json"><Download />Descargar operaciones</a></Button>
        <Button onClick={onClose}>Cerrar</Button>
      </div>
    </DialogContent2>
  </Dialog2>;
}

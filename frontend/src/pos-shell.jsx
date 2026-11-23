import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Component, Fragment, Suspense, useEffect, useRef, useState } from 'react';
import { loadingLabel } from './loading-labels.js';
import { Toaster } from './components/ui/sonner.jsx';
import { Button } from './components/ui/button.jsx';
import { Dialog2, DialogContent2, DialogHeader, DialogTitle2, DialogDescription2 } from './components/ui/dialog.jsx';
import { usePosStore } from './data/pos-context.jsx';
import { SaleDraftProvider, useSaleDraft } from './data/sale-draft.jsx';
import { ModulePlaceholderPage } from './polymet/pages/module-placeholder-page.jsx';
import { PosLayout } from './polymet/layouts/pos-layout.jsx';
import { formatMoney, formatUnitMoney } from './polymet/lib/format.js';
import { PwaProvider, PwaNotice } from './pwa.jsx';

const syncTime = new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo', dateStyle: 'short', timeStyle: 'short' });
const dateLabel = value => value && Number.isFinite(Date.parse(value)) ? syncTime.format(new Date(value)) : 'No registrada';
const operations = { ventas: 'Venta', 'ventas/anular': 'Anulación de venta', compras: 'Compra', productos: 'Artículo',
  clientes: 'Cliente', suplidores: 'Suplidor', formulas: 'Fórmula de precios', configuracion: 'Configuración',
  ncf: 'Secuencia NCF', 'cuentas/cobros': 'Cobro a cliente', 'cuentas/pagos': 'Pago a suplidor',
  'caja/abrir': 'Apertura de caja', 'caja/cerrar': 'Cierre de caja', 'caja/movimiento': 'Movimiento de caja' };
const OWNER_ONLY_ROUTES = new Set(['/compras', '/suplidores', '/reportes', '/cuentas-por-pagar']);

function OwnerOnlyNotice() {
  return (
    <section className="mx-auto max-w-md space-y-4 rounded-2xl border border-border bg-card p-6 text-center">
      <h1 className="text-lg font-semibold">Acceso restringido</h1>
      <p className="text-sm text-muted-foreground">
        Esta sección solo está disponible para el dueño del negocio.
      </p>
      <Button asChild className="rounded-xl">
        <Link to="/ventas">Ir a Ventas</Link>
      </Button>
    </section>
  );
}

function PacketDetails({ packet }) {
  let payload = {};
  try {
    const parsed = JSON.parse(packet.body);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) payload = parsed;
  } catch { /* Preserve a malformed legacy packet for manual review. */ }
  const resource = packet.path?.slice(5).replace(/\/\d+$/, '');
  return <div className="space-y-2 text-sm" style={{ overflowWrap: 'anywhere' }}>
    <p className="font-semibold">{operations[resource] ?? 'Solicitud'}{packet.method === 'DELETE' ? ' · Eliminación' : packet.method === 'PUT' ? ' · Cambio' : ''}</p>
    <dl className="space-y-1">
      <div><dt className="text-muted-foreground">Fecha de solicitud</dt><dd>{dateLabel(packet.createdAt)}</dd></div>
    </dl>
    {payload.nombre && <p>{payload.nombre}</p>}
    {payload.codigo && <p>Código: {payload.codigo}</p>}
    {payload.numero && <p>Factura del suplidor: {payload.numero}</p>}
    {payload.concepto && <p>{payload.concepto}</p>}
    {Array.isArray(payload.items) && <ul className="space-y-1">{payload.items.map((item, index) => <li key={index}>
      {item.nombre || item.codigo || `Artículo ${index + 1} (descripción no conservada)`} · Cantidad: {item.cantidad}
    </li>)}</ul>}
    {Object.entries({ monto: 'Monto', conteo: 'Conteo', costo: 'Costo', precio1: 'Precio 1', stock: 'Existencia' })
      .filter(([key]) => payload[key] != null && Number.isFinite(Number(payload[key])))
      .map(([key, label]) => <p key={key}>{label}: {key === 'stock' ? payload[key] : ['costo', 'precio1'].includes(key) ? formatUnitMoney(Number(payload[key])) : formatMoney(Number(payload[key]))}</p>)}
    <p className="text-muted-foreground">Resultado original sin confirmar. Comprueba los registros anteriores antes de registrar esta operación otra vez.</p>
  </div>;
}

function downloadRecord(record) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = `solicitud-${record.packet.id}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ReviewPending({ runtime, review, close, restoreFocus }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const inFlight = useRef(false);
  async function archive() {
    if (inFlight.current || !acknowledged) return;
    inFlight.current = true; setSending(true); setError(null);
    try {
      await runtime.archivePending({ operationId: review.packet.id, databaseId: review.databaseId, acknowledged, reviewedPacket: review.packet });
      close();
    } catch (cause) { setError(cause.message); }
    finally { inFlight.current = false; setSending(false); }
  }
  return <Dialog2 open onOpenChange={open => { if (!open && !inFlight.current) close(); }}>
    <DialogContent2 closeDisabled={sending} aria-busy={sending} onCloseAutoFocus={restoreFocus}
      className="max-w-lg overflow-y-auto rounded-2xl" style={{ width: 'calc(100vw - 2rem)', maxHeight: 'calc(100dvh - 2rem)' }}>
      <DialogHeader><DialogTitle2>Revisar solicitud pendiente</DialogTitle2>
        <DialogDescription2>Los datos del negocio cambiaron. Esta solicitud corresponde a los datos anteriores y requiere revisión.</DialogDescription2></DialogHeader>
      <PacketDetails packet={review.packet} />
      <p className="text-sm">Archivar conserva el registro en este navegador y permite nuevas operaciones. No confirma ni anula la solicitud original.</p>
      <Button variant="outline" style={{ minHeight: 44 }} onClick={() => downloadRecord({ packet: review.packet, currentDatabaseId: review.databaseId, status: 'pending-review' })}>Descargar registro</Button>
      <label className="flex cursor-pointer items-start gap-3 py-2 text-sm" style={{ minHeight: 44 }}>
        <input type="checkbox" checked={acknowledged} disabled={sending} onChange={event => setAcknowledged(event.target.checked)}
          className="mt-1 h-4 w-4 shrink-0" style={{ accentColor: 'hsl(var(--primary))' }} />
        <span>Revisé la solicitud y entiendo que pudo haberse confirmado antes del cambio.</span>
      </label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button style={{ minHeight: 44 }} disabled={!acknowledged || sending || runtime.busy} onClick={archive}>{sending ? 'Archivando…' : 'Archivar y continuar'}</Button>
        <Button style={{ minHeight: 44 }} variant="outline" disabled={sending} onClick={close}>Cancelar</Button>
      </div>
    </DialogContent2>
  </Dialog2>;
}

function ArchivedRequests({ runtime, close, restoreFocus }) {
  const [records, setRecords] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let current = true;
    runtime.readArchives().then(rows => { if (current) setRecords(rows); }, cause => { if (current) setError(cause.message); });
    return () => { current = false; };
  }, [runtime.readArchives]);
  return <Dialog2 open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent2 onCloseAutoFocus={restoreFocus} className="max-w-lg overflow-y-auto rounded-2xl"
      style={{ width: 'calc(100vw - 2rem)', maxHeight: 'calc(100dvh - 2rem)' }}>
      <DialogHeader><DialogTitle2>Solicitudes archivadas</DialogTitle2>
        <DialogDescription2>Estos registros se conservan en este navegador y nunca se reenvían automáticamente. Descarga una copia antes de borrar los datos de la app.</DialogDescription2></DialogHeader>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!records && !error && <p role="status">Cargando registros…</p>}
      {records?.length === 0 && <p>No hay solicitudes archivadas.</p>}
      {records?.map(record => <section key={record.packet.id} className="space-y-3 rounded-xl border border-border bg-card p-3">
        <PacketDetails packet={record.packet} />
        <p className="text-sm text-muted-foreground">Archivada el {dateLabel(record.archivedAt)}.</p>
        <Button variant="outline" style={{ minHeight: 44 }} onClick={() => downloadRecord(record)}>Descargar registro</Button>
      </section>)}
      <Button style={{ minHeight: 44 }} variant="outline" onClick={close}>Cerrar</Button>
    </DialogContent2>
  </Dialog2>;
}

function ServiceNotice({ runtime }) {
  const draft = useSaleDraft();
  const { pathname } = useLocation();
  const [review, setReview] = useState(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const reviewTrigger = useRef(null), historyTrigger = useRef(null);
  const restoreFocus = (event, trigger = reviewTrigger) => {
    const target = trigger.current ?? historyTrigger.current;
    if (target) { event.preventDefault(); target.focus(); }
  };
  if (!runtime || (!runtime.pending && !runtime.error && !runtime.archiveCount && !review && !historyOpen && runtime.connection !== 'unavailable')) return null;
  const changed = runtime.pending && runtime.databaseId && runtime.pending.databaseId !== runtime.databaseId;
  // A write actively being sent in this tab is not an interrupted pending request.
  const activeSending = Boolean(runtime.pending && !changed && runtime.inFlightOperationId === runtime.pending.id);
  // The sale already shows its exact retry here. Other routes retain the global
  // recovery action, and a changed database always keeps its explicit warning.
  const saleHandlesFailure = !changed && pathname === '/ventas' && draft?.failure?.retry &&
    (!runtime.pending || draft.failure.operationId === runtime.pending.id);
  const suppressPending = activeSending || saleHandlesFailure;
  if (suppressPending && !runtime.error && !runtime.archiveCount && !review && !historyOpen && runtime.connection !== 'unavailable') return null;
  const action = runtime.pending && !changed ? runtime.retryPending : runtime.reload;
  return (
    <div role="status" className="mb-4 space-y-2 rounded-xl border border-border bg-card p-4 text-sm">
      {runtime.pending && !suppressPending && <p className="font-semibold">{changed ? 'La solicitud pendiente pertenece a otra base. Requiere revisión.' : runtime.recovering ? 'Comprobando la solicitud pendiente…' : 'Solicitud pendiente de confirmación'}</p>}
      {runtime.error && !saleHandlesFailure && <p>{runtime.error}</p>}
      {runtime.connection === 'unavailable' && !saleHandlesFailure && <p>Sin conexión al servicio. {runtime.mode === 'online' && 'La web y la PWA requieren conexión para confirmar operaciones.'}</p>}
      {runtime.connection === 'unavailable' && runtime.lastSync && !saleHandlesFailure && <p>Datos desactualizados. Última sincronización el {syncTime.format(new Date(runtime.lastSync))}.</p>}
      <div className="flex flex-wrap gap-2">
        {changed ? <Button ref={reviewTrigger} style={{ minHeight: 44 }} variant="outline" disabled={runtime.busy || runtime.recovering}
          onClick={() => setReview({ packet: runtime.pending, databaseId: runtime.databaseId })}>Revisar solicitud</Button> :
          !suppressPending && (runtime.pending || runtime.error || runtime.connection === 'unavailable') && <Button className={runtime.pending ? undefined : 'desktop-data-refresh'} variant="outline" disabled={runtime.busy || runtime.recovering} onClick={() => action().catch(() => {})}>
            {runtime.pending ? 'Reintentar solicitud' : 'Actualizar datos'}
          </Button>}
        {!!runtime.archiveCount && <Button ref={historyTrigger} style={{ minHeight: 44 }} variant="outline" onClick={() => setHistoryOpen(true)}>Solicitudes archivadas ({runtime.archiveCount})</Button>}
      </div>
      {review && <ReviewPending key={review.packet.id + review.databaseId} runtime={runtime} review={review} close={() => setReview(null)} restoreFocus={restoreFocus} />}
      {historyOpen && <ArchivedRequests runtime={runtime} close={() => setHistoryOpen(false)} restoreFocus={event => restoreFocus(event, historyTrigger)} />}
    </div>
  );
}

function InitialLoad({ runtime }) {
  const { pathname } = useLocation();
  const failed = !!runtime.error && !runtime.busy;
  return (
    <main className="pos-startup" aria-busy={!failed}>
      <img src="/icons/icon-192.png" alt="" width="64" height="64" />
      <h1>Félix POS</h1>
      {failed ? <div className="pos-startup-error">
        <p role="alert">{runtime.readErrorRetryable ? 'Restableciendo la conexión…' : runtime.error}</p>
        {runtime.readErrorRetryable && <p>Volveremos a intentarlo automáticamente.</p>}
        {runtime.pending && <p>{runtime.pending.path === '/api/ventas' ? 'Tu venta pendiente se comprobará al reconectar.' : 'Tu solicitud pendiente se comprobará al reconectar.'}</p>}
        <Button onClick={() => runtime.reload({ recover: true, resumeRecovery: true }).catch(() => {})}>Reintentar</Button>
      </div> : <p role="status"><span className="pos-startup-spinner" aria-hidden="true" />{loadingLabel(pathname)}</p>}
    </main>
  );
}

function ModuleLoad() {
  const { pathname } = useLocation();
  return <div className="flex items-center justify-center gap-3 text-muted-foreground" style={{ minHeight: 192 }} role="status" aria-busy="true">
    <span className="pos-startup-spinner" aria-hidden="true" />{loadingLabel(pathname, 'module')}
  </div>;
}

class ModuleBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <div className="space-y-3 rounded-xl border bg-card p-4">
      <p role="alert">No se pudo abrir este módulo. Revisa la conexión y vuelve a intentarlo.</p>
      <Button onClick={() => location.reload()}>Reintentar</Button>
    </div> : this.props.children;
  }
}

function ModuleContent({ children }) {
  const { pathname } = useLocation();
  return <ModuleBoundary key={pathname}><Suspense fallback={<ModuleLoad />}>{children}</Suspense></ModuleBoundary>;
}

export function PosShell({ pages, homePath }) {
  const { runtime } = usePosStore();
  const Draft = runtime ? SaleDraftProvider : Fragment;
  if (runtime?.authenticationRequired) return (
    <main className="mx-auto max-w-sm space-y-4 p-6">
      <p role="status">Inicia sesión para acceder al sistema.</p>
      <Button asChild><a href="/login">Iniciar sesión</a></Button>
    </main>
  );
  return (
    <PwaProvider enabled={!!runtime}><BrowserRouter>
      {runtime && !runtime.snapshot ? <InitialLoad runtime={runtime} /> : <Draft><PosLayout>
        <PwaNotice runtime={runtime} />
        <ServiceNotice runtime={runtime} />
        <ModuleContent><Routes>
          {homePath && <Route path="/" element={<Navigate to={homePath} replace />} />}
          {Object.entries(pages).map(([path, Page]) => (
            <Route
              key={path}
              path={path}
              element={runtime && !runtime.isOwner && OWNER_ONLY_ROUTES.has(path) ? <OwnerOnlyNotice /> : <Page />}
            />
          ))}
          <Route path="*" element={<ModulePlaceholderPage operational={!!runtime} />} />
        </Routes></ModuleContent>
      </PosLayout></Draft>}
      <Toaster position="top-center" richColors={true} mobileOffset={{ top: 'calc(16px + env(safe-area-inset-top))' }} />
    </BrowserRouter></PwaProvider>
  );
}

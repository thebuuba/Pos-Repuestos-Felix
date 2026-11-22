import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Component, Suspense } from 'react';
import { loadingLabel } from './loading-labels.js';
import { Toaster } from './components/ui/sonner.jsx';
import { Button } from './components/ui/button.jsx';
import { usePosStore } from './data/pos-context.jsx';
import { ModulePlaceholderPage } from './polymet/pages/module-placeholder-page.jsx';
import { PosLayout } from './polymet/layouts/pos-layout.jsx';
import { PwaProvider, PwaNotice } from './pwa.jsx';

const syncTime = new Intl.DateTimeFormat('es-DO', { timeZone: 'America/Santo_Domingo', dateStyle: 'short', timeStyle: 'short' });

function ServiceNotice({ runtime }) {
  if (!runtime || (!runtime.pending && !runtime.error && runtime.connection !== 'unavailable')) return null;
  const changed = runtime.pending && runtime.databaseId && runtime.pending.databaseId !== runtime.databaseId;
  const action = runtime.pending && !changed ? runtime.retryPending : runtime.reload;
  return (
    <div role="status" className="mb-4 space-y-2 rounded-xl border border-border bg-card p-4 text-sm">
      {runtime.pending && <p className="font-semibold">{changed ? 'La solicitud pendiente pertenece a otra base. Requiere revisión.' : 'Solicitud pendiente de confirmación'}</p>}
      {runtime.error && <p>{runtime.error}</p>}
      {runtime.connection === 'unavailable' && <p>Sin conexión al servicio. {runtime.mode === 'online' && 'La web y la PWA requieren conexión para confirmar operaciones.'}</p>}
      {runtime.connection === 'unavailable' && runtime.lastSync && <p>Datos desactualizados. Última sincronización el {syncTime.format(new Date(runtime.lastSync))}.</p>}
      <Button className={runtime.pending && !changed ? undefined : 'desktop-data-refresh'} variant="outline" disabled={runtime.busy} onClick={() => action().catch(() => {})}>
        {runtime.pending && !changed ? 'Reintentar solicitud' : 'Actualizar datos'}
      </Button>
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
        <p role="alert">{runtime.error}</p>
        {runtime.connection === 'unavailable' && <p>Sin conexión al servicio.</p>}
        {runtime.pending && <p>Hay una solicitud pendiente de confirmación.</p>}
        <Button onClick={() => runtime.reload().catch(() => {})}>Reintentar</Button>
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
  if (runtime?.authenticationRequired) return (
    <main className="mx-auto max-w-sm space-y-4 p-6">
      <p role="status">Inicia sesión para acceder al sistema.</p>
      <Button asChild><a href="/login">Iniciar sesión</a></Button>
    </main>
  );
  return (
    <PwaProvider enabled={!!runtime}><BrowserRouter>
      {runtime && !runtime.snapshot ? <InitialLoad runtime={runtime} /> : <PosLayout>
        <PwaNotice runtime={runtime} />
        <ServiceNotice runtime={runtime} />
        <ModuleContent><Routes>
          {homePath && <Route path="/" element={<Navigate to={homePath} replace />} />}
          {Object.entries(pages).map(([path, Page]) => (
            <Route key={path} path={path} element={<Page />} />
          ))}
          <Route path="*" element={<ModulePlaceholderPage operational={!!runtime} />} />
        </Routes></ModuleContent>
      </PosLayout>}
      <Toaster position="top-center" richColors={true} mobileOffset={{ top: 'calc(16px + env(safe-area-inset-top))' }} />
    </BrowserRouter></PwaProvider>
  );
}

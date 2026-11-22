import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Toaster } from './components/ui/sonner.jsx';
import { Button } from './components/ui/button.jsx';
import { usePosStore } from './data/pos-context.jsx';
import { ModulePlaceholderPage } from './polymet/pages/module-placeholder-page.jsx';
import { PosLayout } from './polymet/layouts/pos-layout.jsx';
import { PwaProvider, PwaNotice } from './pwa.jsx';
import { DesktopNotice } from './desktop-status.jsx';

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
      <Button variant="outline" disabled={runtime.busy} onClick={() => action().catch(() => {})}>
        {runtime.pending && !changed ? 'Reintentar solicitud' : 'Actualizar datos'}
      </Button>
    </div>
  );
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
      <PosLayout>
        <PwaNotice runtime={runtime} />
        <DesktopNotice onSync={() => runtime?.reload?.()} />
        <ServiceNotice runtime={runtime} />
        <Routes>
          {homePath && <Route path="/" element={<Navigate to={homePath} replace />} />}
          {Object.entries(pages).map(([path, Page]) => (
            <Route key={path} path={path} element={
              runtime && !runtime.snapshot
                ? <p role="status">{runtime.busy ? 'Cargando catálogo…' : 'El catálogo está pendiente de sincronización.'}</p>
                : <Page />
            } />
          ))}
          <Route path="*" element={<ModulePlaceholderPage operational={!!runtime} />} />
        </Routes>
      </PosLayout>
      <Toaster position="top-center" richColors={true} />
    </BrowserRouter></PwaProvider>
  );
}

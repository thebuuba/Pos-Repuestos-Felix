import { createContext, useContext, useEffect, useState } from 'react';
import { Button } from './components/ui/button.jsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './components/ui/dialog.jsx';

const PwaContext = createContext(null);
export const usePwa = () => useContext(PwaContext);

export function PwaProvider({ enabled, children }) {
  const available = enabled && !window.__FELIX_DESKTOP__;
  const [help, setHelp] = useState(false);
  const [prompt, setPrompt] = useState(null);
  const [installed, setInstalled] = useState(() => window.matchMedia('(display-mode: standalone)').matches || !!navigator.standalone);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    document.documentElement.classList.toggle('pwa-standalone', !!available && installed);
    return () => document.documentElement.classList.remove('pwa-standalone');
  }, [available, installed]);
  useEffect(() => {
    if (!available) return;
    let disposed = false, registration;
    const display = window.matchMedia('(display-mode: standalone)');
    const onInstall = event => { event.preventDefault(); setPrompt(event); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); setHelp(false); };
    const onDisplay = event => setInstalled(event.matches || !!navigator.standalone);
    const onUpdate = () => {
      const worker = registration?.installing;
      const check = () => {
        if (!disposed) setWaiting(!!(registration?.waiting && navigator.serviceWorker.controller));
      };
      worker?.addEventListener('statechange', check);
      check();
    };
    const checkUpdate = () => { if (!document.hidden && navigator.onLine !== false) registration?.update().catch(() => {}); };
    const periodicCheck = window.setInterval(checkUpdate, 5 * 60 * 1000);
    window.addEventListener('beforeinstallprompt', onInstall);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('online', checkUpdate);
    document.addEventListener('visibilitychange', checkUpdate);
    display.addEventListener('change', onDisplay);
    let warmTimer = null;
    if (window.isSecureContext && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(result => {
        if (disposed) return;
        registration = result;
        registration.addEventListener('updatefound', onUpdate);
        onUpdate();
        if (navigator.serviceWorker.controller) {
          warmTimer = window.setTimeout(() => {
            if (!disposed && !document.hidden) navigator.serviceWorker.controller?.postMessage({ type: 'WARM_OPTIONAL' });
          }, 2500);
        }
      }).catch(() => { if (!disposed) setError('No se pudo preparar la aplicación para abrir su interfaz sin conexión. Reintenta al volver a abrirla con internet.'); });
    } else setError('La instalación requiere HTTPS y un navegador compatible.');
    return () => {
      disposed = true;
      window.clearInterval(periodicCheck);
      if (warmTimer !== null) window.clearTimeout(warmTimer);
      window.removeEventListener('beforeinstallprompt', onInstall);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('online', checkUpdate);
      document.removeEventListener('visibilitychange', checkUpdate);
      display.removeEventListener('change', onDisplay);
      registration?.removeEventListener('updatefound', onUpdate);
    };
  }, [available]);
  const install = async () => {
    const event = prompt;
    setPrompt(null);
    try {
      await event.prompt();
      // Only appinstalled/display-mode confirms installation; accepting the dialog alone does not.
      await event.userChoice;
    } catch { setError('El navegador no pudo abrir la instalación.'); }
  };
  const applyUpdate = async () => {
    if (!('serviceWorker' in navigator)) { location.reload(); return; }
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const target = reg?.waiting;
      if (target) {
        await new Promise((resolve) => {
          const timer = window.setTimeout(resolve, 2500);
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            window.clearTimeout(timer);
            resolve();
          }, { once: true });
          target.postMessage({ type: 'SKIP_WAITING' });
        });
      }
    } catch { /* fallback to reload */ }
    location.reload();
  };
  return <PwaContext.Provider value={available ? { installed, waiting, error, applyUpdate, openHelp: () => setHelp(true) } : null}>
    {children}
    {available && <Dialog open={help} onOpenChange={setHelp}>
      <DialogContent className="pwa-install-dialog" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Instalar Repuestos Félix</DialogTitle>
        </DialogHeader>
        {error && <p role="status" className="text-sm text-destructive">{error}</p>}
        {prompt && <Button onClick={install}>Instalar ahora</Button>}
      </DialogContent>
    </Dialog>}
  </PwaContext.Provider>;
}

export function PwaNotice({ runtime }) {
  const pwa = usePwa();
  if (!pwa?.waiting && !pwa?.error) return null;
  const blocked = Boolean(runtime?.pending || runtime?.busy);
  return <div role="status" className={`${pwa.error ? '' : 'pwa-update-notice '}mb-4 space-y-2 rounded-xl border border-border bg-card p-4 text-sm`}>
    {pwa.waiting && <>
      <p className="font-semibold">Actualización disponible</p>
      <p>{blocked
        ? 'Primero resuelve las solicitudes pendientes de confirmación. La aplicación no se recargará automáticamente.'
        : 'Hay una versión nueva lista. Puedes aplicarla ahora o al volver a abrir Repuestos Félix.'}</p>
      {!blocked && <Button type="button" size="sm" variant="outline" onClick={() => pwa.applyUpdate()}>Actualizar ahora</Button>}
    </>}
    {pwa.error && <p>{pwa.error}</p>}
  </div>;
}

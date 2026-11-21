export function setupPWA() {
  const button = document.getElementById('install-app');
  const help = document.getElementById('install-help');
  const offline = document.getElementById('offline-notice');
  const standalone = window.matchMedia?.('(display-mode: standalone)');
  let installPrompt;
  const installed = () => {
    button.hidden = true; help.hidden = true; button.setAttribute('aria-expanded', 'false');
  };
  if (standalone?.matches || window.navigator.standalone) installed();
  standalone?.addEventListener('change', (event) => { if (event.matches) installed(); });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault(); installPrompt = event; button.hidden = false;
  });
  window.addEventListener('appinstalled', installed);
  window.instalarApp = async function () {
    if (installPrompt) {
      const prompt = installPrompt; installPrompt = null;
      try {
        await prompt.prompt();
        if ((await prompt.userChoice).outcome === 'accepted') installed();
      } catch { help.hidden = false; }
    } else help.hidden = !help.hidden;
    button.setAttribute('aria-expanded', String(!help.hidden));
  };
  const connection = () => { offline.hidden = window.navigator.onLine; };
  window.addEventListener('online', connection);
  window.addEventListener('offline', connection);
  connection();
  if (window.isSecureContext && 'serviceWorker' in window.navigator) {
    window.navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {
      help.hidden = false;
      help.insertAdjacentHTML('beforeend', '<p>No se pudo activar el modo instalable. Puedes seguir usando el sistema en el navegador y reintentar al volver a abrirlo.</p>');
    });
  }
}

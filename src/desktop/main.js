import { mkdir, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createPipeServer } from 'node:net';
import { createHash } from 'node:crypto';
import { DesktopLedger } from './ledger.js';
import { DesktopEngine } from './engine.js';
import { RemoteClient } from './credentials.js';
import { desktopServer } from './server.js';

async function lockDirectory(directory) {
  await mkdir(directory, { recursive: true });
  // The OS owns exclusivity and releases it even after an abrupt process exit.
  // A stale PID file cannot safely be deleted by competing startup processes.
  if (process.platform !== 'win32') throw new Error('Esta aplicación de escritorio requiere Windows.');
  const key = createHash('sha256').update((await realpath(directory)).toLowerCase()).digest('hex');
  const pipe = createPipeServer(socket => socket.destroy());
  await new Promise((done, reject) => {
    pipe.once('error', () => reject(new Error('El POS ya está abierto en este equipo o no se pudo reservar su acceso.')));
    pipe.listen('\\\\.\\pipe\\repuestos-felix-' + key, done);
  });
  return () => new Promise(done => pipe.close(done));
}

export async function startDesktop({ directory, assetsDirectory, remoteOptions } = {}) {
  const release = await lockDirectory(directory);
  let engine, server;
  try {
    const ledger = new DesktopLedger(directory);
    engine = new DesktopEngine(ledger);
    await engine.rebuild();
    const remote = new RemoteClient(ledger, remoteOptions);
    server = desktopServer(engine, remote, assetsDirectory);
    const port = ledger.get('port');
    if (port !== null && (!Number.isSafeInteger(port) || port < 1 || port > 65535)) throw new Error('El puerto guardado del POS necesita revisión.');
    // IndexedDB is scoped to the origin. Keep the first assigned port so an
    // uncertain browser request can still replay its UUID after restarting.
    // If another process occupies it, fail startup instead of losing that journal.
    await new Promise((done, reject) => { server.once('error', reject); server.listen(port ?? 0, '127.0.0.1', done); });
    ledger.set('port', server.address().port);
    let stopping;
    return { engine, server, remote, origin: 'http://127.0.0.1:' + server.address().port,
      stop() { return stopping ||= (async () => { server.closeAllConnections(); await new Promise(done => server.close(done)); await engine.close(); await release(); })(); } };
  } catch (error) { server?.close(); await engine?.close(); await release(); throw error; }
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--data-dir', '--assets'].includes(args[index]) || !args[index + 1]) throw new Error('Opciones de inicio inválidas.');
    options[args[index]] = resolve(args[index + 1]);
  }
  if (!options['--data-dir'] || !options['--assets']) throw new Error('Faltan las carpetas de datos y de la interfaz.');
  const app = await startDesktop({ directory: options['--data-dir'], assetsDirectory: options['--assets'] });
  console.log('FELIX_READY=' + app.origin);
  const stop = () => app.stop().then(() => process.exit(0), () => process.exit(1));
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  process.stdin.once('end', stop); process.stdin.resume();
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  console.error('No se pudo iniciar el POS. Comprueba que no esté abierto y que la carpeta de datos permita escribir.');
  process.exitCode = 1;
});

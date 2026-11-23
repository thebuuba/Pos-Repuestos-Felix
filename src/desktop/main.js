import { mkdir, realpath } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createPipeServer } from 'node:net';
import { createHash } from 'node:crypto';
import { DesktopLedger } from './ledger.js';
import { DesktopEngine } from './engine.js';
import { RemoteClient } from './credentials.js';
import { desktopServer } from './server.js';

const stageLabels = {
  args: 'parámetros de arranque',
  lock: 'acceso exclusivo',
  sqlite: 'base de datos local (SQLite)',
  rebuild: 'carga de datos locales',
  server: 'servidor local',
};

function sanitizeDiagnostic(value) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/(?:bearer|token|password|clave|secret|cookie|authorization)\s*[:=]\s*\S+/gi, '[oculto]')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 280);
}

export function formatStartupError(error, stage) {
  const label = stageLabels[stage || error?.startupStage] || 'inicio del POS';
  const code = typeof error?.code === 'string' && error.code ? ` [${error.code}]` : '';
  const causeCode = typeof error?.cause?.code === 'string' && error.cause.code ? ` [${error.cause.code}]` : '';
  const detail = sanitizeDiagnostic(error?.message || error?.name || 'Error inesperado.');
  if (stage === 'server' && error?.code === 'EADDRINUSE') {
    return `Error en ${label}: el puerto guardado del POS está ocupado por otro programa [EADDRINUSE].`;
  }
  return `Error en ${label}: ${detail}${code || causeCode}`;
}

export function recordStartupError(directory, error, stage) {
  const message = formatStartupError(error, stage);
  if (!directory) return message;
  try {
    mkdirSync(directory, { recursive: true });
    const lines = [
      `Fecha: ${new Date().toISOString()}`,
      `Etapa: ${stage || error?.startupStage || 'desconocida'}`,
      `Diagnostico: ${message}`,
      `Tipo: ${sanitizeDiagnostic(error?.name || 'Error')}`,
    ];
    if (error?.cause?.code) lines.push(`CodigoSQL: ${sanitizeDiagnostic(error.cause.code)}`);
    if (error?.cause?.constraint) lines.push(`Restriccion: ${sanitizeDiagnostic(error.cause.constraint)}`);
    if (error?.cause?.table) lines.push(`Tabla: ${sanitizeDiagnostic(error.cause.table)}`);
    if (error?.cause?.column) lines.push(`Columna: ${sanitizeDiagnostic(error.cause.column)}`);
    writeFileSync(join(directory, 'startup-error.log'), lines.join('\n') + '\n', 'utf8');
  } catch { /* best-effort diagnostic log */ }
  return message;
}

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
  let stage = 'lock';
  let release;
  let engine, server;
  try {
    release = await lockDirectory(directory);
    stage = 'sqlite';
    const ledger = new DesktopLedger(directory);
    engine = new DesktopEngine(ledger);
    stage = 'rebuild';
    await engine.rebuild();
    stage = 'server';
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
  } catch (error) {
    if (error && typeof error === 'object' && !error.startupStage) error.startupStage = stage;
    server?.close();
    await engine?.close().catch(() => {});
    await release?.().catch(() => {});
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--data-dir', '--assets'].includes(args[index]) || !args[index + 1]) {
      throw Object.assign(new Error('Opciones de inicio inválidas.'), { startupStage: 'args' });
    }
    options[args[index]] = resolve(args[index + 1]);
  }
  if (!options['--data-dir'] || !options['--assets']) {
    throw Object.assign(new Error('Faltan las carpetas de datos y de la interfaz.'), { startupStage: 'args' });
  }
  try {
    const app = await startDesktop({ directory: options['--data-dir'], assetsDirectory: options['--assets'] });
    console.log('FELIX_READY=' + app.origin);
    const stop = () => app.stop().then(() => process.exit(0), () => process.exit(1));
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    process.stdin.once('end', stop); process.stdin.resume();
  } catch (error) {
    const diagnostic = recordStartupError(options['--data-dir'], error, error?.startupStage);
    console.log('FELIX_ERROR=' + diagnostic);
    console.error(diagnostic);
    process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  const diagnostic = formatStartupError(error, error?.startupStage || 'args');
  console.log('FELIX_ERROR=' + diagnostic);
  console.error(diagnostic);
  process.exitCode = 1;
});

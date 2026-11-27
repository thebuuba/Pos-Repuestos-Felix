import { mkdir, realpath } from 'node:fs/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createPipeServer } from 'node:net';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { DesktopLedger } from './ledger.js';
import { DesktopEngine } from './engine.js';
import { RemoteClient } from './credentials.js';
import { desktopServer } from './server.js';

const validUpdateStates = new Set(['available', 'downloading', 'installing', 'error', 'checking', 'up_to_date', 'check_error']);

export function parseHostUpdateLine(line) {
  if (typeof line !== 'string' || !line.startsWith('FELIX_UPDATE=')) return null;
  try {
    const raw = JSON.parse(line.slice('FELIX_UPDATE='.length));
    if (!raw || typeof raw !== 'object' || !validUpdateStates.has(raw.state)) return null;
    const version = typeof raw.version === 'string' ? raw.version.trim().slice(0, 40) : '';
    const error = typeof raw.error === 'string' && raw.error.trim() ? raw.error.trim().slice(0, 280) : null;
    return { state: raw.state, version, error };
  } catch {
    return null;
  }
}

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
  if (stage === 'server' && (error?.code === 'EADDRINUSE' || error?.code === 'EACCES')) {
    return `Error en ${label}: el puerto guardado del POS no está disponible [${error.code}].`;
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

export async function startDesktop({ directory, assetsDirectory, remoteOptions, host } = {}) {
  let stage = 'lock';
  let release;
  let engine, server;
  try {
    release = await lockDirectory(directory);
    stage = 'sqlite';
    const ledger = new DesktopLedger(directory);
    engine = new DesktopEngine(ledger);
    stage = 'rebuild';
    try {
      await engine.rebuild();
    } catch (rebuildError) {
      let recovered = false;
      // Lossless repair for previously inverted movimientos_inventario IDs from prior versions.
      if (ledger.repairInventoryMovementOrder()) {
        try {
          await engine.rebuild();
          recovered = true;
        } catch { /* fall through to safe cache reset when pending === 0 */ }
      }
      if (!recovered && ledger.clearCachedProjection()) {
        // Safe only when pending === 0 and no reconciliation is open: drop corrupt cache and re-sync on launch.
        engine.lastError = 'Se restableció la caché local dañada; conectando para descargar datos actualizados.';
        recovered = true;
      }
      if (!recovered) throw rebuildError;
    }
    stage = 'server';
    const remote = new RemoteClient(ledger, remoteOptions);
    server = desktopServer(engine, remote, assetsDirectory, host);
    const port = ledger.get('port');
    if (port !== null && (!Number.isSafeInteger(port) || port < 1 || port > 65535)) throw new Error('El puerto guardado del POS necesita revisión.');
    // IndexedDB is scoped to the origin. Keep the first assigned port so an
    // uncertain browser request can still replay its UUID after restarting.
    // On first launch, prefer a non-ephemeral local port (39120-39899) to avoid
    // Windows Hyper-V/WinNAT dynamic port exclusions in 49152-65535.
    const listenOn = targetPort => new Promise((done, reject) => {
      const onError = err => { server.off('listening', onListening); reject(err); };
      const onListening = () => { server.off('error', onError); done(); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(targetPort, '127.0.0.1');
    });
    if (port !== null) {
      await listenOn(port);
    } else {
      const basePort = 39120 + (createHash('sha256').update(String(directory || '')).digest().readUInt16BE(0) % 700);
      let bound = false;
      for (let offset = 0; offset < 25 && !bound; offset++) {
        try { await listenOn(basePort + offset); bound = true; }
        catch (err) { if (err?.code !== 'EADDRINUSE' && err?.code !== 'EACCES') throw err; }
      }
      if (!bound) await listenOn(0);
    }
    ledger.set('port', server.address().port);
    let stopping;
    return { engine, server, remote, origin: 'http://127.0.0.1:' + server.address().port,
      stop() { return stopping ||= (async () => { remote.abortAll?.(); server.closeAllConnections(); await new Promise(done => server.close(done)); await engine.close(); await release(); })(); } };
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
    let updateState = null;
    const host = {
      updateStatus: () => updateState ? { ...updateState } : null,
      checkUpdate: (silent = false) => {
        if (updateState && ['downloading', 'installing'].includes(updateState.state)) {
          return { ...updateState };
        }
        if (!silent && (!updateState || !['available', 'error'].includes(updateState.state))) {
          updateState = { state: 'checking', version: updateState?.version || '', error: null };
        }
        console.log(silent ? 'FELIX_CHECK_UPDATE_SILENT' : 'FELIX_CHECK_UPDATE');
        return updateState ? { ...updateState } : { state: 'checking', version: '', error: null };
      },
      applyUpdate: () => {
        if (!updateState || !['available', 'error'].includes(updateState.state)) return null;
        updateState = { ...updateState, state: 'downloading', error: null };
        console.log('FELIX_APPLY_UPDATE');
        return { ...updateState };
      },
    };
    const app = await startDesktop({ directory: options['--data-dir'], assetsDirectory: options['--assets'], host });
    console.log('FELIX_READY=' + app.origin);
    const stop = () => app.stop().then(() => process.exit(0), () => process.exit(1));
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
    rl.on('line', line => {
      const next = parseHostUpdateLine(line);
      if (next) updateState = next;
    });
    rl.once('close', stop);
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

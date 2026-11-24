import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import pg from 'pg';
import { temporaryPostgres } from './postgres.js';
import { migrateDatabase } from '../src/db/migrations.js';
import { readSyncBootstrap, writeSyncOperation } from '../src/pos/sync-operations.js';
import {
  RemoteClient,
  createLinuxSecrets,
  defaultDesktopSecrets,
} from '../src/desktop/credentials.js';
import { DesktopLedger } from '../src/desktop/ledger.js';
import { DesktopEngine } from '../src/desktop/engine.js';
import { desktopServer } from '../src/desktop/server.js';
import { lockAddressForPlatform, resolveLinuxDataDir } from '../src/desktop/main.js';
import {
  OFFICIAL_NODE_LINUX_SHA256,
  REQUIRED_NODE_VERSION,
  buildLinuxPayload,
  permittedLinuxPath,
  verifyLinuxPayload,
} from '../scripts/build-linux.mjs';

function makeMockKeyring({ mode = 'ok' } = {}) {
  const store = new Map();
  let currentMode = mode;
  return {
    storeMap: store,
    setMode(next) { currentMode = next; },
    async lookup(installationId, keyId) {
      if (currentMode === 'unavailable') return { status: 'unavailable' };
      if (currentMode === 'locked') return { status: 'locked' };
      const hit = store.get(`${installationId}:${keyId}`);
      return hit ? { status: 'ok', key: hit } : { status: 'missing' };
    },
    async store(installationId, keyId, keyBuffer) {
      if (currentMode === 'unavailable') return { status: 'unavailable' };
      if (currentMode === 'locked') return { status: 'locked' };
      store.set(`${installationId}:${keyId}`, Buffer.from(keyBuffer));
      return { status: 'ok' };
    },
  };
}

test('cifrado Linux AES-256-GCM con secret-tool: sobre versionado, nonce único, AAD y detección de manipulación', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'felix-linux-cred-'));
  try {
    const keyring = makeMockKeyring({ mode: 'ok' });
    const origin = 'https://repuestos-felix-pos.repuestosfelix1994.workers.dev';
    const secrets = createLinuxSecrets({
      dataDir: dir,
      origin,
      installationId: 'inst-1',
      keyring,
      enforcePosixPerms: false,
    });

    const cookie = '__Host-felix-session=secreto-de-prueba-123';
    const env1 = await secrets.protect(cookie);
    const env2 = await secrets.protect(cookie);
    assert.ok(env1.startsWith('felix-enc-v1:'));
    assert.notEqual(env1, env2, 'Cada cifrado debe usar un nonce nuevo');

    const parsed = JSON.parse(env1.slice('felix-enc-v1:'.length));
    assert.equal(parsed.v, 1);
    assert.equal(parsed.alg, 'aes-256-gcm');
    assert.equal(parsed.backend, 'secret-tool');
    assert.equal(existsSync(join(dir, 'credentials', 'master.key')), false, 'No debe escribir master.key cuando secret-tool funcionó');

    secrets.resetCache();
    assert.equal(await secrets.unprotect(env1), cookie);

    // Vinculación al origen (AAD): otro origen no puede descifrar el sobre
    const otherOriginSecrets = createLinuxSecrets({
      dataDir: dir,
      origin: 'https://otro-servidor.example.com',
      installationId: 'inst-1',
      keyring,
      enforcePosixPerms: false,
    });
    await assert.rejects(
      () => otherOriginSecrets.unprotect(env1),
      err => err.status === 401 && err.localCredentialError === true && err.code === 'LINUX_ENVELOPE_TAMPERED',
    );

    // Manipulación del ciphertext detectada por GCM
    const tampered = { ...parsed, ct: Buffer.from('datos-alterados').toString('base64') };
    await assert.rejects(
      () => secrets.unprotect('felix-enc-v1:' + JSON.stringify(tampered)),
      err => err.status === 401 && err.code === 'LINUX_ENVELOPE_TAMPERED',
    );

    // Keyring bloqueado produce error explícito (401 localCredentialError)
    secrets.resetCache();
    keyring.setMode('locked');
    await assert.rejects(
      () => secrets.unprotect(env1),
      err => err.status === 401 && err.localCredentialError === true && err.code === 'LINUX_KEYRING_LOCKED',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fallback Linux a credentials/master.key sin keyring, clave borrada/corrupta y cambio de disponibilidad de secret-tool', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'felix-linux-fallback-'));
  try {
    const keyring = makeMockKeyring({ mode: 'unavailable' });
    const origin = 'http://127.0.0.1:41234';
    const secrets = createLinuxSecrets({
      dataDir: dir,
      origin,
      installationId: 'inst-crostini',
      keyring,
      enforcePosixPerms: false,
    });

    const env = await secrets.protect('felix-session=cookie-crostini');
    const parsed = JSON.parse(env.slice('felix-enc-v1:'.length));
    assert.equal(parsed.backend, 'file');
    const keyPath = join(dir, 'credentials', 'master.key');
    assert.equal(existsSync(keyPath), true);

    // Aunque después aparezca secret-tool disponible, el sobre se descifra por su backend ('file')
    keyring.setMode('ok');
    secrets.resetCache();
    assert.equal(await secrets.unprotect(env), 'felix-session=cookie-crostini');

    // Si se borra master.key, unprotect falla explícitamente SIN regenerarla
    rmSync(keyPath);
    secrets.resetCache();
    await assert.rejects(
      () => secrets.unprotect(env),
      err => err.status === 401 && err.localCredentialError === true && err.code === 'LINUX_KEY_MISSING',
    );
    assert.equal(existsSync(keyPath), false, 'unprotect nunca debe regenerar la clave silenciosamente');

    // Si en su lugar se coloca un archivo corrupto (sin keyring), unprotect rechaza y un nuevo protect (re-login) rota limpiamente
    keyring.setMode('unavailable');
    writeFileSync(keyPath, 'no-es-una-clave-valida\n', 'utf8');
    await assert.rejects(
      () => secrets.unprotect(env),
      err => err.status === 401 && err.code === 'LINUX_KEY_CORRUPT',
    );
    const freshEnv = await secrets.protect('felix-session=nueva-sesion');
    assert.equal(JSON.parse(freshEnv.slice('felix-enc-v1:'.length)).backend, 'file');
    assert.equal(await secrets.unprotect(freshEnv), 'felix-session=nueva-sesion');

    // Si master.key es sustituida por un directorio (tipo inválido), se rechaza siempre
    rmSync(keyPath);
    mkdirSync(keyPath);
    secrets.resetCache();
    await assert.rejects(
      () => secrets.unprotect(freshEnv),
      err => err.code === 'LINUX_INVALID_PATH',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('re-login tras pérdida de clave Linux recupera sincronización conservando operaciones pendientes sin duplicados', { timeout: 120000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'felix-linux-relogin-'));
  let database, cloud, ledger, engine, server;
  try {
    database = await temporaryPostgres();
    cloud = new pg.Pool({ connectionString: database.connectionString });
    await migrateDatabase(cloud);
    const actor = { id: 'u-owner', name: 'felix', role: 'dueno' };

    ledger = new DesktopLedger(dir);
    engine = new DesktopEngine(ledger);
    const keyring = makeMockKeyring({ mode: 'unavailable' });
    const origin = 'http://127.0.0.1:49999';
    const secrets = createLinuxSecrets({
      dataDir: dir,
      origin,
      installationId: ledger.get('deviceId'),
      keyring,
      enforcePosixPerms: false,
    });

    const fetcher = async (url, options = {}) => {
      const pathname = new URL(url).pathname;
      const jsonRes = (body, status = 200, extraHeaders = {}) => ({
        ok: status >= 200 && status < 300,
        status,
        headers: new Headers(extraHeaders),
        json: async () => body,
      });
      if (pathname === '/login') {
        return jsonRes({ ok: true }, 200, { 'set-cookie': 'felix-session=tok-' + randomUUID() + '; Path=/; HttpOnly' });
      }
      if (pathname === '/api/account') {
        if (!options.headers?.Cookie) return jsonRes({ error: 'No autenticado' }, 401);
        return jsonRes({ id: actor.id, username: actor.name, role: actor.role }, 200);
      }
      if (pathname === '/api/sync/bootstrap') {
        if (!options.headers?.Cookie) return jsonRes({ error: 'No autenticado' }, 401);
        return jsonRes(await readSyncBootstrap(cloud, 'Prueba Linux'), 200);
      }
      if (pathname === '/api/sync/operations') {
        if (!options.headers?.Cookie) return jsonRes({ error: 'No autenticado' }, 401);
        const result = await writeSyncOperation(cloud, JSON.parse(options.body), 'Prueba Linux', actor);
        return jsonRes(result, 200);
      }
      return jsonRes({ error: 'No encontrado' }, 404);
    };

    const remote = new RemoteClient(ledger, { origin, secrets, fetcher });
    server = desktopServer(engine, remote, resolve('dist/operational'));
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const localOrigin = 'http://127.0.0.1:' + server.address().port;

    // 1. Primer login exitoso: adopta base real y guarda cookie cifrada en pos.sqlite
    const login1 = await fetch(localOrigin + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: localOrigin },
      body: JSON.stringify({ username: 'felix', password: 'mi-password-123', remember: true }),
    });
    assert.equal(login1.status, 200);
    const desktopCookie = login1.headers.get('set-cookie').split(';')[0];
    assert.ok(String(ledger.get('remoteCookie')).startsWith('felix-enc-v1:'));

    // 2. Registrar operación offline real (apertura de caja)
    const dbId = ledger.get('databaseId');
    await engine.write('POST', '/api/caja/abrir', { databaseId: dbId, monto: '500' }, randomUUID(), actor);
    assert.equal(ledger.pending().length, 1);

    // 3. Simular pérdida de master.key y reinicio de caché en memoria
    rmSync(join(dir, 'credentials', 'master.key'));
    secrets.resetCache();
    remote.cookie = null;

    // Sincronizar reporta 'authentication' con error explícito y conserva el pendiente intacto
    const syncFail = await fetch(localOrigin + '/api/desktop/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: localOrigin, Cookie: desktopCookie },
      body: '{}',
    });
    assert.equal(syncFail.status, 200);
    const statusAfterLoss = await syncFail.json();
    assert.equal(statusAfterLoss.connection, 'authentication');
    assert.equal(statusAfterLoss.pending, 1);
    assert.match(statusAfterLoss.error || '', /clave local de sesión/i);
    assert.equal(ledger.pending().length, 1, 'Nunca se deben borrar operaciones pendientes al perder la clave');

    // 4. Re-login genera nueva master.key y reanuda la sincronización completa del pendiente a PostgreSQL
    const login2 = await fetch(localOrigin + '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: localOrigin },
      body: JSON.stringify({ username: 'felix', password: 'mi-password-123', remember: true }),
    });
    assert.equal(login2.status, 200);
    const desktopCookie2 = login2.headers.get('set-cookie').split(';')[0];
    const syncRecovered = await fetch(localOrigin + '/api/desktop/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: localOrigin, Cookie: desktopCookie2 },
      body: '{}',
    });
    assert.equal(syncRecovered.status, 200);
    const finalStatus = await syncRecovered.json();
    assert.equal(finalStatus.connection, 'online');
    assert.equal(finalStatus.pending, 0);
    const cloudTurns = (await cloud.query('SELECT COUNT(*)::int AS total FROM turnos_caja WHERE cerrado_en IS NULL')).rows[0].total;
    assert.equal(cloudTurns, 1, 'La apertura de caja offline debe haberse sincronizado exactamente una vez');
  } finally {
    if (server) {
      server.closeAllConnections?.();
      await new Promise(done => server.close(done));
    }
    await engine?.close().catch(() => {});
    await cloud?.end().catch(() => {});
    await database?.stop().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  }
});

test('rutas XDG y direcciones de bloqueo multiplataforma cumplen la especificación', () => {
  assert.equal(
    resolveLinuxDataDir({ XDG_DATA_HOME: '/home/felix/.local/custom', HOME: '/home/felix' }),
    '/home/felix/.local/custom/RepuestosFelix/POS',
  );
  // XDG relativo debe ignorarse conforme a la especificación XDG
  assert.equal(
    resolveLinuxDataDir({ XDG_DATA_HOME: 'relative/path', HOME: '/home/felix' }),
    '/home/felix/.local/share/RepuestosFelix/POS',
  );
  assert.equal(
    resolveLinuxDataDir({ XDG_DATA_HOME: '', HOME: '/home/felix/' }),
    '/home/felix/.local/share/RepuestosFelix/POS',
  );
  assert.equal(resolveLinuxDataDir({}), null);

  const winAddr = lockAddressForPlatform('C:\\Users\\Felix\\AppData\\Local\\RepuestosFelix\\POS', 'win32');
  assert.ok(winAddr.startsWith('\\\\.\\pipe\\repuestos-felix-'));
  const linAddr = lockAddressForPlatform('/home/felix/.local/share/RepuestosFelix/POS', 'linux');
  assert.ok(linAddr.startsWith('\0repuestos-felix-'));
  assert.equal(linAddr.length, '\0repuestos-felix-'.length + 64);
  assert.throws(() => lockAddressForPlatform('/tmp/x', 'darwin'), /Windows y Linux/);
  assert.throws(() => defaultDesktopSecrets({ dataDir: '/tmp/x', platform: 'darwin' }), /Windows y Linux/);
});

test('empaquetador Linux (.deb) aplica lista blanca estricta, SHA-256 oficial de Node 24.16.0 y tauri.linux.conf.json válido', async () => {
  // Lista blanca Linux: permite runtime/node y rechaza node.exe, .sqlite, .key y secretos
  assert.equal(permittedLinuxPath('runtime/node'), true);
  assert.equal(permittedLinuxPath('runtime/node-LICENSE.txt'), true);
  assert.equal(permittedLinuxPath('app/src/desktop/main.js'), true);
  assert.equal(permittedLinuxPath('app/assets/index.html'), true);
  assert.equal(permittedLinuxPath('runtime/node.exe'), false);
  assert.equal(permittedLinuxPath('app/pos.sqlite'), false);
  assert.equal(permittedLinuxPath('app/credentials/master.key'), false);
  assert.equal(permittedLinuxPath('app/.env'), false);

  assert.equal(REQUIRED_NODE_VERSION, '24.16.0');
  assert.equal(OFFICIAL_NODE_LINUX_SHA256.x64.sha256.length, 64);
  assert.equal(OFFICIAL_NODE_LINUX_SHA256.arm64.sha256.length, 64);

  // Validar tauri.linux.conf.json: elimina claves de windows-payload y referencia iconos existentes
  const linuxConf = JSON.parse(readFileSync(resolve('src-tauri/tauri.linux.conf.json'), 'utf8'));
  assert.deepEqual(linuxConf.bundle.targets, ['deb']);
  assert.equal(linuxConf.bundle.createUpdaterArtifacts, false);
  assert.equal(linuxConf.bundle.resources['../dist/windows-payload/app/'], null);
  assert.equal(linuxConf.bundle.resources['../dist/windows-payload/runtime/'], null);
  assert.equal(linuxConf.bundle.resources['../dist/windows-payload/payload-manifest.json'], null);
  assert.equal(linuxConf.bundle.resources['../dist/linux-payload/runtime/'], 'runtime/');
  for (const iconRel of linuxConf.bundle.icon) {
    assert.equal(existsSync(resolve('src-tauri', iconRel)), true, `Falta icono Linux: ${iconRel}`);
  }

  // Simular construcción + verificación de payload Linux en directorio temporal (y detección de alteración)
  const tmpDest = await mkdtemp(join(tmpdir(), 'felix-linux-payload-'));
  const fakeNode = join(tmpDest, 'fake-node-bin');
  const outDir = join(tmpDest, 'payload');
  try {
    await writeFile(fakeNode, '#!/bin/sh\necho v24.16.0\n', 'utf8');
    const manifest = await buildLinuxPayload({
      destination: outDir,
      nodeBinary: fakeNode,
      arch: 'arm64',
      nodeVersion: REQUIRED_NODE_VERSION,
      platform: 'linux',
      allowOutsideDist: true,
    });
    assert.equal(manifest.format, 'repuestos-felix-linux-payload-v1');
    assert.equal(manifest.architecture, 'arm64');
    assert.equal(manifest.nodeArchiveSha256, OFFICIAL_NODE_LINUX_SHA256.arm64.sha256);
    assert.ok(manifest.files.some(f => f.path === 'runtime/node'));
    assert.equal(manifest.files.some(f => f.path.endsWith('.exe')), false);

    // Alterar 1 byte debe disparar fallo en verifyLinuxPayload
    const targetFile = join(outDir, 'app', 'package.json');
    const prev = await readFile(targetFile, 'utf8');
    await writeFile(targetFile, prev + ' ', 'utf8');
    await assert.rejects(() => verifyLinuxPayload({ destination: outDir, checkExecutable: false }), /alterado/i);
  } finally {
    await rm(tmpDest, { recursive: true, force: true });
  }
});

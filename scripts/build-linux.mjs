import { createHash } from 'node:crypto';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const defaultDestination = join(root, 'dist', 'linux-payload');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const slash = value => value.split(sep).join('/');

export const REQUIRED_NODE_VERSION = '24.16.0';
export const REQUIRED_PGLITE_VERSION = '0.5.17';

// Hashes oficiales tomados de https://nodejs.org/download/release/v24.16.0/SHASUMS256.txt
export const OFFICIAL_NODE_LINUX_SHA256 = Object.freeze({
  x64: {
    filename: 'node-v24.16.0-linux-x64.tar.xz',
    url: 'https://nodejs.org/download/release/v24.16.0/node-v24.16.0-linux-x64.tar.xz',
    sha256: 'd804845d34eddc21dc1092b519d643ef40b1f58ec5dec5c22b1f4bd8fabde6c9',
  },
  arm64: {
    filename: 'node-v24.16.0-linux-arm64.tar.xz',
    url: 'https://nodejs.org/download/release/v24.16.0/node-v24.16.0-linux-arm64.tar.xz',
    sha256: '524659219d6a207a7400f2bde15d19ba060ffbe0d32a8643319ad67e3bb64c78',
  },
});

async function listFiles(directory, prefix = '') {
  const result = [];
  for (const name of (await readdir(directory)).sort()) {
    const full = join(directory, name);
    const info = await lstat(full);
    const child = prefix ? prefix + '/' + name : name;
    if (info.isSymbolicLink()) throw new Error('El paquete Linux no admite enlaces simbólicos: ' + child);
    if (info.isDirectory()) result.push(...await listFiles(full, child));
    else if (info.isFile()) result.push(child);
    else throw new Error('Recurso no admitido en el paquete Linux: ' + child);
  }
  return result;
}

export function permittedLinuxPath(relPath) {
  if (typeof relPath !== 'string' || !relPath) return false;
  if (relPath.split('/').some(name => name.startsWith('.')) || /\.(?:sqlite|sqlite3|db|pem|key|pfx|log|exe)$/i.test(relPath)) {
    return false;
  }
  return relPath === 'runtime/node' || relPath === 'runtime/node-LICENSE.txt' || relPath === 'app/package.json' ||
    /^app\/src\/(?:[\w-]+\/)*[\w-]+\.js$/.test(relPath) ||
    /^app\/supabase\/migrations\/\d+_[\w-]+\.sql$/.test(relPath) ||
    /^app\/assets\/(?:[\w.-]+\/)*[\w.-]+\.(?:html|js|css|png|jpg|woff2|txt|webmanifest)$/.test(relPath) ||
    /^app\/node_modules\/@electric-sql\/pglite\/(?:package\.json|LICENSE|dist\/(?:[\w.-]+\/)*[\w.-]+\.(?:js|cjs|map|ts|cts|wasm|data|tar\.gz))$/.test(relPath);
}

export async function verifyLinuxPayload({ destination = defaultDestination, checkExecutable = process.platform === 'linux' } = {}) {
  const manifestPath = join(destination, 'payload-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.format !== 'repuestos-felix-linux-payload-v1') {
    throw new Error('Formato de manifiesto Linux inválido.');
  }
  const present = (await listFiles(destination)).filter(p => p !== 'payload-manifest.json');
  const expected = manifest.files.map(file => file.path).sort();
  if (JSON.stringify(present.sort()) !== JSON.stringify(expected)) {
    throw new Error('El contenido del paquete Linux no coincide con su manifiesto.');
  }
  let hasNodeRuntime = false;
  for (const record of manifest.files) {
    if (!permittedLinuxPath(record.path)) throw new Error('Archivo fuera de la lista autorizada: ' + record.path);
    const full = join(destination, record.path);
    const content = await readFile(full);
    if (content.length !== record.bytes || digest(content) !== record.sha256) {
      throw new Error('Recurso alterado en paquete Linux: ' + record.path);
    }
    if (record.path === 'runtime/node') {
      hasNodeRuntime = true;
      if (checkExecutable) {
        const info = await stat(full);
        if ((info.mode & 0o111) === 0) throw new Error('runtime/node no tiene permiso ejecutable (+x).');
      }
    }
  }
  if (!hasNodeRuntime) throw new Error('Falta runtime/node en el paquete Linux.');
  return manifest;
}

export async function buildLinuxPayload({
  destination = defaultDestination,
  nodeBinary = process.execPath,
  arch = process.arch,
  nodeVersion = process.versions.node,
  platform = process.platform,
  allowOutsideDist = false,
} = {}) {
  if (platform !== 'linux') throw new Error('Compila el paquete Linux (.deb) desde un entorno Linux (x64 o arm64).');
  if (!Object.hasOwn(OFFICIAL_NODE_LINUX_SHA256, arch)) {
    throw new Error(`Arquitectura Linux no soportada: ${arch}. Usa x64 o arm64.`);
  }
  if (nodeVersion !== REQUIRED_NODE_VERSION) {
    throw new Error(`Esta entrega requiere Node ${REQUIRED_NODE_VERSION} Linux para coincidir con Windows.`);
  }
  const required = [
    'src/desktop/main.js',
    'dist/operational/index.html',
    'dist/operational/app.js',
    'dist/operational/styles.css',
    'src-tauri/licenses/node-LICENSE.txt',
  ];
  for (const file of required) {
    if (!(await stat(join(root, file))).isFile()) throw new Error('Falta el recurso ' + file);
  }
  if (!allowOutsideDist && relative(root, destination) !== join('dist', 'linux-payload')) {
    throw new Error('Carpeta de salida fuera del proyecto.');
  }
  const nodeInfo = await stat(nodeBinary);
  if (!nodeInfo.isFile()) throw new Error('No se encontró el binario runtime de Node Linux.');

  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });

  const copy = async (source, target) => {
    if (!permittedLinuxPath(target)) throw new Error('Archivo fuera de la lista autorizada: ' + target);
    const output = join(destination, target);
    await mkdir(dirname(output), { recursive: true });
    await copyFile(source, output);
  };

  for (const file of await listFiles(join(root, 'src'))) {
    if (file.endsWith('.js')) await copy(join(root, 'src', file), 'app/src/' + file);
  }
  for (const file of await listFiles(join(root, 'supabase', 'migrations'))) {
    if (/^\d+_[\w-]+\.sql$/.test(file)) {
      await copy(join(root, 'supabase', 'migrations', file), 'app/supabase/migrations/' + file);
    }
  }
  for (const file of await listFiles(join(root, 'dist', 'operational'))) {
    await copy(join(root, 'dist', 'operational', file), 'app/assets/' + file);
  }
  const dependency = await realpath(join(root, 'node_modules', '@electric-sql', 'pglite'));
  const packageInfo = JSON.parse(await readFile(join(dependency, 'package.json'), 'utf8'));
  if (packageInfo.name !== '@electric-sql/pglite' || packageInfo.version !== REQUIRED_PGLITE_VERSION) {
    throw new Error('Versión PGlite distinta de la verificada.');
  }
  for (const file of ['package.json', 'LICENSE', ...(await listFiles(join(dependency, 'dist'))).map(f => 'dist/' + f)]) {
    await copy(join(dependency, file), 'app/node_modules/@electric-sql/pglite/' + file);
  }

  await copy(nodeBinary, 'runtime/node');
  if (process.platform === 'linux') {
    await chmod(join(destination, 'runtime', 'node'), 0o755);
  }
  await copy(join(root, 'src-tauri', 'licenses', 'node-LICENSE.txt'), 'runtime/node-LICENSE.txt');
  await writeFile(
    join(destination, 'app', 'package.json'),
    JSON.stringify({ name: 'repuestos-felix-linux-runtime', private: true, type: 'module' }, null, 2) + '\n',
  );

  const records = [];
  for (const file of await listFiles(destination)) {
    const content = await readFile(join(destination, file));
    records.push({ path: slash(file), bytes: content.length, sha256: digest(content) });
  }
  const manifestPath = join(destination, 'payload-manifest.json');
  await writeFile(
    manifestPath,
    JSON.stringify({
      format: 'repuestos-felix-linux-payload-v1',
      node: nodeVersion,
      nodeArchiveSha256: OFFICIAL_NODE_LINUX_SHA256[arch].sha256,
      pglite: packageInfo.version,
      architecture: arch,
      files: records,
    }, null, 2) + '\n',
  );
  return verifyLinuxPayload({ destination, checkExecutable: process.platform === 'linux' });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 1 && args[0] === '--verify')) {
    throw new Error('Usa --verify para comprobar el paquete Linux existente.');
  }
  const result = args[0] === '--verify' ? await verifyLinuxPayload() : await buildLinuxPayload();
  const mib = (result.files.reduce((total, file) => total + file.bytes, 0) / 1048576).toFixed(1);
  console.log(`Paquete Linux (${result.architecture}) verificado: ${result.files.length} archivos; ${mib} MiB.`);
}

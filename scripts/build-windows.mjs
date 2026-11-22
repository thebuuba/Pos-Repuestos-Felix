import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const destination = join(root, 'dist', 'windows-payload');
const manifestPath = join(destination, 'payload-manifest.json');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const slash = path => path.split(sep).join('/');

async function files(directory, prefix = '') {
  const result = [];
  for (const name of (await readdir(directory)).sort()) {
    const path = join(directory, name), info = await lstat(path), child = prefix ? prefix + '/' + name : name;
    if (info.isSymbolicLink()) throw new Error('El paquete no admite enlaces: ' + child);
    if (info.isDirectory()) result.push(...await files(path, child));
    else if (info.isFile()) result.push(child);
    else throw new Error('Recurso no admitido: ' + child);
  }
  return result;
}

function permitted(path) {
  if (path.split('/').some(name => name.startsWith('.')) || /\.(?:sqlite|sqlite3|db|pem|key|pfx|log)$/i.test(path)) return false;
  return path === 'runtime/node.exe' || path === 'runtime/node-LICENSE.txt' || path === 'app/package.json' ||
    /^app\/src\/(?:[\w-]+\/)*[\w-]+\.js$/.test(path) ||
    /^app\/supabase\/migrations\/\d+_[\w-]+\.sql$/.test(path) ||
    /^app\/assets\/(?:[\w.-]+\/)*[\w.-]+\.(?:html|js|css|png|jpg|woff2|txt|webmanifest)$/.test(path) ||
    /^app\/node_modules\/@electric-sql\/pglite\/(?:package\.json|LICENSE|dist\/(?:[\w.-]+\/)*[\w.-]+\.(?:js|cjs|map|ts|cts|wasm|data|tar\.gz))$/.test(path);
}

export async function verifyWindowsPayload() {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const present = (await files(destination)).filter(path => path !== 'payload-manifest.json');
  const expected = manifest.files.map(file => file.path).sort();
  if (JSON.stringify(present.sort()) !== JSON.stringify(expected)) throw new Error('El contenido del paquete no coincide con su manifiesto.');
  for (const record of manifest.files) {
    if (!permitted(record.path)) throw new Error('Archivo fuera de la lista autorizada: ' + record.path);
    const content = await readFile(join(destination, record.path));
    if (content.length !== record.bytes || digest(content) !== record.sha256) throw new Error('Recurso alterado: ' + record.path);
  }
  return manifest;
}

export async function buildWindowsPayload() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Compila el instalador desde Windows x64.');
  if (process.versions.node !== '24.16.0') throw new Error('Esta entrega requiere Node 24.16.0 x64 para un runtime reproducible.');
  const required = ['src/desktop/main.js', 'dist/operational/index.html', 'dist/operational/app.js', 'dist/operational/styles.css', 'src-tauri/licenses/node-LICENSE.txt'];
  for (const path of required) if (!(await stat(join(root, path))).isFile()) throw new Error('Falta el recurso ' + path);
  if (relative(root, destination) !== join('dist', 'windows-payload')) throw new Error('Carpeta de salida fuera del proyecto.');
  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  const copy = async (source, target) => {
    if (!permitted(target)) throw new Error('Archivo fuera de la lista autorizada: ' + target);
    const output = join(destination, target);
    await mkdir(dirname(output), { recursive: true });
    await copyFile(source, output);
  };
  for (const file of await files(join(root, 'src'))) {
    if (file.endsWith('.js')) await copy(join(root, 'src', file), 'app/src/' + file);
  }
  for (const file of await files(join(root, 'supabase', 'migrations'))) {
    if (/^\d+_[\w-]+\.sql$/.test(file)) await copy(join(root, 'supabase', 'migrations', file), 'app/supabase/migrations/' + file);
  }
  for (const file of await files(join(root, 'dist', 'operational'))) await copy(join(root, 'dist', 'operational', file), 'app/assets/' + file);
  const dependency = await realpath(join(root, 'node_modules', '@electric-sql', 'pglite'));
  const packageInfo = JSON.parse(await readFile(join(dependency, 'package.json'), 'utf8'));
  if (packageInfo.name !== '@electric-sql/pglite' || packageInfo.version !== '0.5.17') throw new Error('Versión PGlite distinta de la verificada.');
  for (const file of ['package.json', 'LICENSE', ...(await files(join(dependency, 'dist'))).map(file => 'dist/' + file)]) {
    await copy(join(dependency, file), 'app/node_modules/@electric-sql/pglite/' + file);
  }
  await copy(process.execPath, 'runtime/node.exe');
  await copy(join(root, 'src-tauri', 'licenses', 'node-LICENSE.txt'), 'runtime/node-LICENSE.txt');
  await writeFile(join(destination, 'app', 'package.json'), JSON.stringify({ name: 'repuestos-felix-windows-runtime', private: true, type: 'module' }, null, 2) + '\n');
  const records = [];
  for (const path of await files(destination)) {
    const content = await readFile(join(destination, path));
    records.push({ path: slash(path), bytes: content.length, sha256: digest(content) });
  }
  await writeFile(manifestPath, JSON.stringify({ format: 'repuestos-felix-windows-payload-v1', node: process.versions.node,
    pglite: packageInfo.version, architecture: process.arch, files: records }, null, 2) + '\n');
  return verifyWindowsPayload();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && !(args.length === 1 && args[0] === '--verify')) throw new Error('Usa --verify para comprobar el paquete existente.');
  const result = args[0] === '--verify' ? await verifyWindowsPayload() : await buildWindowsPayload();
  console.log(`Paquete Windows verificado: ${result.files.length} archivos; ${(result.files.reduce((total, file) => total + file.bytes, 0) / 1048576).toFixed(1)} MiB.`);
}

import { spawn } from 'node:child_process';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const sha256 = /^[a-f0-9]{64}$/;
const identifier = /^[a-z][a-z0-9_]{0,62}$/;
function check(ok) {
  if (!ok) throw new Error('Validación NetPOS fallida.');
}
async function digest(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}
async function verify(directory) {
  const manifest = JSON.parse(await readFile(join(directory,'manifest.json'),'utf8'));
  check(manifest.format === 2 && sha256.test(manifest.fingerprint) && Array.isArray(manifest.sources));
  const expected = new Set(['archive.bin','settings.bin','products.bin','products.csv','contacts.bin','key-review.json','load.sql']);
  const fingerprint = [];
  let books = 0;
  for (const entry of manifest.sources) {
    check(typeof entry.name === 'string' && basename(entry.name) === entry.name && sha256.test(entry.sha256));
    fingerprint.push([entry.name,entry.sha256]);
    if (entry.table) {
      check(identifier.test(entry.table) && entry.name.toLowerCase() === entry.table+'.csv');
      expected.add('history-'+entry.table+'.bin');
    } else {
      check(entry.name.toLowerCase().endsWith('.xlsx'));
      books++;
    }
  }
  check(books === 1 && createHash('sha256').update(JSON.stringify(fingerprint)).digest('hex') === manifest.fingerprint);
  const files = await readdir(directory, { withFileTypes: true });
  check(files.length === expected.size+1 && files.every(f => f.isFile() && (expected.has(f.name) || f.name === 'manifest.json')));
  check(Object.keys(manifest.artifacts).length === expected.size);
  for (const name of expected) {
    check(sha256.test(manifest.artifacts[name]) && await digest(join(directory,name)) === manifest.artifacts[name]);
  }
}

export function connectionEnvironment(raw) {
  check(raw && /^postgres(?:ql)?:\/\//i.test(raw));
  const url = new URL(raw);
  check(url.hostname && url.username && url.pathname.length>1 && !url.hash);
  // libpq recibe las credenciales únicamente por el entorno del proceso hijo.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG|^NETPOS_DATABASE_URL$/i.test(key)));
  Object.assign(env, { PGHOST: url.hostname.replace(/^\[|\]$/g,''), PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGCLIENTENCODING: 'UTF8',
    PGAPPNAME: 'NetPOS importación administrativa', PGCONNECT_TIMEOUT: '15' });
  const params = {sslmode:'PGSSLMODE',sslrootcert:'PGSSLROOTCERT',sslcert:'PGSSLCERT',sslkey:'PGSSLKEY',
    sslcrl:'PGSSLCRL',sslcrldir:'PGSSLCRLDIR',channel_binding:'PGCHANNELBINDING',connect_timeout:'PGCONNECT_TIMEOUT'};
  for (const [key,value] of url.searchParams) {
    check(Object.hasOwn(params,key) && url.searchParams.getAll(key).length === 1);
    env[params[key]] = value;
  }
  const host = env.PGHOST.toLowerCase();
  const loopback = host === 'localhost' || host === '::1' || (isIP(host) === 4 && host.startsWith('127.'));
  if (!loopback) {
    check(env.PGSSLMODE === undefined || env.PGSSLMODE === 'verify-full');
    env.PGSSLMODE = 'verify-full';
    env.PGGSSENCMODE = 'disable';
  }
  return env;
}

let failure = 'No se pudo verificar la conexión administrativa o el paquete privado NetPOS.';
async function main() {
  const [flag,location,...extra] = process.argv.slice(2);
  check(flag === '--package' && location && isAbsolute(location) && !extra.length);
  const env = connectionEnvironment(process.env.NETPOS_DATABASE_URL);
  const directory = await realpath(location);
  const fromRepo = relative(await realpath(repo), directory);
  check(isAbsolute(fromRepo) || fromRepo.startsWith('..'+sep));
  check((await lstat(join(directory,'manifest.json'))).isFile());
  await verify(directory);
  const name = process.platform === 'win32' ? 'psql.exe' : 'psql';
  const command = process.env.PG_BIN ? join(process.env.PG_BIN,name) : name;
  failure = 'PostgreSQL no confirmó la carga. Revise el estado del destino y las versiones del esquema y de psql.';
  const code = await new Promise((resolve,reject) => {
    const child = spawn(command, ['-X','-w','-q','--set=ON_ERROR_STOP=1','--set=VERBOSITY=sqlstate',
      '--set=SHOW_CONTEXT=never','--file=load.sql'], { cwd:directory,env,windowsHide:true,stdio:['ignore','ignore','pipe'] });
    createInterface({ input:child.stderr }).on('line', line => {
      const match = /(?:ERROR|FATAL):\s*([0-9A-Z]{5})\s*$/.exec(line);
      if (match) {
        const hints = {
          P0001: ' Revisa que la base destino esté vacía (sin importación ni productos/ventas/compras previas) y con esquema compatible.',
          '42P07': ' Ya existen tablas en el esquema netpos_historico; límpialo antes de reimportar.',
        };
        failure = 'PostgreSQL rechazó la carga (SQLSTATE ' + match[1] + ').' + (hints[match[1]] || '');
      }
    });
    child.once('error', reject);
    child.once('close', resolve);
  });
  check(code === 0);
  console.log('Importación NetPOS confirmada.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  console.error(failure);
  process.exitCode = 1;
});

import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { buildOperational } from './build-operational.mjs';
import { authConfig } from '../src/supabase-auth.js';

export function validateDeploymentConfig(config) {
  if (!/^[a-f0-9]{32}$/i.test(config.account_id || '')) throw new Error('Configura account_id con la cuenta Cloudflare verificada.');
  const database = config.hyperdrive?.find(binding => binding.binding === 'HYPERDRIVE');
  if (!/^[a-f0-9]{32}$/i.test(database?.id || '') || /^0+$/.test(database.id)) throw new Error('Configura el ID real de Hyperdrive antes de publicar.');
  const origin = new URL(config.vars?.PUBLIC_ORIGIN || 'http://sin-configurar');
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('Configura PUBLIC_ORIGIN con la dirección HTTPS final.');
}

async function main() {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const config = JSON.parse(await readFile(join(root, 'wrangler.jsonc'), 'utf8'));
  validateDeploymentConfig(config);
  process.loadEnvFile(join(root, '.env.supabase'));
  const auth = authConfig(process.env);
  const projectRef = (await readFile(join(root, 'supabase/.temp/project-ref'), 'utf8')).trim();
  if (auth.url !== 'https://' + projectRef + '.supabase.co') throw new Error('El proyecto de Auth debe coincidir con el proyecto vinculado.');
  const assets = await buildOperational(join(root, 'dist/operational'));
  const directory = join(root, 'supabase/.temp');
  await mkdir(directory, { recursive: true });
  const secretFile = join(directory, `worker-secrets-${randomUUID()}.json`);
  try {
    await writeFile(secretFile, JSON.stringify({ SUPABASE_URL: auth.url, SUPABASE_PUBLISHABLE_KEY: auth.key,
      POS_SESSION_SECRET: process.env.POS_SESSION_SECRET,
      ...(auth.adminKey && { SUPABASE_SECRET_KEY: auth.adminKey }) }), { mode: 0o600, flag: 'wx' });
    const require = createRequire(import.meta.url);
    const executable = join(dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js');
    await new Promise((done, reject) => {
      const child = spawn(process.execPath, [executable, 'deploy', '--assets', assets, '--secrets-file', secretFile], { cwd: root, stdio: 'inherit', windowsHide: true });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? done() : reject(new Error('El despliegue no terminó correctamente.')));
    });
  } finally { await unlink(secretFile).catch(() => {}); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

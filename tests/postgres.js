import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';

// Una instancia desechable: nunca se usan las bases del negocio para las pruebas.
export async function temporaryPostgres() {
  const executable = process.platform === 'win32' ? '.exe' : '';
  const psql = process.env.PG_BIN || dirname(execFileSync(
    process.platform === 'win32' ? 'where.exe' : 'which', ['psql'], { encoding: 'utf8', windowsHide: true }
  ).trim().split(/\r?\n/)[0]);
  const root = await mkdtemp(join(tmpdir(), 'felix-pg-test-'));
  const data = join(root, 'data');
  const run = (name, args) => execFileSync(join(psql, name + executable), args, {
    windowsHide: true, stdio: 'ignore', timeout: 30000,
  });
  const socket = createServer();
  await new Promise((done) => socket.listen(0, '127.0.0.1', done));
  const port = socket.address().port;
  await new Promise((done) => socket.close(done));
  let started = false;
  const stop = async () => {
    if (started) run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
    const absolute = resolve(root);
    if (dirname(absolute) !== resolve(tmpdir()) || !absolute.startsWith(join(resolve(tmpdir()), 'felix-pg-test-'))) {
      throw new Error('Directorio temporal fuera de la ruta esperada');
    }
    await rm(absolute, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  try {
    run('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--no-locale']);
    run('pg_ctl', ['-D', data, '-l', join(root, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
    started = true;
    return { connectionString: `postgresql://postgres@127.0.0.1:${port}/postgres`, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

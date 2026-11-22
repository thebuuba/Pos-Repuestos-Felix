import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { validateTask, parseAgentResult, runProcess, runTask, fileContext } from '../scripts/orchestrate.mjs';

const task = { id: 'prueba', motor: 'antigravity', modo: 'analisis', objetivo: 'Revisar un archivo.',
  archivos: ['source.txt'], criterios: ['Explicar el resultado.'] };
const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });

test('el encargo rechaza rutas externas, secretos, alcance vacío y motores desconocidos', () => {
  assert.equal(validateTask(task).id, 'prueba');
  for (const filename of ['../secret', '/absolute', 'C:/secret', '.git/config', '.env.supabase', 'dist/data', 'src/../secret', 'src\\file']) {
    assert.throws(() => validateTask({ ...task, archivos: [filename] }), /archivo|ruta/i);
  }
  for (const change of [{ archivos: [] }, { motor: 'desconocido' }, { modo: 'libre' }, { id: '../fuera' }, { criterios: [] }]) {
    assert.throws(() => validateTask({ ...task, ...change }));
  }
});

test('el adaptador exige resultados terminales reales y detecta errores de los CLI', () => {
  assert.equal(parseAgentResult('antigravity', JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'Listo' } })).response, 'Listo');
  assert.throws(() => parseAgentResult('antigravity', JSON.stringify({ event: 'result', result: { status: 'ERROR', response: 'No' } })), /resultado|fall/i);
  assert.throws(() => parseAgentResult('antigravity', '{}'), /resultado/i);
  assert.equal(parseAgentResult('codex', [
    { type: 'item.completed', item: { type: 'agent_message', text: 'Revisado' } },
    { type: 'turn.completed', usage: { input_tokens: 1 } },
  ].map(JSON.stringify).join('\n')).response, 'Revisado');
  assert.throws(() => parseAgentResult('codex', '{"type":"turn.failed"}'), /resultado|fall/i);
});

test('el proceso no interpreta el texto como shell y termina con error o timeout', async () => {
  const literal = '$(not-a-command); `not-a-command`';
  const result = await runProcess(process.execPath, ['-e', 'process.stdin.pipe(process.stdout)'], { input: literal, timeoutMs: 5000 });
  assert.equal(result.stdout, literal);
  await assert.rejects(runProcess(process.execPath, ['-e', 'process.exit(7)'], { timeoutMs: 5000 }), /7/);
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 100 }), /tiempo/i);
});

test('las entregas quedan aisladas y el parche incluye archivos nuevos; el alcance se comprueba', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'felix-agents-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith('felix-agents-test-'));
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  git(root, 'init', '-b', 'feat/sistema-unificado-offline');
  git(root, 'config', 'user.name', 'Prueba'); git(root, 'config', 'user.email', 'prueba@example.invalid');
  await writeFile(path.join(root, '.gitignore'), '.agent-runs/\n.env*\n*.log\n');
  await writeFile(path.join(root, 'source.txt'), 'original\n');
  await writeFile(path.join(root, 'AGENTS.md'), 'Usar solo archivos de prueba.\n');
  git(root, 'add', '.'); git(root, 'commit', '-m', 'fixture');
  await writeFile(path.join(root, '.env.supabase'), 'NEVER_COPY_THIS=synthetic\n');
  const base = git(root, 'rev-parse', 'HEAD').trim();
  const context = JSON.parse(await fileContext(root, task));
  assert.deepEqual(context.map(file => file.archivo), ['AGENTS.md', 'source.txt']);
  assert.equal(context.find(file => file.archivo === 'source.txt').contenido, 'original\n');
  assert.equal(JSON.stringify(context).includes('NEVER_COPY_THIS'), false);
  const result = await runTask(root, { ...task, modo: 'implementacion', archivos: ['source.txt', 'new.txt'] }, {
    execute: async ({ cwd }) => {
      await assert.rejects(readFile(path.join(cwd, '.env.supabase')));
      await writeFile(path.join(cwd, 'source.txt'), 'modificado\n');
      await writeFile(path.join(cwd, 'new.txt'), 'nuevo\n');
      return { response: 'Propuesta', usage: {} };
    },
  });
  assert.equal(result.estado, 'requiere_revision');
  assert.equal(result.base, base);
  assert.match(await readFile(path.join(result.directorio, 'changes.patch'), 'utf8'), /new\.txt/);
  assert.equal(await readFile(path.join(root, 'source.txt'), 'utf8'), 'original\n');
  assert.equal(git(root, 'rev-parse', 'HEAD').trim(), base);
  for (const [mode, filename] of [['implementacion', 'other.txt'], ['analisis', 'source.txt'], ['analisis', 'outside.log']]) {
    const rejected = await runTask(root, { ...task, modo: mode }, { execute: async ({ cwd }) => {
      await writeFile(path.join(cwd, filename), 'cambio\n'); return { response: 'Cambio' };
    } });
    assert.equal(rejected.estado, 'fallida');
    assert.match(rejected.error, /alcance|análisis/i);
  }
  const secret = await runTask(root, { ...task, modo: 'implementacion', archivos: ['src/'] }, { execute: async ({ cwd }) => {
    await mkdir(path.join(cwd, 'src'));
    await writeFile(path.join(cwd, 'src/.env.production'), 'SYNTHETIC_SECRET'); return { response: 'Cambio' };
  } });
  assert.equal(secret.estado, 'fallida');
  await assert.rejects(readFile(path.join(secret.directorio, 'changes.patch')));
  const partial = await runTask(root, { ...task, modo: 'implementacion' }, { execute: async ({ cwd }) => {
    await writeFile(path.join(cwd, 'source.txt'), 'parcial\n'); throw new Error('Fallo simulado');
  } });
  assert.equal(partial.estado, 'fallida');
  assert.deepEqual(partial.archivos, ['source.txt']);
  assert.match(await readFile(path.join(partial.directorio, 'changes.patch'), 'utf8'), /parcial/);
  const unchanged = await runTask(root, { ...task, modo: 'implementacion' }, { execute: async () => ({ response: 'No pude editar.' }) });
  assert.equal(unchanged.estado, 'fallida');
  assert.match(unchanged.error, /no produjo cambios/i);
});

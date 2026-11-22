import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { buildOperational } from '../scripts/build-operational.mjs';
import { serveDesign } from '../scripts/serve-design.mjs';
import { chromium } from 'playwright-core';

test('the operational build has local public assets and no prototype store or fixture dependency', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'felix-operational-build-'));
  try {
    const graph = await build({
      entryPoints: ['frontend/operational.jsx'], outdir: directory,
      bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser',
      jsx: 'automatic', loader: { '.woff2': 'file', '.png': 'file' },
      define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
    });
    const demoDependencies = Object.keys(graph.metafile.inputs).filter(file => /(?:^|\/)(?:pos-store\.jsx|seed-data\.js|pos-data\.js|demo-cashier\.png)$/.test(file.replaceAll('\\', '/')));
    assert.deepEqual(demoDependencies, [], 'the operational dependency graph must be separated from reference fixtures');
    await buildOperational(directory);
    const html = await readFile(path.join(directory, 'index.html'), 'utf8');
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /lang="es"/);
    assert.match(html, /src="\/assets\/pwa\/app-[a-f0-9]{16}\.js"/);
    assert.match(html, /href="\/assets\/pwa\/styles-[a-f0-9]{16}\.css"/);
    const css = await readFile(path.join(directory, 'styles.css'), 'utf8');
    assert.match(css, /assets\/fonts\/inter-latin-wght-normal\.woff2/);
    const font = await readFile(path.join(directory, 'assets/fonts/inter-latin-wght-normal.woff2'));
    const original = await readFile(new URL(import.meta.resolve('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')));
    assert.deepEqual(font, original);
    const license = await readFile(path.join(directory, 'assets/Inter-OFL.txt'), 'utf8');
    assert.match(license, /SIL OPEN FONT LICENSE/);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('felix-operational-build-'));
    await rm(directory, { recursive: true, force: true });
  }
});

test('the root without an API waits for confirmed data before showing the dashboard', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'felix-inventory-entry-'));
  let server, browser;
  try {
    await buildOperational(directory);
    server = await serveDesign(directory, 0);
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    assert.equal((await page.goto(server.origin + '/')).status(), 200);
    await page.getByRole('main').getByRole('button', { name: 'Reintentar', exact: true }).waitFor();
    assert.equal((await fetch(server.origin + '/api/state')).status, 404);
    assert.equal(await page.getByRole('heading', { name: 'Catálogo de artículos e inventario', exact: true }).count(), 0);
    assert.equal(await page.getByText('Mostrando 0 de 0 productos', { exact: true }).count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server?.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('felix-inventory-entry-'));
    await rm(directory, { recursive: true, force: true });
  }
});

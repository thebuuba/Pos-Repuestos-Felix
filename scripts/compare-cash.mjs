// Visual regression only: reference fixtures stay in the isolated preview.
// Runtime persistence is covered by tests/operational-sale-browser.test.js.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'node:http';
import { chromium } from 'playwright-core';
import { build } from 'esbuild';
import { buildDesign } from './build-design.mjs';
import { serveDesign } from './serve-design.mjs';

const reference = JSON.parse(await readFile(new URL('../docs/design/polymet-reference.json', import.meta.url), 'utf8'));
const archived = process.argv[3];
let source;
if (archived) source = await readFile(archived, 'utf8');
else {
  const html = await (await fetch(reference.preview, { signal: AbortSignal.timeout(30000) })).text();
  const scriptUrl = html.match(/<script id="user-main-js" src="([^"]+)"/)?.[1];
  assert.ok(scriptUrl);
  source = await (await fetch(scriptUrl, { signal: AbortSignal.timeout(30000) })).text();
}
assert.equal(createHash('sha256').update(source).digest('hex'), reference.bundleSha256);
let referenceServer, referenceAddress = reference.preview;
if (archived) {
  const css = await readFile(path.join(path.dirname(archived), 'reference.css'), 'utf8');
  const bundledReference = (await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'js' },
    bundle: true, write: false, format: 'iife', define: { 'process.env.NODE_ENV': '"development"' } })).outputFiles[0].text;
  referenceServer = createServer((request, response) => {
    const asset = request.url === '/reference.js' ? ['text/javascript', bundledReference]
      : request.url === '/reference.css' ? ['text/css', css]
      : ['text/html', '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/reference.css"></head><body><div id="root"></div><script src="/reference.js"></script></body></html>'];
    response.writeHead(200, { 'Content-Type': asset[0] }); response.end(asset[1]);
  });
  await new Promise(resolve => referenceServer.listen(0, '127.0.0.1', resolve));
  referenceAddress = `http://127.0.0.1:${referenceServer.address().port}`;
}
const label = process.argv[2] || 'current';
assert.match(label, /^[a-z0-9_-]+$/);
const requestedWidth = process.argv[4] ? Number(process.argv[4]) : null;
const states = process.argv[5] ? [process.argv[5]] : ['page', 'movement', 'count'];
assert.ok(states.every(state => ['page', 'movement', 'count'].includes(state)));
const directory = path.resolve(`dist/cash-comparison-${label}`);
await mkdir(directory, { recursive: true });
const server = await serveDesign(await buildDesign(path.join(directory, 'app')), 0);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const report = { checkedAt: new Date().toISOString(), version: reference.version, fixedTime: '2026-11-21T20:00:00Z',
  referenceSource: archived ? 'Approved archived JavaScript and CSS; SHA-256 verified before bundling its React imports with installed React' : 'Approved public preview; SHA-256 verified',
  scope: 'Caja and dialogs, same Polymet fixtures in isolated local reference entry; no database or credentials.',
  exclusions: ['Operational provider, operator identity, pending requests and real cash balances are tested separately.'], results: [] };
try {
  for (const viewport of reference.visualVerificationViewports.filter(viewport => !requestedWidth || viewport.width === requestedWidth)) for (const theme of ['light', 'dark']) {
    const context = await browser.newContext({ viewport, locale: 'es-DO', timezoneId: 'America/Santo_Domingo', reducedMotion: 'reduce', deviceScaleFactor: 1 });
    try {
      const pages = [];
      for (const [side, address] of [['reference', referenceAddress], ['local', server.origin]]) {
        const page = await context.newPage();
        await page.addInitScript(fixedTime => {
          const NativeDate = Date;
          window.Date = class extends NativeDate {
            constructor(...args) { super(...(args.length ? args : [fixedTime])); }
            static now() { return NativeDate.now(); }
          };
        }, report.fixedTime);
        await page.goto(address, { waitUntil: 'networkidle' });
        await page.locator('main h1').waitFor();
        const menu = page.getByRole('button', { name: 'Abrir menú', exact: true });
        if (await menu.isVisible()) {
          await menu.click();
          await page.getByRole('dialog').locator('a[href="/caja"]').first().click();
          await page.getByRole('dialog').waitFor({ state: 'hidden' });
        } else await page.locator('aside a[href="/caja"]').first().click();
        await page.getByRole('heading', { name: 'Caja', exact: true }).waitFor();
        if (await page.locator('html').evaluate(el => el.classList.contains('dark')) !== (theme === 'dark'))
          await page.getByRole('button', { name: 'Cambiar tema', exact: true }).click();
        await page.evaluate(() => document.fonts.ready);
        pages.push({ side, page });
      }
      for (const state of states) {
        const evidence = [];
        for (const { side, page } of pages) {
          if (state !== 'page') {
            await page.getByRole('main').getByRole('button', { name: state === 'movement' ? 'Entrada / salida' : 'Cerrar caja', exact: true }).click();
            await page.getByRole('dialog').waitFor();
          }
          await page.mouse.move(viewport.width - 1, 0);
          const target = state === 'page' ? page.locator('main') : page.getByRole('dialog');
          await target.evaluate(async el => { await Promise.allSettled(el.getAnimations({ subtree: true }).map(animation => animation.finished)); });
          const geometry = await target.evaluate(el => {
            const root = el.getBoundingClientRect();
            return { width: root.width, height: root.height, children: [...el.querySelectorAll('h1,h2,section,table,input,button')].map(node => {
              const r = node.getBoundingClientRect();
              return { tag: node.tagName, x: +(r.x - root.x).toFixed(2), y: +(r.y - root.y).toFixed(2), width: +r.width.toFixed(2), height: +r.height.toFixed(2) };
            }) };
          });
          const filename = `${viewport.width}-${theme}-${state}-${side}.png`;
          const screenshot = state === 'page'
            ? await target.screenshot({ path: path.join(directory, filename), animations: 'disabled', style: 'header { visibility: hidden !important; }' })
            : await page.screenshot({ path: path.join(directory, filename), animations: 'disabled' });
          evidence.push({ filename, geometry, text: await target.innerText(), screenshot,
            overflow: await page.evaluate(() => document.documentElement.scrollWidth > innerWidth) });
          if (state !== 'page') {
            await page.keyboard.press('Escape');
            await page.getByRole('dialog').waitFor({ state: 'hidden' });
          }
        }
        const [a, b] = evidence;
        const pixels = await pages[0].page.evaluate(async screenshots => {
          const images = await Promise.all(screenshots.map(async data => {
            const image = new Image(); image.src = 'data:image/png;base64,' + data; await image.decode(); return image;
          }));
          if (images[0].width !== images[1].width || images[0].height !== images[1].height) return { dimensionsMatch: false };
          const arrays = images.map(image => {
            const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
            const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0);
            return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          });
          let changed = 0;
          for (let i = 0; i < arrays[0].length; i += 4) if (Math.max(...[0, 1, 2].map(c => Math.abs(arrays[0][i + c] - arrays[1][i + c]))) > 24) changed++;
          return { dimensionsMatch: true, changedPixelsAbove24: changed, changedPercent: +(changed * 100 / (images[0].width * images[0].height)).toFixed(4) };
        }, [a.screenshot.toString('base64'), b.screenshot.toString('base64')]);
        const result = { viewport, theme, state, textMatches: a.text === b.text,
          geometryMatches: JSON.stringify(a.geometry) === JSON.stringify(b.geometry), pngBytesMatch: a.screenshot.equals(b.screenshot),
          pixels,
          reference: { file: a.filename, geometry: a.geometry, overflow: a.overflow }, local: { file: b.filename, geometry: b.geometry, overflow: b.overflow } };
        report.results.push(result);
        await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify({ width: viewport.width, theme, state, text: result.textMatches, geometry: result.geometryMatches, pixels }));
      }
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  await server.close();
  if (referenceServer) await new Promise(resolve => referenceServer.close(resolve));
}
console.log(path.join(directory, 'report.json'));

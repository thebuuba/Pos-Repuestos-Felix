// Rasterize the Repuestos Félix BrandLogo symbol (rounded red tile + white wrench, no black dot)
// for PWA/Web PNG icons and the multi-resolution Windows ICO.
import { createElement } from 'react';
import { writeFile } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import { Wrench } from 'lucide-react';
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const glyph = renderToStaticMarkup(createElement(Wrench, { size: 256, strokeWidth: 2.4, color: 'white' }));

function iconHtml(size, { rounded = true, maskable = false } = {}) {
  const radius = rounded ? '112px' : '0px';
  const inset = maskable ? 84 : 0;
  return `<style>
    *{box-sizing:border-box}
    html,body{margin:0;padding:0;background:transparent;overflow:hidden}
    .icon{position:absolute;width:512px;height:512px;transform:scale(${size / 512});transform-origin:top left;background:#c3131f;border-radius:${radius};overflow:hidden}
    .mark{position:absolute;inset:${inset}px}
    .mark svg{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-45deg);width:56%;height:56%}
  </style><div class="icon"><div class="mark">${glyph}</div></div>`;
}

function packIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  const dir = Buffer.alloc(frames.length * 16);
  let offset = 6 + dir.length;
  frames.forEach(({ size, buffer }, index) => {
    const o = index * 16;
    dir[o] = size >= 256 ? 0 : size;
    dir[o + 1] = size >= 256 ? 0 : size;
    dir[o + 2] = 0;
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(buffer.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += buffer.length;
  });
  return Buffer.concat([header, dir, ...frames.map(f => f.buffer)]);
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const [file, size, options] of [
    ['icon-192.png', 192, { rounded: true }],
    ['icon-512.png', 512, { rounded: true }],
    ['maskable-512.png', 512, { rounded: false, maskable: true }],
    ['apple-touch-icon.png', 180, { rounded: false }],
  ]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(iconHtml(size, options));
    await page.screenshot({
      path: fileURLToPath(new URL('../public/icons/' + file, import.meta.url)),
      omitBackground: Boolean(options.rounded),
    });
    await page.close();
  }

  for (const [file, size] of [
    ['32x32.png', 32],
    ['128x128.png', 128],
    ['128x128@2x.png', 256],
    ['512x512.png', 512],
  ]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(iconHtml(size, { rounded: true }));
    await page.screenshot({
      path: fileURLToPath(new URL('../src-tauri/icons/' + file, import.meta.url)),
      omitBackground: true,
    });
    await page.close();
  }

  const icoFrames = [];
  for (const size of [16, 24, 32, 48, 64, 128, 256]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(iconHtml(size, { rounded: true }));
    const buffer = await page.screenshot({ omitBackground: true });
    icoFrames.push({ size, buffer });
    await page.close();
  }
  await writeFile(fileURLToPath(new URL('../src-tauri/icons/icon.ico', import.meta.url)), packIco(icoFrames));
} finally {
  await browser.close();
}

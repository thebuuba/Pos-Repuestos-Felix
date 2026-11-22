// Rasterize the existing Polymet BrandLogo symbol; no generated brand or external image.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Wrench } from 'lucide-react';
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  for (const [file, size, maskable] of [
    ['icon-192.png', 192], ['icon-512.png', 512], ['maskable-512.png', 512, true], ['apple-touch-icon.png', 180],
  ]) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    const glyph = renderToStaticMarkup(createElement(Wrench, { size: 256, strokeWidth: 2.4, color: 'white' }));
    await page.setContent(`<style>*{box-sizing:border-box}body{margin:0;background:#c3131f}.icon{position:absolute;width:512px;height:512px;transform:scale(${size / 512});transform-origin:top left}.mark{position:absolute;inset:${maskable ? 84 : 0}px}.mark svg{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) rotate(-45deg);width:50%;height:50%}.badge{position:absolute;right:8%;bottom:8%;width:24%;height:24%;border:18px solid white;border-radius:50%;background:#121216}</style><div class="icon"><div class="mark">${glyph}<span class="badge"></span></div></div>`);
    await page.screenshot({ path: fileURLToPath(new URL('../public/icons/' + file, import.meta.url)) });
    await page.close();
  }
} finally { await browser.close(); }

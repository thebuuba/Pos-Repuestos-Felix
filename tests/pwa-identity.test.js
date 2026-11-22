import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { buildOperational } from '../scripts/build-operational.mjs';
import { handleRequest } from '../src/http/app.js';
import { hostingConfig } from '../src/hosting.js';

test('el acceso público y la aplicación anuncian la misma identidad instalable en iPhone', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'felix-pwa-identity-'));
  try {
    await buildOperational(directory);
    const origin = 'https://pos.example';
    const options = {
      hosting: hostingConfig({ PUBLIC_ORIGIN: origin, APP_USERNAME: 'prueba', APP_PASSWORD: 'clave-sintetica-pwa-identity' }),
      pool: { connect() { assert.fail('La identidad pública no debe consultar datos del negocio'); } },
      readAsset: file => readFile(path.join(directory, file)),
    };
    const get = pathname => handleRequest(new Request(origin + pathname, { headers: { 'X-Forwarded-Proto': 'https' } }), options);
    const launch = await get('/ventas');
    assert.equal(launch.status, 303);
    assert.match(launch.headers.get('location'), /^\/login\?/);
    for (const pathname of [launch.headers.get('location'), '/pwa-shell.html']) {
      const response = await get(pathname);
      assert.equal(response.status, 200);
      const dom = new JSDOM(await response.text());
      try {
        const document = dom.window.document;
        assert.equal(document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content, 'Félix POS', pathname);
        assert.equal(document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.content, 'yes', pathname);
        assert.equal(document.querySelector('link[rel="manifest"]')?.getAttribute('href'), '/manifest.webmanifest', pathname);
        const icon = document.querySelector('link[rel="apple-touch-icon"]');
        assert.equal(icon?.getAttribute('sizes'), '180x180');
        const image = await get(icon.getAttribute('href'));
        assert.equal(image.status, 200, 'El icono debe ser público antes de iniciar sesión');
        assert.equal(image.headers.get('content-type'), 'image/png');
        const png = Buffer.from(await image.arrayBuffer());
        assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, '180x180');
      } finally { dom.window.close(); }
    }
    const response = await get('/manifest.webmanifest');
    assert.equal(response.status, 200);
    const manifest = await response.json();
    assert.equal(manifest.name, 'Repuestos Félix');
    assert.equal(manifest.short_name, 'Félix POS');
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, '/ventas');
    assert.equal(manifest.id, '/');
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('felix-pwa-identity-'));
    await rm(directory, { recursive: true, force: true });
  }
});

import { build } from 'esbuild';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function buildOperational(outdir = 'dist/operational') {
  const destination = path.resolve(outdir);
  await mkdir(destination, { recursive: true });
  await build({
    absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
    entryPoints: { app: 'frontend/operational.jsx' }, outdir: destination,
    bundle: true, format: 'esm', target: 'es2022', jsx: 'automatic', minify: true,
    assetNames: 'assets/fonts/[name]', publicPath: '/', loader: { '.woff2': 'file', '.png': 'file' },
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
  });
  await rename(path.join(destination, 'app.css'), path.join(destination, 'styles.css'));
  await mkdir(path.join(destination, 'assets/brand'), { recursive: true });
  await copyFile(new URL('../public/assets/brand/repuestos-felix.jpg', import.meta.url), path.join(destination, 'assets/brand/repuestos-felix.jpg'));
  await copyFile(fileURLToPath(import.meta.resolve('@fontsource-variable/inter/LICENSE')), path.join(destination, 'assets/Inter-OFL.txt'));
  await Promise.all(['login.html', 'login.js'].map(file => copyFile(new URL('../frontend/' + file, import.meta.url), path.join(destination, file))));
  await mkdir(path.join(destination, 'assets/pwa'), { recursive: true });
  const fingerprint = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const app = await readFile(path.join(destination, 'app.js'));
  const styles = await readFile(path.join(destination, 'styles.css'));
  const appPath = `/assets/pwa/app-${fingerprint(app)}.js`;
  const stylesPath = `/assets/pwa/styles-${fingerprint(styles)}.css`;
  await writeFile(path.join(destination, appPath.slice(1)), app);
  await writeFile(path.join(destination, stylesPath.slice(1)), styles);
  await mkdir(path.join(destination, 'icons'), { recursive: true });
  const icons = ['icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon.png'];
  await Promise.all(icons.map(file => copyFile(new URL('../public/icons/' + file, import.meta.url), path.join(destination, 'icons', file))));
  await copyFile(new URL('../public/manifest.webmanifest', import.meta.url), path.join(destination, 'manifest.webmanifest'));
  const html = [
    '<!doctype html><html lang="es"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<meta name="theme-color" content="#c3131f"><meta name="apple-mobile-web-app-capable" content="yes">',
    '<meta name="apple-mobile-web-app-title" content="Félix POS"><meta name="apple-mobile-web-app-status-bar-style" content="default">',
    '<link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">',
    `<title>Repuestos Félix</title><link rel="stylesheet" href="${stylesPath}"></head>`,
    `<body><div id="root"></div><script type="module" src="${appPath}"></script></body></html>`,
  ].join('\n');
  await writeFile(path.join(destination, 'index.html'), html);
  await writeFile(path.join(destination, 'pwa-shell.html'), html);
  const files = ['/pwa-shell.html', appPath, stylesPath, '/manifest.webmanifest',
    '/assets/fonts/inter-latin-wght-normal.woff2', '/assets/brand/repuestos-felix.jpg', ...icons.map(file => '/icons/' + file)];
  const template = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  const digest = createHash('sha256').update(template);
  for (const file of files) digest.update(file).update(await readFile(path.join(destination, file.slice(1))));
  const worker = template.replace('__BUILD_ID__', digest.digest('hex').slice(0, 16))
    .replace(/const FILES = \[[\s\S]*?\];/, `const FILES = ${JSON.stringify(files)};`);
  await writeFile(path.join(destination, 'sw.js'), worker);
  return destination;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('POS compilado en', await buildOperational());
}

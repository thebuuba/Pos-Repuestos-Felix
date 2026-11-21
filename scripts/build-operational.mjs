import { build } from 'esbuild';
import { copyFile, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function buildOperational(outdir = 'dist/operational') {
  const destination = path.resolve(outdir);
  await mkdir(destination, { recursive: true });
  await build({
    absWorkingDir: fileURLToPath(new URL('../', import.meta.url)),
    entryPoints: { app: 'frontend/operational.jsx' }, outdir: destination,
    bundle: true, format: 'esm', target: 'es2022', jsx: 'automatic', minify: true,
    assetNames: 'assets/fonts/[name]', loader: { '.woff2': 'file', '.png': 'file' },
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
  });
  await rename(path.join(destination, 'app.css'), path.join(destination, 'styles.css'));
  await copyFile(fileURLToPath(import.meta.resolve('@fontsource-variable/inter/LICENSE')), path.join(destination, 'assets/Inter-OFL.txt'));
  await writeFile(path.join(destination, 'index.html'), [
    '<!doctype html><html lang="es"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
    '<title>Repuestos Félix</title><link rel="stylesheet" href="/styles.css"></head>',
    '<body><div id="root"></div><script type="module" src="/app.js"></script></body></html>',
  ].join('\n'));
  return destination;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('Inventario compilado en', await buildOperational());
}

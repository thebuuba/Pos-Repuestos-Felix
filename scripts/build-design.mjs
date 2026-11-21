import { build } from "esbuild";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function buildDesign(outdir = "dist/design-preview") {
  const projectRoot = fileURLToPath(new URL("../", import.meta.url));
  const destination = path.resolve(outdir);
  await mkdir(destination, { recursive: true });
  await build({
    absWorkingDir: projectRoot,
    entryPoints: ["frontend/reference.jsx"],
    outdir: destination,
    entryNames: "design",
    assetNames: "assets/[name]-[hash]",
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    jsx: "automatic",
    minify: true,
    loader: { ".woff2": "file", ".png": "file" },
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  await mkdir(path.join(destination, "assets"), { recursive: true });
  await writeFile(
    path.join(destination, "assets/Inter-OFL.txt"),
    await readFile(
      fileURLToPath(import.meta.resolve("@fontsource-variable/inter/LICENSE")),
    ),
  );
  await writeFile(
    path.join(destination, "index.html"),
    `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex,nofollow"><title>Repuestos Félix · Revisión de diseño</title>
<link rel="stylesheet" href="/design.css"></head><body><div id="root"></div><script type="module" src="/design.js"></script></body></html>`,
  );
  return destination;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  console.log("Vista de diseño compilada:", await buildDesign());
}

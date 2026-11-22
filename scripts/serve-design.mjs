// Static inventory preview by default. --reference opts into the isolated QA demo.
// Neither preview starts an API, runs migrations or reads business credentials.
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildDesign } from "./build-design.mjs";
import { buildOperational } from "./build-operational.mjs";

const reference = JSON.parse(
  await readFile(
    new URL("../docs/design/polymet-reference.json", import.meta.url),
    "utf8",
  ),
);
const routes = new Set(reference.routes.map((route) => route.path));
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
};

export async function serveDesign(directory, port = 3001) {
  const assets = new Map();
  async function collect(subdir = "") {
    for (const entry of await readdir(path.join(directory, subdir), {
      withFileTypes: true,
    })) {
      const relative = path.posix.join(subdir, entry.name);
      if (entry.isDirectory()) await collect(relative);
      else if (entry.isFile())
        assets.set("/" + relative, path.join(directory, relative));
    }
  }
  await collect();
  const server = createServer(async (request, response) => {
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      const asset = assets.get(routes.has(pathname) ? "/index.html" : pathname);
      if (!asset || !["GET", "HEAD"].includes(request.method)) {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, {
        "Content-Type":
          types[path.extname(asset)] || "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(
        request.method === "HEAD" ? undefined : await readFile(asset),
      );
    } catch {
      response.writeHead(500);
      response.end("No se pudo leer el recurso de diseño.");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const referenceOnly = process.argv.includes("--reference");
  const directory = referenceOnly
    ? await buildDesign()
    : await buildOperational();
  const server = await serveDesign(directory);
  console.log(
    referenceOnly
      ? `Referencia de Polymet (demostración aislada): ${server.origin}`
      : `Vista del inventario sin datos de muestra: ${server.origin}. Vista estática: API y activación conectada pendientes.`,
  );
}

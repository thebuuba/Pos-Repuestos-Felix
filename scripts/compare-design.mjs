// Compare only the public user-approved prototype with the isolated local fixture preview.
// No personal browser profile or business credentials are read.
import { chromium } from "playwright-core";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { buildDesign } from "./build-design.mjs";
import { serveDesign } from "./serve-design.mjs";

const reference = JSON.parse(
  await readFile(
    new URL("../docs/design/polymet-reference.json", import.meta.url),
    "utf8",
  ),
);
const preview = await (
  await fetch(reference.preview, { signal: AbortSignal.timeout(30_000) })
).text();
const scriptUrl = preview.match(/<script id="user-main-js" src="([^"]+)"/)?.[1];
if (!scriptUrl)
  throw new Error("No se pudo identificar la versión pública de Polymet.");
const source = await (
  await fetch(scriptUrl, { signal: AbortSignal.timeout(30_000) })
).text();
if (
  createHash("sha256").update(source).digest("hex") !== reference.bundleSha256
)
  throw new Error("Polymet cambió de versión. Revisar antes de comparar.");

const runLabel = process.argv[2] || "current";
if (!/^[a-z0-9_-]+$/.test(runLabel))
  throw new Error("Nombre de comparación inválido.");
const directory = path.resolve(`dist/design-comparison-${runLabel}`);
await mkdir(directory, { recursive: true });
const server = await serveDesign(
  await buildDesign(`dist/design-preview-${runLabel}`),
  0,
);
const browser = await chromium.launch({ channel: "msedge", headless: true });
const report = {
  version: reference.version,
  fixedTime: "2026-11-21T20:00:00Z",
  clockStrategy:
    "Fixed Date constructor for fixture business dates; real Date.now for JavaScript animations",
  checkedAt: new Date().toISOString(),
  results: [],
};
const titles = {
  "/ventas": "Facturación / Punto de venta",
  "/inventario": "Catálogo de artículos e inventario",
  "/compras": "Subir factura de compra",
};
try {
  for (const viewport of reference.visualVerificationViewports) {
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport,
        locale: "es-DO",
        timezoneId: "America/Santo_Domingo",
        reducedMotion: "reduce",
        deviceScaleFactor: 1,
      });
      const remote = await context.newPage();
      const local = await context.newPage();
      const analysis = await context.newPage();
      await context.route("**/*", (route) =>
        route.request().method() === "GET" ? route.continue() : route.abort(),
      );
      for (const [page, origin] of [
        [remote, reference.preview],
        [local, server.origin],
      ]) {
        // Freezing Date.now also freezes Recharts' animation manager. Keep the
        // monotonic animation timeline live while making fixture dates stable.
        await page.addInitScript((fixedTime) => {
          const NativeDate = Date;
          const fixed = new NativeDate(fixedTime).valueOf();
          class FixtureDate extends NativeDate {
            constructor(...args) {
              super(...(args.length ? args : [fixed]));
            }
            static now() {
              return NativeDate.now();
            }
          }
          window.Date = FixtureDate;
        }, report.fixedTime);
        await page.goto(origin, { waitUntil: "networkidle" });
        await page.locator("main h1").waitFor();
      }
      for (const route of reference.routes) {
        const slug = `${viewport.width}-${theme}-${route.path === "/" ? "panel" : route.path.slice(1)}`;
        const evidence = [];
        for (const [page, side] of [
          [remote, "reference"],
          [local, "local"],
        ]) {
          if (route.path !== "/") {
            const mobileMenu = page.getByRole("button", {
              name: "Abrir menú",
              exact: true,
            });
            if (await mobileMenu.isVisible()) {
              await mobileMenu.click();
              await page
                .getByRole("dialog")
                .locator(`a[href="${route.path}"]`)
                .first()
                .click();
              await page.getByRole("dialog").waitFor({ state: "hidden" });
            } else
              await page
                .locator(`aside a[href="${route.path}"]`)
                .first()
                .click();
          }
          await page
            .getByRole("heading", {
              name: titles[route.path] || route.label,
              exact: true,
            })
            .waitFor();
          const isDark = await page
            .locator("html")
            .evaluate((el) => el.classList.contains("dark"));
          if (isDark !== (theme === "dark"))
            await page
              .getByRole("button", { name: "Cambiar tema", exact: true })
              .click();
          await page.evaluate(() => document.fonts.ready);
          await page.mouse.move(viewport.width - 1, 0);
          // Only charts have a JavaScript entrance animation; CSS animations are disabled in screenshots.
          await page.waitForTimeout(
            (await page.locator(".recharts-wrapper").count()) ? 1700 : 250,
          );
          const geometry = await page.evaluate(() =>
            [
              ...document.querySelectorAll(
                "header, aside, main, main h1, main table, main .rounded-3xl",
              ),
            ].map((el) => {
              const rect = el.getBoundingClientRect();
              return {
                tag: el.tagName,
                x: Math.round(rect.x * 100) / 100,
                y: Math.round(rect.y * 100) / 100,
                width: Math.round(rect.width * 100) / 100,
                height: Math.round(rect.height * 100) / 100,
              };
            }),
          );
          const text = await page.locator("body").innerText();
          const filename = `${slug}-${side}.png`;
          const screenshot = await page.screenshot({
            path: path.join(directory, filename),
            fullPage: true,
            animations: "disabled",
          });
          evidence.push({
            geometry,
            text,
            screenshot,
            filename,
            overflow: await page.evaluate(
              () => document.documentElement.scrollWidth > innerWidth,
            ),
          });
        }
        const [a, b] = evidence;
        const pixels = await analysis.evaluate(
          async ([first, second]) => {
            const images = await Promise.all(
              [first, second].map(async (base64) => {
                const image = new Image();
                image.src = "data:image/png;base64," + base64;
                await image.decode();
                return image;
              }),
            );
            if (
              images[0].width !== images[1].width ||
              images[0].height !== images[1].height
            )
              return {
                dimensionsMatch: false,
                referenceSize: [images[0].width, images[0].height],
                localSize: [images[1].width, images[1].height],
              };
            const data = images.map((image) => {
              const canvas = document.createElement("canvas");
              canvas.width = image.width;
              canvas.height = image.height;
              const ctx = canvas.getContext("2d", { willReadFrequently: true });
              ctx.drawImage(image, 0, 0);
              return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            });
            let changed = 0,
              absolute = 0,
              minX = images[0].width,
              minY = images[0].height,
              maxX = -1,
              maxY = -1;
            for (let i = 0; i < data[0].length; i += 4) {
              const delta = Math.max(
                Math.abs(data[0][i] - data[1][i]),
                Math.abs(data[0][i + 1] - data[1][i + 1]),
                Math.abs(data[0][i + 2] - data[1][i + 2]),
              );
              if (delta > 24) {
                changed++;
                const pixel = i / 4,
                  x = pixel % images[0].width,
                  y = Math.floor(pixel / images[0].width);
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
              }
              absolute += delta;
            }
            const total = images[0].width * images[0].height;
            return {
              dimensionsMatch: true,
              changedPixelsAbove24: changed,
              totalPixels: total,
              differenceBounds: changed ? { minX, minY, maxX, maxY } : null,
              changedPercent: Math.round((changed / total) * 10000) / 100,
              meanMaxChannelDifference:
                Math.round((absolute / total) * 1000) / 1000,
            };
          },
          [a.screenshot.toString("base64"), b.screenshot.toString("base64")],
        );
        const result = {
          route: route.path,
          viewport,
          theme,
          textMatches: a.text === b.text,
          geometryMatches:
            JSON.stringify(a.geometry) === JSON.stringify(b.geometry),
          geometry: { reference: a.geometry, local: b.geometry },
          overflow: { reference: a.overflow, local: b.overflow },
          pixels,
          screenshots: [a.filename, b.filename],
        };
        report.results.push(result);
        await writeFile(
          path.join(directory, "report.json"),
          JSON.stringify(report, null, 2),
        );
        console.log(
          JSON.stringify({
            case: slug,
            textMatches: result.textMatches,
            geometryMatches: result.geometryMatches,
            pixels,
          }),
        );
      }
      await context.close();
    }
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(
  `Comparación guardada en ${path.relative(process.cwd(), directory)}/report.json`,
);

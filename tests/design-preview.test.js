import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";

test(
  "the recovered design renders all Polymet modules, mobile navigation and dark mode without a database",
  { timeout: 120_000 },
  async () => {
    const { buildDesign } = await import("../scripts/build-design.mjs");
    const { serveDesign } = await import("../scripts/serve-design.mjs");
    const outdir = await mkdtemp(path.join(tmpdir(), "felix-design-"));
    let server, browser;
    try {
      await buildDesign(outdir);
      server = await serveDesign(outdir, 0);
      browser = await chromium.launch({ channel: "msedge", headless: true });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        locale: "es-DO",
        timezoneId: "America/Santo_Domingo",
      });
      const errors = [];
      const externalRequests = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (
          !request.url().startsWith(server.origin) &&
          !request.url().startsWith("data:")
        )
          externalRequests.push(request.url());
      });
      const manifest = JSON.parse(
        await readFile(
          new URL("../docs/design/polymet-reference.json", import.meta.url),
          "utf8",
        ),
      );
      for (const route of manifest.routes) {
        const response = await page.goto(server.origin + route.path);
        assert.equal(response.status(), 200, route.path);
        await page.locator("main h1").waitFor();
        const expected = {
          "/ventas": "Facturación / Punto de venta",
          "/inventario": "Catálogo de artículos e inventario",
          "/compras": "Subir factura de compra",
        };
        assert.equal(
          (await page.locator("main h1").innerText()).trim(),
          expected[route.path] || route.label,
          route.path,
        );
        assert.equal(
          await page.locator("aside:visible").count(),
          1,
          route.path,
        );
      }
      await page.goto(server.origin + "/");
      await page
        .getByRole("button", { name: "Cambiar tema", exact: true })
        .click();
      assert.equal(
        await page
          .locator("html")
          .evaluate((el) => el.classList.contains("dark")),
        true,
      );
      await page.setViewportSize({ width: 390, height: 844 });
      await page
        .getByRole("button", { name: "Más", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("link", { name: "Suplidores", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Suplidores", exact: true })
        .waitFor();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(await page.getByRole("dialog").count(), 0);
      const bottomNav = page.getByRole("navigation", { name: "Navegación rápida" });
      await bottomNav.getByRole("link", { name: "Inventario", exact: true }).click();
      await page
        .getByRole("heading", {
          name: "Catálogo de artículos e inventario",
          exact: true,
        })
        .waitFor();
      await bottomNav.getByRole("link", { name: "Ventas", exact: true }).click();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollHeight),
        2317 + 72,
        "Mobile invoice form retains Polymet spacing plus the 72px reserved for the requested bottom navigation",
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(externalRequests, []);
      assert.equal((await fetch(server.origin + "/api/state")).status, 404);
      assert.equal((await fetch(server.origin + "/.env")).status, 404);
    } finally {
      await browser?.close();
      await server?.close();
      const resolved = path.resolve(outdir);
      assert.ok(
        resolved.startsWith(path.resolve(tmpdir()) + path.sep) &&
          path.basename(resolved).startsWith("felix-design-"),
      );
      await rm(resolved, { recursive: true, force: true });
    }
  },
);

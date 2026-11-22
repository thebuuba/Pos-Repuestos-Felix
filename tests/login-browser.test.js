import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { chromium } from "playwright-core";
import { temporaryPostgres } from "./postgres.js";
import { migrateDatabase } from "../src/db/migrations.js";
import { createApp } from "../src/server.js";
import { hostingConfig } from "../src/hosting.js";

test(
  "login propio recuerda la sesión al reabrir, no expone la cookie a JavaScript y permite salir",
  { timeout: 60000 },
  async () => {
    let database, pool, server, browser;
    try {
      database = await temporaryPostgres();
      pool = new pg.Pool({ connectionString: database.connectionString });
      await migrateDatabase(pool);
      server = await createApp(pool, {
        hosting: hostingConfig({
          APP_USERNAME: "felix",
          APP_PASSWORD: "clave-navegador-sintetica-12345",
        }),
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const origin = "http://127.0.0.1:" + server.address().port;
      browser = await chromium.launch({ channel: "msedge", headless: true });
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        locale: "es-DO",
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(origin + "/inventario?existencia=low");
      await page
        .getByRole("heading", { name: "Iniciar sesión", exact: true })
        .waitFor();
      await page.getByLabel("Usuario", { exact: true }).fill("felix");
      await page.getByLabel("Contraseña", { exact: true }).fill("incorrecta");
      await page.getByRole("button", { name: "Entrar al sistema" }).click();
      await page
        .getByRole("alert")
        .getByText("El usuario o la contraseña no son correctos.", {
          exact: true,
        })
        .waitFor();
      await page
        .getByLabel("Contraseña", { exact: true })
        .fill("clave-navegador-sintetica-12345");
      await page.getByRole("button", { name: "Entrar al sistema" }).click();
      await page
        .getByRole("heading", {
          name: "Catálogo de artículos e inventario",
          exact: true,
        })
        .waitFor();
      assert.ok(page.url().endsWith("/inventario?existencia=low"));
      assert.equal(
        await page.evaluate(() => document.cookie.includes("felix-session")),
        false,
      );
      const cookie = (await context.cookies()).find(
        (c) => c.name === "felix-session",
      );
      assert.ok(cookie.httpOnly);
      assert.equal(cookie.sameSite, "Strict");
      assert.ok(cookie.expires > Date.now() / 1000 + 29 * 86400);
      const saved = await context.storageState();
      await context.close();
      const reopened = await browser.newContext({
        storageState: saved,
        viewport: { width: 320, height: 844 },
      });
      const next = await reopened.newPage();
      await next.goto(origin + "/inventario");
      await next
        .getByRole("heading", {
          name: "Catálogo de artículos e inventario",
          exact: true,
        })
        .waitFor();
      assert.equal(
        await next.evaluate(
          () => document.documentElement.scrollWidth > innerWidth + 1,
        ),
        false,
      );
      await next
        .getByRole("button", { name: "Cerrar sesión", exact: true })
        .click();
      await next
        .getByRole("heading", { name: "Iniciar sesión", exact: true })
        .waitFor();
      const denied = await reopened.request.get(origin + "/api/state");
      assert.equal(denied.status(), 401);
      assert.equal(denied.headers()["www-authenticate"], undefined);
      assert.equal(
        (await reopened.cookies()).some((c) => c.name === "felix-session"),
        false,
      );
      assert.deepEqual(errors, []);
      await reopened.close();
    } finally {
      await browser?.close();
      if (server) await new Promise((resolve) => server.close(resolve));
      await pool?.end();
      await database?.stop();
    }
  },
);

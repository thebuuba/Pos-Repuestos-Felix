import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { chromium } from "playwright-core";
import { temporaryPostgres } from "./postgres.js";
import { migrateDatabase } from "../src/db/migrations.js";
import { createApp } from "../src/server.js";
import { hostingConfig } from "../src/hosting.js";
import { testAuthService } from "./fixtures/supabase-auth.js";

test(
  "login propio recuerda la sesión al reabrir, no expone la cookie a JavaScript y permite salir",
  { timeout: 60000 },
  async () => {
    let database, pool, server, browser, authService;
    try {
      database = await temporaryPostgres();
      pool = new pg.Pool({ connectionString: database.connectionString });
      await migrateDatabase(pool);
      authService = await testAuthService();
      server = await createApp(pool, { hosting: hostingConfig(authService.env) });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const origin = "http://127.0.0.1:" + server.address().port;
      browser = await chromium.launch({ channel: "msedge", headless: true });
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        locale: "es-DO",
        colorScheme: "dark",
      });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(origin + "/inventario?existencia=low");
      await page
        .getByRole("heading", { name: "Iniciar sesión", exact: true })
        .waitFor();
      assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), 'light', 'El acceso usa el mismo tema predeterminado que el POS');
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
      assert.equal(cookie.sameSite, "Lax");
      assert.ok(cookie.expires > Date.now() / 1000 + 364 * 86400);
      const saved = await context.storageState();
      await context.close();
      const reopened = await browser.newContext({
        storageState: saved,
        viewport: { width: 320, height: 844 },
      });
      const next = await reopened.newPage();
      // Enter from another site, as with a saved link or a message. Strict
      // cookies used to omit the session during this top-level navigation.
      await next.goto(origin.replace('127.0.0.1', 'localhost') + '/login');
      await next.evaluate(href => {
        const link = document.createElement('a'); link.textContent = 'Abrir el POS'; link.href = href;
        document.body.append(link);
      }, origin + '/inventario');
      await next.getByRole('link', { name: 'Abrir el POS' }).click();
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
      const secondTab = await reopened.newPage();
      await secondTab.goto(origin + "/inventario");
      await secondTab.getByRole("heading", { name: "Catálogo de artículos e inventario", exact: true }).waitFor();
      await next
        .getByRole("button", { name: "Cerrar sesión", exact: true })
        .click();
      await secondTab.getByRole("link", { name: "Iniciar sesión" }).waitFor();
      assert.equal(await secondTab.getByRole("heading", { name: "Catálogo de artículos e inventario" }).count(), 0);
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
      await next.getByRole("link", { name: "Cambiar mi contraseña" }).click();
      await next.getByLabel("Usuario", { exact: true }).fill("felix");
      await next.getByLabel("Contraseña", { exact: true }).fill("clave-navegador-sintetica-12345");
      await next.getByLabel("Nueva contraseña").fill("Una frase privada del cajero");
      await next.getByRole("button", { name: "Guardar contraseña y entrar" }).click();
      await next.getByRole("heading", { name: "Catálogo de artículos e inventario", exact: true }).waitFor();
      await reopened.close();
    } finally {
      await browser?.close();
      await authService?.close();
      if (server) await new Promise((resolve) => server.close(resolve));
      await pool?.end();
      await database?.stop();
    }
  },
);

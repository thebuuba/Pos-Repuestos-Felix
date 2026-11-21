import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { buildOperational } from "../scripts/build-operational.mjs";
import { serveDesign } from "../scripts/serve-design.mjs";

let browser, server, directory;
const databaseId = randomUUID();
const product = {
  id: 7,
  version: 2,
  codigo: "PRUEBA",
  nombre: "Artículo de prueba",
  marca: "Prueba",
  categoria: "Motor",
  ubicacion: "A-01",
  costo: 10.25,
  precio1: 20,
  precio2: 15,
  precio3: 12,
  stock: 8,
  stockMinimo: 4,
  gravado: true,
};

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "felix-catalog-forms-"));
  await buildOperational(directory);
  server = await serveDesign(directory, 0);
  browser = await chromium.launch({ channel: "msedge", headless: true });
});

after(async () => {
  await browser?.close();
  await server?.close();
  if (directory) {
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith("felix-catalog-forms-"));
    await rm(resolved, { recursive: true, force: true });
  }
});

async function openInventory(t, products = []) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    locale: "es-DO",
    timezoneId: "America/Santo_Domingo",
    serviceWorkers: "block",
  });
  t.after(() => context.close());
  const page = await context.newPage();
  const state = {
    databaseId,
    databaseLabel: "Prueba aislada",
    revision: 1,
    state: { productos: products },
  };
  await page.route("**/api/state", (route) => route.fulfill({ json: state }));
  await page.goto(server.origin + "/inventario");
  await page
    .getByRole("button", { name: "Nuevo artículo", exact: true })
    .waitFor();
  return { page, state };
}

async function newDraft(page) {
  await page
    .getByRole("button", { name: "Nuevo artículo", exact: true })
    .click();
  const sheet = page.getByRole("dialog");
  await sheet.getByPlaceholder("Ej. BUJ-C7HSA").fill("PRUEBA");
  await sheet
    .getByPlaceholder("Ej. Bujía NGK C7HSA")
    .fill("Artículo de prueba");
  const numbers = sheet.getByRole("spinbutton");
  await numbers.nth(0).fill("10.25");
  await numbers.nth(3).fill("20.15");
  return sheet;
}

const noToast = (page, message) =>
  page
    .getByText(message, { exact: true })
    .count()
    .then((count) =>
      assert.equal(count, 0, "an unconfirmed request must not show success"),
    );

test(
  "a deferred save blocks duplicate clicks and reports success only after the response",
  { timeout: 30_000 },
  async (t) => {
    const { page, state } = await openInventory(t);
    const gate = Promise.withResolvers();
    const packets = [];
    await page.route("**/api/productos", async (route) => {
      packets.push(route.request().postDataJSON());
      await gate.promise;
      await route.fulfill({
        json: {
          ...state,
          revision: 2,
          result: { id: product.id },
          state: { productos: [product] },
        },
      });
    });
    const sheet = await newDraft(page);
    try {
      await sheet
        .getByRole("button", { name: "Guardar artículo", exact: true })
        .dblclick();
      await noToast(page, "Artículo creado");
      assert.equal(await sheet.isVisible(), true);
      await sheet
        .getByRole("button", { name: "Guardando…", exact: true })
        .waitFor();
      assert.equal(
        await sheet.getByPlaceholder("Ej. Bujía NGK C7HSA").isDisabled(),
        true,
      );
      await page.keyboard.press("Escape");
      assert.equal(await sheet.isVisible(), true);
    } finally {
      gate.resolve();
    }
    await sheet.waitFor({ state: "hidden" });
    await page.getByText("Artículo creado", { exact: true }).waitFor();
    assert.equal(packets.length, 1);
    assert.equal(packets[0].databaseId, databaseId);
    assert.equal(Object.hasOwn(packets[0], "version"), false);
  },
);

test(
  "a rejected save retains the draft and allows a correction",
  { timeout: 30_000 },
  async (t) => {
    const { page } = await openInventory(t);
    await page.route("**/api/productos", (route) =>
      route.fulfill({
        status: 422,
        json: { error: "El servicio rechazó el artículo." },
      }),
    );
    const sheet = await newDraft(page);
    await sheet
      .getByRole("button", { name: "Guardar artículo", exact: true })
      .click();
    await noToast(page, "Artículo creado");
    await sheet
      .getByRole("alert")
      .getByText("El servicio rechazó el artículo.")
      .waitFor();
    const description = sheet.getByLabel("Descripción", { exact: true });
    assert.equal(await description.inputValue(), "Artículo de prueba");
    await description.fill("Corrección de prueba");
  },
);

test(
  "invalid numeric fields stay in the draft and explicit zero survives optional price fallback",
  { timeout: 30_000 },
  async (t) => {
    const { page, state } = await openInventory(t);
    const packets = [];
    await page.route("**/api/productos", (route) => {
      packets.push(route.request().postDataJSON());
      return route.fulfill({
        json: { ...state, revision: 2, result: { id: product.id } },
      });
    });
    const sheet = await newDraft(page);
    const numbers = sheet.getByRole("spinbutton");
    const submit = sheet.getByRole("button", {
      name: "Guardar artículo",
      exact: true,
    });
    for (const [field, value, message] of [
      [0, "1e100", /hasta dos decimales/],
      [1, "1.5", /entero/],
      [2, "2147483648", /entero/],
      [3, "10.255", /hasta dos decimales/],
      [4, "-1", /hasta dos decimales/],
      [5, "3.141", /hasta dos decimales/],
    ]) {
      const input = numbers.nth(field);
      const original = await input.inputValue();
      await input.fill(value);
      await submit.click();
      await noToast(page, "Artículo creado");
      assert.match(await input.locator("..").innerText(), message);
      await input.fill(original);
    }
    assert.equal(packets.length, 0);
    assert.equal(
      await sheet
        .getByRole("button", { name: "Calcular", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(await sheet.getByText(/Sugerido/).count(), 0);
    await sheet.getByLabel("Precio 2 · Por mayor", { exact: true }).fill("0");
    await submit.click();
    await sheet.waitFor({ state: "hidden" });
    assert.equal(packets.length, 1);
    assert.equal(packets[0].stock, 0);
    assert.equal(packets[0].stockMinimo, 5);
    assert.equal(packets[0].costo, 10.25);
    assert.equal(packets[0].precio1, 20.15);
    assert.equal(packets[0].precio2, 0);
    assert.equal(packets[0].precio3, 0);
  },
);

test(
  "an uncertain save freezes the draft and retries the same request",
  { timeout: 30_000 },
  async (t) => {
    const { page, state } = await openInventory(t);
    const packets = [];
    await page.route("**/api/productos", (route) => {
      packets.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      if (packets.length === 1) return route.abort("failed");
      return route.fulfill({
        json: {
          ...state,
          revision: 2,
          result: { id: product.id },
          state: { productos: [product] },
        },
      });
    });
    const sheet = await newDraft(page);
    await sheet
      .getByRole("button", { name: "Guardar artículo", exact: true })
      .click();
    await noToast(page, "Artículo creado");
    await sheet
      .getByRole("alert")
      .getByText(/No se confirmó la operación/)
      .waitFor();
    assert.equal(
      await sheet.getByLabel("Categoría", { exact: true }).isDisabled(),
      true,
    );
    assert.equal(
      await sheet
        .getByRole("switch", { name: "Aplica ITBIS", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(
      await sheet.getByLabel("Descripción", { exact: true }).isDisabled(),
      true,
    );
    await sheet
      .getByRole("button", { name: "Reintentar guardado", exact: true })
      .click();
    await sheet.waitFor({ state: "hidden" });
    assert.equal(packets.length, 2);
    assert.ok(packets[0].key);
    assert.deepEqual(packets[1], packets[0]);
  },
);

test(
  "a refresh from another generation does not change an open draft",
  { timeout: 30_000 },
  async (t) => {
    const { page, state } = await openInventory(t);
    let writes = 0;
    await page.route("**/api/productos", (route) => {
      writes++;
      return route.fulfill({
        status: 422,
        json: { error: "La solicitud no debió enviarse." },
      });
    });
    const sheet = await newDraft(page);
    state.databaseId = randomUUID();
    state.state.productos = [
      { ...product, codigo: "NUEVO", nombre: "Otra generación" },
    ];
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.locator("tbody").getByText("Otra generación").waitFor();
    await sheet
      .getByRole("button", { name: "Guardar artículo", exact: true })
      .click();
    await noToast(page, "Artículo creado");
    await sheet
      .getByRole("alert")
      .getByText(/La base cambió/)
      .waitFor();
    assert.equal(
      await sheet.getByLabel("Descripción", { exact: true }).inputValue(),
      product.nombre,
    );
    assert.equal(writes, 0);
  },
);

test(
  "delete confirmation preserves the original product version and focus after rejection",
  { timeout: 30_000 },
  async (t) => {
    const { page, state } = await openInventory(t, [product]);
    const gate = Promise.withResolvers();
    const packets = [];
    await page.route("**/api/productos/7", async (route) => {
      packets.push(route.request().postDataJSON());
      await gate.promise;
      await route.fulfill({
        status: 409,
        json: {
          error: "El producto cambió. Actualiza los datos antes de editar.",
        },
      });
    });
    const rowAction = page.getByRole("button", {
      name: "Eliminar",
      exact: true,
    });
    await rowAction.click();
    const dialog = page.getByRole("alertdialog");
    const confirm = dialog.getByRole("button", {
      name: "Eliminar",
      exact: true,
    });
    assert.equal(
      await dialog
        .getByRole("button", { name: "Cancelar", exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    state.revision = 2;
    state.state.productos = [
      { ...product, version: 3, nombre: "Editado en otra caja" },
    ];
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.locator("tbody").getByText("Editado en otra caja").waitFor();
    try {
      await confirm.dblclick();
      await noToast(page, "Artículo eliminado");
      await dialog
        .getByRole("button", { name: "Confirmando…", exact: true })
        .waitFor();
      await page.keyboard.press("Escape");
      assert.equal(await dialog.isVisible(), true);
    } finally {
      gate.resolve();
    }
    await dialog
      .getByRole("alert")
      .getByText(/El producto cambió/)
      .waitFor();
    assert.deepEqual(packets, [{ version: 2, databaseId }]);
    assert.equal(
      await confirm.evaluate((el) => el === document.activeElement),
      true,
    );
    await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.waitForFunction(
      () => document.activeElement?.getAttribute("aria-label") === "Eliminar",
    );
  },
);

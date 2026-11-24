import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { acknowledged } from "./pos-response-fixture.js";
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
  activo: true,
};

function confirmNewProduct(route, snapshot, id = product.id) {
  const { databaseId, ...fields } = route.request().postDataJSON();
  snapshot.revision++;
  const costo = Number(fields.costo);
  snapshot.state.productos.push({ ...fields, precio1:Number(fields.precio1), precio2:Number(fields.precio2), precio3:Number(fields.precio3), costo, costoExacto: costo.toFixed(4), id, version: 1, activo: true });
  return route.fulfill({ json: acknowledged(route, snapshot, id) });
}

function rejected(route, status, error) {
  const request = route.request();
  return route.fulfill({
    status,
    json: {
      error,
      rejection: {
        operationId: request.headers()["idempotency-key"],
        databaseId: request.postDataJSON().databaseId,
        method: request.method(),
        path: new URL(request.url()).pathname,
      },
    },
  });
}

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

async function openInventory(t, products = [], formulas = []) {
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
    state: {
      empresa: "Negocio", itbisRate: 0.18, configuracionVersion: 1,
      configuracion: { version: 1, empresa: "Negocio", rnc: "", tel: "", correo: "", direccion: "",
        itbisPorcentaje: 18, redondeo: 0, nivelPrecioPredeterminado: null, formatoImpresion: null,
        pieTicket: "", permitirStockNegativo: false },
      productos: products, clientes: [], suplidores: [], formulas, facturas: [], compras: [], movimientos: [],
    },
  };
  await page.route("**/api/state", (route) => route.fulfill({ json: state }));
  await page.goto(server.origin + "/inventario");
  await page
    .getByRole("button", { name: "Nuevo artículo", exact: true })
    .waitFor();
  return { page, state };
}

test("the stock total preserves hundredths across 7,681 products", async (t) => {
  const products = Array.from({ length: 7681 }, (_, index) => ({
    ...product, id: index + 1, codigo: `SINT-${index + 1}`, stock: 9876543.55,
  }));
  const { page } = await openInventory(t, products);
  const total = page.getByText(/unidades en almacén$/);
  assert.equal(await total.textContent(), "75,861,731,007.55 unidades en almacén");
});

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

test("oversized catalog text stays editable and never creates a network operation", async (t) => {
  const { page } = await openInventory(t);
  let writes = 0;
  await page.route("**/api/productos", async (route) => {
    writes++;
    await route.fulfill({
      status: 400,
      json: { error: "Revisa el texto del artículo." },
    });
  });
  const sheet = await newDraft(page);
  const tooLong = "X".repeat(2001);
  for (const [label, original] of [
    ["Código", "PRUEBA"],
    ["Nombre", "Artículo de prueba"],
    ["Marca", ""],
    ["Ubicación", ""],
  ]) {
    const input = sheet.getByLabel(label, { exact: true });
    await input.fill(tooLong);
    await sheet
      .getByRole("button", { name: "Guardar artículo", exact: true })
      .click();
    await sheet
      .getByText("Usa hasta 2000 caracteres", { exact: true })
      .waitFor({ timeout: 1500 });
    assert.equal(await input.inputValue(), tooLong);
    assert.equal(await input.isEditable(), true);
    assert.equal(writes, 0);
    await input.fill(original);
  }
});

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
      await confirmNewProduct(route, state);
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
  "confirming the last product deletion with the keyboard focuses Nuevo artículo",
  { timeout: 30_000 },
  async (t) => {
    const { page, state } = await openInventory(t, [product]);
    await page.route("**/api/productos/7", (route) => {
      state.revision++;
      state.state.productos = [];
      return route.fulfill({ json: acknowledged(route, state, product.id) });
    });
    const row = page.getByRole("row").filter({ hasText: product.codigo });
    await row.getByRole("button", { name: "Eliminar", exact: true }).focus();
    await page.keyboard.press("Enter");

    const dialog = page.getByRole("alertdialog");
    await dialog
      .getByRole("button", { name: "Cancelar", exact: true })
      .and(page.locator(":focus"))
      .waitFor();
    await page.keyboard.press("Tab");
    await dialog
      .getByRole("button", { name: "Eliminar", exact: true })
      .and(page.locator(":focus"))
      .waitFor();
    await page.keyboard.press("Enter");

    await dialog.waitFor({ state: "hidden" });
    await row.waitFor({ state: "hidden" });
    await page
      .getByRole("button", { name: "Nuevo artículo", exact: true })
      .and(page.locator(":focus"))
      .waitFor({ timeout: 3_000 });
  },
);

test(
  "a rejected save retains the draft and allows a correction",
  { timeout: 30_000 },
  async (t) => {
    const { page } = await openInventory(t);
    await page.route("**/api/productos", (route) =>
      rejected(route, 400, "El servicio rechazó el artículo."),
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
    const description = sheet.getByLabel("Nombre", { exact: true });
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
      return confirmNewProduct(route, state);
    });
    const sheet = await newDraft(page);
    const numbers = sheet.getByRole("spinbutton");
    const submit = sheet.getByRole("button", {
      name: "Guardar artículo",
      exact: true,
    });
    for (const [field, value, message] of [
      [0, "", /Indica el costo/],
      [3, "", /Indica el precio/],
      [0, "1e100", /hasta cuatro decimales/],
      [1, "1.501", /hasta dos decimales/],
      [2, "2147483648", /hasta dos decimales/],
      [3, "10.25555", /hasta cuatro decimales/],
      [4, "-1", /hasta cuatro decimales/],
      [5, "3.14159", /hasta cuatro decimales/],
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
    assert.equal(packets[0].costo, "10.25");
    assert.equal(packets[0].precio1, "20.15");
    assert.equal(packets[0].precio2, "0");
    assert.equal(packets[0].precio3, "0");
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
      return confirmNewProduct(route, state);
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
      await sheet.getByLabel("Nombre", { exact: true }).isDisabled(),
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
  "a definitive save rejection unlocks the preserved draft for a corrected operation",
  { timeout: 30_000 },
  async (t) => {
    const { page, state } = await openInventory(t);
    const duplicate =
      "Ya existe un registro con ese código o número de factura.";
    const unavailable = "El servicio no está disponible.";
    const packets = [];
    await page.route("**/api/productos", (route) => {
      packets.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      switch (packets.length) {
        case 1:
          return route.abort("failed");
        case 2:
          return route.fulfill({ status: 409, body: "Respuesta incompleta" });
        case 3:
          return route.fulfill({ status: 503, json: { error: unavailable } });
        case 4:
          state.revision = 2;
          state.state.productos = [product];
          return rejected(route, 409, duplicate);
        default:
          return confirmNewProduct(route, state, 8);
      }
    });
    const sheet = await newDraft(page);
    const code = sheet.getByLabel("Código", { exact: true });
    const description = sheet.getByLabel("Nombre", { exact: true });
    const save = sheet.getByRole("button", {
      name: "Guardar artículo",
      exact: true,
    });
    const retry = sheet.getByRole("button", {
      name: "Reintentar guardado",
      exact: true,
    });
    const alert = sheet.getByRole("alert");
    await save.click();
    for (const message of [
      /No se confirmó la operación/,
      /No se confirmó la operación/,
      unavailable,
    ]) {
      await alert.getByText(message).waitFor();
      assert.equal(await code.isDisabled(), true);
      await noToast(page, "Artículo creado");
      await retry.click();
    }
    await alert.getByText(duplicate).waitFor();
    await noToast(page, "Artículo creado");
    assert.equal(await code.inputValue(), "PRUEBA");
    assert.equal(await description.inputValue(), product.nombre);
    assert.equal(
      await sheet.getByLabel("Costo base RD$", { exact: true }).inputValue(),
      "10.25",
    );
    assert.equal(await code.isEditable(), true);
    assert.equal(await description.isEditable(), true);
    assert.equal(await retry.count(), 0);
    assert.deepEqual(packets, Array(4).fill(packets[0]));

    await code.fill("CORREGIDO");
    await save.click();
    await sheet.waitFor({ state: "hidden" });
    await page.getByText("Artículo creado", { exact: true }).waitFor();
    assert.equal(packets.length, 5);
    assert.ok(packets[4].key);
    assert.notEqual(packets[4].key, packets[0].key);
    assert.deepEqual(JSON.parse(packets[4].body), {
      ...JSON.parse(packets[0].body),
      codigo: "CORREGIDO",
    });
  },
);

test(
  "another tab's pending operation keeps the original draft locked",
  { timeout: 30_000 },
  async (t) => {
    const { page, state } = await openInventory(t);
    let originalRequests = 0;
    await page.route("**/api/productos", (route) => {
      originalRequests++;
      return route.abort("failed");
    });
    const sheet = await newDraft(page);
    await sheet
      .getByRole("button", { name: "Guardar artículo", exact: true })
      .click();
    await sheet
      .getByRole("alert")
      .getByText(/No se confirmó la operación/)
      .waitFor();

    const peer = await page.context().newPage();
    let peerRequests = 0;
    await peer.route("**/api/state", (route) => route.fulfill({ json: state }));
    await peer.route("**/api/productos", (route) => {
      if (++peerRequests > 1) return route.abort("failed");
      return confirmNewProduct(route, state);
    });
    await peer.goto(server.origin + "/inventario");
    await peer
      .getByRole("button", { name: "Reintentar solicitud", exact: true })
      .click();
    await peer.getByRole("row").filter({ hasText: product.codigo }).waitFor();
    const peerSheet = await newDraft(peer);
    await peerSheet
      .getByLabel("Código", { exact: true })
      .fill("OTRA-SOLICITUD");
    await peerSheet
      .getByRole("button", { name: "Guardar artículo", exact: true })
      .click();
    await peerSheet
      .getByRole("alert")
      .getByText(/No se confirmó la operación/)
      .waitFor();

    const retry = sheet.getByRole("button", {
      name: "Reintentar guardado",
      exact: true,
    });
    await retry.click();
    await sheet
      .getByRole("alert")
      .getByText(/La solicitud pendiente cambió/)
      .waitFor();
    await retry.waitFor();
    const originalCode = sheet.getByLabel("Código", { exact: true });
    assert.equal(await originalCode.inputValue(), "PRUEBA");
    assert.equal(await originalCode.isDisabled(), true);
    await noToast(page, "Artículo creado");
    assert.equal(originalRequests, 1);
    assert.equal(peerRequests, 2);
  },
);

test(
  "a definitive delete rejection clears the uncertain confirmation state",
  { timeout: 30_000 },
  async (t) => {
    const { page, state } = await openInventory(t, [product]);
    const versionConflict =
      "El producto cambió. Actualiza los datos antes de editar.";
    const packets = [];
    await page.route("**/api/productos/7", (route) => {
      packets.push({
        body: route.request().postData(),
        key: route.request().headers()["idempotency-key"],
      });
      if (packets.length === 1) return route.abort("failed");
      state.revision = 2;
      state.state.productos = [{ ...product, version: 3 }];
      return rejected(route, 409, versionConflict);
    });
    await page
      .getByRole("row")
      .filter({ hasText: product.codigo })
      .getByRole("button", { name: "Eliminar", exact: true })
      .click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByRole("button", { name: "Eliminar", exact: true }).click();
    await dialog
      .getByRole("alert")
      .getByText(/No se confirmó la operación/)
      .waitFor();
    const retry = dialog.getByRole("button", {
      name: "Reintentar",
      exact: true,
    });
    await retry.click();
    await dialog.getByRole("alert").getByText(versionConflict).waitFor();
    await noToast(page, "Artículo eliminado");
    assert.equal(await retry.count(), 0);
    assert.equal(
      await dialog
        .getByRole("button", { name: "Eliminar", exact: true })
        .count(),
      1,
    );
    assert.deepEqual(packets, [packets[0], packets[0]]);
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
      await sheet.getByLabel("Nombre", { exact: true }).inputValue(),
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
      await rejected(
        route,
        409,
        "El producto cambió. Actualiza los datos antes de editar.",
      );
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

test("keyboard selection uses the server's numeric formula ID to calculate product prices", async t => {
  const makeFormula = (id, factorCosto) => ({ id, version: 1, nombre: "Tarifa " + id, factorCosto, recargo1: 0, recargo2: 0, recargo3: 0 });
  const { page } = await openInventory(t, [], [makeFormula(4, 1), makeFormula(7, 2)]);
  const sheet = await newDraft(page);
  const select = sheet.getByRole("combobox", { name: "Fórmula de precios" });
  await select.press("Enter");
  const second = page.getByRole("option", { name: /Tarifa 7/ });
  await second.waitFor({ timeout: 2000 });
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "option");
  await page.keyboard.press("End");
  await page.waitForFunction(() => document.activeElement?.textContent.includes("Tarifa 7"));
  await page.keyboard.press("Enter");
  await second.waitFor({ state: "hidden" });
  assert.match(await select.innerText(), /Tarifa 7/);
  await sheet.getByRole("button", { name: "Calcular" }).click();
  assert.equal(await sheet.getByRole("spinbutton").nth(3).inputValue(), "20.5");
});

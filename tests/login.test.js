import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/http/app.js";
import { hostingConfig, authorized } from "../src/hosting.js";

const origin = "https://pos.example";
const env = {
  PUBLIC_ORIGIN: origin,
  APP_USERNAME: "felix",
  APP_PASSWORD: "clave-sintetica-login-12345",
};
const hosting = hostingConfig(env);
const options = {
  hosting,
  pool: {
    connect() {
      assert.fail("El login no debe consultar la base");
    },
  },
  readAsset: (path) => "asset:" + path,
};
const request = (path, init = {}) =>
  new Request(origin + path, {
    ...init,
    headers: { "X-Forwarded-Proto": "https", ...init.headers },
  });
const login = (body, headers = {}) =>
  handleRequest(
    request("/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        ...headers,
      },
      body: JSON.stringify(body),
    }),
    options,
  );
const credentials = {
  username: "felix",
  password: "clave-sintetica-login-12345",
  remember: true,
};

test("abre el login propio y nunca dispara el cuadro HTTP Basic del navegador", async () => {
  const page = await handleRequest(
    request("/inventario?existencia=low"),
    options,
  );
  assert.equal(page.status, 303);
  assert.equal(page.headers.get("www-authenticate"), null);
  assert.equal(
    page.headers.get("location"),
    "/login?next=%2Finventario%3Fexistencia%3Dlow",
  );
  const form = await handleRequest(request("/login"), options);
  assert.equal(form.status, 200);
  assert.equal(await form.text(), "asset:login.html");
  const api = await handleRequest(request("/api/state"), options);
  assert.equal(api.status, 401);
  assert.equal(api.headers.get("www-authenticate"), null);
});

test("recuerda el acceso mediante cookie firmada y rechaza manipulación, caducidad y cambio de contraseña", async () => {
  const result = await login({
    ...credentials,
    next: "/inventario?existencia=low",
  });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), {
    redirect: "/inventario?existencia=low",
  });
  const cookie = result.headers.get("set-cookie");
  assert.match(cookie, /^__Host-felix-session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Max-Age=2592000/);
  assert.equal(cookie.includes(credentials.password), false);
  const header = cookie.split(";")[0];
  assert.equal(
    authorized(request("/api/state", { headers: { Cookie: header } }), hosting),
    true,
  );
  assert.equal(
    authorized(
      request("/api/state", { headers: { Cookie: header + "x" } }),
      hosting,
    ),
    false,
  );
  assert.equal(
    authorized(
      request("/api/state", { headers: { Cookie: header } }),
      hostingConfig({ ...env, APP_PASSWORD: "otra-clave-sintetica-12345" }),
    ),
    false,
  );
  const future = Date.now() + 31 * 86400000;
  assert.equal(
    authorized(
      request("/api/state", { headers: { Cookie: header } }),
      hosting,
      future,
    ),
    false,
  );
  const temporary = await login({ ...credentials, remember: false });
  assert.equal(temporary.headers.get("set-cookie").includes("Max-Age"), false);
  const logout = await handleRequest(
    request("/logout", {
      method: "POST",
      headers: { Cookie: header, Origin: origin },
    }),
    options,
  );
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
});

test("protege login y salida de otros orígenes, limita el cuerpo y evita redirecciones externas", async () => {
  const denied = await login({ ...credentials, password: "incorrecta" });
  assert.equal(denied.status, 401);
  assert.equal(denied.headers.get("set-cookie"), null);
  assert.equal(denied.headers.get("www-authenticate"), null);
  assert.equal(
    (await login(credentials, { Origin: "https://ajeno.example" })).status,
    403,
  );
  assert.equal(
    (
      await handleRequest(
        request("/logout", {
          method: "POST",
          headers: { Origin: "https://ajeno.example" },
        }),
        options,
      )
    ).status,
    403,
  );
  assert.equal(
    (await login({ ...credentials, password: "x".repeat(20000) })).status,
    413,
  );
  const redirected = await login({
    ...credentials,
    next: "//ajeno.example/inventario",
  });
  assert.deepEqual(await redirected.json(), { redirect: "/inventario" });
});

test("el acceso local puede usar el mismo login con cookie de loopback", async () => {
  const local = hostingConfig({
    APP_USERNAME: env.APP_USERNAME,
    APP_PASSWORD: env.APP_PASSWORD,
  });
  const localRequest = new Request("http://127.0.0.1:3001/login", {
    method: "POST",
    headers: {
      Origin: "http://127.0.0.1:3001",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(credentials),
  });
  const response = await handleRequest(localRequest, {
    ...options,
    hosting: local,
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /^felix-session=/);
  assert.equal(cookie.includes("Secure"), false);
  assert.equal(
    authorized(
      new Request("http://127.0.0.1:3001/api/state", {
        headers: { Cookie: cookie.split(";")[0] },
      }),
      local,
    ),
    true,
  );
});

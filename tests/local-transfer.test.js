import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { gunzipSync } from "node:zlib";
import { createApp } from "../src/server.js";

test("localhost comprime assets, permite revalidarlos y conserva el contenido y los métodos", async () => {
  const pool = {
    connect() {
      assert.fail("Un asset no consulta la base");
    },
  };
  const server = await createApp(pool, {
    assetsDirectory: new URL("../dist/operational/", import.meta.url),
  });
  // Use the real modern CSS resource; large enough to catch a disabled compressor.
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  const get = (headers = {}, method = "GET") =>
    new Promise((resolve, reject) => {
      const call = request(
        origin + "/styles.css",
        { headers, method },
        (response) => {
          const chunks = [];
          response.on("data", (bytes) => chunks.push(bytes));
          response.on("end", () =>
            resolve({
              status: response.statusCode,
              headers: response.headers,
              body: Buffer.concat(chunks),
            }),
          );
        },
      );
      call.on("error", reject);
      call.end();
    });
  try {
    const plain = await get({ "Accept-Encoding": "identity" });
    const zipped = await get({ "Accept-Encoding": "gzip" });
    assert.equal(zipped.status, 200);
    assert.equal(zipped.headers["content-encoding"], "gzip");
    assert.deepEqual(gunzipSync(zipped.body), plain.body);
    assert.ok(zipped.body.length < plain.body.length / 3);
    assert.match(zipped.headers.vary, /Accept-Encoding/i);
    assert.match(plain.headers["cache-control"], /must-revalidate/);
    assert.equal(
      (await get({ "If-None-Match": plain.headers.etag })).status,
      304,
    );
    const cachedGzip = await get({
      "Accept-Encoding": "gzip",
      "If-None-Match": zipped.headers.etag,
    });
    assert.equal(cachedGzip.status, 304);
    assert.equal(cachedGzip.headers.etag, zipped.headers.etag);
    assert.match(cachedGzip.headers.vary, /Accept-Encoding/i);
    assert.equal(
      (await get({ "Accept-Encoding": "gzip;q=0" })).headers[
        "content-encoding"
      ],
      undefined,
    );
    assert.equal(
      (await get({ "Accept-Encoding": "gzip" }, "HEAD")).body.length,
      0,
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

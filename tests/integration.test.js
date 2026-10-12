const { test } = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { createApp } = require("../admin-server/app");
const { createAccount } = require("../admin-server/security");
const { glb } = require("./model.test");
test("HTTP workflow keeps drafts private and publishes uploaded converted models through engine aliases", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "site-integration-test-"));
  fs.mkdirSync(path.join(root, "assets/data"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "index.html"),
    "<html><head><title>Original</title></head></html>",
  );
  fs.writeFileSync(
    path.join(root, "assets/data/uil.1.json"),
    JSON.stringify({
      INPUT_Config_8_ParticleTest_geometry: {
        src: "assets/geometry/original.bin",
      },
    }),
  );
  const app = createApp({
      root,
      dataDir: path.join(root, "data"),
      origin: "http://localhost:3000",
    }),
    server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((r) => server.close(r));
    app.locals.store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  await createAccount(app.locals.store, "owner", "test-only-long-password");
  const login = await fetch(base + "/api/admin/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:3000",
    },
    body: JSON.stringify({
      username: "owner",
      password: "test-only-long-password",
    }),
  });
  const headers = {
    "Content-Type": "application/json",
    Origin: "http://localhost:3000",
    Cookie: login.headers.get("set-cookie").split(";")[0],
    "X-CSRF-Token": (await login.json()).csrfToken,
  };
  const api = async (url, body, method = "POST") => {
    const response = await fetch(base + "/api/admin" + url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    assert(response.ok, JSON.stringify(data));
    return data;
  };
  const form = new FormData();
  form.append("file", new Blob([glb()]), "triangle.glb");
  const uploadHeaders = { ...headers };
  delete uploadHeaders["Content-Type"];
  const uploaded = await fetch(base + "/api/admin/resources/upload", {
    method: "POST",
    headers: uploadHeaders,
    body: form,
  });
  assert.equal(uploaded.status, 201);
  const source = (await uploaded.json()).resource;
  const { resource } = await api("/resources/" + source.id + "/convert", {
    size: 0.8,
  });
  assert.equal(resource.status, "ready");
  assert.equal((await fetch(base + resource.url)).status, 404);
  const { config, revision } = await api("/config", undefined, "GET");
  config.site.title = "Published title";
  config.scenes[0].fields[0].value = resource.url;
  const saved = await api("/config", { config, revision }, "PUT");
  assert.match(
    await (await fetch(base + "/")).text(),
    /<title>Original<\/title>/,
  );
  const preview = await api("/preview", { revision: saved.revision });
  assert.equal((await fetch(base + preview.url)).status, 401);
  const published = await api("/publish", { revision: saved.revision });
  assert.match(
    await (await fetch(base + "/")).text(),
    /<title>Published title<\/title>/,
  );
  const uil = await (
    await fetch(base + `/api/site/${published.version}/uil.json`)
  ).json();
  const url = uil.INPUT_Config_8_ParticleTest_geometry.src;
  assert.match(url, /^\/assets\/geometry\/admin\//);
  const model = await fetch(base + url);
  assert.equal(model.status, 200);
  assert((await model.arrayBuffer()).byteLength > 90);
  assert.equal(
    (
      await fetch(base + "/api/admin/resources/" + resource.id, {
        method: "PATCH",
        headers,
        body: '{"trashed":true}',
      })
    ).status,
    409,
  );
  const beforeReset = headers.Cookie;
  await api("/password", {
    currentPassword: "test-only-long-password",
    newPassword: "a-new-test-password-2026",
  });
  assert.equal(
    (
      await fetch(base + "/api/admin/config", {
        headers: { Cookie: beforeReset },
      })
    ).status,
    401,
  );
});

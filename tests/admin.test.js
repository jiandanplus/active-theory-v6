const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

async function fixture(t) {
  const { createApp } = require("../admin-server/app");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "site-admin-test-"));
  fs.writeFileSync(
    path.join(root, "index.html"),
    "<html><head><title>Test</title></head><body>Site</body></html>",
  );
  fs.writeFileSync(path.join(root, "server.js"), "SECRET SOURCE");
  const app = createApp({
    root,
    dataDir: path.join(root, "data"),
    origin: "http://localhost:3000",
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    app.locals.store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const request = (route, options = {}) => fetch(url + route, options);
  return { app, root, request };
}

test("private routes and legacy write endpoints are protected", async (t) => {
  const { request } = await fixture(t);
  assert.equal((await request("/api/admin/config")).status, 401);
  for (const name of [
    "/server.js",
    "/data/site.db",
    "/.env",
    "/cms/projects-dev.json.bak",
    "/package.json",
  ]) {
    assert.equal((await request(name)).status, 404, name);
  }
  for (const name of ["/api/projects", "/api/build"])
    assert.equal((await request(name, { method: "POST" })).status, 401);
});

test("login, CSRF, origin rejection, logout and old session invalidation", async (t) => {
  const { app, request } = await fixture(t);
  const { createAccount } = require("../admin-server/security");
  await createAccount(app.locals.store, "owner", "a-valid-long-password-2026");
  const json = {
    "Content-Type": "application/json",
    Origin: "http://localhost:3000",
  };
  const bad = await request("/api/admin/login", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ username: "owner", password: "wrong" }),
  });
  assert.equal(bad.status, 401);
  const login = await request("/api/admin/login", {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      username: "owner",
      password: "a-valid-long-password-2026",
    }),
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const { csrfToken } = await login.json();
  const headers = { ...json, Cookie: cookie, "X-CSRF-Token": csrfToken };
  assert.equal((await request("/api/admin/config", { headers })).status, 200);
  assert.equal(
    (
      await request("/api/admin/logout", {
        method: "POST",
        headers: { Cookie: cookie },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/admin/logout", {
        method: "POST",
        headers: { ...headers, Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("/api/admin/logout", { method: "POST", headers })).status,
    200,
  );
  assert.equal((await request("/api/admin/config", { headers })).status, 401);
});

test("initialization cannot replace account without explicit local reset", async (t) => {
  const { app } = await fixture(t);
  const { createAccount } = require("../admin-server/security");
  await assert.rejects(createAccount(app.locals.store, "owner", "short"), /12/);
  await createAccount(app.locals.store, "owner", "a-valid-long-password-2026");
  await assert.rejects(
    createAccount(app.locals.store, "owner", "another-long-password"),
    /存在/,
  );
  assert(
    !JSON.stringify(
      app.locals.store.db.prepare("SELECT * FROM admins").all(),
    ).includes("a-valid-long-password"),
  );
});

module.exports = { fixture };
test("rejects public private-data directories and malformed origins before initialization", () => {
  const { createApp } = require("../admin-server/app");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "site-options-test-"));
  try {
    assert.throws(
      () => createApp({ root, dataDir: path.join(root, "assets/private") }),
      /数据目录/,
    );
    assert.throws(
      () => createApp({ root, origin: "https://example.com/path" }),
      /SITE_ORIGIN/,
    );
    assert.throws(
      () => createApp({ root, production: true, origin: "http://example.com" }),
      /HTTPS/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

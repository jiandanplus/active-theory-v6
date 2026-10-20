const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("content and resource routes preserve authenticated response and mutation contracts", async (t) => {
  const f = await require("./helpers/http").httpFixture(t);
  await f.createAdmin();
  const headers = await f.login();
  assert.equal((await f.request("/api/admin/config")).status, 401);
  const draft = await (
    await f.request("/api/admin/config", { headers })
  ).json();
  assert.deepEqual(Object.keys(draft).sort(), [
    "config",
    "published",
    "revision",
  ]);
  const saved = await f.request("/api/admin/config", {
    method: "PUT",
    headers,
    body: JSON.stringify(draft),
  });
  assert.deepEqual(await saved.json(), { revision: draft.revision + 1 });
  assert.equal(
    (
      await f.request("/api/admin/config", {
        method: "PUT",
        headers,
        body: JSON.stringify(draft),
      })
    ).status,
    409,
  );
  const linked = await f.request("/api/admin/resources/link", {
    method: "POST",
    headers,
    body: JSON.stringify({ kind: "image", url: "https://example.test/a.png" }),
  });
  assert.equal(linked.status, 201);
  const { resource } = await linked.json();
  assert.equal(resource.source, "external");
  assert.equal(resource.accessibility, "unverified");
  const list = await (
    await f.request("/api/admin/resources", { headers })
  ).json();
  assert(list.resources.some((row) => row.id === resource.id));
  const storage = await (
    await f.request("/api/admin/storages", { headers })
  ).json();
  assert.equal(storage.defaultStorage, "local");
  assert(storage.storages.every((row) => !row.credentials));
  const overview = await (
    await f.request("/api/admin/overview", { headers })
  ).json();
  assert.equal(overview.revision, draft.revision + 1);
  assert.equal(overview.resources, list.resources.length);
});

test("shared contract runs the same validation in CommonJS and browser without Node dependencies", () => {
  const root = path.join(__dirname, "..");
  const file = path.join(root, "shared/content-contract.js");
  assert(fs.existsSync(file), "shared content contract must exist");
  const shared = require(file);
  const browser = vm.createContext({ URL, structuredClone });
  vm.runInContext(
    fs.readFileSync(path.join(root, "shared/site-identity.js"), "utf8"),
    browser,
  );
  vm.runInContext(fs.readFileSync(file, "utf8"), browser);
  const schema = require("../admin-server/config").initialConfig(
    "/nonexistent",
  );
  for (const api of [shared, browser.SiteContentContract]) {
    assert.equal(
      api.validateConfig(structuredClone(schema), schema).site.title,
      schema.site.title,
    );
    const invalid = structuredClone(schema);
    invalid.site.title = "<script>";
    assert.throws(() => api.validateConfig(invalid, schema), /文字内容/);
    const invalidScene = structuredClone(schema);
    invalidScene.scenes[0].id = "unknown";
    assert.doesNotThrow(() => api.validateContent(invalidScene, schema));
    assert.throws(
      () => api.validateScenes(invalidScene.scenes, schema.scenes),
      /场景/,
    );
    for (const value of [
      "javascript:alert(1)",
      "https://user:password@example.test/a",
      "../private",
    ])
      assert.throws(
        () => api.safeURL(value),
        (error) => error.status === 400,
      );
  }
  assert.equal(
    require("../admin-server/config").validateConfig,
    shared.validateConfig,
  );
});

test("health is available before installation gate and readiness validates real PostgreSQL state", async (t) => {
  const { store } = await require("./helpers/postgres").postgresFixture(t, {
    migrated: false,
  });
  const f = await require("./helpers/http").httpFixture(t, {
    store,
    installed: false,
  });
  const check = async (endpoint, status, body) => {
    const response = await f.request(endpoint);
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), body);
    assert.match(response.headers.get("cache-control"), /no-store/);
  };
  await check("/health/live", 200, { status: "ok" });
  await check("/health/ready", 200, { status: "ok" });
  for (const page of [
    "/",
    "/work",
    "/work/example",
    "/contact",
    "/basic",
    "/basic/work",
    "/basic/work/example",
    "/basic/contact",
  ]) {
    const maintenance = await f.request(page);
    assert.equal(maintenance.status, 503);
    assert.match(maintenance.headers.get("content-type"), /text\/html/);
  }
  const script = await f.request("/admin/content-contract.js");
  assert.equal(script.status, 200);
  assert.match(await script.text(), /SiteContentContract/);
  await store.query("CREATE SCHEMA personal_site");
  await check("/health/ready", 503, { status: "unavailable" });
  await store.close();
  await check("/health/live", 200, { status: "ok" });
  await check("/health/ready", 503, { status: "unavailable" });
});

test("installed readiness becomes unavailable for structural drift", async (t) => {
  const f = await require("./helpers/http").httpFixture(t);
  assert.equal((await f.request("/health/ready")).status, 200);
  await f.store.query(
    "ALTER TABLE personal_site.installation ADD COLUMN unexpected text",
  );
  assert.equal((await f.request("/health/ready")).status, 503);
});

test("health rejects upgrade-required state without blocking the legacy installer shell", async (t) => {
  const { store } = await require("./helpers/v1").v1Fixture(t);
  const f = await require("./helpers/http").httpFixture(t, {
    store,
    installed: false,
  });
  const ready = await f.request("/health/ready");
  assert.equal(ready.status, 503);
  assert.deepEqual(await ready.json(), { status: "unavailable" });
  assert.equal((await f.request("/health/live")).status, 200);
  assert.equal((await f.request("/admin/content-contract.js")).status, 200);
  assert.equal((await f.request("/admin/")).status, 200);
});

test("health allows a current migrated uninstalled schema but never an old uninstalled schema", async (t) => {
  const f = await require("./helpers/http").httpFixture(t, {
    installed: false,
  });
  assert.equal((await f.request("/health/ready")).status, 200);
  const { store } = await require("./helpers/v1").v1Fixture(t);
  await store.query("DELETE FROM personal_site.installation");
  const older = await require("./helpers/http").httpFixture(t, {
    store,
    installed: false,
  });
  assert.equal((await older.request("/health/ready")).status, 503);
});

test("shared validators reject malformed scene and song objects with public Chinese validation errors", () => {
  const api = require("../shared/content-contract");
  const schema = require("../admin-server/config").initialConfig(
    "/nonexistent",
  );
  for (const mutate of [
    (config) => (config.songs = [null]),
    (config) => (config.scenes[0].fields[0] = null),
  ]) {
    const config = structuredClone(schema);
    mutate(config);
    assert.throws(
      () => api.validateConfig(config, schema),
      (error) => error.status === 400 && /[\u4e00-\u9fff]/.test(error.message),
    );
  }
});

test("request summaries validate IDs and omit query strings, credentials, headers and bodies", async (t) => {
  const entries = [];
  const f = await require("./helpers/http").httpFixture(t, {
    options: { requestLog: (entry) => entries.push(entry) },
  });
  const response = await f.request("/health/live?token=very-secret", {
    headers: {
      "X-Request-ID": "release-check_01",
      Authorization: "Bearer hidden",
    },
  });
  assert.equal(response.headers.get("x-request-id"), "release-check_01");
  await response.json();
  const second = await f.request("/health/live?password=hidden", {
    headers: { "X-Request-ID": "invalid id" },
  });
  assert.match(second.headers.get("x-request-id"), /^[a-f0-9-]{36}$/);
  await second.json();
  assert.equal(entries.length, 2);
  assert.equal(entries[0].requestId, "release-check_01");
  assert.equal(entries[0].path, "/health/live");
  assert.equal(entries[0].status, 200);
  assert.equal(entries[0].method, "GET");
  assert.equal(typeof entries[0].durationMs, "number");
  assert(
    !/secret|Bearer|Authorization|password|hidden|token/.test(
      JSON.stringify(entries),
    ),
  );
  await (await f.request("/api/site/preview-sensitive-bearer/config")).text();
  assert(!JSON.stringify(entries).includes("sensitive-bearer"));
});

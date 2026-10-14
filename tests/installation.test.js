const { test } = require("node:test");
const assert = require("node:assert/strict");
const { postgresFixture } = require("./helpers/postgres");
const { contentFixture } = require("./helpers/content");
const { openPostgres } = require("../admin-server/postgres");
const {currentSchemaVersion} = require('../admin-server/migrations');
const input = (bundle) => ({
  bundle,
  mode: "bundle",
  expectedDigest: bundle.report.digest,
  account: { username: "owner", password: "test-only-password-2026" },
});

test("legacy staged bytes affect fresh setup digest and survive actual HTTP delivery across pool restart", async (t) => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = require("./helpers/import-content").importFixture(t);
  fs.writeFileSync(
    path.join(source.root, "cms/metadata-dev.json"),
    JSON.stringify({ ogImage: "/media/optional-image" }),
  );
  const { store } = await postgresFixture(t, { migrated: false });
  const f = await require("./helpers/http").httpFixture(t, {
    store,
    installed: false,
    options: {
      root: source.root,
      dataDir: source.dataDir,
      legacyPath: source.legacyPath,
    },
  });
  const headers = await f.setupSession();
  const check = async () => {
    const response = await f.request("/api/setup/preflight", {
      method: "POST",
      headers,
      body: JSON.stringify({ mode: "legacy", dataDir: "/untrusted" }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  const install = (digest) =>
    f.request("/api/setup/install", {
      method: "POST",
      headers,
      body: JSON.stringify({ mode: "legacy", digest, dataDir: "/untrusted" }),
    });
  const initial = await check();
  assert(!initial.report.missingRequired.includes("legacy:derived-logo"));
  const file = path.join(source.dataDir, "uploads/derived.bin");
  fs.writeFileSync(file, "converted-logo-BYTES");
  assert.equal((await install(initial.digest)).status, 409);
  const changed = await check();
  fs.unlinkSync(file);
  assert.equal((await install(changed.digest)).status, 409);
  const missing = await check();
  assert.ok(missing.report.missingRequired.includes("legacy:derived-logo"));
  assert.equal(
    (await store.query("SELECT to_regnamespace('personal_site') AS schema"))
      .rows[0].schema,
    null,
  );
  fs.writeFileSync(file, "converted-logo-bytes");
  assert.equal((await install((await check()).digest)).status, 201);
  assert.deepEqual(await require('../admin-server/installation').installationStatus(store),
    {state:'installed',schemaVersion:currentSchemaVersion});
  assert.deepEqual((await store.query('SELECT version_id,mode,artifact_digest FROM personal_site.delivery_bindings ORDER BY version_id')).rows,
    [{version_id:'41',mode:'legacy',artifact_digest:null},{version_id:'42',mode:'legacy',artifact_digest:null}]);
  for (const restarted of [false, true]) {
    if (restarted) await f.restart();
    for (const [id, name, bytes] of [
      ["derived-logo", "logo.bin", "converted-logo-bytes"],
      ["source-logo", "source.glb", "original-model-bytes"],
      ["optional-image", "image.png", "optional-image-bytes"],
    ]) {
      const response = await f.request(`/api/site/42/resources/${id}/${name}`);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), bytes);
    }
    assert.equal(
      (
        await require("../admin-server/repositories/content")
          .contentRepository(f.store)
          .getDraft()
      ).published,
      42,
    );
  }
  assert.equal(
    require("node:crypto")
      .createHash("sha256")
      .update(fs.readFileSync(source.legacyPath))
      .digest("hex"),
    source.sourceHash,
  );
});

test("legacy installation can preserve history with disclosed missing private geometry", async (t) => {
  const source = require("./helpers/import-content").importFixture(t);
  require("node:fs").unlinkSync(
    require("node:path").join(source.dataDir, "uploads/derived.bin"),
  );
  const { store } = await postgresFixture(t, { migrated: false });
  const f = await require("./helpers/http").httpFixture(t, {
    store,
    installed: false,
    options: {
      root: source.root,
      dataDir: source.dataDir,
      legacyPath: source.legacyPath,
    },
  });
  const headers = await f.setupSession();
  const response = await f.request("/api/setup/preflight", {
    method: "POST",
    headers,
    body: '{"mode":"legacy"}',
  });
  const { report, digest } = await response.json();
  assert.ok(report.missingRequired.includes("legacy:derived-logo"));
  assert(!JSON.stringify(report).includes(source.root));
  const installed = await f.request("/api/setup/install", {
    method: "POST",
    headers,
    body: JSON.stringify({ mode: "legacy", digest }),
  });
  assert.equal(installed.status, 201);
  const repo =
    require("../admin-server/repositories/content").contentRepository(f.store);
  assert.equal((await repo.getDraft()).published, 42);
  for (const id of [41, 42]) {
    const version = await repo.getVersion(id);
    assert.equal(version.snapshot.template.readiness.ready, false);
    assert.ok(
      version.snapshot.template.readiness.missingRequired.includes(
        "legacy:derived-logo",
      ),
    );
  }
  assert.equal(
    (await f.request("/api/site/42/resources/derived-logo/logo.bin")).status,
    404,
  );
});

// Only the server version response is controlled; schema, transactions and HTTP
// behavior still use a UUID-isolated real PostgreSQL fixture.
function versionResponse(store, version, queries = []) {
  const wrap = (client) => ({
    query: async (sql, values) => {
      queries.push(sql);
      const result = await client.query(sql, values);
      if (sql.includes("current_setting('server_version_num')"))
        return {
          ...result,
          rows: result.rows.map((row) => ({ ...row, server_version: version })),
        };
      return result;
    },
    transaction: (fn) => client.transaction((tx) => fn(wrap(tx))),
  });
  return wrap(store);
}

test("unsupported PostgreSQL cannot install directly and leaves no partial schema", async (t) => {
  const { store } = await postgresFixture(t, { migrated: false });
  const source = contentFixture(t);
  const { installSite, preflight } = require("../admin-server/installation");
  const bundle = await preflight({ root: source.root }, "empty");
  await assert.rejects(
    installSite(versionResponse(store, 170009), input(bundle)),
    (error) => error.status === 503,
  );
  assert.equal(
    (await store.query("SELECT to_regnamespace('personal_site') AS schema"))
      .rows[0].schema,
    null,
  );
  await assert.rejects(
    versionResponse(store, 170009).transaction(
      require("../admin-server/migrations").migrate,
    ),
    /PostgreSQL 18/,
  );
  assert.equal(
    (await store.query("SELECT to_regnamespace('personal_site') AS schema"))
      .rows[0].schema,
    null,
  );
});

test("unsupported PostgreSQL setup install is rejected without database inspection GET", async (t) => {
  const { store } = await postgresFixture(t, { migrated: false });
  const f = await require("./helpers/http").httpFixture(t, {
    store: versionResponse(store, 190001),
    installed: false,
  });
  const headers = await f.setupSession();
  const bundle = await require("../admin-server/installation").preflight(
    { root: f.root },
    "empty",
  );
  const response = await f.request("/api/setup/install", {
    method: "POST",
    headers,
    body: JSON.stringify({
      mode: "empty",
      digest: bundle.report.digest,
      account: input(bundle).account,
    }),
  });
  assert.equal(response.status, 503);
  assert.equal(
    (await store.query("SELECT to_regnamespace('personal_site') AS schema"))
      .rows[0].schema,
    null,
  );
  const status = await f.request("/api/setup/status");
  assert.equal(status.status, 503);
  assert.equal((await status.json()).state, "incompatible");
});

test("installed traffic and inspection reject unsupported PostgreSQL without catalog scans", async (t) => {
  const { store } = await postgresFixture(t);
  const f = await require("./helpers/http").httpFixture(t, { store });
  const {
    inspectInstallation,
    migrate,
  } = require("../admin-server/migrations");
  const queries = [];
  const unsupported = versionResponse(store, 179999, queries);
  const blocked = await require("./helpers/http").httpFixture(t, {
    store: unsupported,
    installed: false,
  });
  assert.equal(
    (
      await blocked.request("/api/admin/login", {
        method: "POST",
        headers: blocked.json,
        body: "{}",
      })
    ).status,
    503,
  );
  assert.equal((await blocked.request("/api/setup/status")).status, 503);
  assert.equal(
    queries.some((sql) => sql.includes("pg_get_constraintdef")),
    false,
  );
  assert.equal((await inspectInstallation(unsupported)).state, "incompatible");
  await assert.rejects(unsupported.transaction(migrate), /PostgreSQL 18/);
  assert.equal((await f.request("/api/setup/status")).status, 200);
  const supportedQueries = [];
  assert.equal(
    (
      await require("../admin-server/installation").installationStatus(
        versionResponse(store, 180099, supportedQueries),
      )
    ).state,
    "installed",
  );
  assert.equal(
    supportedQueries.some((sql) => sql.includes("pg_get_constraintdef")),
    false,
  );
});

test("runtime entrypoints expose no SQLite store or auto-initializer", () => {
  assert.equal(require("../admin-server/database").openStore, undefined);
  assert.equal(require("../admin-server/config").initializeConfig, undefined);
});

test("setup sessions enforce Origin, expiry, rotation, attempt cap and missing token", async (t) => {
  const { store } = await postgresFixture(t, { migrated: false });
  const options = { setupToken: "ab".repeat(32) };
  const f = await require("./helpers/http").httpFixture(t, {
    store,
    installed: false,
    options,
  });
  const authorize = (token = "wrong", headers = f.json) =>
    f.request("/api/setup/authorize", {
      method: "POST",
      headers,
      body: JSON.stringify({ token }),
    });
  assert.equal(
    (
      await authorize("ab".repeat(32), {
        ...f.json,
        Origin: "https://evil.example",
      })
    ).status,
    403,
  );
  const session = await f.setupSession();
  assert.equal(
    (
      await f.request("/api/setup/preflight", {
        method: "POST",
        headers: { ...session, "X-CSRF-Token": "é".repeat(64) },
        body: '{"mode":"empty"}',
      })
    ).status,
    403,
  );
  const invalid = await f.request("/api/setup/database", {
    headers: {
      ...session,
      Cookie: session.Cookie.replace(/\d{13}/, "1000000000000"),
    },
  });
  assert.equal(invalid.status, 401);
  const crypto = require("node:crypto");
  const value = "0".repeat(64) + ".1000000000000";
  const key = crypto
    .createHmac("sha256", options.setupToken)
    .update("site-setup:session")
    .digest();
  const mac = crypto.createHmac("sha256", key).update(value).digest("hex");
  assert.equal(
    (
      await f.request("/api/setup/database", {
        headers: { ...f.json, Cookie: `site_setup=${value}.${mac}` },
      })
    ).status,
    401,
  );
  options.setupToken = "cd".repeat(32);
  await f.restart();
  assert.equal(
    (await f.request("/api/setup/database", { headers: session })).status,
    401,
  );
  options.setupToken = undefined;
  await f.restart();
  assert.equal((await authorize("ab".repeat(32))).status, 503);
  options.setupToken = "ab".repeat(32);
  await f.restart();
  for (let i = 0; i < 10; i++) assert.equal((await authorize()).status, 401);
  assert.equal((await authorize()).status, 429);
});

test("fresh server preflight digest detects source changes before any database writes", async (t) => {
  const { store } = await postgresFixture(t, { migrated: false });
  const f = await require("./helpers/http").httpFixture(t, {
    store,
    installed: false,
  });
  const headers = await f.setupSession();
  const response = await f.request("/api/setup/preflight", {
    method: "POST",
    headers,
    body: '{"mode":"bundle"}',
  });
  const { digest } = await response.json();
  const fs = require("node:fs");
  const source = f.root + "/cms/metadata-dev.json";
  fs.writeFileSync(source, JSON.stringify({ title: "Changed fixture source" }));
  const stale = await f.request("/api/setup/install", {
    method: "POST",
    headers,
    body: JSON.stringify({
      mode: "bundle",
      digest,
      account: { username: "owner", password: "test-only-password-2026" },
    }),
  });
  assert.equal(stale.status, 409);
  assert.equal(
    (await require("../admin-server/installation").installationStatus(store))
      .schemaVersion,
    null,
  );
});

test("legacy import preserves account and publication history and rejects a replacement account", async (t) => {
  const { store } = await postgresFixture(t, { migrated: false });
  const source = contentFixture(t);
  const { preflight, installSite } = require("../admin-server/installation");
  const bundle = await preflight(
    { root: source.root, legacyPath: source.legacyPath },
    "legacy",
  );
  await assert.rejects(
    installSite(store, { ...input(bundle), mode: "legacy" }),
    (error) => error.status === 400,
  );
  await installSite(store, {
    bundle,
    mode: "legacy",
    expectedDigest: bundle.report.digest,
  });
  assert.equal(
    (
      await require("../admin-server/repositories/auth")
        .authRepository(store)
        .getAdmin()
    ).hash,
    bundle.admin.hash,
  );
  assert.equal(
    (
      await require("../admin-server/repositories/content")
        .contentRepository(store)
        .getDraft()
    ).published,
    bundle.published,
  );
  assert.equal(
    (await store.query("SELECT count(*)::int AS n FROM personal_site.versions"))
      .rows[0].n,
    bundle.versions.length,
  );
});

test("insufficient CREATE privilege leaves the database uninstalled and returns safe retryable error", async (t) => {
  const { store, databaseUrl } = await postgresFixture(t, { migrated: false });
  const role = new URL(databaseUrl).pathname.slice(1);
  await store.query(
    `CREATE ROLE "${role}" NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN`,
  );
  try {
    const asRole = (fn) =>
      store.transaction(async (tx) => {
        await tx.query(`SET LOCAL ROLE "${role}"`);
        return fn(tx);
      });
    const restricted = {
      query: (sql, values) => asRole((tx) => tx.query(sql, values)),
      transaction: asRole,
    };
    const f = await require("./helpers/http").httpFixture(t, {
      store: restricted,
      installed: false,
      options: { databaseUrl },
    });
    const headers = await f.setupSession();
    const database = await f.request("/api/setup/database", { headers });
    assert.equal(database.status, 200);
    const check = await database.json();
    assert.equal(check.permissions.createSchema, false);
    assert.equal(check.target.host, "127.0.0.1");
    assert.equal(check.target.database, role);
    assert(!JSON.stringify(check).includes("local-test-only"));
    const report = await (
      await f.request("/api/setup/preflight", {
        method: "POST",
        headers,
        body: '{"mode":"empty"}',
      })
    ).json();
    const response = await f.request("/api/setup/install", {
      method: "POST",
      headers,
      body: JSON.stringify({
        mode: "empty",
        digest: report.digest,
        account: { username: "owner", password: "test-only-password-2026" },
      }),
    });
    assert.equal(response.status, 503);
    assert.equal(
      (await require("../admin-server/installation").installationStatus(store))
        .schemaVersion,
      null,
    );
  } finally {
    await store.query(`DROP ROLE "${role}"`);
  }
});

test("installation lock timeout is a safe retryable HTTP503 without partial schema", async (t) => {
  const { store } = await postgresFixture(t, { migrated: false });
  const f = await require("./helpers/http").httpFixture(t, {
    store,
    installed: false,
  });
  const headers = await f.setupSession();
  const report = await (
    await f.request("/api/setup/preflight", {
      method: "POST",
      headers,
      body: '{"mode":"empty"}',
    })
  ).json();
  let release, locked;
  const held = new Promise((r) => (release = r)),
    ready = new Promise((r) => (locked = r));
  const blocker = store.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1)", [734216901]);
    locked();
    await held;
  });
  await ready;
  try {
    const response = await f.request("/api/setup/install", {
      method: "POST",
      headers,
      body: JSON.stringify({
        mode: "empty",
        digest: report.digest,
        account: { username: "owner", password: "test-only-password-2026" },
      }),
    });
    assert.equal(response.status, 503);
    assert(!(await response.text()).includes("password"));
  } finally {
    release();
    await blocker;
  }
  assert.equal(
    (await require("../admin-server/installation").installationStatus(store))
      .schemaVersion,
    null,
  );
});

test("one installation wins across independent database clients", async (t) => {
  let other;
  t.after(() => other?.close());
  const { store, databaseUrl } = await postgresFixture(t, { migrated: false });
  other = openPostgres({ databaseUrl });
  const bundle = structuredClone(contentFixture(t).bundle);
  bundle.admin = null;
  const { installSite } = require("../admin-server/installation");
  const results = await Promise.allSettled([
    installSite(store, input(bundle)),
    installSite(other, input(bundle)),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.status, 409);
  assert.equal(
    (await store.query("SELECT count(*)::int AS n FROM personal_site.admins"))
      .rows[0].n,
    1,
  );
});

test("setup status distinguishes unknown schema, offline database and installed authority", async (t) => {
  const { httpFixture } = require("./helpers/http");
  const { store } = await postgresFixture(t, { migrated: false });
  const f = await httpFixture(t, { store, installed: false });
  await store.query("CREATE SCHEMA personal_site");
  const unknown = await f.request("/api/setup/status");
  assert.equal(unknown.status, 503);
  assert.equal((await unknown.json()).state, "incompatible");
  const g = await httpFixture(t);
  await g.store.query(
    "CREATE FUNCTION personal_site.test_failure() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''failure''; END'",
  );
  await g.store.query(
    "CREATE TRIGGER test_failure BEFORE INSERT ON personal_site.audit_events FOR EACH ROW EXECUTE FUNCTION personal_site.test_failure()",
  );
  assert.equal(
    (await (await g.request("/api/setup/status")).json()).state,
    "installed",
  );
  const { root } = contentFixture(t);
  const app = require("../admin-server/app").createApp({
    root,
    dataDir: root + "/data",
    databaseUrl: "postgresql://no-secret:private@127.0.0.1:1/site",
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/setup/status`,
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      state: "unavailable",
      schemaVersion: null,
    });
  } finally {
    await new Promise((r) => server.close(r));
    await app.locals.store.close();
  }
});

test("parser errors never reflect submitted setup token or password", async (t) => {
  const { store } = await postgresFixture(t, { migrated: false });
  const f = await require("./helpers/http").httpFixture(t, {
    store,
    installed: false,
  });
  const secret = "TOP-SECRET-PASSWORD";
  const response = await f.request("/api/setup/authorize", {
    method: "POST",
    headers: f.json,
    body: `{"token":"${secret}" BROKEN`,
  });
  assert.equal(response.status, 400);
  assert(!(await response.text()).includes(secret));
  const huge = await f.request("/api/setup/authorize", {
    method: "POST",
    headers: f.json,
    body: JSON.stringify({ token: "x".repeat(66000) }),
  });
  assert.equal(huge.status, 413);
});

test("preflight errors never disclose trusted source paths", async (t) => {
  const { store } = await postgresFixture(t, { migrated: false });
  const f = await require("./helpers/http").httpFixture(t, {
    store,
    installed: false,
    options: { legacyPath: "/tmp/TOP-SECRET-SOURCE/site.db" },
  });
  const headers = await f.setupSession();
  const response = await f.request("/api/setup/preflight", {
    method: "POST",
    headers,
    body: '{"mode":"legacy"}',
  });
  assert.equal(response.status, 409);
  assert(!(await response.text()).includes("TOP-SECRET"));
});

test("failure after admin creation rolls schema and account back and allows retry", async (t) => {
  const { store } = await postgresFixture(t, { migrated: false });
  const bundle = structuredClone(contentFixture(t).bundle);
  bundle.admin = null;
  const {
    installSite,
    installationStatus,
  } = require("../admin-server/installation");
  // Decorate the real transaction query, not its database behavior: fail the
  // completion insert after the real schema/content/admin work has happened.
  const fault = {
    ...store,
    transaction: (fn) =>
      store.transaction((tx) =>
        fn({
          query: async (sql, args) => {
            if (/INSERT INTO personal_site.installation/.test(sql)) {
              assert.equal(
                (
                  await tx.query(
                    "SELECT count(*)::int AS n FROM personal_site.admins",
                  )
                ).rows[0].n,
                1,
              );
              throw Error("injected completion failure");
            }
            return tx.query(sql, args);
          },
        }),
      ),
  };
  await assert.rejects(installSite(fault, input(bundle)), /injected/);
  assert.deepEqual(await installationStatus(store), {
    state: "uninstalled",
    schemaVersion: null,
  });
  await installSite(store, input(bundle));
  assert.equal((await installationStatus(store)).state, "installed");
});

test("unconfigured and malformed database settings keep admin shell and status reachable", async (t) => {
  const { createApp } = require("../admin-server/app");
  const { root } = contentFixture(t);
  for (const databaseUrl of [undefined, "not-a-database-url"]) {
    const app = createApp({ root, dataDir: root + "/data", databaseUrl });
    const server = app.listen(0, "127.0.0.1");
    await new Promise((r) => server.once("listening", r));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      assert.equal((await fetch(base + "/admin/")).status, 200);
      const status = await fetch(base + "/api/setup/status");
      assert.equal(status.status, databaseUrl ? 503 : 200);
      assert.equal(
        (await status.json()).state,
        databaseUrl ? "unavailable" : "unconfigured",
      );
      assert.equal((await fetch(base + "/api/admin/session")).status, 503);
    } finally {
      await new Promise((r) => server.close(r));
      await app.locals.store?.close();
    }
  }
});

test("setup authorizes a short-lived CSRF session and installs only trusted sources", async (t) => {
  const { store } = await postgresFixture(t, { migrated: false });
  const { httpFixture } = require("./helpers/http");
  const f = await httpFixture(t, {
    store,
    installed: false,
    options: { setupToken: "ab".repeat(32) },
  });
  const status = await f.request("/api/setup/status");
  assert.equal((await status.json()).state, "uninstalled");
  assert.equal((await f.request("/api/setup/database")).status, 401);
  assert.equal(
    (
      await f.request("/api/setup/authorize", {
        method: "POST",
        headers: f.json,
        body: '{"token":"wrong"}',
      })
    ).status,
    401,
  );
  const auth = await f.request("/api/setup/authorize", {
    method: "POST",
    headers: f.json,
    body: JSON.stringify({ token: "ab".repeat(32) }),
  });
  assert.equal(auth.status, 200);
  assert.match(auth.headers.get("set-cookie"), /HttpOnly/);
  const headers = {
    ...f.json,
    Cookie: auth.headers.get("set-cookie").split(";")[0],
    "X-CSRF-Token": (await auth.json()).csrfToken,
  };
  const pre = await f.request("/api/setup/preflight", {
    method: "POST",
    headers,
    body: JSON.stringify({ mode: "empty", root: "/untrusted" }),
  });
  assert.equal(pre.status, 200);
  const report = await pre.json();
  assert.equal(report.report.hasAdmin, false);
  assert.equal(
    (
      await f.request("/api/setup/install", {
        method: "POST",
        headers: { ...headers, "X-CSRF-Token": "bad" },
        body: "{}",
      })
    ).status,
    403,
  );
  const install = () =>
    f.request("/api/setup/install", {
      method: "POST",
      headers,
      body: JSON.stringify({
        mode: "empty",
        digest: report.digest,
        account: { username: "owner", password: "test-only-password-2026" },
      }),
    });
  const response = await install();
  assert.equal(response.status, 201);
  assert.match(response.headers.get("set-cookie"), /Expires=Thu, 01 Jan 1970/);
  assert.equal((await install()).status, 409);
  // Rotating the setup token cannot override the durable completion record.
  const fresh = await f.setupSession();
  assert.equal(
    (
      await f.request("/api/setup/preflight", {
        method: "POST",
        headers: fresh,
        body: '{"mode":"empty"}',
      })
    ).status,
    409,
  );
  assert.equal(
    (await store.query("SELECT count(*)::int AS n FROM personal_site.sessions"))
      .rows[0].n,
    0,
  );
});

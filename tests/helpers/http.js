const { createApp } = require("../../admin-server/app");
const { postgresFixture } = require("./postgres");
const { contentFixture } = require("./content");
const {
  contentRepository,
} = require("../../admin-server/repositories/content");
const { createAccount } = require("../../admin-server/security");
const password = "a-valid-long-password-2026";
async function httpFixture(t, { store, options = {}, installed = true } = {}) {
  if (!store) ({ store } = await postgresFixture(t));
  // The PostgreSQL fixture owns final disposal. Keep its original cleanup hook
  // capable of closing every replacement pool before it drops this database.
  const ownerStore = store,
    closers =
      typeof store.close === "function" ? [store.close.bind(store)] : [];
  const closed = new Map();
  async function closeOnce(close) {
    if (!closed.has(close)) closed.set(close, close());
    return closed.get(close);
  }
  if (closers.length) {
    ownerStore.close = async () => {
      for (const close of closers) await closeOnce(close);
    };
  }
  const content = contentFixture(t);
  if (installed) {
    const bundle = structuredClone(content.bundle);
    bundle.admin = null;
    await store.transaction(async (tx) => {
      await contentRepository(tx).importBundle(bundle);
      await tx.query(
        "INSERT INTO personal_site.installation(id,source,schema_version) VALUES(true,'fixture',1)",
      );
    });
  }
  let app, server, base;
  async function start() {
    app = createApp({
      root: content.root,
      dataDir: content.root + "/data",
      origin: "http://localhost:3000",
      setupToken: "ab".repeat(32),
      ...options,
      store,
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  }
  await start();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  require("node:assert/strict").equal(
    app.locals.store,
    store,
    "createApp must use the injected PostgreSQL store without initialization",
  );
  const request = (route, init = {}) => fetch(base + route, init);
  const json = {
    "Content-Type": "application/json",
    Origin: "http://localhost:3000",
  };
  async function login() {
    const response = await request("/api/admin/login", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ username: "owner", password }),
    });
    if (response.status !== 200)
      throw new Error(`Login failed: ${response.status}`);
    return {
      ...json,
      Cookie: response.headers.get("set-cookie").split(";")[0],
      "X-CSRF-Token": (await response.json()).csrfToken,
    };
  }
  async function setupSession() {
    const response = await request("/api/setup/authorize", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ token: options.setupToken || "ab".repeat(32) }),
    });
    if (response.status !== 200)
      throw new Error(`Setup authorization failed: ${response.status}`);
    return {
      ...json,
      Cookie: response.headers.get("set-cookie").split(";")[0],
      "X-CSRF-Token": (await response.json()).csrfToken,
    };
  }
  return {
    get app() {
      return app;
    },
    get store() {
      return store;
    },
    root: content.root,
    bundle: content.bundle,
    get base() {
      return base;
    },
    request,
    login,
    setupSession,
    json,
    async createAdmin() {
      await createAccount(store, "owner", password);
    },
    async restart() {
      if (!closers.length)
        throw new Error("Restart requires a closable PostgreSQL fixture store");
      await new Promise((resolve) => server.close(resolve));
      const database = (
        await store.query("SELECT pg_catalog.current_database() AS name")
      ).rows[0].name;
      const url = new URL(process.env.TEST_DATABASE_URL);
      if (!/^site_test_[a-f0-9]{32}$/.test(database))
        throw new Error("Restart requires an isolated fixture database");
      url.pathname = "/" + database;
      await closeOnce(closers.at(-1));
      store = require("../../admin-server/postgres").openPostgres({
        databaseUrl: url.href,
      });
      closers.push(store.close.bind(store));
      await start();
    },
  };
}
module.exports = { httpFixture };

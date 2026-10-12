const {
  inspectInstallation,
  migrate,
  checksum,
  supportedPostgresVersion,
} = require("./migrations");
const { contentRepository } = require("./repositories/content");
const { authRepository } = require("./repositories/auth");
const { auditRepository } = require("./repositories/audit");
const { hashPassword, fail } = require("./security");

// Runtime authority deliberately does not fingerprint catalogs on every request.
// A present schema with missing/broken tables throws; it is never a new site.
async function installationStatus(store) {
  if (store.configured === false)
    return { state: "unconfigured", schemaVersion: null };
  if (!(await supportedPostgresVersion(store)))
    return { state: "incompatible", schemaVersion: null };
  const exists = (
    await store.query(
      "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='personal_site') AS present",
    )
  ).rows[0].present;
  if (!exists) return { state: "uninstalled", schemaVersion: null };
  const versions = (
    await store.query(
      "SELECT version,checksum FROM personal_site.schema_migrations ORDER BY version",
    )
  ).rows;
  if (
    versions.length !== 1 ||
    versions[0].version !== 1 ||
    versions[0].checksum !== checksum
  )
    return { state: "incompatible", schemaVersion: null };
  const rows = (
    await store.query("SELECT schema_version FROM personal_site.installation")
  ).rows;
  if (rows.length > 1 || (rows.length && rows[0].schema_version !== 1))
    return { state: "incompatible", schemaVersion: 1 };
  return { state: rows.length ? "installed" : "uninstalled", schemaVersion: 1 };
}
async function preflight(options, mode) {
  if (!["empty", "bundle", "legacy"].includes(mode))
    throw fail(400, "安装模式无效");
  try {
    if (mode === "legacy")
      return await require("./importers/sqlite").readLegacy({
        root: options.root,
        legacyPath: options.legacyPath,
        masterKey: options.masterKey,
        dataDir: options.dataDir,
      });
    return await require("./importers/bundle").readBundle({
      root: options.root,
      mode,
    });
  } catch {
    throw fail(409, "导入源不可用或格式无效，请检查服务器端配置");
  }
}
async function installSite(store, { bundle, account, expectedDigest, mode }) {
  if (!["empty", "bundle", "legacy"].includes(mode))
    throw fail(400, "安装模式无效");
  if (
    typeof expectedDigest !== "string" ||
    expectedDigest !== bundle?.report?.digest
  )
    throw fail(409, "源数据已变化，请重新预检");
  let prehashed;
  if (bundle.admin) {
    if (account !== undefined && account !== null)
      throw fail(400, "迁移已包含管理员，不能替换账号");
  } else {
    if (
      !account ||
      typeof account.username !== "string" ||
      !/^[a-zA-Z0-9_.-]{3,64}$/.test(account.username)
    )
      throw fail(400, "用户名须为 3–64 位字母、数字、点、下划线或短横线");
    prehashed = {
      username: account.username,
      hash: await hashPassword(account.password),
    };
  }
  await store.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1)", [734216901]);
    if (!(await supportedPostgresVersion(tx)))
      throw fail(503, "仅支持 PostgreSQL 18");
    const state = await inspectInstallation(tx);
    if (state.state !== "uninstalled")
      throw fail(409, "站点不可重复初始化或结构不兼容");
    await migrate(tx);
    await contentRepository(tx).importBundle(bundle);
    if (!bundle.admin) await authRepository(tx).replaceAdmin(prehashed);
    await tx.query(
      "INSERT INTO personal_site.installation(source,schema_version) VALUES($1,$2)",
      [mode, 1],
    );
    await auditRepository(tx).append(
      "installation.complete",
      bundle.admin?.username || prehashed.username,
    );
  });
}
function mountInstallation(app, { store, options }) {
  const express = require("express");
  const { route } = require("./http");
  const auth = require("./setup-auth").setupAuth(options);
  const router = express.Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  router.use(express.json({ limit: "64kb" }));
  router.get(
    "/status",
    route(async (req, res) => {
      try {
        let state;
        try {
          state = await installationStatus(store);
        } catch {
          state = await inspectInstallation(store);
        }
        if (state.state === "uninstalled")
          state = await inspectInstallation(store);
        res.status(state.state === "incompatible" ? 503 : 200).json(state);
      } catch {
        res.status(503).json({ state: "unavailable", schemaVersion: null });
      }
    }),
  );
  router.post(
    "/authorize",
    route(async (req, res) => auth.authorize(req, res)),
  );
  router.use(auth.requireSession);
  async function notInstalled() {
    const state = await installationStatus(store);
    if (state.state === "incompatible") throw fail(503, "数据库不兼容");
    if (state.state === "installed")
      throw fail(409, "站点不可重复初始化或结构不兼容");
    if (state.state === "unconfigured") throw fail(503, "数据库未配置");
  }
  router.get(
    "/database",
    route(async (req, res) => {
      await notInstalled();
      const state = await inspectInstallation(store);
      let target;
      try {
        const url = new URL(options.databaseUrl);
        target = {
          host: url.hostname,
          database: decodeURIComponent(url.pathname.slice(1)),
        };
      } catch {
        target = { host: null, database: null };
      }
      const permissions = (
        await store.query(
          "SELECT has_database_privilege(current_database(),'CREATE') AS create_schema, current_setting('server_version_num')::int AS server_version",
        )
      ).rows[0];
      res.json({
        target,
        state: state.state,
        permissions: {
          createSchema: permissions.create_schema,
          supportedVersion:
            permissions.server_version >= 180000 &&
            permissions.server_version < 190000,
        },
      });
    }),
  );
  router.post(
    "/preflight",
    auth.csrf,
    route(async (req, res) => {
      await notInstalled();
      const state = await inspectInstallation(store);
      if (state.state !== "uninstalled") throw fail(409, "数据库结构不兼容");
      const bundle = await preflight(options, req.body?.mode);
      res.json({
        report: publicReport(bundle.report),
        digest: bundle.report.digest,
      });
    }),
  );
  router.post(
    "/install",
    auth.csrf,
    route(async (req, res) => {
      await notInstalled();
      const bundle = await preflight(options, req.body?.mode);
      await installSite(store, {
        bundle,
        mode: req.body?.mode,
        expectedDigest: req.body?.digest,
        account: req.body?.account,
      });
      auth.clear(res).status(201).json({ installed: true });
    }),
  );
  router.use((error, req, res, next) => {
    if (error.type === "entity.parse.failed")
      return next(fail(400, "安装请求格式无效"));
    if (error.type === "entity.too.large")
      return next(fail(413, "安装请求不得超过 64 KiB"));
    next(error);
  });
  app.use("/api/setup", router);
}
function publicReport(report) {
  const safeList = (value) =>
    (value || []).map((s) =>
      typeof s === "string" && !/[\\/]|:\/\//.test(s) ? s : "源资源需要检查",
    );
  return {
    counts: report.counts,
    missingRequired: safeList(report.missingRequired),
    warnings: safeList(report.warnings),
    credentialsUnavailable: safeList(report.credentialsUnavailable),
    hasAdmin: report.hasAdmin,
    digest: report.digest,
  };
}
module.exports = {
  installationStatus,
  preflight,
  installSite,
  mountInstallation,
};

const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const { openStore } = require("./database");
const { mountAuth } = require("./security");
const {
  initializeConfig,
  saveDraft,
  publish,
  restore,
  createPreview,
} = require("./config");
const { route, publicError } = require("./http");
const { contentRepository } = require("./repositories/content");
const { resourceRepository } = require("./repositories/resources");
const { storageRepository } = require("./repositories/storages");
const { auditRepository } = require("./repositories/audit");
const { mountFrontend } = require("./frontend");
const { mountResources } = require("./resources");
const { mountModels } = require("./models");

function createApp(options = {}) {
  options = {
    root: path.resolve(__dirname, ".."),
    production: false,
    origin: "http://localhost:3000",
    ...options,
  };
  options.dataDir = path.resolve(
    options.dataDir || path.join(options.root, "data"),
  );
  const canonical = (p) =>
    fs.existsSync(p)
      ? fs.realpathSync(p)
      : path.join(canonical(path.dirname(p)), path.basename(p));
  const privatePath = canonical(options.dataDir);
  for (const folder of ["assets", "room", "bush.bin", "admin-ui"]) {
    const publicPath = canonical(path.join(options.root, folder));
    if (
      privatePath === publicPath ||
      privatePath.startsWith(publicPath + path.sep)
    )
      throw new Error("私有数据目录不能位于公开资源目录中");
  }
  if (privatePath === canonical(options.root))
    throw new Error("私有数据目录不能等于项目根目录");
  let origin;
  try {
    origin = new URL(options.origin);
  } catch {
    throw new Error("SITE_ORIGIN 必须是完整来源地址");
  }
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.origin !== options.origin.replace(/\/$/, "")
  )
    throw new Error("SITE_ORIGIN 不能包含路径、凭证或查询参数");
  options.origin = origin.origin;
  if (options.production && !options.origin.startsWith("https://"))
    throw new Error("生产环境 SITE_ORIGIN 必须为 HTTPS");
  const app = express(),
    store = options.store || openStore(options.dataDir);
  app.locals.store = store;
  app.disable("x-powered-by");
  if (options.trustProxy) app.set("trust proxy", options.trustProxy);
  app.use((req, res, next) => {
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "same-origin");
    res.set("X-Frame-Options", "SAMEORIGIN");
    if (req.path.startsWith("/admin"))
      res.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: blob: data:; media-src 'self' https: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
      );
    if (options.production)
      res.set("Strict-Transport-Security", "max-age=31536000");
    if (req.path.startsWith("/api/admin") || req.path.startsWith("/admin"))
      res.set("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "5mb" }));
  if (!options.store) initializeConfig(store, options.root);
  const { requireAuth, csrfGuard } = mountAuth(app, store, options);
  const admin = express.Router();
  app.use("/api/admin", requireAuth, csrfGuard, admin);
  admin.get(
    "/config",
    route(async (req, res) => {
      const draft = await contentRepository(store).getDraft();
      const { config, revision, published } = draft;
      res.json({ config, revision, published });
    }),
  );
  admin.put(
    "/config",
    route(async (req, res) =>
      res.json({
        revision: await saveDraft(
          store,
          req.body.config,
          req.body.revision,
          req.adminSession.username,
        ),
      }),
    ),
  );
  admin.post(
    "/publish",
    route(async (req, res) => {
      res.json(
        await publish(
          store,
          req.body.revision,
          options,
          req.adminSession.username,
          { withWarnings: true },
        ),
      );
    }),
  );
  admin.post(
    "/preview",
    route(async (req, res) =>
      res.json({
        url: `/?preview=${await createPreview(store, req.body.revision, options, req.adminSession.username)}`,
      }),
    ),
  );
  admin.get(
    "/versions",
    route(async (req, res) => {
      const repo = contentRepository(store);
      res.json({
        published: (await repo.getDraft()).published,
        versions: (await repo.listVersions()).map(({ id, created }) => ({
          id,
          created,
        })),
      });
    }),
  );
  admin.post(
    "/versions/:id/restore",
    route(async (req, res) =>
      res.json({
        revision: await restore(
          store,
          Number(req.params.id),
          req.body.revision,
          req.adminSession.username,
        ),
      }),
    ),
  );
  admin.get(
    "/overview",
    route(async (req, res) => {
      const draft = await contentRepository(store).getDraft();
      res.json({
        published: draft.published,
        revision: draft.revision,
        resources: (await resourceRepository(store).list()).length,
        projects: draft.config.projects.length,
        defaultStorage: await storageRepository(store).getDefault(),
        cloudConfigured: (await storageRepository(store).list()).some(
          (s) => s.type === "s3",
        ),
        masterKeyConfigured: /^[a-f\d]{64}$/i.test(options.masterKey || ""),
        audit: await auditRepository(store).recent(10),
      });
    }),
  );
  mountResources({ app, admin, store, options });
  mountModels({ app, admin, store, options });
  app.use(["/api/projects", "/api/build"], requireAuth, (req, res) =>
    res.status(410).json({ error: "旧接口已停用，请使用 /admin" }),
  );
  app.use(
    "/admin",
    express.static(path.join(__dirname, "../admin-ui"), {
      index: "index.html",
      dotfiles: "deny",
    }),
  );
  mountFrontend(app, store, options);
  app.use((req, res) => res.status(404).json({ error: "未找到资源" }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const { status, message } = publicError(err);
    if (status === 500) console.error("[admin]", err.code || err.name);
    res.status(status).json({
      error: message,
    });
  });
  return app;
}
module.exports = { createApp };

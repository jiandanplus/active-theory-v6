const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const { openPostgres } = require("./database");
const { mountInstallation, installationStatus } = require("./installation");
const { mountAuth } = require("./security");
const { saveDraft, publish, restore, createPreview } = require("./config");
const { route, publicError } = require("./http");
const { contentRepository } = require("./repositories/content");
const { resourceRepository } = require("./repositories/resources");
const { storageRepository } = require("./repositories/storages");
const { auditRepository } = require("./repositories/audit");
const { mountFrontend } = require("./frontend");
const { mountResources } = require("./resources");
const { mountModels } = require("./models");

function createApp(options = {}, {deliveryService} = {}) {
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
    store =
      options.store ||
      openPostgres({
        databaseUrl: options.databaseUrl,
        ssl: options.databaseSSL,
      });
  app.locals.store = store;
  deliveryService ||= require('./delivery/service').createDeliveryService({store,options});
  app.locals.deliveryService = deliveryService;
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
    const privateResponse = req.path.startsWith('/admin') || req.path.startsWith('/api/admin') ||
      req.path.startsWith('/api/setup') || /^\/api\/site\/preview-[^/]+\//.test(req.path) || Object.hasOwn(req.query,'preview');
    if (privateResponse) res.set('Cache-Control','private, no-store').set('X-Robots-Tag','noindex, nofollow');
    next();
  });
  mountInstallation(app, { store, options });
  app.get('/admin/site-identity.js', (req, res) => res.type('js').sendFile(
    path.join(__dirname, '../shared/site-identity.js'), { cacheControl: false }));
  app.use(
    "/admin",
    express.static(path.join(__dirname, "../admin-ui"), {
      index: "index.html",
      dotfiles: "deny",
      cacheControl: false,
    }),
  );
  app.use(
    route(async (req, res, next) => {
      const publicPage = /^(?:\/|\/work(?:\/[^/]+)?)$/.test(req.path);
      let state;
      try {
        state = await installationStatus(store);
      } catch (error) {
        if (!publicPage) throw error;
        return res
          .status(503)
          .type("html")
          .send(
            '<!doctype html><meta charset="utf-8"><title>网站暂时不可用</title><p>网站暂时不可用，请稍后重试。</p><a href="/admin">管理后台</a>',
          );
      }
      if (state.state !== "installed") {
        if (publicPage)
          return res
            .status(503)
            .type("html")
            .send(
              state.state==='upgrade_required'
                ? '<!doctype html><meta charset="utf-8"><title>网站需要维护升级</title><p>网站需要维护升级，请由管理员在服务器备份后运行数据库升级命令</p><a href="/admin">管理后台</a>'
                : '<!doctype html><meta charset="utf-8"><title>网站尚未就绪</title><p>网站尚未完成安装或暂时不可用，请通过管理后台检查状态。</p><a href="/admin">管理后台</a>',
            );
        return res
          .status(503)
          .json({ error: state.state==='upgrade_required'?'网站需要维护升级':"网站尚未安装或暂时不可用", state: state.state });
      }
      next();
    }),
  );
  app.use(express.json({ limit: "5mb" }));
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
          {id:req.adminSession.id, username:req.adminSession.username},
          { withWarnings: true, deliveryService },
        ),
      );
    }),
  );
  admin.post(
    "/preview",
    route(async (req, res) =>
      res.json({
        url: `/?preview=${await createPreview(store, req.body.revision, options,
          {id:req.adminSession.id,username:req.adminSession.username}, {deliveryService})}`,
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

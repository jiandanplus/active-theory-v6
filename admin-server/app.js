const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const { openStore } = require("./database");
const { mountAuth } = require("./security");
const { initializeConfig, saveDraft, publish, restore } = require("./config");
const { mountFrontend } = require("./frontend");
const { mountResources } = require("./resources");
const { mountModels } = require("./models");
const { validatePublication } = require("./publication");
const { randomUUID } = require("node:crypto");

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
    store = openStore(options.dataDir);
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
  initializeConfig(store, options.root);
  const { requireAuth, csrfGuard } = mountAuth(app, store, options);
  const admin = express.Router();
  app.use("/api/admin", requireAuth, csrfGuard, admin);
  admin.get("/config", (req, res) =>
    res.json({
      config: store.get("draft"),
      revision: store.get("revision", 0),
      published: store.get("published"),
    }),
  );
  admin.put("/config", (req, res, next) => {
    try {
      res.json({
        revision: saveDraft(store, req.body.config, req.body.revision),
      });
    } catch (error) {
      next(error);
    }
  });
  admin.post("/publish", async (req, res, next) => {
    try {
      const warnings = await validatePublication(store, options.root, options);
      res.json({ version: publish(store, req.body.revision), warnings });
    } catch (error) {
      next(error);
    }
  });
  admin.post("/preview", async (req, res, next) => {
    try {
      if (req.body.revision !== store.get("revision"))
        return res.status(409).json({ error: "草稿已更新，请刷新" });
      await validatePublication(store, options.root, options);
      if (req.body.revision !== store.get("revision"))
        return res.status(409).json({ error: "草稿已更新，请刷新" });
      const previews = store.get("previews", {}),
        key = "preview-" + randomUUID();
      previews[key] = store.get("draft");
      store.set(
        "previews",
        Object.fromEntries(Object.entries(previews).slice(-5)),
      );
      res.json({ url: `/?preview=${key}` });
    } catch (error) {
      next(error);
    }
  });
  admin.get("/versions", (req, res) =>
    res.json({
      published: store.get("published"),
      versions: store.db
        .prepare("SELECT id,created FROM versions ORDER BY id DESC")
        .all(),
    }),
  );
  admin.post("/versions/:id/restore", (req, res, next) => {
    try {
      res.json({
        revision: restore(store, Number(req.params.id), req.body.revision),
      });
    } catch (error) {
      next(error);
    }
  });
  admin.get("/overview", (req, res) =>
    res.json({
      published: store.get("published"),
      revision: store.get("revision"),
      resources: store.get("resources", []).length,
      projects: store.get("draft").projects.length,
      defaultStorage: store.get("defaultStorage", "local"),
      cloudConfigured: store.get("storages", []).length > 0,
      masterKeyConfigured: /^[a-f\d]{64}$/i.test(options.masterKey || ""),
      audit: store.db
        .prepare(
          "SELECT created,action,actor FROM audit ORDER BY id DESC LIMIT 10",
        )
        .all(),
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
    const status = err.status >= 400 && err.status < 500 ? err.status : 500;
    if (status === 500) console.error("[admin]", err.code || err.name);
    res
      .status(status)
      .json({
        error:
          status === 500 ? "服务器处理失败，请查看服务端日志" : err.message,
      });
  });
  return app;
}
module.exports = { createApp };

const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const { openPostgres } = require("./database");
const { mountInstallation, installationStatus } = require("./installation");
const { mountAuth } = require("./security");
const { route, publicError } = require("./http");
const { mountFrontend } = require("./frontend");
const { mountResources } = require("./resources");
const { mountModels } = require("./models");
const {mountDeliveryAdmin}=require('./delivery/admin-routes');

const {mountContentRoutes} = require('./routes/content');
const {mountOperationalHealth} = require('./operational-health');
const {requestLogging} = require('./request-logging');

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
  app.disable('etag');
  if (options.trustProxy) app.set("trust proxy", options.trustProxy);
  app.use(requestLogging(options));
  app.use((req, res, next) => {
    // Express res.send/json must never turn a non-program response into 304.
    Object.defineProperty(req,'fresh',{get:()=>false});
    res.set('Cache-Control','no-store');
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "same-origin");
    res.set("X-Frame-Options", "SAMEORIGIN");
    // Static mount prefixes are case insensitive in Express; identifiers are not.
    const adminPage = /^\/admin(?:\/|$)/i.test(req.path);
    if (adminPage)
      res.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: blob: data:; media-src 'self' https: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
      );
    if (options.production)
      res.set("Strict-Transport-Security", "max-age=31536000");
    const targetSegment=/^\/api\/site\/([^/]+)(?:\/|$)/i.exec(req.path)?.[1];
    let privateTarget=false;
    if(targetSegment) {
      try { privateTarget=decodeURIComponent(targetSegment).startsWith('preview-'); }
      catch { /* Invalid encoding remains a non-cacheable error. */ }
    }
    const privateResponse = adminPage || /^\/api\/(?:admin|setup)(?:\/|$)/i.test(req.path) ||
      privateTarget || Object.hasOwn(req.query,'preview');
    if (privateResponse) res.set('Cache-Control','private, no-store').set('X-Robots-Tag','noindex, nofollow');
    next();
  });
  mountOperationalHealth(app, {store});
  app.get('/admin/content-contract.js', (req, res) => res.type('js').sendFile(
    path.join(__dirname, '../shared/content-contract.js'), {cacheControl:false, etag:false, lastModified:false}));
  mountInstallation(app, { store, options });
  app.use('/admin',(req,res,next)=>{
    delete req.headers['if-none-match'];
    delete req.headers['if-modified-since'];
    next();
  });
  app.get('/admin/site-identity.js', (req, res) => res.type('js').sendFile(
    path.join(__dirname, '../shared/site-identity.js'), { cacheControl: false,etag:false,lastModified:false }));
  app.use(
    "/admin",
    express.static(path.join(__dirname, "../admin-ui"), {
      index: "index.html",
      dotfiles: "deny",
      cacheControl: false,
      etag:false,
      lastModified:false,
    }),
  );
  app.use(
    route(async (req, res, next) => {
      const publicPage = /^(?:\/|\/(?:work(?:\/[^/]+)?|contact|basic(?:\/(?:work(?:\/[^/]+)?|contact))?|unsupported\.html)\/?)$/i.test(req.path);
      let state;
      try {
        state = await installationStatus(store);
      } catch (error) {
        if (!publicPage) throw error;
        require('./delivery/response').noStore(res,{error:true});
        return res
          .status(503)
          .type("html")
          .send(
            '<!doctype html><meta charset="utf-8"><title>网站暂时不可用</title><p>网站暂时不可用，请稍后重试。</p><a href="/admin">管理后台</a>',
          );
      }
      if (state.state !== "installed") {
        require('./delivery/response').noStore(res,{error:true});
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
  mountContentRoutes({admin, store, options, deliveryService});
  mountResources({ app, admin, store, options });
  mountModels({ app, admin, store, options });
  mountDeliveryAdmin({admin,store,service:deliveryService});
  app.use(["/api/projects", "/api/build"], requireAuth, (req, res) =>
    res.status(410).json({ error: "旧接口已停用，请使用 /admin" }),
  );
  mountFrontend(app, store, options, {cas:deliveryService.cas});
  app.use((req, res) => {
    require('./delivery/response').noStore(res,{error:true});
    res.status(404).json({ error: "未找到资源" });
  });
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const { status, message } = publicError(err);
    require('./delivery/response').noStore(res,{error:true});
    if (status === 500) console.error("[admin]", err.code || err.name);
    res.status(status).json({
      error: message,
    });
  });
  return app;
}
module.exports = { createApp };

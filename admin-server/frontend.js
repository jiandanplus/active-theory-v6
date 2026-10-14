const fs = require("node:fs"),
  path = require("node:path");
const express = require("express");
const { appFile } = require("./config");
const {patchAppSource,patchShaders}=require("./engine/legacy-adapter");
const {bridgeSource,versionedUIL,renderHTML,renderUnsupportedHTML}=require("./engine/render");
const { fail } = require("./security");
const { route } = require("./http");
const { pageMetadata } = require('../shared/site-identity');
const {
  resolveVersion,
  resolvePublishedResource,
  sendResource,
} = require("./frontend-resources");
const {
  publicSnapshot,
  collectReferences,
  resourceAsset,
  mapResourceTree,
} = require("./snapshots");
function safeStatic(directory) {
  const serve = express.static(directory, {
    dotfiles: "deny",
    index: false,
    fallthrough: true,
  });
  return (req, res, next) => {
    try {
      const relative = decodeURIComponent(req.path).replace(/^\/+/, ""),
        target = path.resolve(directory, relative);
      if (
        !target.startsWith(path.resolve(directory) + path.sep) ||
        relative
          .split("/")
          .some(
            (v) => v.startsWith(".") || /\.(bak|tmp|db|sqlite|env)$/i.test(v),
          )
      )
        return next();
      if (fs.existsSync(target)) {
        const real = fs.realpathSync(target);
        if (!real.startsWith(fs.realpathSync(directory) + path.sep))
          return next();
      }
      serve(req, res, next);
    } catch {
      next();
    }
  };
}
function mountFrontend(app, store, options) {
  async function versionConfig(req) {
    const { id, snapshot } = await resolveVersion(store, {
      version: req.params.version,
      preview: req.query.preview,
      admin: req.adminSession,
    });
    return { id, snapshot, config: publicSnapshot(snapshot, id) };
  }
  app.get(
    "/api/site/:version/resources/:id/:fileName",
    route(async (req, res, next) => {
      const resource = await resolvePublishedResource(store, {
        version: req.params.version,
        id: req.params.id,
        admin: req.adminSession,
      });
      return sendResource(req, res, next, resource, options);
    }),
  );
  app.get(
    "/api/site/:version/:file",
    route(async (req, res, next) => {
      try {
        const { id, config, snapshot } = await versionConfig(req);
        if (!res.get('Cache-Control')) res.set("Cache-Control", "no-store");
        switch (req.params.file) {
          case "config":
            return res.json(config);
          case "bridge.js":
            return res.type("js").send(bridgeSource(id, config, snapshot, options.origin, collectReferences(snapshot), {}));
          case 'identity.js':
            return res.type('js').send(['site-identity.js','page-metadata-dom.js']
              .map(name=>fs.readFileSync(path.join(__dirname,'../shared',name),'utf8')).join('\n;\n'));
          case 'unsupported.html': {
            const file=path.join(options.root,'unsupported.html');
            if(!fs.existsSync(file))throw fail(503,'缺少前台运行资源，请阅读部署说明');
            return res.type('html').send(renderUnsupportedHTML({html:fs.readFileSync(file,'utf8'),snapshot,target:{id},references:collectReferences(snapshot)}).source);
          }
          case "app.js": {
            const file = appFile(options.root);
            if (!file) throw fail(503, "缺少前台运行资源，请阅读部署说明");
            return res
              .type("js")
              .send(
                patchAppSource(
                  fs.readFileSync(
                    path.join(options.root, "assets/js", file),
                    "utf8",
                  ),
                  config,
                ).source,
              );
          }
          case "uil.json":
            return res.json(versionedUIL(snapshot, id));
          case "projects.json":
            return res.json(config.projects);
          case "compiled.vs":
            return res
              .type("text/plain")
              .send(
                patchShaders(
                  fs.readFileSync(
                    path.join(options.root, "assets/shaders/compiled.vs"),
                    "utf8",
                  ),
                  config,
                ).source,
              );
          case "metadata.json":
          case "contact.json": {
            return res.json(
              mapResourceTree(
                snapshot,
                id,
                snapshot.template[req.params.file.replace(".json", "")] || {},
              ),
            );
          }
          default:
            throw fail(404, "资源不存在");
        }
      } catch (error) {
        next(error);
      }
    }),
  );
  app.get(
    ["/", "/work", "/work/:slug"],
    route(async (req, res, next) => {
      try {
        let resolved;
        try {
          resolved = await versionConfig(req);
        } catch (error) {
          if (error.status !== 404 || req.query.preview) throw error;
          return res
            .status(503)
            .type("html")
            .send(
              '<!doctype html><meta charset="utf-8"><title>网站尚未发布</title><p>网站尚未发布，请在管理后台完成安装并发布内容。</p>',
            );
        }
        const { id, config, snapshot } = resolved;
        const meta = pageMetadata(config, options.origin, req.path);
        if (meta.status === 404) return res.status(404).set('X-Robots-Tag','noindex, nofollow')
          .type('html').send('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>页面不存在</title></head><body><h1>页面不存在</h1><a href="/">返回首页</a></body></html>');
        if (
          !appFile(options.root) ||
          !fs.existsSync(path.join(options.root, "index.html"))
        )
          return res
            .status(503)
            .type("html")
            .send(
              '<!doctype html><meta charset="utf-8"><title>缺少前台运行资源</title><p>缺少前台运行资源，请阅读部署说明并安装完整运行包。</p>',
            );
        let html = fs.readFileSync(
          path.join(options.root, "index.html"),
          "utf8",
        );
        html=renderHTML({html,snapshot:{...snapshot,config},target:{type:String(id).startsWith('preview-')?'preview':'version',id:String(id)},origin:options.origin,pathname:req.path,programs:{}}).source;
        if (!res.get('Cache-Control')) res.set("Cache-Control", "no-store");
        res.type("html").send(html);
      } catch (error) {
        next(error);
      }
    }),
  );
  const programs = safeStatic(path.join(options.root, "assets"));
  app.use("/assets", (req, res, next) =>
    /^\/(?:js|css)\/.*\.(?:js|css|wasm)$/i.test(req.path)
      ? programs(req, res, next)
      : next(),
  );
  app.get(
    ["/assets/*", "/room/*", "/bush.bin/*"],
    route(async (req, res, next) => {
      const { id, snapshot } = await versionConfig(req);
      const asset = resourceAsset(snapshot, req.path);
      if (!asset) throw fail(404, "资源不存在");
      const resource = await resolvePublishedResource(store, {
        version: id,
        id: asset.resourceId,
        admin: req.adminSession,
      });
      return sendResource(req, res, next, resource, options);
    }),
  );
  app.get("/unsupported.html", (req, res) =>
    res.sendFile(path.join(options.root, "unsupported.html")),
  );
}
module.exports = {
  versionedUIL,
  bridgeSource,
  patchAppSource,
  patchShaders,
  mountFrontend,
  safeStatic,
};

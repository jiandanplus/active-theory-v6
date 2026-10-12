const fs = require("node:fs"),
  path = require("node:path");
const express = require("express");
const { buildUIL, appFile } = require("./config");
const { fail } = require("./security");
const { route } = require("./http");
const {
  resolveVersion,
  resolvePublishedResource,
  sendResource,
} = require("./frontend-resources");
const {
  publicSnapshot,
  collectReferences,
  resourceAsset,
  mapResourceURL,
  mapResourceTree,
  canonicalResourceURL,
} = require("./snapshots");
const quote = (value) => JSON.stringify(value ?? "");
function replaceClass(source, name, transform) {
  const start = source.indexOf(`Class((function ${name}(`);
  if (start < 0) return source;
  const next = source.indexOf("Class((function ", start + 20),
    end = next < 0 ? source.length : next;
  return (
    source.slice(0, start) +
    transform(source.slice(start, end)) +
    source.slice(end)
  );
}
function patchAppSource(source, config) {
  const site = config.site;
  // The legacy worker path helper concatenates root-relative paths twice.
  // Keep managed media/model URLs anchored to the actual origin (and port).
  source = source.replace(
    "this.absolutePath = function (path) {",
    'this.absolutePath = function (path) { path = typeof window !== "undefined" && window.__SITE_RESOURCE_URL__ ? window.__SITE_RESOURCE_URL__(path) : path; if (path.startsWith("/")) return new URL(path, location.origin).href;',
  );
  source = source.replace(
    "this.getPath = function (path) {",
    "this.getPath = function (path) { const mapped = window.__SITE_RESOURCE_URL__?.(path); if (mapped && mapped !== path) return mapped;",
  );
  source = replaceClass(source, "AssetLoader", (code) =>
    code.replaceAll(
      "fetch(path)",
      "fetch(window.__SITE_RESOURCE_URL__?.(path) || path)",
    ),
  );
  source = replaceClass(source, "GeomThread", (code) =>
    code.replaceAll(
      'path.includes("assets/geometry/")',
      '(path.includes("assets/geometry/") || path.startsWith("/api/site/"))',
    ),
  );
  source = replaceClass(source, "InstanceMesh", (code) =>
    code.replaceAll(
      'file.includes("assets/geometry")',
      '(file.includes("assets/geometry") || file.startsWith("/api/site/"))',
    ),
  );
  source = replaceClass(source, "ParticleDistributor", (code) =>
    code.replaceAll(
      'path.includes("assets/geometry")',
      '(path.includes("assets/geometry") || path.startsWith("/api/site/"))',
    ),
  );
  source = replaceClass(source, "ViewController", (code) =>
    code
      .replaceAll('"AGI旅行者· AGI Voyager"', () => quote(site.title))
      .replace(
        "${data.title} · Active Theory",
        () => "${data.title} · " + String(site.title).replace(/[`$\\]/g, ""),
      ),
  );
  source = replaceClass(source, "NavUI", (code) =>
    code
      .replace(
        'text: "Work", _type:',
        () => `text: ${quote(site.navWork)}, link: "work", _type:`,
      )
      .replace(
        'text: "Contact", _type:',
        () => `text: ${quote(site.navContact)}, link: "contact", _type:`,
      ),
  );
  source = replaceClass(source, "NavUIItem", (code) =>
    code.replace(
      "_this.params.text.toLowerCase()",
      "(_this.params.link || _this.params.text.toLowerCase())",
    ),
  );
  source = replaceClass(source, "ContactUI", (code) => {
    for (const [ref, key] of Object.entries({
      contact: "contactTitle",
      lax: "cityLax",
      nyc: "cityNyc",
      ams: "cityAms",
      email: "email",
    })) {
      code = code.replace(
        new RegExp(`(_innerText: )"(?:[^"\\\\]|\\\\.)*"(, refName: "${ref}")`),
        (_, a, b) => a + quote(site[key]) + b,
      );
      code = code.replace(
        new RegExp(
          `(_this\\.${ref}\\.setText\\(replaceRandomLetters\\()"(?:[^"\\\\]|\\\\.)*"`,
        ),
        (_, a) => a + quote(site[key]),
      );
    }
    return code.replace(/"mailto:[^"\s]*"/g, () =>
      quote(`mailto:${site.emailLink}`),
    );
  });
  source = replaceClass(source, "CleanRoom", (code) =>
    code.replace(
      /let url = "[^"]*";/,
      () => `let url = ${quote(site.labUrl)};`,
    ),
  );
  if (Array.isArray(config.songs))
    source = source.replace(
      /let SONGS = \[[\s\S]*?\];/,
      () => `let SONGS = ${JSON.stringify(config.songs)};`,
    );
  if (config.songs?.length === 0)
    source = source.replace(
      "let SONGS = []; SONGS = SONGS.shuffle()",
      'let SONGS = []; if (!SONGS.length) { _this.wrapper?.hide?.(); _this.set("Global/audioEnabled", false); _this.flag?.("__ready", true); _this.onInit?.(); return; } SONGS = SONGS.shuffle()',
    );
  return source;
}
function bridgeSource(
  version,
  config,
  snapshot = { assets: {}, legacyMap: {} },
) {
  const allowed = snapshot.config
    ? new Set(collectReferences(snapshot).map((r) => r.resourceId))
    : new Set();
  const mappings = Object.fromEntries(
    Object.entries(snapshot.legacyMap || {})
      .filter(([, slot]) => allowed.has(snapshot.assets[slot]?.resourceId))
      .map(([alias]) => [
        canonicalResourceURL(alias),
        mapResourceURL(snapshot, version, alias).split(/[?#]/)[0],
      ]),
  );
  return `(()=>{const base=${quote(`/api/site/${version}`)}, mappings=${quote(mappings)};
    function map(value){try{if(typeof value!=='string')return value;const u=new URL(value.replace(/^~/,''),location.origin+'/');if(u.pathname.includes('/api/site/'))return value;
      let key=/^https?:\\/\\//i.test(value)&&Object.hasOwn(mappings,value)?value:u.origin===location.origin?decodeURIComponent(u.pathname).replace(/^\\//,''):value;
      if(Object.hasOwn(mappings,key))return mappings[key]+(/\\.ktx2?$/i.test(mappings[key])?u.search:u.search.replace(/-compressedKtx2?/g,''))+u.hash;
      if(u.origin!==location.origin)return value;
      if(/\\/cms\\/projects-[^/]+\\.json$/.test(u.pathname))return base+'/projects.json';
      if(/\\/cms\\/metadata-[^/]+\\.json$/.test(u.pathname))return base+'/metadata.json';
      if(/\\/cms\\/contact-[^/]+\\.json$/.test(u.pathname))return base+'/contact.json';
      if(u.origin===location.origin&&/\\/assets\\/data\\/uil\\.[^/]+\\.json$/.test(u.pathname))return base+'/uil.json';
      if(u.origin===location.origin&&u.pathname==='/assets/shaders/compiled.vs')return base+'/compiled.vs';
      return value;}catch{return value;}}
    window.__SITE_RESOURCE_URL__=map;
    const fetchOriginal=window.fetch;window.fetch=function(input,init){const old=input instanceof Request?input.url:String(input);const next=map(old);return fetchOriginal.call(this,next!==old&&input instanceof Request?new Request(new URL(next,location.origin).href,input):next!==old?next:input,init);};
    const open=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url,...args){return open.call(this,method,map(url),...args);};
    window.__SITE_VERSION__=${quote(String(version))};document.title=${quote(config.site.title)};
  })();`;
}
function patchShaders(source, config) {
  const fields = config.scenes.find((s) => s.id === "TreeScene")?.fields || [];
  const value = (name) =>
    fields.find((f) => f.key === `__blackhole_${name}`)?.value ?? 1;
  const parts = source.split("{@}");
  for (let i = 0; i < parts.length - 1; i++)
    if (parts[i] === "LogoParticleShader.glsl") {
      parts[i + 1] = parts[i + 1]
        .replace(/\btime\b/g, `(time * ${value("speed").toFixed(4)})`)
        .replace(/\b2\.16\b/g, (2.16 * value("size")).toFixed(6))
        .replace(/\b0\.54\b/g, (0.54 * value("size")).toFixed(6))
        .replace(
          "vec4(emission, 1.0)",
          `vec4(emission * ${value("brightness").toFixed(4)}, 1.0)`,
        )
        .replace(
          "vec4(color, 1.0)",
          `vec4(color * ${value("brightness").toFixed(4)}, 1.0)`,
        );
    }
  return parts.join("{@}");
}
function escapeHTML(text) {
  return String(text).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
}
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
        res.set("Cache-Control", "no-store");
        switch (req.params.file) {
          case "config":
            return res.json(config);
          case "bridge.js":
            return res.type("js").send(bridgeSource(id, config, snapshot));
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
                ),
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
                ),
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
        html = html.replace(
          /<title>[\s\S]*?<\/title>/,
          () => `<title>${escapeHTML(config.site.title)}</title>`,
        );
        html = html.replace(
          /(<link\b[^>]*\bhref=["'])([^"']+)(["'][^>]*>)/gi,
          (all, start, url, end) =>
            /\brel=["'][^"']*(?:icon|manifest)/i.test(all)
              ? start + mapResourceURL(snapshot, id, url) + end
              : all,
        );
        html = html.replace(
          /url\(\s*(["']?)([^"')]+)\1\s*\)/g,
          (all, q, url) =>
            /\.(?:woff2?|ttf|otf)(?:[?#]|$)/i.test(url)
              ? `url(${q}${mapResourceURL(snapshot, id, url)}${q})`
              : all,
        );
        html = html.replace(
          /s = "assets\/js\/app\." \+ window\._CACHE_ \+ "\.js"/,
          `s = "/api/site/${id}/app.js"`,
        );
        html = html
          .replace("</head>", `</head>`)
          .replace(
            "<head>",
            `<head><script src="/api/site/${id}/bridge.js"></script>`,
          );
        res.set("Cache-Control", "no-store").type("html").send(html);
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
function versionedUIL(snapshot, id) {
  const data = buildUIL(snapshot);
  for (const [key, value] of Object.entries(data)) {
    if (!value || typeof value !== "object" || typeof value.src !== "string")
      continue;
    const original =
      /(?:geometry|initialPositions)$/.test(key) &&
      value.relative?.includes(".")
        ? value.relative
        : value.src;
    const src = mapResourceURL(snapshot, id, original);
    if (src !== original)
      data[key] = {
        ...value,
        src,
        relative: "",
        prefix: "",
        filename: src.split("/").at(-1).split("?")[0],
        compressed: false,
        useCompressed: false,
        hotreload: false,
      };
  }
  return data;
}
module.exports = {
  versionedUIL,
  bridgeSource,
  patchAppSource,
  patchShaders,
  mountFrontend,
  safeStatic,
};

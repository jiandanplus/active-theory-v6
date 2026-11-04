const path = require("node:path");
const express = require("express");
const { mountInstallation } = require("./installation");
const { noStore } = require("./delivery/response");

const noCaching = { cacheControl: false, etag: false, lastModified: false };
const shared = (name) => (req, res) =>
  res.type("js").sendFile(path.join(__dirname, "../shared", name), noCaching);

// Browser admin: shared validation scripts, the installer API and the static
// shell. Admin assets are never conditionally cached.
function mountAdminShell(app, { store, options }) {
  app.get("/admin/page-content.js", shared("page-content.js"));
  app.get("/admin/content-contract.js", shared("content-contract.js"));
  mountInstallation(app, { store, options });
  app.use("/admin", (req, res, next) => {
    delete req.headers["if-none-match"];
    delete req.headers["if-modified-since"];
    next();
  });
  app.get("/admin/site-identity.js", shared("site-identity.js"));
  // admin-ui/package.json only tells Node the folder holds ES modules.
  app.get("/admin/package.json", (req, res) => {
    noStore(res, { error: true });
    res.status(404).json({ error: "未找到资源" });
  });
  app.use(
    "/admin",
    express.static(path.join(__dirname, "../admin-ui"), {
      index: "index.html",
      dotfiles: "deny",
      ...noCaching,
    }),
  );
}
module.exports = { mountAdminShell };

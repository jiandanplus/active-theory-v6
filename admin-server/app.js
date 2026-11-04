const express = require("express");
const { openPostgres } = require("./database");
const { appOptions } = require("./app-options");
const { mountAdminShell } = require("./admin-shell");
const { mountAuth } = require("./security");
const { publicError } = require("./http");
const { mountFrontend } = require("./frontend");
const { mountResources } = require("./resources");
const { mountModels } = require("./models");
const { mountDeliveryAdmin } = require("./delivery/admin-routes");
const { createDeliveryService } = require("./delivery/service");
const { noStore } = require("./delivery/response");
const { mountContentRoutes } = require("./routes/content");
const { mountOperationalHealth } = require("./operational-health");
const { requestLogging } = require("./request-logging");
const {
  securityHeaders,
  privateCachePolicy,
} = require("./middleware/request-policy");
const { installationGate } = require("./middleware/installation-gate");

/**
 * Composition root: middleware order, lifecycle and route mounting only.
 * @param {any} [input]
 * @param {{deliveryService?: any}} [services]
 */
function createApp(input = {}, { deliveryService } = {}) {
  const options = appOptions(input);
  const app = express(),
    store =
      options.store ||
      openPostgres({
        databaseUrl: options.databaseUrl,
        ssl: options.databaseSSL,
      });
  app.locals.store = store;
  deliveryService ||= createDeliveryService({ store, options });
  app.locals.deliveryService = deliveryService;
  app.disable("x-powered-by");
  app.disable("etag");
  if (options.trustProxy) app.set("trust proxy", options.trustProxy);
  app.use(
    requestLogging(options),
    securityHeaders(options),
    privateCachePolicy(),
  );
  mountOperationalHealth(app, { store });
  mountAdminShell(app, { store, options });
  app.use(installationGate(store));
  app.use(express.json({ limit: "5mb" }));
  const { requireAuth, csrfGuard } = mountAuth(app, store, options);
  const admin = express.Router();
  app.use("/api/admin", requireAuth, csrfGuard, admin);
  mountContentRoutes({ admin, store, options, deliveryService });
  mountResources({ app, admin, store, options });
  mountModels({ app, admin, store, options });
  mountDeliveryAdmin({ admin, store, service: deliveryService });
  app.use(["/api/projects", "/api/build"], requireAuth, (req, res) =>
    res.status(410).json({ error: "旧接口已停用，请使用 /admin" }),
  );
  mountFrontend(app, store, options, { cas: deliveryService.cas });
  app.use((req, res) => {
    noStore(res, { error: true });
    res.status(404).json({ error: "未找到资源" });
  });
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const { status, message } = publicError(err);
    noStore(res, { error: true });
    if (status === 500) console.error("[admin]", err.code || err.name);
    res.status(status).json({ error: message });
  });
  return app;
}
module.exports = { createApp };

const { inspectInstallation, currentSchemaVersion } = require("./migrations");

function mountOperationalHealth(app, { store }) {
  app.get("/health/live", (req, res) => res.json({ status: "ok" }));
  app.get("/health/ready", async (req, res) => {
    try {
      // Full catalog verification prevents a damaged schema being mistaken for
      // a fresh installation. This endpoint deliberately exposes no DB details.
      const state = await inspectInstallation(store);
      const ready =
        state.state === "installed" ||
        (state.state === "uninstalled" &&
          (state.schemaVersion === null ||
            state.schemaVersion === currentSchemaVersion));
      return res
        .status(ready ? 200 : 503)
        .json({ status: ready ? "ok" : "unavailable" });
    } catch {
      return res.status(503).json({ status: "unavailable" });
    }
  });
}
module.exports = { mountOperationalHealth };

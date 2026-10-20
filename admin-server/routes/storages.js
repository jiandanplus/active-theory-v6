const { route } = require("../http");
const { createStorageService } = require("../services/storages");

function mountStorageRoutes({ admin, store, options }) {
  const service = createStorageService({ store, options });
  admin.get(
    "/storages",
    route(async (req, res) => res.json(await service.list())),
  );
  admin.post(
    "/storages",
    route(async (req, res) => {
      const { status, storage } = await service.save(
        req.body,
        req.adminSession.username,
      );
      res.status(status).json({ storage });
    }),
  );
  admin.post(
    "/storages/:id/test",
    route(async (req, res) => res.json(await service.test(req.params.id))),
  );
}
module.exports = { mountStorageRoutes };

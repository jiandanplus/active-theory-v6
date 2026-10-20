const { route } = require("../http");
const { createResourceService } = require("../services/resources");

function mountResourceRoutes({ admin, store, options }) {
  const service = createResourceService({ store, options });
  admin.get(
    "/resources",
    route(async (req, res) => res.json({ resources: await service.list() })),
  );
  admin.post(
    "/resources/link",
    route(async (req, res) =>
      res
        .status(201)
        .json({
          resource: await service.link(req.body, req.adminSession.username),
        }),
    ),
  );
  admin.post(
    "/resources/upload",
    route(async (req, res) =>
      res
        .status(201)
        .json({
          resource: await service.upload(req, req.adminSession.username),
        }),
    ),
  );
  admin.patch(
    "/resources/:id",
    route(async (req, res) =>
      res.json({
        resource: await service.setTrashed(
          req.params.id,
          req.body?.trashed,
          req.adminSession.username,
        ),
      }),
    ),
  );
}
module.exports = { mountResourceRoutes };

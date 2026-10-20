const {
  saveDraft,
  publish,
  restore,
  createPreview,
} = require("../services/content");
const { route } = require("../http");
const { contentRepository } = require("../repositories/content");
const { resourceRepository } = require("../repositories/resources");
const { storageRepository } = require("../repositories/storages");
const { auditRepository } = require("../repositories/audit");
const { versionDeliverySummaries } = require("../delivery/admin-routes");

function mountContentRoutes({ admin, store, options, deliveryService }) {
  admin.get(
    "/config/schema",
    route(async (req, res) => {
      const { schema } = await contentRepository(store).getTemplate();
      res.json({ schema });
    }),
  );
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
          { id: req.adminSession.id, username: req.adminSession.username },
          { withWarnings: true, deliveryService },
        ),
      );
    }),
  );
  admin.post(
    "/preview",
    route(async (req, res) =>
      res.json({
        url: `/?preview=${await createPreview(
          store,
          req.body.revision,
          options,
          { id: req.adminSession.id, username: req.adminSession.username },
          { deliveryService },
        )}`,
      }),
    ),
  );
  admin.get(
    "/versions",
    route(async (req, res) => {
      const repo = contentRepository(store);
      res.json({
        published: (await repo.getDraft()).published,
        versions: await versionDeliverySummaries(
          store,
          await repo.listVersions(),
          options.origin,
        ),
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
}
module.exports = { mountContentRoutes };

const { route } = require("../http");
const { fail } = require("../security");
const { runtimeRepository } = require("../repositories/runtime");
const { deliveryRepository } = require("../repositories/deliveries");

const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const generation = (value) => Number.isSafeInteger(value) && value >= 0;
function exactBody(body, keys) {
  return (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Object.keys(body).length === keys.length &&
    keys.every((key) => Object.hasOwn(body, key))
  );
}
function mountDeliveryAdmin({ admin, store, service }) {
  admin.post(
    "/runtime/builtin",
    route(async (req, res) => {
      if (!exactBody(req.body, [])) throw fail(400, "模板登记参数无效");
      const input = await require("../portfolio/builtin").builtinRuntime();
      res.json(
        await service.register({
          ...input,
          actor: {
            id: req.adminSession.id,
            username: req.adminSession.username,
          },
        }),
      );
    }),
  );
  admin.get(
    "/runtime",
    route(async (req, res) => {
      const runtime = runtimeRepository(store);
      const [selection, bundles] = await Promise.all([
        runtime.getSelection(),
        runtime.listBundles(),
      ]);
      res.json({
        selection,
        bundles: bundles.map((bundle) => ({
          digest: bundle.digest,
          profileId: bundle.profileId,
          files: bundle.manifest.files.length,
          bytes: bundle.manifest.files.reduce(
            (sum, file) => sum + file.size,
            0,
          ),
          registeredAt: bundle.registeredAt,
        })),
      });
    }),
  );
  admin.put(
    "/runtime/selection",
    route(async (req, res) => {
      if (
        !exactBody(req.body, ["digest", "generation"]) ||
        !digest(req.body.digest) ||
        !generation(req.body.generation)
      )
        throw fail(400, "运行包选择参数无效");
      res.json(
        await service.select({
          digest: req.body.digest,
          expectedGeneration: req.body.generation,
          actor: {
            id: req.adminSession.id,
            username: req.adminSession.username,
          },
        }),
      );
    }),
  );
  admin.post(
    "/versions/:id/delivery",
    route(async (req, res) => {
      const id = Number(req.params.id);
      if (
        !/^[1-9][0-9]*$/.test(req.params.id) ||
        !Number.isSafeInteger(id) ||
        !exactBody(req.body, ["generation"]) ||
        !generation(req.body.generation)
      )
        throw fail(400, "交付参数无效");
      res.json(
        await service.legacy({
          versionId: id,
          expectedGeneration: req.body.generation,
          actor: {
            id: req.adminSession.id,
            username: req.adminSession.username,
          },
        }),
      );
    }),
  );
}
async function versionDeliverySummaries(store, versions, origin) {
  const repo = deliveryRepository(store),
    result = [];
  const selection = await runtimeRepository(store).getSelection();
  // Every version is still fully verified; the reads are batched.
  const verified = await repo.verifyVersions(versions);
  for (const version of versions) {
    const summary = {
      id: version.id,
      created: version.created,
      mode: null,
      generation: null,
      artifactDigest: null,
      status: "缺失/损坏",
    };
    const entry = verified.get(version.id);
    if (entry?.error) {
      // Only a known mode is exposed; never include malformed database values.
      summary.status = !["pinned", "legacy"].includes(entry.mode)
        ? "不支持"
        : "缺失/损坏";
    } else if (entry) {
      // A damaged binding must not erase the rest of the history.
      const binding = entry.binding;
      summary.mode = binding.mode;
      summary.generation = binding.generation;
      summary.artifactDigest = binding.artifactDigest;
      if (binding.mode === "legacy" && !binding.artifactDigest)
        summary.status = selection.digest ? "legacy待生成" : "未选包";
      else if (!["pinned", "legacy"].includes(binding.mode))
        summary.status = "不支持";
      else if (!binding.artifactDigest) summary.status = "缺失/损坏";
      else
        summary.status =
          entry.artifact.manifest.origin === origin ? "已固定" : "origin不匹配";
    }
    result.push(summary);
  }
  return result;
}
module.exports = { mountDeliveryAdmin, versionDeliverySummaries };

const { fail } = require("../security");
const { normalizeConfig } = require("../../shared/site-identity");
const { lockSchema, MEDIA_FIELDS } = require("../../shared/page-content");
const { initialConfig, appFile, baseUIL } = require("../importers/disk");
const { contentRepository } = require("../repositories/content");
const { auditRepository } = require("../repositories/audit");
const { safeURL, validateConfig } = require("../validation/content");
const { buildUIL } = require("../engine/legacy-adapter");
function assertRevision(draft, revision) {
  if (!draft || revision !== draft.revision)
    throw fail(409, "配置版本冲突，请刷新后重新编辑");
}
async function saveDraft(
  store,
  config,
  revision,
  actor = null,
  preserveFixed = false,
) {
  config = structuredClone(config);
  return store.transaction(async (tx) => {
    const repo = contentRepository(tx);
    const draft = await repo.getDraft({ lock: true });
    assertRevision(draft, revision);
    const savedTemplate = await repo.getTemplate();
    if (preserveFixed) config = lockSchema(config, draft.config);
    validateConfig(config, lockSchema(savedTemplate.schema, draft.config));
    // Freeze the media identities chosen by this save into the next snapshot.
    // The catalogue may contain unrelated rows; only selected media enters here.
    const resources = require("../repositories/resources").resourceRepository(
      tx,
    );
    const rows = await resources.list();
    const urls = [
      config.site.socialImage,
      ...Object.keys(MEDIA_FIELDS).map((key) => config.site[key]),
      ...config.projects.flatMap((p) =>
        ["video", "image", "projectLogo"].flatMap((k) => [
          p[k]?.url,
          p[k]?.thumbnail,
        ]),
      ),
      ...config.scenes.flatMap((s) =>
        s.fields
          .filter((f) => ["resource", "geometry"].includes(f.type))
          .map((f) => f.value),
      ),
      ...config.songs.map((s) => s.src),
    ].filter(Boolean);
    const { resourceAsset } = require("../snapshots");
    for (const url of new Set(urls)) {
      if (resourceAsset(savedTemplate, url)) continue;
      const id =
        /^\/media\/([^/?#]+)/.exec(url)?.[1] ||
        /^\/(?:models\/|assets\/geometry\/admin\/)([^/?#]+)\.bin/.exec(
          url,
        )?.[1];
      let row = rows.find((r) => r.id === id || r.url === url);
      if (!row && /^https:\/\//.test(url)) {
        const resourceId =
          "external-" + require("../resource-catalog").digest(url).slice(0, 32);
        const pageKind = Object.entries(MEDIA_FIELDS).find(
          ([key]) => config.site[key] === url,
        )?.[1].kind;
        const kind =
          pageKind ||
          (config.songs.some((s) => s.src === url)
            ? "audio"
            : config.projects.some((p) => p.video?.url === url)
              ? "video"
              : config.scenes.some((s) =>
                    s.fields.some(
                      (f) => f.type === "geometry" && f.value === url,
                    ),
                  )
                ? "model"
                : "image");
        row = await resources.insert({
          id: resourceId,
          source: "external",
          url,
          name: new URL(url).pathname.split("/").at(-1) || "external",
          kind,
          status: "unverified",
        });
        rows.push(row);
      }
      if (!row) continue; // Missing managed IDs are rejected by writeDraft references.
      const slot = `selected:${row.id}`;
      savedTemplate.assets[slot] = {
        resourceId: row.id,
        fileName: require("node:path").posix.basename(
          row.key || row.path || row.name || row.id,
        ),
        url,
        owner: "selected",
      };
      savedTemplate.legacyMap[url] = slot;
    }
    for (const [key, field] of Object.entries(MEDIA_FIELDS)) {
      const url = config.site[key];
      if (!url) continue;
      const asset = resourceAsset(savedTemplate, url);
      const row = rows.find((row) => row.id === asset?.resourceId);
      if (!row || row.kind !== field.kind)
        throw fail(
          400,
          `${field.label}资源类型须为${field.kind === "video" ? "视频" : "图片"}`,
        );
    }
    if (config.site.socialImage) {
      const asset = resourceAsset(savedTemplate, config.site.socialImage);
      if (
        !rows.some(
          (row) => row.id === asset?.resourceId && row.kind === "image",
        )
      )
        throw fail(400, "分享图片必须引用已登记的图片资源");
    }
    await repo.updateTemplateMedia(savedTemplate);
    const next = await repo.writeDraft(config, revision);
    await auditRepository(tx).append("config.save", actor);
    return next;
  });
}
async function validatedDraft(store, revision, options) {
  const repo = contentRepository(store),
    draft = await repo.getDraft();
  assertRevision(draft, revision);
  validateConfig(
    draft.config,
    lockSchema((await repo.getTemplate()).schema, draft.config),
  );
  const warnings = await require("../publication").validatePublication(
    store,
    options,
    draft.snapshot,
  );
  return { draft, warnings };
}
async function publish(
  store,
  revision,
  options = {},
  actor = null,
  { withWarnings = false, deliveryService } = {},
) {
  const service =
    deliveryService ||
    require("../delivery/service").createDeliveryService({ store, options });
  return service.publish({ revision, actor, withWarnings });
}
async function restore(store, id, revision, actor = null) {
  if (!Number.isSafeInteger(id) || id < 1) throw fail(404, "版本不存在");
  const row = await contentRepository(store).getVersion(id);
  if (!row) throw fail(404, "版本不存在");
  return saveDraft(
    store,
    normalizeConfig(row.snapshot.config),
    revision,
    actor,
    true,
  );
}
async function createPreview(
  store,
  revision,
  options,
  actor,
  { deliveryService } = {},
) {
  const service =
    deliveryService ||
    require("../delivery/service").createDeliveryService({ store, options });
  return service.preview({ revision, actor });
}
module.exports = {
  initialConfig,
  validateConfig,
  buildUIL,
  saveDraft,
  publish,
  restore,
  createPreview,
  safeURL,
  appFile,
  baseUIL,
};

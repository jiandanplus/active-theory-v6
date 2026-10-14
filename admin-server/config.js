const { fail } = require("./security");
const {normalizeConfig,validateIdentity} = require('../shared/site-identity');
const { initialConfig, appFile, baseUIL } = require("./importers/disk");
const { contentRepository } = require("./repositories/content");
const { auditRepository } = require("./repositories/audit");
function safeURL(value, { empty = true } = {}) {
  if (typeof value !== "string") throw fail(400, "资源地址必须是文本");
  if (!value && empty) return;
  if (value.length > 4096 || /[<>\x00-\x1f\\]/.test(value))
    throw fail(400, "资源地址包含无效字符");
  if (
    /^(?:\/?assets\/|\/media\/|\/models\/|room\/|bush\.bin\/)/.test(value) &&
    !value.split(/[/?#]/).includes("..")
  )
    return;
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fail(400, "资源地址须为 HTTPS URL 或站内资源路径");
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw fail(400, "资源地址须使用 HTTPS，且不能包含密码");
}
function plain(value, max = 20000) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    /<\/?[a-z!]|\x00/i.test(value)
  )
    throw fail(400, "文字内容不能包含 HTML 标签，且不能超过长度限制");
}
function validateConfig(config, schema) {
  if (
    !config ||
    Object.keys(config).some(
      (k) => !["site", "projects", "scenes", "songs"].includes(k),
    )
  )
    throw fail(400, "不支持的配置字段");
  if (
    !config.site ||
    Object.keys(config.site).length !== Object.keys(schema.site).length ||
    Object.keys(config.site).some((key) => !Object.hasOwn(schema.site, key))
  )
    throw fail(400, "网站配置字段无效");
  validateIdentity(config.site);
  for (const [key, value] of Object.entries(config.site)) {
    if (key === 'description' || key === 'language') continue;
    if (key === 'socialImage') { safeURL(value); continue; }
    plain(value, 1000);
    if (key === "labUrl") safeURL(value);
  }
  if (
    config.site.emailLink &&
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(config.site.emailLink)
  )
    throw fail(400, "邮箱格式无效");
  if (
    !Array.isArray(config.scenes) ||
    config.scenes.length !== schema.scenes.length
  )
    throw fail(400, "场景结构无效");
  const seenScenes = new Set();
  config.scenes.forEach((scene) => {
    const original = schema.scenes.find((s) => s.id === scene?.id);
    if (
      !original ||
      seenScenes.has(scene.id) ||
      scene.id !== original.id ||
      scene.label !== original.label ||
      !Array.isArray(scene.fields) ||
      scene.fields.length !== original.fields.length
    )
      throw fail(400, "场景字段结构无效");
    seenScenes.add(scene.id);
    const seenFields = new Set();
    scene.fields.forEach((field) => {
      const base = original.fields.find((f) => f.key === field?.key);
      if (
        !base ||
        seenFields.has(field.key) ||
        field.key !== base.key ||
        field.type !== base.type ||
        field.label !== base.label ||
        Object.keys(field).some(
          (k) => !["key", "label", "type", "value"].includes(k),
        )
      )
        throw fail(400, "不支持的场景字段");
      seenFields.add(field.key);
      if (field.type === "number") {
        if (
          !Number.isFinite(field.value) ||
          field.value < 0 ||
          field.value > (field.key.startsWith("__blackhole_") ? 3 : 10)
        )
          throw fail(400, "参数超出允许范围");
        if (field.key === "__blackhole_size" && field.value < 0.2)
          throw fail(400, "黑洞尺寸不能小于 0.2");
      } else if (field.type === "text") plain(field.value);
      else if (field.value !== base.value) {
        safeURL(field.value, { empty: false });
        if (
          field.type === "geometry" &&
          !/\.bin(?:[?#]|$)|^\/media\//.test(field.value)
        )
          throw fail(400, "此模型槽位需要转换后的 BIN 模型");
      }
    });
  });
  if (!Array.isArray(config.projects) || config.projects.length > 500)
    throw fail(400, "作品数量超出限制");
  const slugs = new Set();
  for (const p of config.projects) {
    if (
      !p ||
      typeof p !== "object" ||
      !/^[a-z0-9][a-z0-9-]{0,100}$/.test(p.slug) ||
      slugs.has(p.slug)
    )
      throw fail(400, "作品标识须为唯一的小写字母、数字及短横线");
    slugs.add(p.slug);
    if (
      typeof p.tags !== "string" ||
      !p.video ||
      typeof p.video !== "object" ||
      typeof p.video.url !== "string" ||
      typeof p.video.thumbnail !== "string" ||
      !p.projectLogo ||
      typeof p.projectLogo.url !== "string" ||
      typeof p.completionDate !== "string" ||
      !Number.isFinite(Date.parse(p.completionDate))
    )
      throw fail(400, "作品缺少必要字段：标签、视频、封面、标志、有效完成日期");
    for (const key of ["name", "description", "tags", "clientName"])
      plain(p[key] || "");
    if (!p.name?.trim()) throw fail(400, "作品名称不能为空");
    if (p.uiColor && !/^[a-f\d]{6}$/i.test(p.uiColor))
      throw fail(400, "作品颜色须为六位十六进制");
    if (
      p.priority !== undefined &&
      (!Number.isFinite(p.priority) || p.priority < 0 || p.priority > 100)
    )
      throw fail(400, "作品排序须在 0–100 之间");
    const old = schema.projects.find((o) => o.slug === p.slug);
    for (const key of ["projectURL", "caseStudyURL"])
      if (p[key] !== old?.[key]) safeURL(p[key] || "");
    for (const key of ["video", "projectLogo", "image"])
      if (p[key]) {
        if (typeof p[key] !== "object") throw fail(400, "作品资源结构无效");
        for (const item of ["url", "thumbnail"])
          if (p[key][item] !== old?.[key]?.[item]) safeURL(p[key][item] || "");
      }
  }
  if (!Array.isArray(config.songs) || config.songs.length > 100)
    throw fail(400, "音乐列表无效");
  for (const song of config.songs) {
    plain(song.title, 200);
    safeURL(song.src, { empty: false });
  }
  return config;
}
const {buildUIL}=require('./engine/legacy-adapter');
function assertRevision(draft, revision) {
  if (!draft || revision !== draft.revision)
    throw fail(409, "配置版本冲突，请刷新后重新编辑");
}
async function saveDraft(store, config, revision, actor = null) {
  config = structuredClone(config);
  return store.transaction(async (tx) => {
    const repo = contentRepository(tx);
    const draft = await repo.getDraft({ lock: true });
    assertRevision(draft, revision);
    const savedTemplate = await repo.getTemplate();
    validateConfig(config, savedTemplate.schema);
    // Freeze the media identities chosen by this save into the next snapshot.
    // The catalogue may contain unrelated rows; only selected media enters here.
    const resources = require("./repositories/resources").resourceRepository(
      tx,
    );
    const rows = await resources.list();
    const urls = [
      config.site.socialImage,
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
    const { resourceAsset } = require("./snapshots");
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
          "external-" + require("./resource-catalog").digest(url).slice(0, 32);
        const kind = config.songs.some((s) => s.src === url)
          ? "audio"
          : config.projects.some((p) => p.video?.url === url)
            ? "video"
            : config.scenes.some((s) =>
                  s.fields.some(
                    (f) => f.type === "geometry" && f.value === url,
                  ),
                )
              ? "model"
              : "image";
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
    if (config.site.socialImage) {
      const asset = resourceAsset(savedTemplate, config.site.socialImage);
      if (!rows.some(row => row.id === asset?.resourceId && row.kind === 'image'))
        throw fail(400, '分享图片必须引用已登记的图片资源');
    }
    await tx.query(
      "UPDATE personal_site.templates SET content=$1 WHERE id=(SELECT template_id FROM personal_site.site_settings WHERE id=true)",
      [
        {
          template: savedTemplate.template,
          assets: savedTemplate.assets,
          legacyMap: savedTemplate.legacyMap,
        },
      ],
    );
    const next = await repo.writeDraft(config, revision);
    await auditRepository(tx).append("config.save", actor);
    return next;
  });
}
async function validatedDraft(store, revision, options) {
  const repo = contentRepository(store),
    draft = await repo.getDraft();
  assertRevision(draft, revision);
  validateConfig(draft.config, (await repo.getTemplate()).schema);
  const warnings = await require("./publication").validatePublication(
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
  const service = deliveryService || require('./delivery/service').createDeliveryService({store,options});
  return service.publish({revision,actor,withWarnings});
}
async function restore(store, id, revision, actor = null) {
  if (!Number.isSafeInteger(id) || id < 1) throw fail(404, "版本不存在");
  const row = await contentRepository(store).getVersion(id);
  if (!row) throw fail(404, "版本不存在");
  return saveDraft(store, normalizeConfig(row.snapshot.config), revision, actor);
}
async function createPreview(store, revision, options, actor, {deliveryService} = {}) {
  // Task 10 replaces this staged body with service.preview; no fallback routing.
  require('./delivery/candidates').assertActor(actor);
  const owner = actor.username;
  const { draft } = await validatedDraft(store, revision, options);
  return store.transaction(async (tx) => {
    const repo = contentRepository(tx),
      current = await repo.getDraft({ lock: true });
    assertRevision(current, revision);
    await require("./publication").checkPublicationState(tx, draft.snapshot);
    const now = Date.now();
    await repo.prunePreviews(new Date(now));
    const id = "preview-" + require("node:crypto").randomUUID();
    await repo.putPreview({
      id,
      owner,
      expires: new Date(now + 30 * 60000),
      snapshot: draft.snapshot,
    });
    const old = (
      await tx.query(
        "SELECT id FROM personal_site.previews WHERE owner=$1 ORDER BY expires DESC,id DESC OFFSET 5",
        [owner],
      )
    ).rows.map((r) => r.id);
    await tx.query(
      "DELETE FROM personal_site.resource_references WHERE owner_type='preview' AND owner_id=ANY($1::text[])",
      [old],
    );
    await tx.query(
      "DELETE FROM personal_site.previews WHERE id=ANY($1::text[])",
      [old],
    );
    await auditRepository(tx).append("config.preview", owner);
    return id;
  });
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

const { fail } = require("./security");
const { initialConfig, appFile, baseUIL } = require("./importers/disk");
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
    Object.keys(config.site).join("|") !== Object.keys(schema.site).join("|")
  )
    throw fail(400, "网站配置字段无效");
  for (const [key, value] of Object.entries(config.site)) {
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
  config.scenes.forEach((scene, i) => {
    const original = schema.scenes[i];
    if (
      scene.id !== original.id ||
      scene.label !== original.label ||
      !Array.isArray(scene.fields) ||
      scene.fields.length !== original.fields.length
    )
      throw fail(400, "场景字段结构无效");
    scene.fields.forEach((field, j) => {
      const base = original.fields[j];
      if (
        field.key !== base.key ||
        field.type !== base.type ||
        field.label !== base.label ||
        Object.keys(field).some(
          (k) => !["key", "label", "type", "value"].includes(k),
        )
      )
        throw fail(400, "不支持的场景字段");
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
function buildUIL(root, config) {
  const data = baseUIL(root);
  for (const scene of config.scenes)
    for (const field of scene.fields) {
      if (field.key.startsWith("__")) continue;
      if (["resource", "geometry"].includes(field.type)) {
        const old = data[field.key];
        if (old?.src === field.value) continue;
        const src =
          field.type === "geometry"
            ? field.value.replace(/^\/models\//, "/assets/geometry/admin/")
            : field.value;
        const filename = src.split("/").at(-1).split("?")[0];
        data[field.key] = {
          ...old,
          src,
          filename,
          prefix: "",
          relative: "",
          compressed: false,
          useCompressed: false,
          hotreload: false,
        };
      } else data[field.key] = field.value;
    }
  const speed =
    config.scenes
      .find((s) => s.id === "TreeScene")
      ?.fields.find((f) => f.key === "__blackhole_speed")?.value ?? 1;
  const size =
    config.scenes
      .find((s) => s.id === "TreeScene")
      ?.fields.find((f) => f.key === "__blackhole_size")?.value ?? 1;
  const key = "INPUT_P_Element_21_TreeScenecode_1_code";
  if (typeof data[key] === "string" && data[key].includes("Lensed accretion"))
    data[key] =
      data[key].replace(/\btime\b/g, `(time * ${speed.toFixed(4)})`) +
      `\npos *= ${size.toFixed(4)};`;
  return data;
}
function initializeConfig(store, root) {
  if (store.get("draft")) return;
  const config = initialConfig(root);
  store.transaction(() => {
    store.set("schema", config);
    store.set("draft", config);
    store.set("revision", 0);
    const result = store.db
      .prepare("INSERT INTO versions(created,config) VALUES(?,?)")
      .run(new Date().toISOString(), JSON.stringify(config));
    store.set("published", Number(result.lastInsertRowid));
  });
}
function assertRevision(store, revision) {
  if (revision !== store.get("revision", 0))
    throw fail(409, "配置版本冲突，请刷新后重新编辑");
}
function saveDraft(store, config, revision) {
  validateConfig(config, store.get("schema"));
  return store.transaction(() => {
    assertRevision(store, revision);
    store.set("draft", config);
    store.set("revision", revision + 1);
    return revision + 1;
  });
}
function publish(store, revision) {
  return store.transaction(() => {
    assertRevision(store, revision);
    const config = store.get("draft");
    validateConfig(config, store.get("schema"));
    const result = store.db
      .prepare("INSERT INTO versions(created,config) VALUES(?,?)")
      .run(new Date().toISOString(), JSON.stringify(config));
    store.set("published", Number(result.lastInsertRowid));
    store.audit("config.publish");
    return Number(result.lastInsertRowid);
  });
}
function restore(store, id, revision) {
  const row = store.db
    .prepare("SELECT config FROM versions WHERE id=?")
    .get(id);
  if (!row) throw fail(404, "版本不存在");
  return saveDraft(store, JSON.parse(row.config), revision);
}
module.exports = {
  initialConfig,
  validateConfig,
  buildUIL,
  initializeConfig,
  saveDraft,
  publish,
  restore,
  safeURL,
  appFile,
  baseUIL,
};

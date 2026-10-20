"use strict";

/** @typedef {{validateIdentity: (site: import('./content-types').SiteContent['site']) => unknown}} IdentityContract */
/** @typedef {{SiteIdentity: IdentityContract, SiteContentContract?: import('./content-types').ContentContract}} ContractGlobal */
/**
 * @param {ContractGlobal} root
 * @param {(identity: IdentityContract) => import('./content-types').ContentContract} factory
 */
(function (root, factory) {
  const identityModule = "./site-identity";
  if (typeof module === "object" && module.exports)
    module.exports = factory(require(identityModule));
  else root.SiteContentContract = factory(root.SiteIdentity);
})(
  /** @type {ContractGlobal} */ (/** @type {unknown} */ (globalThis)),
  /** @param {IdentityContract} identity */ function (identity) {
    "use strict";
    /** @import {SiteContent as ContentShape, SceneContent as SceneShape} from './content-types' */
    const { validateIdentity } = identity;
    /** @param {number} status @param {string} message */
    const fail = (status, message) =>
      Object.assign(new Error(message), { status });
    /** @param {unknown} value @param {{empty?: boolean}} [options] @returns {asserts value is string} */
    function safeURL(value, { empty = true } = {}) {
      if (typeof value !== "string") throw fail(400, "资源地址必须是文本");
      if (!value && empty) return;
      if (value.length > 4096 || /[<>\x00-\x1f\\]/.test(value))
        throw fail(400, "资源地址包含无效字符");
      if (
        /^(?:\/?assets\/|\/media\/|\/models\/|room\/|bush\.bin\/)/.test(
          value,
        ) &&
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
    /** @param {unknown} value @param {number} [max] */
    function plain(value, max = 20000) {
      if (
        typeof value !== "string" ||
        value.length > max ||
        /<\/?[a-z!]|\x00/i.test(value)
      )
        throw fail(400, "文字内容不能包含 HTML 标签，且不能超过长度限制");
    }
    /** @template {ContentShape} T @param {T} config @param {ContentShape} schema @returns {T} */
    function validateContent(config, schema) {
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
        if (key === "description" || key === "language") continue;
        if (key === "socialImage") {
          safeURL(value);
          continue;
        }
        plain(value, 1000);
        if (key === "labUrl") safeURL(value);
      }
      if (
        config.site.emailLink &&
        !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(String(config.site.emailLink))
      )
        throw fail(400, "邮箱格式无效");
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
          throw fail(
            400,
            "作品缺少必要字段：标签、视频、封面、标志、有效完成日期",
          );
        for (const key of /** @type {const} */ ([
          "name",
          "description",
          "tags",
          "clientName",
        ]))
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
        for (const key of /** @type {const} */ (["projectURL", "caseStudyURL"]))
          if (p[key] !== old?.[key]) safeURL(p[key] || "");
        for (const key of /** @type {const} */ ([
          "video",
          "projectLogo",
          "image",
        ]))
          if (p[key]) {
            if (typeof p[key] !== "object") throw fail(400, "作品资源结构无效");
            for (const item of /** @type {const} */ (["url", "thumbnail"]))
              if (p[key][item] !== old?.[key]?.[item])
                safeURL(p[key][item] || "");
          }
      }
      if (!Array.isArray(config.songs) || config.songs.length > 100)
        throw fail(400, "音乐列表无效");
      for (const song of config.songs) {
        if (!song || typeof song !== "object") throw fail(400, "音乐列表无效");
        plain(song.title, 200);
        safeURL(song.src, { empty: false });
      }
      return config;
    }
    /** @template {SceneShape[]} T @param {T} scenes @param {SceneShape[]} schemaScenes @returns {T} */
    function validateScenes(scenes, schemaScenes) {
      if (!Array.isArray(scenes) || scenes.length !== schemaScenes.length)
        throw fail(400, "场景结构无效");
      const seenScenes = new Set();
      scenes.forEach((scene) => {
        const original = schemaScenes.find((s) => s.id === scene?.id);
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
          if (!field || typeof field !== "object")
            throw fail(400, "不支持的场景字段");
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
              typeof field.value !== "number" ||
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
      return scenes;
    }
    /** @template {ContentShape} T @param {T} config @param {ContentShape} schema @returns {T} */
    function validateConfig(config, schema) {
      validateContent(config, schema);
      validateScenes(config.scenes, schema.scenes);
      return config;
    }
    return { safeURL, plain, validateContent, validateScenes, validateConfig };
  },
);

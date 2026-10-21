"use strict";

/** @param {any} root @param {() => import('./content-types').PageContentPolicy} factory */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SitePageContent = api;
})(/** @type {any} */ (globalThis), function () {
  /** @param {Record<string, import('./content-types').PageField>} fields */
  function registry(fields) {
    for (const field of Object.values(fields)) Object.freeze(field);
    return Object.freeze(fields);
  }
  const MEDIA_FIELDS = registry({
    heroVideo: {
      label: "开场背景视频",
      kind: "video",
      default: "assets/video/reel.mp4",
    },
    heroPoster: {
      label: "开场视频封面",
      kind: "image",
      default: "assets/video/reel-frame.jpg",
    },
    labBackground: {
      label: "底部六边形屏内容",
      kind: "image",
      default: "assets/images/lab.gif",
    },
    contactInstagramIcon: {
      label: "Instagram 图标",
      kind: "image",
      default: "assets/images/ui/ig.png",
    },
    contactLinkedinIcon: {
      label: "LinkedIn 图标",
      kind: "image",
      default: "assets/images/ui/in.png",
    },
    contactXIcon: {
      label: "X 图标",
      kind: "image",
      default: "assets/images/ui/tw.png",
    },
    contactQrImage: { label: "微信二维码图片", kind: "image", default: "" },
  });
  const TEXT_FIELDS = registry({
    contactHomeText: { label: "主页链接文字", default: "" },
    contactJoinText: { label: "加入链接文字", default: "" },
    contactAboutText: { label: "关于链接文字", default: "" },
    contactInstagramText: { label: "Instagram 文字", default: "" },
    contactLinkedinText: { label: "LinkedIn 文字", default: "" },
    contactXText: { label: "X 文字", default: "" },
    contactQrText: { label: "二维码说明", default: "" },
  });
  const LINK_FIELDS = registry({
    contactHomeURL: { label: "主页链接", default: "" },
    contactJoinURL: { label: "加入链接", default: "" },
    contactAboutURL: { label: "关于链接", default: "" },
    contactInstagramURL: { label: "Instagram 链接", default: "" },
    contactLinkedinURL: { label: "LinkedIn 链接", default: "" },
    contactXURL: { label: "X 链接", default: "" },
  });
  const PAGE_KEYS = Object.freeze([
    ...Object.keys(MEDIA_FIELDS),
    ...Object.keys(TEXT_FIELDS),
    ...Object.keys(LINK_FIELDS),
  ]);
  /** @param {{id:string}} scene @param {{key:string,type:string}} field */
  function isEditableSceneField(scene, field) {
    return (
      field.type === "text" ||
      (scene.id === "Home" &&
        field.key === "INPUT_Config_8_ParticleTest_geometry" &&
        field.type === "geometry")
    );
  }
  /** @template {import('./content-types').SiteContent} T @param {T} schema @param {import('./content-types').SiteContent} current @returns {T} */
  function lockSchema(schema, current) {
    const locked = structuredClone(schema);
    for (const scene of locked.scenes) {
      const existing = current.scenes.find((item) => item.id === scene.id);
      for (const field of scene.fields) {
        if (isEditableSceneField(scene, field)) continue;
        const value = existing?.fields.find((item) => item.key === field.key);
        if (value) field.value = value.value;
      }
    }
    return locked;
  }
  /** @param {import('./content-types').ContentResource} resource @param {import('./content-types').SiteContent} config */
  function isSystemResource(resource, config) {
    if (resource.source !== "bundled") return false;
    const business = [
      "assets/geometry/logo/AT_logo.bin",
      ...Object.values(MEDIA_FIELDS).map((field) => field.default),
      config.site.socialImage,
      ...Object.keys(MEDIA_FIELDS).map((key) => config.site[key]),
      ...config.projects.flatMap((project) => [
        project.video?.url,
        project.video?.thumbnail,
        project.image?.url,
        project.image?.thumbnail,
        project.projectLogo?.url,
        project.projectLogo?.thumbnail,
      ]),
      ...config.songs.map((song) => song.src),
      ...config.scenes.flatMap((scene) =>
        scene.fields
          .filter(
            (field) =>
              field.type === "geometry" && isEditableSceneField(scene, field),
          )
          .map((field) => field.value),
      ),
    ].filter((value) => typeof value === "string" && value);
    /** @param {string} value */
    const canonical = (value) => value.replace(/^\/(assets\/)/, "$1");
    return !business.some((value) => {
      const url = /** @type {string} */ (value);
      return (
        [resource.url, resource.path].some(
          (entry) =>
            typeof entry === "string" && canonical(entry) === canonical(url),
        ) ||
        (resource.id && /^\/media\/([^/?#]+)/.exec(url)?.[1] === resource.id)
      );
    });
  }
  return {
    MEDIA_FIELDS,
    TEXT_FIELDS,
    LINK_FIELDS,
    PAGE_KEYS,
    isEditableSceneField,
    lockSchema,
    isSystemResource,
  };
});

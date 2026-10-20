"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.SiteAdminModules ||= {})["site"] = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
function create(context) {
  const { state, window, labels, node, button, dirty, field, panel, heading, warning, render } = context;
  function siteView() {
    heading("网站设置", "维护网站标题、导航与联系信息。");
    const p = panel(context.content, "基本信息"),
      grid = node("div", undefined, "grid");
    p.append(grid);
    for (const [key, value] of Object.entries(state.config.site).filter(([key]) =>
      !["description", "language", "socialImage"].includes(key)))
      field(
        grid,
        labels[key] || key,
        value,
        (v) => {
          state.config.site[key] = v;
          dirty();
        },
        {
          help:
            key === "labUrl"
              ? "使用 HTTPS 链接"
              : key === "emailLink"
                ? "只填写邮箱地址，不需要 mailto:"
                : undefined,
        },
      );
    const identity = panel(context.content, "搜索与分享");
    const update = (key, value) => { state.config.site[key] = value; dirty(); };
    field(identity, "网站描述", state.config.site.description, v => update("description", v), {
      multiline: true, maxLength: 500,
      help: "最多 500 字符。用于搜索和分享介绍，不改变 3D 场景文字。",
    });
    const languageLabels = { "zh-CN": "简体中文", "zh-TW": "繁體中文", en: "English" };
    field(identity, "页面语言", state.config.site.language, v => update("language", v), {
      choices: window.SiteIdentity.LANGUAGES.map(value => ({ value, label: languageLabels[value] })),
      help: "声明页面内容的语言，不会自动翻译网站。",
    });
    const social = field(identity, "分享图片", state.config.site.socialImage, v => update("socialImage", v), {
      pick: "image", help: "选择图片资源或填写 HTTPS 图片地址；留空则不使用默认分享图。",
    });
    identity.append(button("清空分享图片", () => { social.value = ""; update("socialImage", ""); }));
    identity.append(node("p", "网站域名来自服务器 SITE_ORIGIN。修改先保存为草稿，发布后才影响公开页面。", "muted"));
    const songs = panel(context.content, "背景音乐");
    warning(songs, "音乐由访客主动播放。添加资源前，请确保拥有使用授权。");
    state.config.songs.forEach((song, i) => {
      const row = node("div", undefined, "grid");
      field(row, "曲目名称", song.title, (v) => {
        song.title = v;
        dirty();
      });
      field(
        row,
        "音频地址",
        song.src,
        (v) => {
          song.src = v;
          dirty();
        },
        { pick: "audio" },
      );
      songs.append(
        row,
        button(
          "删除曲目",
          () => {
            state.config.songs.splice(i, 1);
            dirty();
            render();
          },
          "danger",
        ),
      );
    });
    songs.append(
      button("＋ 添加音乐", () => {
        state.config.songs.push({ title: "新曲目", src: "" });
        dirty();
        render();
      }),
    );
  }
  return { siteView };
}
return { create };
});

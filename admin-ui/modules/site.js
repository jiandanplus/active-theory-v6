import { orderedSiteKeys } from "./helpers.js";

// Functions this module adds to the shared context (see registry.js).
export const provides = ["siteView"];

export function create(context) {
  const {
    state,
    window,
    labels,
    node,
    button,
    dirty,
    field,
    panel,
    heading,
    warning,
    render,
  } = context;
  const pageContent = context.pageContent || context.window?.SitePageContent;
  function siteView() {
    heading("网站设置", "维护网站标题、导航与联系信息。");
    // Anchor navigation for this long page; filled as each panel is added.
    const nav = node("nav", undefined, "section-nav");
    nav.setAttribute?.("aria-label", "网站设置分组");
    context.content.append(nav);
    let sections = 0;
    const section = (title) => {
      const created = panel(context.content, title);
      created.id = "site-section-" + ++sections;
      const link = node("a", title);
      link.href = "#" + created.id;
      nav.append(link);
      return created;
    };
    const p = section("基本信息"),
      grid = node("div", undefined, "grid");
    p.append(grid);
    const excluded = [
      "description",
      "language",
      "socialImage",
      "labUrl",
      ...pageContent.PAGE_KEYS,
    ];
    for (const key of orderedSiteKeys(state.config.site, labels, excluded))
      field(
        grid,
        labels[key] || key,
        state.config.site[key],
        (v) => {
          state.config.site[key] = v;
          dirty();
        },
        {
          help:
            key === "emailLink"
              ? "只填写邮箱地址，不需要 mailto:"
              : /^city/.test(key)
                ? "联系页显示的城市或地点文字"
                : undefined,
        },
      );
    const definitions = {
      ...pageContent.MEDIA_FIELDS,
      ...pageContent.TEXT_FIELDS,
      ...pageContent.LINK_FIELDS,
    };
    const update = (key, value) => {
      state.config.site[key] = value;
      dirty();
    };
    /** @type {[string, string[]][]} */
    const groups = [
      ["开场与底部展示", ["heroVideo", "heroPoster", "labBackground"]],
      [
        "联系页面链接",
        [
          "contactHomeText",
          "contactHomeURL",
          "contactJoinText",
          "contactJoinURL",
          "contactAboutText",
          "contactAboutURL",
        ],
      ],
      [
        "社交媒体",
        [
          "contactInstagramText",
          "contactInstagramURL",
          "contactInstagramIcon",
          "contactLinkedinText",
          "contactLinkedinURL",
          "contactLinkedinIcon",
          "contactXText",
          "contactXURL",
          "contactXIcon",
        ],
      ],
      ["微信二维码", ["contactQrImage", "contactQrText"]],
    ];
    // Shared rules are stated once, not repeated under every field.
    warning(
      context.content,
      "以下可选内容留空则继承原版展示。修改后先保存草稿并前台预览，确认效果后再发布。",
    );
    for (const [title, keys] of groups) {
      const group = section(title),
        rows = node("div", undefined, "grid");
      if (keys.some((key) => key in pageContent.TEXT_FIELDS))
        group.append(
          node(
            "p",
            "文字以原站 3D 字形显示，受原有字体字形覆盖限制，请在前台预览检查。",
            "muted",
          ),
        );
      if (keys.some((key) => definitions[key].kind))
        group.append(
          node(
            "p",
            "资源可从资源库选择或填写 HTTPS 地址；外部资源须允许跨域 CORS，公开可访问性仍需前台验证。",
            "muted",
          ),
        );
      group.append(rows);
      for (const key of keys) {
        const definition = definitions[key];
        field(
          rows,
          definition.label,
          state.config.site[key],
          (value) => update(key, value),
          {
            pick: definition.kind,
            help:
              key in pageContent.LINK_FIELDS ? "使用 HTTPS 链接" : undefined,
          },
        );
      }
      if (title === "开场与底部展示")
        field(
          rows,
          "底部展示区跳转链接",
          state.config.site.labUrl,
          (value) => update("labUrl", value),
          { help: "使用 HTTPS 链接" },
        );
      if (title === "社交媒体")
        group.append(
          node(
            "p",
            "图标建议使用 PNG / WebP 透明背景图片，保持清晰边缘与一致尺寸。",
            "muted",
          ),
        );
      if (title === "微信二维码")
        group.append(
          node(
            "p",
            "请上传方形微信二维码原图，保留完整边距与清晰度；在前台预览确认可识别后再发布。",
            "muted",
          ),
        );
    }
    const identity = section("搜索与分享");
    field(
      identity,
      "网站描述",
      state.config.site.description,
      (v) => update("description", v),
      {
        multiline: true,
        maxLength: 500,
        help: "最多 500 字符。用于搜索和分享介绍，不改变 3D 场景文字。",
      },
    );
    const languageLabels = {
      "zh-CN": "简体中文",
      "zh-TW": "繁體中文",
      en: "English",
    };
    field(
      identity,
      "页面语言",
      state.config.site.language,
      (v) => update("language", v),
      {
        choices: window.SiteIdentity.LANGUAGES.map((value) => ({
          value,
          label: languageLabels[value],
        })),
        help: "声明页面内容的语言，不会自动翻译网站。",
      },
    );
    const social = field(
      identity,
      "分享图片",
      state.config.site.socialImage,
      (v) => update("socialImage", v),
      {
        pick: "image",
        help: "选择图片资源或填写 HTTPS 图片地址；留空则不使用默认分享图。",
      },
    );
    identity.append(
      button("清空分享图片", () => {
        social.value = "";
        update("socialImage", "");
      }),
    );
    identity.append(
      node(
        "p",
        "网站域名来自服务器 SITE_ORIGIN。修改先保存为草稿，发布后才影响公开页面。",
        "muted",
      ),
    );
    const songs = section("背景音乐");
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

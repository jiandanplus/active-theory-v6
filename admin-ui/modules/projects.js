"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.SiteAdminModules ||= {})["projects"] = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
function create(context) {
  const { state, crypto, node, button, confirmAction, dirty, field, heading, empty, render, newProject } = context;
  function projectsView() {
    heading(
      "作品管理",
      "保留原有作品结构，仅在保存和发布后应用修改。",
      button(
        "＋ 新建作品",
        () => {
          state.config.projects.unshift(newProject(crypto.randomUUID()));
          dirty();
          render();
        },
        "primary",
      ),
    );
    if (!state.config.projects.length)
      empty(context.content, "还没有作品，点击右上角创建。");
    state.config.projects.forEach((project, index) => {
      const d = node("details");
      d.open = index === 0;
      d.append(node("summary", project.name || "未命名作品"));
      const body = node("div", undefined, "detail-body"),
        grid = node("div", undefined, "grid");
      for (const [key, label, type] of [
        ["name", "作品名称"],
        ["slug", "作品标识（slug）"],
        ["tags", "标签"],
        ["clientName", "客户 / 所属"],
        ["completionDate", "完成日期", "date"],
        ["uiColor", "界面颜色（不含 #）"],
        ["priority", "排序权重", "number"],
        ["projectURL", "项目链接"],
        ["caseStudyURL", "案例链接"],
      ])
        field(
          grid,
          label,
          project[key],
          (v) => {
            project[key] =
              type === "date" ? (v ? v + "T12:00:00.000Z" : "") : v;
            dirty();
          },
          {
            type: type || "text",
            min: 0,
            max: 100,
            help:
              key === "slug"
                ? "唯一的小写字母、数字、短横线"
                : key === "tags"
                  ? "保留原有文本格式，多个标签可用逗号分隔"
                  : undefined,
          },
        );
      body.append(grid);
      field(
        body,
        "作品介绍",
        project.description,
        (v) => {
          project.description = v;
          dirty();
        },
        { multiline: true },
      );
      const media = node("div", undefined, "grid");
      for (const [key, label, kind] of [
        ["video", "作品视频", "video"],
        ["projectLogo", "作品标志", "image"],
        ["image", "作品图片", "image"],
      ])
        field(
          media,
          label + "地址",
          project[key]?.url || "",
          (v) => {
            project[key] = { ...(project[key] || {}), url: v };
            dirty();
          },
          { pick: kind },
        );
      field(
        media,
        "视频封面地址",
        project.video?.thumbnail || "",
        (v) => {
          project.video = { ...(project.video || {}), thumbnail: v };
          dirty();
        },
        { pick: "image" },
      );
      body.append(
        media,
        button(
          "删除此作品",
          async () => {
            if (
              !(await confirmAction(
                "从草稿删除「" +
                  project.name +
                  "」？保存后仍可从历史发布版本恢复。",
              ))
            )
              return;
            state.config.projects.splice(index, 1);
            dirty();
            render();
          },
          "danger",
        ),
      );
      d.append(body);
      context.content.append(d);
    });
  }
  return { projectsView };
}
return { create };
});

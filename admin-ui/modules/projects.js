import { newProject } from "./helpers.js";

// Functions this module adds to the shared context (see registry.js).
export const provides = ["projectsView"];

export function create(context) {
  const {
    state,
    crypto,
    node,
    button,
    confirmAction,
    dirty,
    field,
    heading,
    empty,
  } = context;
  // Remembered across redraws so editing one project never collapses others.
  const openIds = new Set();
  let query = "";
  function projectsView() {
    heading(
      "作品管理",
      "保留原有作品结构，仅在保存和发布后应用修改。",
      button(
        "＋ 新建作品",
        () => {
          const project = newProject(crypto.randomUUID());
          state.config.projects.unshift(project);
          openIds.add(project.id);
          query = "";
          search.value = "";
          dirty();
          draw(project.id);
        },
        "primary",
      ),
    );
    const toolbar = node("div", undefined, "toolbar"),
      search = node("input");
    search.type = "search";
    search.placeholder = "搜索作品名称、标识、客户或标签";
    search.setAttribute("aria-label", "搜索作品");
    search.value = query;
    search.addEventListener("input", () => {
      query = search.value;
      draw();
    });
    toolbar.append(search);
    const list = node("div");
    context.content.append(toolbar, list);
    if (!openIds.size && state.config.projects[0]?.id)
      openIds.add(state.config.projects[0].id);
    draw();
    // Only the list is rebuilt; the heading and search box stay in place.
    function draw(focusId) {
      list.replaceChildren();
      const words = query.trim().toLowerCase();
      const shown = state.config.projects.filter(
        (project) =>
          !words ||
          [project.name, project.slug, project.clientName, project.tags]
            .join(" ")
            .toLowerCase()
            .includes(words),
      );
      if (!state.config.projects.length)
        empty(list, "还没有作品，点击右上角创建。");
      else if (!shown.length) empty(list, "没有匹配“" + query + "”的作品。");
      for (const project of shown) {
        const d = projectCard(project);
        list.append(d);
        if (project.id === focusId) {
          d.scrollIntoView?.({ block: "nearest" });
          d.querySelector?.("input")?.focus();
        }
      }
    }
    function projectCard(project) {
      const d = node("details");
      d.open = openIds.has(project.id);
      d.addEventListener("toggle", () => {
        if (d.open) openIds.add(project.id);
        else openIds.delete(project.id);
      });
      const summary = node("summary", project.name || "未命名作品");
      d.append(summary);
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
            if (key === "name") summary.textContent = v || "未命名作品";
            dirty();
          },
          {
            type: type || "text",
            min: 0,
            max: 100,
            hexColor: key === "uiColor",
            help:
              key === "slug"
                ? "唯一的小写字母、数字、短横线"
                : key === "tags"
                  ? "保留原有文本格式，多个标签可用逗号分隔"
                  : key === "uiColor"
                    ? "6 位十六进制颜色，可直接用取色器选择"
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
            const index = state.config.projects.indexOf(project);
            if (index < 0) return;
            state.config.projects.splice(index, 1);
            openIds.delete(project.id);
            dirty();
            draw();
          },
          "danger",
        ),
      );
      d.append(body);
      return d;
    }
  }
  return { projectsView };
}

import {
  newProject,
  projectsByPriority,
  topPriority,
  moveProject,
} from "./helpers.js";

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
          // Listed first on the site as well as here.
          project.priority = topPriority(state.config.projects);
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
    const first = projectsByPriority(state.config.projects)[0];
    if (!openIds.size && first?.id) openIds.add(first.id);
    draw();
    // Only the list is rebuilt; the heading and search box stay in place.
    // `focus` is a project id (focus its first field) or {id, move} to keep
    // focus on that card's move button for repeated keyboard moves.
    function draw(focus) {
      list.replaceChildren();
      const words = query.trim().toLowerCase();
      const ordered = projectsByPriority(state.config.projects);
      const shown = ordered.filter(
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
        const item = projectCard(project, ordered);
        list.append(item.element);
        if (focus === project.id) {
          item.element.scrollIntoView?.({ block: "nearest" });
          item.card.querySelector?.("input")?.focus();
        } else if (focus?.id === project.id) {
          item.element.scrollIntoView?.({ block: "nearest" });
          // At the top or bottom that button is disabled; keep focus on
          // the card's other move button instead of losing it.
          const { up, down } = item.controls;
          const same = focus.move === "up" ? up : down;
          (same.disabled ? (same === up ? down : up) : same).focus();
        }
      }
    }
    function projectCard(project, ordered) {
      // Move controls sit beside the card so reordering works collapsed;
      // they are disabled while searching, where neighbours are hidden.
      const element = node("div", undefined, "project-item");
      const rank = ordered.indexOf(project);
      const controls = {};
      /** @type {[string, string, number][]} */
      const moves = [
        ["up", "上移", -1],
        ["down", "下移", 1],
      ];
      for (const [key, label, delta] of moves) {
        const control = button(label, () => {
          if (!moveProject(state.config.projects, project, delta)) return;
          dirty();
          draw({ id: project.id, move: key });
        });
        control.setAttribute(
          "aria-label",
          label + "「" + (project.name || "未命名作品") + "」",
        );
        control.disabled =
          !!query.trim() ||
          (delta < 0 ? rank === 0 : rank === ordered.length - 1);
        controls[key] = control;
      }
      const move = node("div", undefined, "project-move");
      move.append(
        node(
          "span",
          "第 " + (rank + 1) + " / " + ordered.length + " 位",
          "muted",
        ),
        controls.up,
        controls.down,
      );
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
        ["priority", "排序权重（越大越靠前）", "number"],
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
                    : key === "priority"
                      ? "0–100。一般用卡片旁的上移/下移调整；直接改数值后，列表在下次刷新时重新排序"
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
      element.append(move, d);
      return { element, card: d, controls };
    }
  }
  return { projectsView };
}

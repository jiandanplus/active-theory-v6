"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.SiteAdminModules ||= {})["scenes"] = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
function create(context) {
  const { state, node, dirty, field, heading, warning, empty } = context;
  const isTopLogo = (scene, f) => scene.id === "Home" && f.key === "INPUT_Config_8_ParticleTest_geometry";
  const displayLabel = (scene, f) => isTopLogo(scene, f) ? "顶部 3D Logo" : f.label || f.key;
  function scenesView() {
    heading("场景编辑", "按场景查找文案、材质与模型；保留已有参数，逐项调整。");
    const search = node("input");
    search.placeholder = "搜索文案、资源名或技术字段";
    search.setAttribute("aria-label", "搜索场景字段");
    const toolbar = node("div", undefined, "toolbar");
    toolbar.append(search);
    context.content.append(toolbar);
    warning(
      context.content,
      "原始 3D 位图字体仅包含有限字形。新增字符会经过验证，不在原字形图集中的字符将被拒绝；需要先重建字体图集才能使用。请在前台预览检查文案效果。",
    );
    const list = node("div");
    context.content.append(list);
    function draw() {
      list.replaceChildren();
      const q = search.value.trim().toLowerCase();
      for (const scene of state.config.scenes) {
        const fields = scene.fields.filter((f) =>
          (displayLabel(scene, f) + " " + f.label + " " + f.key + " " + f.value).toLowerCase().includes(q),
        );
        if (!fields.length) continue;
        const detail = node("details");
        detail.open = !!q || scene.id === "Home";
        detail.append(
          node("summary", scene.label + " · " + fields.length + " 项"),
        );
        const body = node("div", undefined, "detail-body");
        const groups = new Map();
        for (const f of fields) {
          const category =
            f.type === "text"
              ? "场景文案"
              : f.type === "number"
                ? "表现参数"
                : f.type === "geometry"
                  ? "3D 模型"
                  : "材质与纹理";
          if (!groups.has(category)) groups.set(category, []);
          groups.get(category).push(f);
        }
        for (const [label, items] of groups) {
          body.append(node("h3", label));
          const grid = node("div", undefined, "grid");
          for (const f of items) {
            const isObject = typeof f.value === "object";
            field(
              grid,
              displayLabel(scene, f),
              isObject ? JSON.stringify(f.value, null, 2) : f.value,
              (v) => {
                f.value = v;
                dirty();
              },
              {
                type: f.type === "number" ? "number" : "text",
                multiline: f.type === "text" || isObject,
                min: f.key === "__blackhole_size" ? 0.2 : 0,
                max: f.key.startsWith("__blackhole_") ? 3 : 10,
                step: "0.05",
                pick:
                  ["resource", "geometry"].includes(f.type) && !isObject
                    ? f.type
                    : undefined,
                readOnly: isObject,
                help: f.key,
                key: true,
                labelLink: isTopLogo(scene, f) ? {
                  text: "混元 3D 生成模型 ↗",
                  href: "https://3d.hunyuan.tencent.com/",
                } : undefined,
                description: isTopLogo(scene, f)
                  ? "可以在混元 3D 生成模型，下载 GLB 文件后上传到资源库；上传成功后会自动转换为 BIN。转换完成后选择模型，预览确认再发布。转换只使用模型网格，反射效果由现有场景材质控制。"
                  : undefined,
              },
            );
          }
          body.append(grid);
          if (label === "3D 模型")
            warning(
              body,
              "模型槽位使用引擎 BIN 格式。资源库上传 GLB 后会自动转换，失败时可手动重试；原始 GLB 不能直接选择。外部 BIN 地址可以填写，但兼容性与公开可访问性未经验证。",
            );
        }
        detail.append(body);
        list.append(detail);
      }
      if (!list.children.length) empty(list, "没有匹配的场景字段");
    }
    search.addEventListener("input", draw);
    draw();
  }
  return { scenesView };
}
return { create };
});

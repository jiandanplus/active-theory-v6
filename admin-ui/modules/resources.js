"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.SiteAdminModules ||= {})["resources"] = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
function create(context) {
  const { state, document, node, button, notify, confirmAction, api, field, panel, heading, warning, empty, load, preview, render, canPick, canConvert, resourcePreviewURL } = context;
  let resourceRequestSequence = 0;
  async function refreshResources(current = context.captureView?.() || (() => true)) {
    const sequence = ++resourceRequestSequence, epoch = state.sessionEpoch;
    const result = await api("/resources");
    if (sequence !== resourceRequestSequence || epoch !== state.sessionEpoch || !current()) return false;
    state.resources = result.resources;
    return true;
  }
  function conversionEditor(resource) {
    const current = context.captureView?.() || (() => true);
    const dialog = node("dialog", undefined, "modal"),
      head = node("div", undefined, "modal-head");
    head.append(
      node("h2", "转换 GLB 为引擎模型"),
      button("关闭", () => dialog.close()),
    );
    dialog.append(head);
    warning(
      dialog,
      "将创建单独的 BIN 资源，原始 GLB 会保留。转换使用模型网格数据，不保留原始材质、动画与骨骼。选择合适的尺寸，转换后在草稿中预览检查。",
    );
    let size = 0.8;
    field(dialog, "模型尺寸", size, (v) => (size = v), {
      type: "number",
      min: 0.1,
      max: 5,
      step: "0.1",
      help: "范围 0.1–5，默认 0.8",
    });
    dialog.append(
      button(
        "开始转换",
        async () => {
          if (!Number.isFinite(size) || size < 0.1 || size > 5)
            throw new Error("模型尺寸须在 0.1–5 之间");
          await api("/resources/" + resource.id + "/convert", "POST", { size });
          if (!current()) return;
          dialog.close();
          if (!await refreshResources(current)) return;
          notify("转换完成，可在模型槽位选择新 BIN 资源。");
          await render();
        },
        "primary",
      ),
    );
    showDialog(dialog);
  }
  function resourceCard(resource, select) {
    const current = context.captureView?.() || (() => true);
    const card = node("article", undefined, "resource-card"),
      preview = node("div", undefined, "resource-preview");
    if (resource.kind === "image") {
      const img = node("img");
      img.src = resourcePreviewURL(resource);
      img.alt = resource.name;
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      preview.append(img);
    } else if (["video", "audio"].includes(resource.kind)) {
      const media = node(resource.kind);
      media.src = resourcePreviewURL(resource);
      media.controls = true;
      media.preload = "none";
      preview.append(media);
    } else preview.textContent = "◇";
    const info = node("div", undefined, "resource-info");
    info.append(
      node("h3", resource.name),
      node(
        "span",
        { image: "图片", video: "视频", audio: "音频", model: "3D 模型" }[
          resource.kind
        ] || resource.kind,
        "badge",
      ),
      node(
        "small",
        resource.size
          ? (resource.size / 1024 / 1024).toFixed(1) + " MB"
          : "外部链接",
      ),
      node(
        "small",
        resource.accessibility === "verified"
          ? "本地资源可访问"
          : "公开可访问性尚未验证",
      ),
      node(
        "small",
        resource.kind === "model"
          ? resource.status === "ready"
            ? "已转换 · BIN 就绪"
            : "GLB / 外链模型 · 尚未转换"
          : resource.trashed
            ? "已移入回收站"
            : "",
      ),
    );
    const actions = node("div", undefined, "toolbar");
    if (select)
      actions.append(button("使用此资源", () => select(resource), "primary"));
    else {
      if (canConvert(resource))
        actions.append(
          button("转换为 BIN", async () => {
            conversionEditor(resource);
          }),
        );
      actions.append(
        button(resource.trashed ? "恢复资源" : "移入回收站", async () => {
          if (
            !resource.trashed &&
            !(await confirmAction(
              "将此资源移入回收站？被草稿或历史版本引用的资源不能回收。",
            ))
          )
            return;
          if (!current()) return;
          await api("/resources/" + resource.id, "PATCH", {
            trashed: !resource.trashed,
          });
          if (!current() || !await refreshResources(current)) return;
          await render();
        }),
      );
    }
    info.append(actions);
    card.append(preview, info);
    return card;
  }
  async function picker(kind, onSelect) {
    const current = context.captureView?.() || (() => true);
    if (!await refreshResources(current)) return;
    const dialog = node("dialog", undefined, "modal"),
      head = node("div", undefined, "modal-head");
    head.append(
      node(
        "h2",
        "选择" +
          {
            geometry: "已转换模型",
            audio: "音频",
            video: "视频",
            image: "图片",
            resource: "资源",
          }[kind],
      ),
      button("关闭", () => dialog.close()),
    );
    dialog.append(head);
    if (kind === "geometry")
      warning(
        dialog,
        "只有转换成功的 BIN 模型可用于此槽位。请先在资源库上传 GLB 到本地或已配置云存储，上传后会自动转换；失败时可手动重试。",
      );
    const grid = node("div", undefined, "resource-grid");
    for (const resource of state.resources.filter((r) => canPick(r, kind)))
      grid.append(
        resourceCard(resource, (r) => {
          if (!current()) return;
          onSelect(r.url);
          dialog.close();
        }),
      );
    if (!grid.children.length)
      empty(grid, "暂无可用资源。可先在资源库上传或添加外链。");
    dialog.append(grid);
    showDialog(dialog);
  }
  function showDialog(dialog) {
    if (context.mountDialog) context.mountDialog(dialog);
    else {
      document.body.append(dialog);
      dialog.addEventListener("close", () => dialog.remove());
      dialog.showModal();
    }
  }
  async function resourcesView() {
    const current = context.captureView?.() || (() => true);
    if (!await refreshResources(current)) return;
    heading(
      "资源库",
      "统一管理图片、视频、音乐与模型。上传和回收会立即保存，不需要发布。",
    );
    const upload = panel(context.content, "上传资源"),
      bar = node("div", undefined, "toolbar"),
      select = node("select");
    select.setAttribute("aria-label", "上传存储位置");
    for (const storage of state.storages) {
      const opt = node("option", storage.name);
      opt.value = storage.id;
      select.append(opt);
    }
    select.value = state.defaultStorage;
    const file = node("input");
    file.type = "file";
    file.accept =
      ".png,.jpg,.jpeg,.gif,.webp,.avif,.mp4,.webm,.mp3,.wav,.ogg,.opus,.glb";
    file.setAttribute("aria-label", "选择上传文件");
    const progress = node("progress", undefined, "progress");
    progress.max = 100;
    progress.value = 0;
    const status = node(
      "p",
      "图片 ≤ 25 MB · 音频 ≤ 100 MB · GLB ≤ 200 MB · 视频 ≤ 1 GB",
      "muted",
    );
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    bar.append(
      select,
      file,
      button(
        "开始上传",
        async () => {
          if (!file.files[0]) throw new Error("请先选择一个文件");
          file.disabled = true;
          select.disabled = true;
          try {
            const {resource} = await uploadFile(file.files[0], select.value, (percent) => {
              if (!current()) return;
              progress.value = percent;
              status.textContent =
                percent < 100
                  ? "上传中 · " + percent + "%"
                  : "上传完成，服务器正在验证文件…";
            });
            if (!current()) return;
            file.value = "";
            let converted = false, conversionError;
            if (resource && canConvert(resource)) {
              status.textContent = "GLB 上传成功，自动转换中，请稍候…";
              try {
                const result = await api("/resources/" + resource.id + "/convert", "POST", {size: 0.8});
                if (!current()) return;
                if (!result.resource || !canPick(result.resource, "geometry"))
                  throw new Error("转换响应无效，请刷新资源库确认结果后再手动重试");
                converted = true;
              } catch (error) {
                if (!current()) return;
                conversionError = error.message || "转换未能确认完成";
              }
            }
            status.textContent = conversionError ? "上传成功，自动转换失败" : converted ? "上传及自动转换完成" : "上传成功";
            if (!await refreshResources(current)) return;
            notify(conversionError
              ? "GLB 上传成功，但自动转换失败；原始 GLB 已保留，可在资源卡片点击“转换为 BIN”手动重试。原因：" + conversionError
              : converted ? "GLB 自动转换完成，原文件已保留。请选择生成的 BIN，预览确认后再发布。"
              : "资源已上传。需在内容中选用后保存、发布。", !!conversionError);
            await render();
          } finally {
            file.disabled = false;
            select.disabled = false;
          }
        },
        "primary",
      ),
    );
    upload.append(bar, progress, status);
    warning(
      upload,
      "文件类型由服务器校验。GLB 上传成功后会自动转换为 BIN（默认尺寸 0.8），原文件会保留；转换失败时可手动重试。仅转换网格，不保留原材质、动画与骨骼。S3 连接成功不代表访客可访问，云存储和外链仍需前台验证。",
    );
    const external = panel(context.content, "添加 HTTPS 外部链接"),
      form = node("form"),
      grid = node("div", undefined, "grid");
    let name = "",
      url = "",
      kind = "image";
    field(grid, "资源名称", "", (v) => (name = v));
    field(grid, "HTTPS 地址", "", (v) => (url = v));
    const k = node("select");
    k.setAttribute("aria-label", "外链资源类型");
    for (const [value, label] of [
      ["image", "图片"],
      ["video", "视频"],
      ["audio", "音频"],
      ["model", "模型（不可直接用于场景）"],
    ]) {
      const o = node("option", label);
      o.value = value;
      k.append(o);
    }
    k.addEventListener("change", () => (kind = k.value));
    grid.append(k);
    form.addEventListener("submit", (event) => event.preventDefault());
    form.append(
      grid,
      button("添加外链", async () => {
        await api("/resources/link", "POST", { name, url, kind });
        if (!current() || !await refreshResources(current)) return;
        notify("外链已添加，公开可访问性尚未验证。");
        await render();
      }),
    );
    external.append(form);
    const controls = node("div", undefined, "toolbar"),
      search = node("input"),
      filter = node("select");
    search.placeholder = "搜索资源名称";
    search.setAttribute("aria-label", "搜索资源");
    for (const [value, label] of [
      ["active", "资源库"],
      ["trash", "回收站"],
    ]) {
      const o = node("option", label);
      o.value = value;
      filter.append(o);
    }
    controls.append(search, filter);
    context.content.append(controls);
    const cards = node("div", undefined, "resource-grid");
    context.content.append(cards);
    function draw() {
      cards.replaceChildren();
      for (const r of state.resources.filter(
        (r) =>
          !!r.trashed === (filter.value === "trash") &&
          r.name.toLowerCase().includes(search.value.toLowerCase()),
      ))
        cards.append(resourceCard(r));
      if (!cards.children.length) empty(cards, "暂无匹配资源");
    }
    search.addEventListener("input", draw);
    filter.addEventListener("change", draw);
    draw();
  }
  function uploadFile(file, storageId, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/admin/resources/upload");
      xhr.setRequestHeader("X-CSRF-Token", state.csrf);
      xhr.withCredentials = true;
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable)
          onProgress(Math.round((e.loaded / e.total) * 100));
      });
      xhr.addEventListener("error", () =>
        reject(new Error("上传连接失败，请重试")),
      );
      xhr.addEventListener("abort", () => reject(new Error("上传已取消")));
      xhr.addEventListener("load", () => {
        let result;
        try {
          result = JSON.parse(xhr.responseText);
        } catch {
          reject(new Error("上传响应无效"));
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(result);
        else reject(new Error(result.error || "上传失败"));
      });
      const form = new FormData();
      form.append("storageId", storageId);
      form.append("file", file);
      xhr.send(form);
    });
  }
  return { refreshResources, conversionEditor, resourceCard, picker, resourcesView, uploadFile };
}
return { create };
});

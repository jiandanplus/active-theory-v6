"use strict";

function newProject(id) {
  return {
    id,
    name: "新作品",
    slug: "new-project-" + id.slice(0, 12),
    description: "",
    tags: "",
    clientName: "",
    completionDate: new Date().toISOString(),
    uiColor: "7058d8",
    priority: 0,
    projectURL: "",
    caseStudyURL: "",
    video: { url: "", thumbnail: "" },
    projectLogo: { url: "" },
    image: { url: "" },
  };
}
function canPick(resource, kind) {
  if (resource.trashed) return false;
  if (kind === "geometry")
    return (
      resource.kind === "model" &&
      resource.status === "ready" &&
      /^\/models\/[\w-]+\.bin$/.test(resource.url || "")
    );
  return kind === "resource"
    ? resource.kind !== "model"
    : resource.kind === kind;
}
function storageBody(values) {
  const body = { ...values, type: "s3" };
  for (const key of ["accessKeyId", "secretAccessKey", "sessionToken"])
    if (!body[key] || body[key] === "configured") delete body[key];
  return body;
}
function canConvert(resource) {
  return (
    resource.kind === "model" &&
    ["local", "s3"].includes(resource.source) &&
    resource.status !== "ready" &&
    !resource.trashed
  );
}
if (typeof module !== "undefined")
  module.exports = { newProject, canPick, storageBody, canConvert };
if (typeof document !== "undefined") startAdmin();

function startAdmin() {
  const app = document.getElementById("app");
  const state = {
    csrf: "",
    config: null,
    revision: 0,
    dirty: false,
    busy: false,
    section: "overview",
    resources: [],
    storages: [],
    defaultStorage: "local",
    overview: {},
  };
  const sections = [
    ["overview", "◈", "总览"],
    ["site", "▤", "网站设置"],
    ["scenes", "◇", "场景编辑"],
    ["projects", "▦", "作品管理"],
    ["resources", "▧", "资源库"],
    ["storage", "◫", "存储设置"],
    ["versions", "↶", "发布版本"],
    ["security", "⊙", "账号安全"],
  ];
  const labels = {
    title: "网站标题",
    navWork: "作品导航文字",
    navContact: "联系导航文字",
    contactTitle: "联系页标题",
    cityLax: "地点一",
    cityNyc: "地点二",
    cityAms: "地点三",
    email: "邮箱显示文字",
    emailLink: "联系邮箱",
    labUrl: "实验室链接",
  };
  let content, saveStatus, noticeTimer;
  function node(tag, text, cls) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  }
  function button(text, action, cls) {
    const b = node("button", text, cls);
    b.type = "button";
    b.addEventListener("click", () => run(action, b));
    return b;
  }
  function notify(message, error = false) {
    const el = document.getElementById("notice");
    el.textContent = message;
    el.className = "visible" + (error ? " error" : "");
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (el.className = ""), 6500);
  }
  function confirmAction(message) {
    return new Promise((resolve) => {
      const previous = document.activeElement,
        dialog = node("dialog", undefined, "modal");
      const title = node("h2", "确认操作"),
        description = node("p", message),
        actions = node("div", undefined, "form-actions");
      title.id = "confirmation-title-" + crypto.randomUUID();
      description.id = "confirmation-message-" + crypto.randomUUID();
      dialog.setAttribute("aria-labelledby", title.id);
      dialog.setAttribute("aria-describedby", description.id);
      let accepted = false;
      const cancel = button("取消", () => dialog.close());
      cancel.autofocus = true;
      const proceed = button(
        "确认继续",
        () => {
          accepted = true;
          dialog.close();
        },
        "primary",
      );
      actions.append(cancel, proceed);
      dialog.append(title, description, actions);
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        dialog.close();
      });
      dialog.addEventListener(
        "close",
        () => {
          dialog.remove();
          resolve(accepted);
          setTimeout(() => {
            if (previous?.isConnected) previous.focus();
          }, 0);
        },
        { once: true },
      );
      document.body.append(dialog);
      dialog.showModal();
      cancel.focus();
    });
  }
  async function run(action, b) {
    if (b) b.disabled = true;
    try {
      await action();
    } catch (e) {
      notify(e.message, true);
    } finally {
      if (b) b.disabled = false;
    }
  }
  async function api(path, method = "GET", body) {
    const res = await fetch("/api/admin" + path, {
      method,
      credentials: "same-origin",
      headers:
        method === "GET"
          ? {}
          : { "Content-Type": "application/json", "X-CSRF-Token": state.csrf },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({ error: "服务器响应无效" }));
    if (!res.ok) {
      if (res.status === 401 && state.config && path !== "/password") {
        state.config = null;
        login(true);
      }
      throw new Error(data.error || "请求失败");
    }
    return data;
  }
  function dirty() {
    state.dirty = true;
    updateStatus();
  }
  function updateStatus() {
    if (!saveStatus) return;
    saveStatus.replaceChildren(
      node("span", "", "status-dot"),
      node(
        "span",
        state.dirty ? "有未保存的修改" : "草稿已保存 · 修订 " + state.revision,
      ),
    );
    saveStatus.className = state.dirty ? "is-dirty" : "";
  }
  window.addEventListener("beforeunload", (event) => {
    if (state.dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  function field(parent, label, value, onChange, options = {}) {
    const wrap = node("div", undefined, "field"),
      id = "field-" + crypto.randomUUID();
    const l = node("label", label);
    l.htmlFor = id;
    wrap.append(l);
    const input = node(options.multiline ? "textarea" : "input");
    input.id = id;
    if (!options.multiline) input.type = options.type || "text";
    input.value =
      options.type === "date"
        ? String(value || "").slice(0, 10)
        : (value ?? "");
    if (options.min !== undefined) input.min = options.min;
    if (options.max !== undefined) input.max = options.max;
    if (options.step) input.step = options.step;
    if (options.placeholder) input.placeholder = options.placeholder;
    if (options.readOnly) input.readOnly = true;
    if (options.autocomplete) input.autocomplete = options.autocomplete;
    input.addEventListener("input", () =>
      onChange(options.type === "number" ? Number(input.value) : input.value),
    );
    if (options.pick) {
      const row = node("div", undefined, "field-row");
      row.append(
        input,
        button("选择资源", () =>
          picker(options.pick, (value) => {
            input.value = value;
            onChange(value);
          }),
        ),
      );
      wrap.append(row);
    } else wrap.append(input);
    if (options.help)
      wrap.append(node("small", options.help, options.key ? "field-key" : ""));
    parent.append(wrap);
    return input;
  }
  function panel(parent, title) {
    const p = node("section", undefined, "panel");
    if (title) p.append(node("h2", title));
    parent.append(p);
    return p;
  }
  function heading(title, description, action) {
    const h = node("div", undefined, "page-heading"),
      left = node("div");
    left.append(
      node("div", "CONTENT STUDIO", "eyebrow"),
      node("h1", title),
      node("p", description, "muted"),
    );
    h.append(left);
    if (action) h.append(action);
    content.append(h);
  }
  function warning(parent, text) {
    parent.append(node("div", text, "warning"));
  }
  function empty(parent, text) {
    parent.append(node("p", text, "empty"));
  }
  function check(parent, text, checked, onChange) {
    const row = node("div", undefined, "check-row"),
      input = node("input"),
      label = node("label", text);
    input.type = "checkbox";
    input.checked = checked;
    input.id = "check-" + crypto.randomUUID();
    label.htmlFor = input.id;
    input.addEventListener("change", () => onChange(input.checked));
    row.append(input, label);
    parent.append(row);
  }
  async function load() {
    const [cfg, res, stores, overview] = await Promise.all([
      api("/config"),
      api("/resources"),
      api("/storages"),
      api("/overview"),
    ]);
    state.config = cfg.config;
    state.revision = cfg.revision;
    state.resources = res.resources;
    state.storages = stores.storages;
    state.defaultStorage = stores.defaultStorage;
    state.overview = overview;
    state.dirty = false;
    shell();
    await render();
  }
  function login(initialized) {
    app.replaceChildren();
    const wrap = node("main", undefined, "login-wrap"),
      card = node("section", undefined, "login-card");
    card.append(
      node("div", "Studio / 管理工作台", "brand"),
      node("div", "PRIVATE ACCESS", "eyebrow"),
      node("h1", initialized ? "欢迎回来" : "初始化管理员"),
      node(
        "p",
        initialized
          ? "登录以管理你的 3D 网站。修改先保存为草稿，发布后才会出现在公开网站。"
          : "尚未设置管理员。请在服务器终端执行下方命令，按提示创建唯一的管理员账号。",
        "muted",
      ),
    );
    if (!initialized) {
      card.append(
        node("code", "npm run admin:init"),
        node("p", "没有默认账号或密码。初始化完成后刷新此页面。", "muted"),
        button("重新检查", init, "primary"),
      );
    } else {
      const form = node("form");
      let username = "",
        password = "";
      const u = field(form, "管理员账号", "", (v) => (username = v), {
        autocomplete: "username",
      });
      u.required = true;
      const p = field(form, "密码", "", (v) => (password = v), {
        type: "password",
        autocomplete: "current-password",
      });
      p.required = true;
      const error = node("p", "", "login-error");
      error.setAttribute("role", "alert");
      const submit = node("button", "登录工作台", "primary");
      submit.type = "submit";
      form.append(error, submit);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        submit.disabled = true;
        error.textContent = "";
        try {
          const data = await api("/login", "POST", { username, password });
          state.csrf = data.csrfToken;
          await load();
        } catch (e) {
          error.textContent = e.message;
          p.value = "";
          password = "";
          p.focus();
        } finally {
          submit.disabled = false;
        }
      });
      card.append(form);
    }
    wrap.append(card);
    app.append(wrap);
  }
  function shell() {
    app.replaceChildren();
    const root = node("div", undefined, "shell"),
      side = node("aside", undefined, "sidebar");
    side.append(
      node("div", "Studio /", "brand"),
      node("div", "PERSONAL WEBSITE", "subtitle"),
    );
    const nav = node("nav", undefined, "nav");
    nav.setAttribute("aria-label", "管理导航");
    for (const [id, icon, label] of sections) {
      const b = button("", async () => {
        state.section = id;
        await render();
      });
      b.dataset.section = id;
      b.append(node("span", icon, "nav-icon"), node("span", label));
      nav.append(b);
    }
    side.append(nav);
    const foot = node("div", undefined, "sidebar-foot");
    foot.append(
      node("div", "单管理员 · 私人工作空间"),
      button("退出登录", logout),
    );
    side.append(foot);
    const workspace = node("div", undefined, "workspace"),
      top = node("header", undefined, "topbar");
    top.append(node("span", "工作空间 / 网站管理"));
    const link = node("a", "访问公开网站 ↗");
    link.href = "/";
    link.target = "_blank";
    link.rel = "noopener";
    top.append(link, button("退出", logout));
    content = node("main", undefined, "content");
    workspace.append(top, content);
    root.append(side, workspace);
    app.append(root);
    const bar = node("footer", undefined, "savebar");
    saveStatus = node("div");
    const actions = node("div", undefined, "savebar-actions");
    actions.append(
      button("保存草稿", save, "primary"),
      button("预览草稿 ↗", preview),
      button("发布网站", publish),
    );
    bar.append(saveStatus, actions);
    app.append(bar);
    updateStatus();
  }
  async function logout() {
    if (
      state.dirty &&
      !(await confirmAction("有未保存的修改。退出登录将丢弃这些修改，继续吗？"))
    )
      return;
    await api("/logout", "POST", {});
    state.config = null;
    state.dirty = false;
    state.csrf = "";
    await init();
  }
  async function save() {
    if (state.busy) throw new Error("正在处理，请稍后");
    state.busy = true;
    try {
      const saved = JSON.stringify(state.config);
      const data = await api("/config", "PUT", {
        config: JSON.parse(saved),
        revision: state.revision,
      });
      state.revision = data.revision;
      state.dirty = JSON.stringify(state.config) !== saved;
      updateStatus();
      notify(
        state.dirty
          ? "草稿已保存；保存期间的新修改尚未保存。"
          : "草稿已保存。公开网站尚未改变。",
      );
    } finally {
      state.busy = false;
    }
  }
  async function preview() {
    if (state.dirty) await save();
    if (state.dirty) throw new Error("保存期间内容已修改，请再次保存后预览");
    const data = await api("/preview", "POST", { revision: state.revision });
    const link = node("a", "打开草稿预览 ↗");
    link.href = data.url;
    link.target = "_blank";
    link.rel = "noopener";
    const p = panel(content, "草稿预览已准备");
    p.append(link, node("p", "这是私有草稿预览，未发布到公开网站。", "muted"));
    p.scrollIntoView({ behavior: "smooth" });
    window.open(data.url, "_blank", "noopener");
  }
  async function publish() {
    if (
      !(await confirmAction(
        "确认发布当前草稿？网站的文案、作品和资源将在公开网站生效。只读 S3 测试不验证公开 URL 或 CORS；请先在前台预览资源，检查加载与跨域访问。",
      ))
    )
      return;
    if (state.dirty) await save();
    if (state.dirty) throw new Error("保存期间内容已修改，请再次保存后发布");
    const result = await api("/publish", "POST", { revision: state.revision });
    state.overview.published = result.version;
    notify("发布成功 · 版本 " + result.version);
    if (state.section === "versions" || state.section === "overview")
      await render();
  }
  async function render() {
    if (!state.config) return;
    content.replaceChildren();
    for (const b of document.querySelectorAll("[data-section]")) {
      const active = b.dataset.section === state.section;
      b.classList.toggle("active", active);
      if (active) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    }
    const views = {
      overview: overviewView,
      site: siteView,
      scenes: scenesView,
      projects: projectsView,
      resources: resourcesView,
      storage: storageView,
      versions: versionsView,
      security: securityView,
    };
    await views[state.section]();
  }
  async function overviewView() {
    const o = await api("/overview");
    state.overview = o;
    heading("网站总览", "从内容到发布，在这里管理每一个细节。");
    const metrics = node("div", undefined, "metrics");
    for (const [label, value, note] of [
      ["当前发布版本", "v" + o.published, "公开网站正在使用"],
      ["草稿修订", state.revision, "保存与发布互不影响"],
      ["作品数量", state.config.projects.length, "展示在作品空间"],
      ["资源数量", o.resources, "图片 / 视频 / 音乐 / 模型"],
    ]) {
      const p = panel(metrics);
      p.classList.add("metric");
      p.append(
        node("small", label),
        node("div", String(value), "number"),
        node("small", note),
      );
    }
    content.append(metrics);
    const grid = node("div", undefined, "grid");
    content.append(grid);
    const guide = panel(grid, "你的内容工作流");
    guide.append(
      node("p", "编辑内容 → 保存草稿 → 预览检查 → 发布网站"),
      node(
        "p",
        "保存只更新管理草稿；公开页面始终读取已发布版本。你可以在「发布版本」将历史版本恢复为草稿，再检查并发布。",
        "muted",
      ),
    );
    const storage = panel(grid, "资源与存储");
    storage.append(
      node(
        "p",
        "默认上传位置：" +
          (state.storages.find((s) => s.id === o.defaultStorage)?.name ||
            o.defaultStorage),
      ),
    );
    warning(
      storage,
      o.masterKeyConfigured
        ? "云存储凭证由服务器加密保存。只读连接测试不验证公开 URL 或 CORS，请在前台预览检查资源。"
        : "尚未配置 SITE_MASTER_KEY。可以使用本地存储；配置 S3 前需先设置服务器加密密钥。",
    );
    const audit = panel(content, "最近操作");
    if (!o.audit.length) empty(audit, "尚无操作记录");
    else
      for (const a of o.audit)
        audit.append(
          node(
            "p",
            new Date(a.created).toLocaleString("zh-CN") +
              " · " +
              a.action +
              " · " +
              (a.actor || "管理员"),
            "muted",
          ),
        );
  }
  function siteView() {
    heading("网站设置", "维护网站标题、导航与联系信息。");
    const p = panel(content, "基本信息"),
      grid = node("div", undefined, "grid");
    p.append(grid);
    for (const [key, value] of Object.entries(state.config.site))
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
    const songs = panel(content, "背景音乐");
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
  function scenesView() {
    heading("场景编辑", "按场景查找文案、材质与模型；保留已有参数，逐项调整。");
    const search = node("input");
    search.placeholder = "搜索文案、资源名或技术字段";
    search.setAttribute("aria-label", "搜索场景字段");
    const toolbar = node("div", undefined, "toolbar");
    toolbar.append(search);
    content.append(toolbar);
    warning(
      content,
      "原始 3D 位图字体仅包含有限字形。新增字符会经过验证，不在原字形图集中的字符将被拒绝；需要先重建字体图集才能使用。请在前台预览检查文案效果。",
    );
    const list = node("div");
    content.append(list);
    function draw() {
      list.replaceChildren();
      const q = search.value.trim().toLowerCase();
      for (const scene of state.config.scenes) {
        const fields = scene.fields.filter((f) =>
          (f.label + " " + f.key + " " + f.value).toLowerCase().includes(q),
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
              f.label || f.key,
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
              },
            );
          }
          body.append(grid);
          if (label === "3D 模型")
            warning(
              body,
              "模型槽位使用引擎 BIN 格式。上传 GLB 后请先在资源库转换；原始 GLB 不能直接选择。外部 BIN 地址可以填写，但兼容性与公开可访问性未经验证。",
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
      empty(content, "还没有作品，点击右上角创建。");
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
      content.append(d);
    });
  }
  async function refreshResources() {
    state.resources = (await api("/resources")).resources;
  }
  function conversionEditor(resource) {
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
          dialog.close();
          await refreshResources();
          await render();
          notify("转换完成，可在模型槽位选择新 BIN 资源。");
        },
        "primary",
      ),
    );
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
  }
  function resourceCard(resource, select) {
    const card = node("article", undefined, "resource-card"),
      preview = node("div", undefined, "resource-preview");
    if (resource.kind === "image") {
      const img = node("img");
      img.src = resource.url;
      img.alt = resource.name;
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      preview.append(img);
    } else if (["video", "audio"].includes(resource.kind)) {
      const media = node(resource.kind);
      media.src = resource.url;
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
          await api("/resources/" + resource.id, "PATCH", {
            trashed: !resource.trashed,
          });
          await refreshResources();
          await render();
        }),
      );
    }
    info.append(actions);
    card.append(preview, info);
    return card;
  }
  async function picker(kind, onSelect) {
    await refreshResources();
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
        "只有转换成功的 BIN 模型可用于此槽位。请先在资源库上传 GLB 到本地或已配置云存储并转换。",
      );
    const grid = node("div", undefined, "resource-grid");
    for (const resource of state.resources.filter((r) => canPick(r, kind)))
      grid.append(
        resourceCard(resource, (r) => {
          onSelect(r.url);
          dialog.close();
        }),
      );
    if (!grid.children.length)
      empty(grid, "暂无可用资源。可先在资源库上传或添加外链。");
    dialog.append(grid);
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
  }
  async function resourcesView() {
    await refreshResources();
    heading(
      "资源库",
      "统一管理图片、视频、音乐与模型。上传和回收会立即保存，不需要发布。",
    );
    const upload = panel(content, "上传资源"),
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
            await uploadFile(file.files[0], select.value, (percent) => {
              progress.value = percent;
              status.textContent =
                percent < 100
                  ? "上传中 · " + percent + "%"
                  : "上传完成，服务器正在验证文件…";
            });
            status.textContent = "上传成功";
            file.value = "";
            await refreshResources();
            await render();
            notify("资源已上传。需在内容中选用后保存、发布。");
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
      "文件类型由服务器校验。S3 连接成功不代表访客可访问；云存储和外链资源仍需检查公开地址。GLB 必须转换后才能用于场景模型。",
    );
    const external = panel(content, "添加 HTTPS 外部链接"),
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
        await refreshResources();
        await render();
        notify("外链已添加，公开可访问性尚未验证。");
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
    content.append(controls);
    const cards = node("div", undefined, "resource-grid");
    content.append(cards);
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
  async function storageView() {
    const result = await api("/storages");
    state.storages = result.storages;
    state.defaultStorage = result.defaultStorage;
    heading(
      "存储设置",
      "本地优先，或连接兼容 S3 的对象存储。存储操作会立即保存。",
    );
    warning(
      content,
      state.overview.masterKeyConfigured
        ? "凭证加密存储在服务器端。编辑时凭证保持空白；留空保留已配置值，不会回显原值。"
        : "配置 S3 前，请在服务器设置 64 位十六进制 SITE_MASTER_KEY 并重启。没有密钥时仍可正常使用本地存储。",
    );
    for (const store of state.storages) {
      const p = panel(
        content,
        store.name + (state.defaultStorage === store.id ? " · 默认" : ""),
      );
      p.append(
        node(
          "p",
          store.type === "local"
            ? "资源保存在服务器本地，需要纳入备份。"
            : store.bucket + " · " + store.endpoint,
          "muted",
        ),
      );
      const actions = node("div", undefined, "toolbar");
      actions.append(
        button("只读连接测试", async () => {
          const result = await api(
            "/storages/" + store.id + "/test",
            "POST",
            {},
          );
          notify(
            result.ok
              ? "连接测试通过（只读），不验证公开 URL 或 CORS。请在前台预览资源，检查加载与跨域访问。"
              : "连接测试未通过",
          );
        }),
      );
      if (state.defaultStorage !== store.id)
        actions.append(
          button("设为默认", async () => {
            if (store.id === "local")
              await api("/storages", "POST", { id: "local", isDefault: true });
            else
              await api("/storages", "POST", {
                ...storageBody(store),
                isDefault: true,
              });
            await render();
            notify("默认上传位置已更新。");
          }),
        );
      if (store.type === "s3")
        actions.append(button("编辑配置", () => storageEditor(store)));
      p.append(actions);
    }
    content.append(
      button("＋ 添加 S3 存储", () => storageEditor({}), "primary"),
    );
  }
  function storageEditor(existing) {
    const dialog = node("dialog", undefined, "modal"),
      head = node("div", undefined, "modal-head");
    head.append(
      node("h2", existing.id ? "编辑 S3 存储" : "添加 S3 存储"),
      button("关闭", () => dialog.close()),
    );
    dialog.append(head);
    warning(
      dialog,
      "凭证输入框始终为空。编辑已有配置时，留空保留旧凭证。使用最小权限凭证；连接测试为只读，不验证公开资源 URL 或 CORS；管理员需在前台预览检查资源加载与跨域访问。已有资源的存储位置不能更改。",
    );
    const values = {
      id: existing.id,
      name: existing.name || "",
      endpoint: existing.endpoint || "",
      region: existing.region || "us-east-1",
      bucket: existing.bucket || "",
      prefix: existing.prefix || "",
      publicBaseUrl: existing.publicBaseUrl || "",
      forcePathStyle: !!existing.forcePathStyle,
      isDefault: false,
    };
    const form = node("form"),
      grid = node("div", undefined, "grid");
    for (const [key, label] of [
      ["name", "配置名称"],
      ["endpoint", "S3 Endpoint（HTTPS）"],
      ["region", "区域"],
      ["bucket", "Bucket"],
      ["prefix", "对象前缀"],
      ["publicBaseUrl", "公开资源根地址（HTTPS）"],
      ["accessKeyId", "Access Key ID"],
      ["secretAccessKey", "Secret Access Key"],
      ["sessionToken", "Session Token（可选）"],
    ])
      field(grid, label, values[key] || "", (v) => (values[key] = v), {
        type: ["accessKeyId", "secretAccessKey", "sessionToken"].includes(key)
          ? "password"
          : "text",
        autocomplete: "off",
        placeholder:
          ["accessKeyId", "secretAccessKey", "sessionToken"].includes(key) &&
          existing.id
            ? "留空保留已配置值"
            : undefined,
      });
    form.append(grid);
    check(
      form,
      "使用 Path-style 地址",
      values.forcePathStyle,
      (v) => (values.forcePathStyle = v),
    );
    check(form, "设为默认上传位置", false, (v) => (values.isDefault = v));
    const actions = node("div", undefined, "form-actions");
    actions.append(
      button("取消", () => dialog.close()),
      button(
        "保存存储配置",
        async () => {
          await api("/storages", "POST", storageBody(values));
          dialog.close();
          await render();
          notify("存储配置已保存，请执行连接测试。");
        },
        "primary",
      ),
    );
    form.append(actions);
    dialog.append(form);
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
  }
  async function versionsView() {
    const data = await api("/versions");
    heading(
      "发布版本",
      "每次发布都有快照。恢复只更新草稿，不会立即替换公开网站。",
    );
    const p = panel(content, "版本历史");
    if (!data.versions.length) {
      empty(p, "尚无发布版本");
      return;
    }
    const table = node("table"),
      head = node("tr");
    for (const label of ["版本", "发布时间", "状态", "操作"])
      head.append(node("th", label));
    const thead = node("thead");
    thead.append(head);
    table.append(thead);
    const body = node("tbody");
    for (const v of data.versions) {
      const row = node("tr");
      row.append(
        node("td", "v" + v.id),
        node("td", new Date(v.created).toLocaleString("zh-CN")),
        node("td", v.id === data.published ? "当前公开版本" : "历史版本"),
      );
      const td = node("td");
      td.append(
        button("恢复到草稿", async () => {
          if (
            !(await confirmAction(
              "将版本 v" +
                v.id +
                " 恢复为草稿？" +
                (state.dirty ? "未保存的修改会丢失。" : "") +
                "公开网站不会改变。",
            ))
          )
            return;
          await api("/versions/" + v.id + "/restore", "POST", {
            revision: state.revision,
          });
          const cfg = await api("/config");
          state.config = cfg.config;
          state.revision = cfg.revision;
          state.dirty = false;
          updateStatus();
          notify("已恢复为草稿。预览检查后可重新发布。");
          await render();
        }),
      );
      row.append(td);
      body.append(row);
    }
    table.append(body);
    p.append(table);
  }
  function securityView() {
    heading("账号安全", "保护唯一管理员账号，定期更新密码。");
    const p = panel(content, "修改密码");
    warning(
      p,
      "修改密码成功后，当前登录和其他已有会话都会失效。请使用新密码重新登录。",
    );
    const form = node("form");
    let currentPassword = "",
      newPassword = "";
    const current = field(form, "当前密码", "", (v) => (currentPassword = v), {
        type: "password",
        autocomplete: "current-password",
      }),
      next = field(form, "新密码", "", (v) => (newPassword = v), {
        type: "password",
        autocomplete: "new-password",
        help: "至少 12 位，建议使用密码管理器生成独立密码。",
      });
    current.required = true;
    next.required = true;
    next.minLength = 12;
    const submit = node("button", "更新密码", "primary");
    submit.type = "submit";
    form.append(submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      run(async () => {
        if (
          state.dirty &&
          !(await confirmAction(
            "修改密码会退出登录，未保存修改将丢失。继续吗？",
          ))
        )
          return;
        await api("/password", "POST", { currentPassword, newPassword });
        state.config = null;
        state.dirty = false;
        state.csrf = "";
        notify("密码已更新，请重新登录。");
        await init();
      }, submit);
    });
    p.append(form);
  }
  async function init() {
    try {
      const session = await api("/session");
      state.csrf = session.csrfToken || "";
      if (session.authenticated) await load();
      else login(session.initialized);
    } catch (e) {
      app.replaceChildren(
        node("p", e.message, "loading"),
        button("重试", init),
      );
    }
  }
  init();
}

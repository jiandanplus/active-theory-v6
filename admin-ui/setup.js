"use strict";
function setupView(status, authorized) {
  if (status === "installed") return "login";
  if (status !== "uninstalled") return "maintenance";
  return authorized ? "database" : "authorize";
}
function mount({ root, onInstalled }) {
  const state = {
    status: "unavailable",
    csrf: "",
    mode: "demo",
    report: null,
    digest: "",
    username: "",
    busy: false,
  };
  let card, live;
  const el = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text !== undefined) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  function clearSecrets() {
    root.querySelectorAll("[data-secret]").forEach((input) => {
      input.value = "";
      input.type = "password";
    });
  }
  function message(text) {
    live.textContent = text;
  }
  function page(title, step) {
    clearSecrets();
    root.replaceChildren();
    const wrap = el("main", undefined, "login-wrap setup-wrap");
    card = el("section", undefined, "login-card setup-card");
    const heading = el("h1", title);
    heading.tabIndex = -1;
    card.append(
      el("div", "Studio / 首次安装", "brand"),
      el("div", step, "eyebrow"),
      heading,
    );
    live = el("p", "", "setup-status");
    live.setAttribute("aria-live", "polite");
    live.setAttribute("role", "status");
    card.append(live);
    wrap.append(card);
    root.append(wrap);
    heading.focus();
  }
  function button(parent, text, action, primary = false) {
    const b = el("button", text, primary ? "primary" : "");
    b.type = "button";
    b.addEventListener("click", () => run(action));
    parent.append(b);
    return b;
  }
  function input(
    parent,
    label,
    { secret = false, value = "", autocomplete = "off" } = {},
  ) {
    const wrap = el("div", undefined, "field");
    const n = el("input");
    n.id = "setup-" + crypto.randomUUID();
    n.type = secret ? "password" : "text";
    n.value = value;
    n.autocomplete = autocomplete;
    n.required = true;
    const l = el("label", label);
    l.htmlFor = n.id;
    wrap.append(l, n);
    if (secret) {
      n.dataset.secret = "true";
      const toggle = el("button", "显示");
      toggle.type = "button";
      toggle.setAttribute("aria-pressed", "false");
      toggle.setAttribute("aria-label", "显示或隐藏" + label);
      toggle.addEventListener("click", () => {
        const show = n.type === "password";
        n.type = show ? "text" : "password";
        toggle.textContent = show ? "隐藏" : "显示";
        toggle.setAttribute("aria-pressed", String(show));
      });
      wrap.append(toggle);
    }
    parent.append(wrap);
    return n;
  }
  function form(text, action) {
    const f = el("form"),
      b = el("button", text, "primary");
    b.type = "submit";
    f.addEventListener("submit", (event) => {
      event.preventDefault();
      run(() => action(f));
    });
    f.append(b);
    card.append(f);
    return f;
  }
  async function request(path, body) {
    const response = await fetch("/api/setup" + path, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers:
        body === undefined
          ? {}
          : { "Content-Type": "application/json", "X-CSRF-Token": state.csrf },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response
      .json()
      .catch(() => ({ error: "服务器响应无效" }));
    if (!response.ok && path !== "/status") {
      const error = new Error(data.error || "请求失败");
      error.status = response.status;
      throw error;
    }
    return data;
  }
  async function run(action) {
    if (state.busy) return;
    state.busy = true;
    root.querySelectorAll("button").forEach((b) => {
      b.disabled = true;
    });
    try {
      await action();
    } catch (error) {
      clearSecrets();
      if (error.status === 401) {
        state.csrf = "";
        state.report = null;
        authorize();
      } else if (error.status === 409) {
        state.report = null;
        state.digest = "";
        try {
          await refresh();
        } catch {
          maintenance("unavailable");
        }
      } else if (error.status >= 500 || !error.status) {
        state.report = null;
        state.digest = "";
        maintenance("unavailable");
      }
      message(
        error.message +
          (error.status === 409
            ? "；请重新检查状态和预检，不会自动重放安装。"
            : ""),
      );
    } finally {
      state.busy = false;
      root.querySelectorAll("button").forEach((b) => {
        b.disabled = false;
      });
    }
  }
  function maintenance(status) {
    page("暂时无法安装或登录", "维护状态");
    const reasons = {
      upgrade_required:
        "网站数据库需要升级。请由服务器管理员备份后在维护窗口运行 npm run db:migrate；这里不会重新安装或创建管理员。",
      unconfigured:
        "服务器尚未配置 DATABASE_URL。请由管理员在服务器端配置 PostgreSQL 18 后重试。",
      incompatible:
        "数据库版本或结构不兼容。仅支持 PostgreSQL 18，请由管理员检查或显式升级。",
      unavailable:
        "数据库连接或查询暂时不可用。不会将故障当作新站点，也不会创建管理员。",
    };
    card.append(el("p", reasons[status] || reasons.unavailable, "muted"));
    button(card, "重新检查", refresh, true);
  }
  async function refresh() {
    clearSecrets();
    const data = await request("/status");
    state.status = data.state;
    const view = setupView(state.status, Boolean(state.csrf));
    if (view === "login") {
      state.csrf = "";
      state.report = null;
      await onInstalled();
    } else if (view === "maintenance") maintenance(state.status);
    else if (view === "authorize") authorize();
    else await database();
  }
  function authorize() {
    page("授权首次安装", "1 / 5 · 安装授权");
    card.append(
      el(
        "p",
        "输入服务器管理员提供的 SETUP_TOKEN。授权有效期为 15 分钟，令牌只用于本次请求，不会保存。",
        "muted",
      ),
    );
    let token;
    const f = form("验证安装令牌", async () => {
      const value = token.value;
      token.value = "";
      const data = await request("/authorize", { token: value });
      state.csrf = data.csrfToken;
      await database();
    });
    token = input(f, "安装令牌", { secret: true });
    f.append(f.firstChild);
    token.focus();
  }
  async function database() {
    const data = await request("/database");
    page("检查数据库", "2 / 5 · 数据库检测");
    card.append(
      el("p", "连接信息来自服务器配置，页面不接受任意数据库地址。", "muted"),
    );
    card.append(
      el(
        "p",
        "目标：" +
          (data.target.host || "未知") +
          " / " +
          (data.target.database || "未知"),
      ),
    );
    card.append(
      el(
        "p",
        "PostgreSQL 18：" +
          (data.permissions.supportedVersion ? "兼容" : "不兼容"),
      ),
    );
    card.append(
      el(
        "p",
        "创建应用结构权限：" +
          (data.permissions.createSchema ? "通过" : "不足"),
      ),
    );
    if (data.permissions.supportedVersion && data.permissions.createSchema)
      button(card, "选择内容来源", source, true);
    button(card, "重新检测", database);
  }
  function source() {
    page("内容来源与预检", "3 / 5 · 内容来源");
    card.append(
      el(
        "p",
        "只读取服务器端配置的来源，不上传任意路径；迁移不会自动上传媒体或删除原文件。",
        "muted",
      ),
    );
    const label = el("label", "内容来源"),
      select = el("select");
    select.id = "setup-mode";
    label.htmlFor = select.id;
    for (const [value, text] of [
      ["demo", "内置个人主页示例（推荐）"],
      ["empty", "空白站点"],
      ["bundle", "服务器内容包"],
      ["legacy", "旧站迁移（只读）"],
    ]) {
      const option = el("option", text);
      option.value = value;
      select.append(option);
    }
    select.value = state.mode;
    select.addEventListener("change", () => {
      state.mode = select.value;
      state.report = null;
      state.digest = "";
      source();
    });
    card.append(label, select);
    if (state.mode === "demo")
      card.append(el("p", "包含原创示例图形和作品文案；安装后可在后台修改，再选择内置模板并预览、发布。", "muted"));
    if (state.mode === "empty")
      card.append(
        el(
          "p",
          "空白站点仅建立后台数据；没有完整运行包和必需资源时，公开视觉网站仍不可运行。",
          "warning",
        ),
      );
    button(
      card,
      "执行预检",
      async () => {
        const data = await request("/preflight", { mode: state.mode });
        state.report = data.report;
        state.digest = data.digest;
        source();
      },
      true,
    );
    if (state.report) {
      const report = state.report;
      card.append(el("h2", "预检报告"));
      for (const [key, title] of [
        ["missingRequired", "缺少必需资源"],
        ["warnings", "警告"],
        ["credentialsUnavailable", "不可用的存储凭证"],
      ]) {
        card.append(el("h3", title));
        const list = el("ul");
        for (const item of report[key] || [])
          list.append(el("li", String(item)));
        if (!list.childNodes.length) list.append(el("li", "无"));
        card.append(list);
      }
      card.append(
        el(
          "p",
          "导入数量：" +
            Object.entries(report.counts || {})
              .map(([key, value]) => key + " " + value)
              .join("，"),
        ),
      );
      if (report.missingRequired?.length)
        card.append(
          el(
            "p",
            "安装后台不代表公开网站已就绪。缺失资源必须后续补齐并验证，不能保证视觉网站运行。",
            "warning",
          ),
        );
      button(
        card,
        report.hasAdmin ? "保留原管理员并继续" : "设置管理员",
        account,
        true,
      );
    }
    button(card, "返回数据库检测", database);
  }
  function account() {
    if (!state.report || !state.digest) return source();
    page(
      state.report.hasAdmin ? "保留原管理员" : "创建唯一管理员",
      "4 / 5 · 管理员",
    );
    if (state.report.hasAdmin)
      card.append(
        el(
          "p",
          "旧站已有管理员，将保留原账号和密码；不创建或替换账号。",
          "muted",
        ),
      );
    let username, password, repeat;
    const f = form("确认安装", async () => {
      if (!state.report || !state.digest) return source();
      let credentials;
      if (!state.report.hasAdmin) {
        state.username = username.value;
        if (password.value !== repeat.value) {
          message("两次密码不一致，请重新输入。");
          clearSecrets();
          password.focus();
          return;
        }
        credentials = { username: username.value, password: password.value };
      }
      clearSecrets();
      await request("/install", {
        mode: state.mode,
        digest: state.digest,
        ...(credentials ? { account: credentials } : {}),
      });
      state.csrf = "";
      state.report = null;
      state.digest = "";
      page("后台安装完成", "5 / 5 · 完成");
      card.append(
        el(
          "p",
          "数据库与管理员已保存。请使用管理员账号登录；公开网站是否可运行仍取决于预检资源和运行包，不会自动发布。",
          "muted",
        ),
      );
      button(card, "进入管理员登录", onInstalled, true);
    });
    if (!state.report.hasAdmin) {
      username = input(f, "管理员账号", {
        value: state.username,
        autocomplete: "username",
      });
      username.pattern = "[a-zA-Z0-9_.\\-]{3,64}";
      username.minLength = 3;
      username.maxLength = 64;
      username.addEventListener("input", () => {
        state.username = username.value;
      });
      password = input(f, "新密码", {
        secret: true,
        autocomplete: "new-password",
      });
      password.minLength = 12;
      repeat = input(f, "确认密码", {
        secret: true,
        autocomplete: "new-password",
      });
      repeat.minLength = 12;
      f.append(el("p", "密码至少 12 位；安装成功不会自动登录。", "muted"));
      f.append(f.firstChild);
      username.focus();
    }
    button(card, "返回预检", source);
  }
  run(refresh);
}
if (typeof module !== "undefined") module.exports = { setupView, mount };
if (typeof window !== "undefined") window.SiteSetup = { mount };

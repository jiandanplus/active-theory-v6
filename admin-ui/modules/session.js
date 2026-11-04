"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.SiteAdminModules ||= {})["session"] = factory();
})(
  /** @type {typeof globalThis & {SiteAdminModules?: Record<string, object>}} */ (
    globalThis
  ),
  function () {
    function create(context) {
      const {
        state,
        document,
        window,
        fetch,
        app,
        sections,
        node,
        button,
        confirmAction,
        api,
        updateStatus,
        field,
        save,
        preview,
        publish,
        overviewView,
        siteView,
        scenesView,
        projectsView,
        resourcesView,
        storageView,
        versionsView,
        securityView,
        invalidateRuntime,
      } = context;
      async function load() {
        const epoch = state.sessionEpoch;
        invalidateRuntime();
        const [cfg, canonical, res, stores, overview, runtime] =
          await Promise.all([
            api("/config"),
            api("/config/schema"),
            api("/resources"),
            api("/storages"),
            api("/overview"),
            // Needed on every page to enable preview/publish; not fatal here.
            api("/runtime").catch(() => null),
          ]);
        if (epoch !== state.sessionEpoch) return;
        // Never substitute the mutable current draft for the template's legacy-URL baseline.
        let validationSchema;
        try {
          if (!canonical?.schema || !window.SiteContentContract?.validateConfig)
            throw new Error("missing canonical schema");
          window.SiteContentContract.validateConfig(
            canonical.schema,
            canonical.schema,
          );
          validationSchema = JSON.parse(JSON.stringify(canonical.schema));
        } catch {
          throw new Error("内容校验结构响应无效，请刷新页面后重试");
        }
        state.config = cfg.config;
        state.validationSchema = validationSchema;
        state.revision = cfg.revision;
        state.resources = res.resources;
        state.storages = stores.storages;
        state.defaultStorage = stores.defaultStorage;
        state.overview = overview;
        if (context.validRuntime?.(runtime)) state.runtime = runtime;
        state.dirty = false;
        shell();
        await render();
      }
      function login(initialized) {
        context.invalidateView?.();
        state.busy = false;
        if (!initialized)
          return window.SiteSetup.mount({ root: app, onInstalled: init });
        app.replaceChildren();
        const wrap = node("main", undefined, "login-wrap"),
          card = node("section", undefined, "login-card");
        card.append(
          node("div", "Studio / 管理工作台", "brand"),
          node("div", "PRIVATE ACCESS", "eyebrow"),
          node("h1", "欢迎回来"),
          node(
            "p",
            "登录以管理你的 3D 网站。修改先保存为草稿，发布后才会出现在公开网站。",
            "muted",
          ),
        );
        {
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
        for (const [id, , label] of sections) {
          const b = button("", async () => {
            state.section = id;
            await render();
          });
          b.dataset.section = id;
          // Icons are CSS-masked SVGs keyed by section, identical on every OS.
          const glyph = node("span", "", "nav-icon");
          glyph.dataset.icon = id;
          glyph.setAttribute("aria-hidden", "true");
          b.append(glyph, node("span", label));
          nav.append(b);
        }
        side.append(nav);
        const foot = node("div", undefined, "sidebar-foot");
        // One sign-out control lives in the top bar, which stays visible on phones.
        foot.append(node("div", "单管理员 · 私人工作空间"));
        side.append(foot);
        const workspace = node("div", undefined, "workspace"),
          top = node("header", undefined, "topbar");
        top.append(node("span", "工作空间 / 网站管理"));
        const link = node("a", "访问公开网站 ↗");
        link.href = "/";
        link.target = "_blank";
        link.rel = "noopener";
        top.append(link, button("退出登录", logout));
        context.content = node("main", undefined, "content");
        workspace.append(top, context.content);
        root.append(side, workspace);
        app.append(root);
        const bar = node("footer", undefined, "savebar");
        context.saveStatus = node("div");
        const actions = node("div", undefined, "savebar-actions");
        const previewButton = button("预览草稿 ↗", preview, undefined, true),
          publishButton = button("发布网站", publish, undefined, true);
        // Preview and publish need a selected runtime; updateStatus disables
        // them and shows why until one is selected.
        previewButton.dataset.needsRuntime = "true";
        publishButton.dataset.needsRuntime = "true";
        context.runtimeHint = node("span", "需先选择运行包", "savebar-hint");
        actions.append(
          context.runtimeHint,
          button("保存草稿", save, "primary", true),
          previewButton,
          publishButton,
        );
        context.saveBar = bar;
        context.saveActions = actions;
        bar.append(context.saveStatus, actions);
        app.append(bar);
        updateStatus();
      }
      async function logout() {
        if (
          state.dirty &&
          !(await confirmAction(
            "有未保存的修改。退出登录将丢弃这些修改，继续吗？",
          ))
        )
          return;
        state.sessionEpoch++;
        context.invalidateView?.();
        await api("/logout", "POST", {});
        state.config = null;
        state.dirty = false;
        state.csrf = "";
        await init();
      }
      async function render() {
        if (!state.config) return;
        context.invalidateView?.();
        context.content.replaceChildren();
        context.updateStatus?.();
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
      async function init() {
        try {
          const status = await fetch("/api/setup/status", {
            credentials: "same-origin",
            cache: "no-store",
          });
          const installation = await status.json();
          if (installation.state !== "installed")
            return window.SiteSetup.mount({ root: app, onInstalled: init });
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
      return { load, login, shell, logout, render, init };
    }
    return { create };
  },
);

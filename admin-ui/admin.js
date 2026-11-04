// Composition root only. Modules own their focused behavior; session state is
// created once. Shared validation (page-content, content-contract,
// site-identity) arrives as classic scripts that set browser globals.
import * as state from "./modules/state.js";
import * as api from "./modules/api.js";
import * as dom from "./modules/dom.js";
import * as session from "./modules/session.js";
import * as router from "./modules/router.js";
import * as actions from "./modules/actions.js";
import * as overview from "./modules/overview.js";
import * as site from "./modules/site.js";
import * as scenes from "./modules/scenes.js";
import * as projects from "./modules/projects.js";
import * as resources from "./modules/resources.js";
import * as storage from "./modules/storage.js";
import * as versions from "./modules/versions.js";
import * as security from "./modules/security.js";
import { wireModules } from "./modules/registry.js";

export * from "./modules/helpers.js";

const MODULES = {
  state,
  api,
  dom,
  session,
  router,
  actions,
  overview,
  site,
  scenes,
  projects,
  resources,
  storage,
  versions,
  security,
};
const SECTIONS = [
  ["overview", "◈", "总览"],
  ["site", "▤", "网站设置"],
  ["scenes", "◇", "场景编辑"],
  ["projects", "▦", "作品管理"],
  ["resources", "▧", "资源库"],
  ["storage", "◫", "存储设置"],
  ["versions", "↶", "发布版本"],
  ["security", "⊙", "账号安全"],
];
// Display order of the basic site fields; stored jsonb key order is not used.
const LABELS = {
  title: "网站标题",
  navWork: "作品导航文字",
  navContact: "联系导航文字",
  contactTitle: "联系页标题",
  email: "邮箱显示文字",
  emailLink: "联系邮箱",
  cityLax: "联系页地点一（原 LA）",
  cityNyc: "联系页地点二（原 NY）",
  cityAms: "联系页地点三（原 AMS）",
  labUrl: "底部展示区跳转链接",
};

/** @param {any} [environment] browser window, or a test double of it */
export function startAdmin(environment = globalThis) {
  if (!environment.SitePageContent)
    throw new Error("页面内容策略加载失败，请刷新页面");
  const document = environment.document;
  const context = {
    state: state.createState(),
    sections: SECTIONS,
    labels: LABELS,
    document,
    pageContent: environment.SitePageContent,
    app: document.getElementById("app"),
    window: environment,
    fetch: environment.fetch.bind(environment),
    crypto: environment.crypto,
    content: null,
    saveStatus: null,
  };
  const services = wireModules(context, MODULES);
  const ready = services.session.init();
  return {
    state: context.state,
    ready,
    actions: services.actions,
    render: services.router.render,
  };
}
if (typeof document !== "undefined") startAdmin();

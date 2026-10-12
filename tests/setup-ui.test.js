const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
test("database outage never renders account creation", () => {
  const { setupView } = require("../admin-ui/setup");
  for (const status of ["unavailable", "unconfigured", "incompatible"])
    for (const authorized of [false, true])
      assert.equal(setupView(status, authorized), "maintenance");
  assert.equal(setupView("installed", false), "login");
  assert.equal(setupView("uninstalled", false), "authorize");
  assert.equal(setupView("uninstalled", true), "database");
});
test("setup shell loads before admin and removes terminal initialization instructions", () => {
  const html = fs.readFileSync(
    require.resolve("../admin-ui/index.html"),
    "utf8",
  );
  assert.ok(html.indexOf("/admin/setup.js") < html.indexOf("/admin/admin.js"));
  const admin = fs.readFileSync(
    require.resolve("../admin-ui/admin.js"),
    "utf8",
  );
  assert.match(admin, /SiteSetup.mount/);
  assert.doesNotMatch(admin, /npm run admin:init/);
});
test("wizard keeps secrets transient and renders safe accessible DOM", () => {
  const source = fs.readFileSync(
    require.resolve("../admin-ui/setup.js"),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /innerHTML|insertAdjacentHTML|localStorage|sessionStorage/,
  );
  for (const contract of [
    "same-origin",
    "X-CSRF-Token",
    "aria-live",
    "htmlFor",
    "missingRequired",
    "credentialsUnavailable",
    "hasAdmin",
    "onInstalled",
  ])
    assert.ok(source.includes(contract), contract);
});
test("username pattern is valid under modern HTML unicode-set validation", () => {
  const source = fs.readFileSync(
    require.resolve("../admin-ui/setup.js"),
    "utf8",
  );
  const literal = source.match(/username.pattern = ([^;]*);/)[1];
  const pattern = require("node:vm").runInNewContext(literal);
  const regex = new RegExp("^(?:" + pattern + ")$", "v");
  assert.equal(regex.test("wizard-owner"), true);
  assert.equal(regex.test("bad account"), false);
});

function dom() {
  let active;
  class Element {
    constructor(tag) {
      this.tag = tag;
      this.childNodes = [];
      this.dataset = {};
      this.events = {};
      this.value = "";
      this.attrs = {};
    }
    get firstChild() {
      return this.childNodes[0];
    }
    get textContent() {
      return this.text || this.childNodes.map((n) => n.textContent).join(" ");
    }
    set textContent(text) {
      this.text = text;
    }
    append(...nodes) {
      for (const n of nodes) {
        if (n.parent)
          n.parent.childNodes = n.parent.childNodes.filter((x) => x !== n);
        this.childNodes.push(n);
        n.parent = this;
      }
    }
    replaceChildren(...nodes) {
      this.childNodes.forEach((n) => {
        n.parent = null;
      });
      this.childNodes = [];
      this.append(...nodes);
    }
    setAttribute(key, value) {
      this.attrs[key] = value;
    }
    addEventListener(name, fn) {
      this.events[name] = fn;
    }
    focus() {
      active = this;
    }
    querySelectorAll(selector) {
      return this.childNodes.flatMap((n) => [
        ...(selector === "[data-secret]"
          ? n.dataset.secret
            ? [n]
            : []
          : n.tag === selector
            ? [n]
            : []),
        ...n.querySelectorAll(selector),
      ]);
    }
  }
  return {
    root: new Element("root"),
    document: {
      createElement: (tag) => new Element(tag),
      get activeElement() {
        return active;
      },
    },
  };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));
async function wizard() {
  const tree = dom(),
    calls = [];
  let failure = 0,
    status = "uninstalled";
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const path = url.replace("/api/setup", "");
    if (path === "/status" && status === "network-error")
      throw new Error("Network unavailable");
    const code = path === "/preflight" ? failure : 0;
    const data = code
      ? { error: "临时失败" }
      : path === "/status"
        ? { state: status, schemaVersion: null }
        : path === "/authorize"
          ? { csrfToken: "test-csrf" }
          : path === "/database"
            ? {
                target: { host: "127.0.0.1", database: "site_test_fixture" },
                permissions: { supportedVersion: true, createSchema: true },
                state: "uninstalled",
              }
            : {
                report: {
                  counts: { resources: 0 },
                  missingRequired: ["runtime:app"],
                  warnings: [],
                  credentialsUnavailable: [],
                  hasAdmin: false,
                  digest: "digest",
                },
                digest: "digest",
              };
    return { ok: !code, status: code || 200, json: async () => data };
  };
  const vm = require("node:vm");
  const module = { exports: {} };
  vm.runInNewContext(
    fs.readFileSync(require.resolve("../admin-ui/setup.js"), "utf8"),
    {
      document: tree.document,
      crypto: { randomUUID: () => String(Math.random()) },
      fetch,
      module,
    },
  );
  module.exports.mount({ root: tree.root, onInstalled: () => {} });
  await settle();
  tree.root.querySelectorAll("input")[0].value = "transient-token";
  tree.root.querySelectorAll("form")[0].events.submit({ preventDefault() {} });
  await settle();
  tree.root
    .querySelectorAll("button")
    .find((n) => n.textContent === "选择内容来源")
    .events.click();
  await settle();
  return {
    ...tree,
    calls,
    fail(code) {
      failure = code;
    },
    status(value) {
      status = value;
    },
  };
}
for (const code of [401, 409, 503, 500])
  test(
    "preflight HTTP " + code + " fails closed and clears unsafe continuation",
    async () => {
      const w = await wizard();
      w.fail(code);
      w.root
        .querySelectorAll("button")
        .find((n) => n.textContent === "执行预检")
        .events.click();
      await settle();
      assert.equal(
        w.root
          .querySelectorAll("input")
          .filter((n) => n.autocomplete === "new-password").length,
        0,
      );
      assert.equal(w.root.textContent.includes("设置管理员"), false);
      assert.equal(
        w.root.textContent.includes(
          code === 401
            ? "授权首次安装"
            : code === 409
              ? "检查数据库"
              : "暂时无法安装或登录",
        ),
        true,
      );
      assert.equal(w.calls.filter((n) => n.url.endsWith("/install")).length, 0);
    },
  );
test("conflict status refresh network failure falls back to maintenance", async () => {
  const w = await wizard();
  w.fail(409);
  w.status("network-error");
  w.root
    .querySelectorAll("button")
    .find((n) => n.textContent === "执行预检")
    .events.click();
  await settle();
  assert.equal(w.root.textContent.includes("暂时无法安装或登录"), true);
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
test("imports current values and rejects unknown fields or unsafe resource URLs", () => {
  const {
    initialConfig,
    validateConfig,
    buildUIL,
  } = require("../admin-server/config");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "site-config-test-"));
  try {
    fs.mkdirSync(path.join(root, "assets/data"), { recursive: true });
    fs.mkdirSync(path.join(root, "cms"));
    fs.writeFileSync(
      path.join(root, "index.html"),
      "<title>My real site</title>",
    );
    fs.writeFileSync(
      path.join(root, "assets/data/uil.1.json"),
      JSON.stringify({
        INPUT_Element_3_About_text3d_text: "My name",
        INPUT_Config_8_ParticleTest_geometry: {
          src: "assets/geometry/logo/AT_logo.bin",
        },
        x: 5,
      }),
    );
    fs.writeFileSync(path.join(root, "cms/projects-dev.json"), "[]");
    const base = initialConfig(root);
    assert.equal(base.site.title, "My real site");
    const field = base.scenes.find((s) => s.id === "About").fields[0];
    assert.equal(field.value, "My name");
    const updated = structuredClone(base);
    updated.scenes.find((s) => s.id === "About").fields[0].value =
      "New name ->";
    validateConfig(updated, base);
    assert.equal(
      buildUIL(root, updated)["INPUT_Element_3_About_text3d_text"],
      "New name ->",
    );
    assert.equal(buildUIL(root, updated).x, 5);
    updated.scenes.find((s) => s.id === "Home").fields[0].value =
      "javascript:alert(1)";
    assert.throws(() => validateConfig(updated, base), /地址|资源/);
    assert.throws(
      () => validateConfig({ ...base, secret: "no" }, base),
      /字段/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("requires the CMS fields consumed by the rendering engine", () => {
  const { initialConfig, validateConfig } = require("../admin-server/config");
  const config = initialConfig("/nonexistent");
  config.projects = [{ name: "Minimal", slug: "minimal" }];
  assert.throws(
    () => validateConfig(config, initialConfig("/nonexistent")),
    /作品.*字段/,
  );
});

test("configuration versions save atomically, conflict and restore only to draft", () => {
  const { openStore } = require("../admin-server/database");
  const {
    initializeConfig,
    saveDraft,
    publish,
    restore,
  } = require("../admin-server/config");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "site-versions-test-"));
  const store = openStore(path.join(root, "data"));
  try {
    initializeConfig(store, root);
    const v1 = store.get("published");
    const original = store.get("draft");
    const changed = structuredClone(original);
    changed.site.title = "new title";
    const next = saveDraft(store, changed, 0);
    assert.equal(next, 1);
    assert.equal(store.get("published"), v1);
    assert.throws(() => saveDraft(store, original, 0), /冲突/);
    const v2 = publish(store, 1);
    assert.notEqual(v1, v2);
    assert.equal(
      JSON.parse(
        store.db.prepare("SELECT config FROM versions WHERE id=?").get(v1)
          .config,
      ).site.title,
      original.site.title,
    );
    restore(store, v1, 1);
    assert.equal(store.get("draft").site.title, original.site.title);
    assert.equal(store.get("published"), v2);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

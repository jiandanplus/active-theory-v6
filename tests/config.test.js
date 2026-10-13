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
    assert.equal(base.site.language, "en");
    assert.equal(base.site.description, "");
    assert.equal(base.site.socialImage, "");
    const field = base.scenes.find((s) => s.id === "About").fields[0];
    assert.equal(field.value, "My name");
    const updated = structuredClone(base);
    updated.scenes.find((s) => s.id === "About").fields[0].value =
      "New name ->";
    validateConfig(updated, base);
    assert.equal(
      buildUIL({
        config: updated,
        template: { baseUIL: require("../admin-server/config").baseUIL(root) },
      })["INPUT_Element_3_About_text3d_text"],
      "New name ->",
    );
    assert.equal(
      buildUIL({
        config: updated,
        template: { baseUIL: require("../admin-server/config").baseUIL(root) },
      }).x,
      5,
    );
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

test("configuration versions save atomically, conflict and restore only to draft", async (t) => {
  const { saveDraft, publish, restore } = require("../admin-server/config");
  const { store, root } = await require("./helpers/http").httpFixture(t);
  const repo =
    require("../admin-server/repositories/content").contentRepository(store);
  const draft = await repo.getDraft();
  const v1 = draft.published;
  const original = draft.config;
  const changed = structuredClone(original);
  changed.site.title = "new title";
  const next = await saveDraft(store, changed, draft.revision);
  assert.equal(next, draft.revision + 1);
  assert.equal((await repo.getDraft()).published, v1);
  await assert.rejects(saveDraft(store, original, draft.revision), /冲突/);
  const v2 = await publish(store, next, {
    root,
    dataDir: path.join(root, "data"),
  });
  assert.notEqual(v1, v2);
  assert.equal(
    (await repo.getVersion(v1)).snapshot.config.site.title,
    original.site.title,
  );
  await restore(store, v1, next);
  assert.equal((await repo.getDraft()).config.site.title, original.site.title);
  assert.equal((await repo.getDraft()).published, v2);
  assert.equal((await repo.getDraft()).config.site.language, "en");
  assert.equal(Object.hasOwn((await repo.getVersion(v1)).snapshot.config.site, "language"), false);
});

test("JSONB object key order does not invalidate site config", (t) => {
  const schema = require("./helpers/content").contentFixture(t).bundle.schema;
  const config = structuredClone(schema);
  config.site = Object.fromEntries(Object.entries(config.site).reverse());
  assert.doesNotThrow(() =>
    require("../admin-server/config").validateConfig(config, schema),
  );
});
test("scene and field identities are checked independently from ordering", (t) => {
  const config = require("./helpers/content").contentFixture(t).bundle.schema;
  config.scenes.push({
    id: "Other",
    label: "Other",
    fields: [
      { key: "b", label: "B", type: "text", value: "B" },
      { key: "a", label: "A", type: "text", value: "A" },
    ],
  });
  const next = structuredClone(config);
  next.scenes.reverse();
  next.scenes[0].fields.reverse();
  const { validateConfig } = require("../admin-server/config");
  assert.doesNotThrow(() => validateConfig(next, config));
  next.scenes[0].fields[1] = structuredClone(next.scenes[0].fields[0]);
  assert.throws(() => validateConfig(next, config), /字段/);
  const duplicate = structuredClone(config);
  duplicate.scenes[1] = duplicate.scenes[0];
  assert.throws(() => validateConfig(duplicate, config), /场景/);
});
test("new bundle remains unpublished and rejected draft audit rolls back all lists", async (t) => {
  const { store } = await require("./helpers/postgres").postgresFixture(t);
  const { bundle } = require("./helpers/content").contentFixture(t);
  bundle.versions = [];
  bundle.published = null;
  bundle.admin = null;
  const repo =
    require("../admin-server/repositories/content").contentRepository(store);
  await store.transaction((tx) =>
    require("../admin-server/repositories/content")
      .contentRepository(tx)
      .importBundle(bundle),
  );
  const before = await repo.getDraft();
  assert.equal(before.published, null);
  assert.equal((await repo.listVersions()).length, 0);
  await store.query(
    "CREATE FUNCTION personal_site.fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'draft audit rejected'; END; $$",
  );
  await store.query(
    "CREATE TRIGGER reject_audit BEFORE INSERT ON personal_site.audit_events FOR EACH ROW EXECUTE FUNCTION personal_site.fail_audit()",
  );
  const changed = structuredClone(before.config);
  changed.site.title = "Failed";
  changed.projects = [];
  await assert.rejects(
    require("../admin-server/config").saveDraft(
      store,
      changed,
      before.revision,
    ),
    /draft audit rejected/,
  );
  assert.deepEqual(await repo.getDraft(), before);
});

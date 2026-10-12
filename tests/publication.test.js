const { test } = require("node:test");
const assert = require("node:assert/strict");
const { httpFixture } = require("./helpers/http");
const { contentRepository } = require("../admin-server/repositories/content");
const { validatePublication } = require("../admin-server/publication");
test("publication rejects missing managed resources and uses database font coverage", async (t) => {
  const { store, root } = await httpFixture(t);
  const draft = (await contentRepository(store).getDraft()).snapshot;
  draft.config.scenes[0].fields[0].value = "/media/missing";
  await assert.rejects(validatePublication(store, { root }, draft), /不存在/);
  draft.config.scenes[0].fields = [
    { key: "demo_text", label: "Text", type: "text", value: "中" },
  ];
  draft.template.baseUIL.demo_text = "A";
  draft.template.baseUIL.demo_fontStyle = "font: Demo";
  draft.assets.demoFont = {
    resourceId: "font",
    fileName: "assets/fonts/Demo.json",
  };
  draft.legacyMap["assets/fonts/Demo.json"] = "demoFont";
  draft.template.fontCoverage.font = "ABC";
  await assert.rejects(validatePublication(store, { root }, draft), /字形/);
  draft.config.scenes[0].fields[0].value = "B";
  await validatePublication(store, { root }, draft);
  draft.config.scenes[0].fields = [
    { key: "geometry", type: "geometry", value: "/media/image" },
  ];
  await store.query(
    "UPDATE personal_site.resources SET status='uploaded' WHERE id='image'",
  );
  await assert.rejects(validatePublication(store, { root }, draft), /转换/);
  draft.config.scenes[0].fields[0].value = "/models/image.bin";
  await assert.rejects(validatePublication(store, { root }, draft), /转换/);
});

test("unregistered local media cannot bypass publication and external media is warned without fetching", async (t) => {
  const f = await httpFixture(t),
    snapshot = (await contentRepository(f.store).getDraft()).snapshot;
  snapshot.config.scenes[0].fields[0].value = "assets/absent.png";
  await assert.rejects(
    validatePublication(f.store, { root: f.root }, snapshot),
    /不存在/,
  );
  snapshot.config.scenes[0].fields[0].value =
    "https://external.invalid/file.png";
  assert.equal(
    (await validatePublication(f.store, { root: f.root }, snapshot)).length,
    1,
  );
});
test("preview is owned, expires after thirty minutes, prunes references and keeps five", async (t) => {
  const f = await httpFixture(t);
  await f.createAdmin();
  const headers = await f.login();
  let url;
  for (let i = 0; i < 6; i++) {
    const response = await f.request("/api/admin/preview", {
      method: "POST",
      headers,
      body: JSON.stringify({ revision: 3 }),
    });
    assert.equal(response.status, 200);
    url = (await response.json()).url;
  }
  const rows = (
    await f.store.query("SELECT * FROM personal_site.previews ORDER BY expires")
  ).rows;
  assert.equal(rows.length, 5);
  assert.ok(
    Math.abs(rows[0].expires.getTime() - Date.now() - 30 * 60000) < 5000,
  );
  assert.equal((await f.request(url)).status, 401);
  assert.equal((await f.request(url, { headers })).status, 200);
  await f.store.query(
    "UPDATE personal_site.previews SET expires=now()-interval '1 second'",
  );
  assert.equal((await f.request(url)).status, 401);
  assert.equal((await f.request(url, { headers })).status, 404);
  assert.equal(
    (
      await f.store.query(
        "SELECT * FROM personal_site.resource_references WHERE owner_type='preview'",
      )
    ).rowCount,
    0,
  );
});
test("publication rechecks resource/storage state inside transaction and awaits audit rollback", async (t) => {
  const f = await httpFixture(t),
    { publish } = require("../admin-server/config");
  await f.store.query(
    "UPDATE personal_site.resources SET storage_id='local' WHERE id='image'",
  );
  const raced = {
    query: f.store.query,
    transaction: async (fn) => {
      await f.store.query(
        "UPDATE personal_site.storages SET available=false WHERE id='local'",
      );
      return f.store.transaction(fn);
    },
  };
  await assert.rejects(publish(raced, 3, { root: f.root }), /存储/);
  assert.equal((await contentRepository(f.store).getDraft()).published, 42);
  await f.store.query("UPDATE personal_site.storages SET available=true");
  await f.store.query(
    "CREATE FUNCTION personal_site.fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit rejected'; END; $$",
  );
  await f.store.query(
    "CREATE TRIGGER reject_audit BEFORE INSERT ON personal_site.audit_events FOR EACH ROW EXECUTE FUNCTION personal_site.fail_audit()",
  );
  await assert.rejects(publish(f.store, 3, { root: f.root }), /audit rejected/);
  assert.equal((await contentRepository(f.store).getDraft()).published, 42);
  assert.equal((await contentRepository(f.store).listVersions()).length, 1);
  assert.equal(
    (
      await f.store.query(
        "SELECT * FROM personal_site.resource_references WHERE owner_type='version' AND owner_id!='42'",
      )
    ).rowCount,
    0,
  );
});
test("concurrent save/publication cannot publish a mixed revision", async (t) => {
  const f = await httpFixture(t),
    { saveDraft, publish } = require("../admin-server/config"),
    repo = contentRepository(f.store);
  const original = (await repo.getDraft()).config,
    changed = structuredClone(original);
  changed.site.title = "Changed";
  changed.projects[0].name = "Changed project";
  const outcomes = await Promise.allSettled([
    publish(f.store, 3, { root: f.root }),
    saveDraft(f.store, changed, 3),
  ]);
  assert.equal(outcomes[1].status, "fulfilled");
  if (outcomes[0].status === "fulfilled") {
    const snap = (await repo.getVersion(outcomes[0].value)).snapshot;
    assert.deepEqual(snap.config, original);
  } else assert.equal(outcomes[0].reason.status, 409);
  assert.equal((await repo.getDraft()).config.site.title, "Changed");
});

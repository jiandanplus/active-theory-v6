const { test } = require("node:test");
const assert = require("node:assert/strict");
const { httpFixture } = require("./helpers/http");
const { contentRepository } = require("../admin-server/repositories/content");
const {
  resourceRepository,
} = require("../admin-server/repositories/resources");
const { saveDraft, restore } = require("../admin-server/services/content");

test("schema reads reflect current fixed values and never materialize page defaults; PUT rejects locked edits", async (t) => {
  const f = await httpFixture(t);
  await f.createAdmin();
  const headers = await f.login();
  const fields = [
    { key: "fixed", label: "Fixed", type: "number", value: 18 },
    { key: "copy", label: "Copy", type: "text", value: "Hello" },
  ];
  await f.store.query("UPDATE personal_site.scenes SET fields=$1 WHERE id=$2", [
    JSON.stringify(fields),
    "Home",
  ]);
  const repo = contentRepository(f.store),
    before = await repo.getDraft();
  // Existing template metadata stays authoritative; establish its old fixed value.
  const schemaRow = (
    await f.store.query("SELECT schema_config FROM personal_site.templates")
  ).rows[0];
  schemaRow.schema_config.scenes[0].fields = structuredClone(fields);
  schemaRow.schema_config.scenes[0].fields[0].value = 1;
  await f.store.query("UPDATE personal_site.templates SET schema_config=$1", [
    schemaRow.schema_config,
  ]);
  const response = await f.request("/api/admin/config/schema", { headers });
  assert.equal(response.status, 200);
  const { schema } = await response.json();
  assert.equal(schema.scenes[0].fields[0].value, 18);
  assert.deepEqual((await repo.getDraft()).config, before.config);
  const config = structuredClone(before.config);
  config.site.contactJoinText = "Join";
  assert.equal(
    await saveDraft(f.store, config, before.revision),
    before.revision + 1,
  );
  config.scenes[0].fields[0].value = 1;
  const rejected = await f.request("/api/admin/config", {
    method: "PUT",
    headers,
    body: JSON.stringify({ config, revision: before.revision + 1 }),
  });
  assert.equal(rejected.status, 400);
  assert.match((await rejected.json()).error, /固定/);
  assert.equal((await repo.getDraft()).revision, before.revision + 1);
});

test("historical restore restores content while retaining current fixed visual values", async (t) => {
  const f = await httpFixture(t),
    repo = contentRepository(f.store),
    before = await repo.getDraft();
  const historical = structuredClone(before.snapshot);
  historical.config.site.title = "Historical";
  historical.config.scenes[0].fields[0].value = "/media/unused";
  const old = await repo.insertVersion(historical);
  await restore(f.store, old.id, before.revision);
  const after = await repo.getDraft();
  assert.equal(after.config.site.title, "Historical");
  assert.equal(
    after.config.scenes[0].fields[0].value,
    before.config.scenes[0].fields[0].value,
  );
});

test("save registers page external media with declared kinds and grants draft references", async (t) => {
  const f = await httpFixture(t),
    repo = contentRepository(f.store),
    draft = await repo.getDraft();
  Object.assign(draft.config.site, {
    heroVideo: "https://media.example.test/hero",
    heroPoster: "https://media.example.test/poster",
    contactQrImage: "/media/image",
  });
  await saveDraft(f.store, draft.config, draft.revision);
  const resources = await resourceRepository(f.store).list();
  for (const [url, kind] of [
    [draft.config.site.heroVideo, "video"],
    [draft.config.site.heroPoster, "image"],
  ]) {
    const row = resources.find((row) => row.url === url);
    assert(row, url);
    assert.equal(row.kind, kind);
    assert(
      (
        await f.store.query(
          "SELECT * FROM personal_site.resource_references WHERE owner_type=$1 AND resource_id=$2",
          ["draft", row.id],
        )
      ).rowCount > 0,
    );
  }
});

test("save rejects wrong-kind managed video, poster, icons and QR without advancing revision", async (t) => {
  const f = await httpFixture(t),
    repo = contentRepository(f.store),
    draft = await repo.getDraft();
  for (const key of [
    "heroVideo",
    "heroPoster",
    "labBackground",
    "contactInstagramIcon",
    "contactLinkedinIcon",
    "contactXIcon",
    "contactQrImage",
  ]) {
    const config = structuredClone(draft.config);
    config.site[key] = key === "heroVideo" ? "/media/image" : "/media/audio";
    await assert.rejects(
      saveDraft(f.store, config, draft.revision),
      (error) =>
        error.status === 400 && /资源.*类型|类型.*资源/.test(error.message),
      key,
    );
    assert.equal((await repo.getDraft()).revision, draft.revision);
  }
});

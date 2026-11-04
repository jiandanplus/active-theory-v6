const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createHash } = require("node:crypto");
const { v2Fixture } = require("./helpers/v2");
const { upgradeInstalled } = require("../scripts/db-migrate");
const { contentRepository } = require("../admin-server/repositories/content");
const {
  rejectTargetlessDocument,
} = require("../admin-server/frontend-resources");

// The pre-004 rule: any stored version or preview snapshot marking the
// resource as a document blocks target-less access.
const OLD_RULE = `SELECT 1 FROM (
    SELECT snapshot FROM personal_site.versions
    UNION ALL SELECT snapshot FROM personal_site.previews
  ) snapshots CROSS JOIN LATERAL jsonb_each(snapshots.snapshot->'assets') asset
  WHERE asset.value->>'resourceId'=$1 AND asset.value ? 'document' LIMIT 1`;
const IDS = [
  "doc-ref",
  "doc-unreferenced",
  "doc-false",
  "plain",
  "preview-doc",
  "absent",
];
const snapshot = (assets) => ({
  format: 2,
  config: {},
  template: {},
  assets,
  legacyMap: {},
});

async function agree(store) {
  for (const id of IDS) {
    const old = (await store.query(OLD_RULE, [id])).rowCount > 0;
    const now = await rejectTargetlessDocument(store, id).then(
      () => false,
      (error) => {
        assert.equal(error.status, 404);
        return true;
      },
    );
    assert.equal(now, old, id);
  }
}

test("004 backfills document assets so the indexed rule matches the old scan", async (t) => {
  const f = await v2Fixture(t);
  const sql = readFileSync(
    join(__dirname, "../admin-server/migrations/003-engine-delivery.sql"),
    "utf8",
  );
  await f.store.transaction(async (tx) => {
    await tx.query(sql);
    await tx.query(
      "INSERT INTO personal_site.schema_migrations(version,checksum) VALUES(3,$1)",
      [createHash("sha256").update(sql).digest("hex")],
    );
    await tx.query("UPDATE personal_site.installation SET schema_version=3");
    await tx.query(
      "INSERT INTO personal_site.versions(id,snapshot) VALUES(901,$1),(902,$2)",
      [
        snapshot({
          a: { resourceId: "doc-ref", document: { kind: "json" } },
          b: { resourceId: "doc-unreferenced", document: true },
          c: { resourceId: "plain" },
        }),
        snapshot({ d: { resourceId: "doc-false", document: false } }),
      ],
    );
    const owner = (await tx.query("SELECT username FROM personal_site.admins"))
      .rows[0]?.username;
    if (owner)
      await tx.query(
        "INSERT INTO personal_site.previews(id,owner,expires,snapshot) VALUES('preview-fixture',$1,now()+interval '1 hour',$2)",
        [owner, snapshot({ e: { resourceId: "preview-doc", document: true } })],
      );
  });
  await upgradeInstalled(f.store);
  await agree(f.store);
  const plan = (
    await f.store.query(
      "EXPLAIN SELECT 1 FROM personal_site.document_assets WHERE resource_id='doc-ref' LIMIT 1",
    )
  ).rows
    .map((row) => row["QUERY PLAN"])
    .join("\n");
  assert.doesNotMatch(plan, /jsonb_each/);
  // Deleting a version removes its rows with it.
  await f.store.query("DELETE FROM personal_site.versions WHERE id=902");
  await agree(f.store);
});

test("new versions and previews record their document assets as stored", async (t) => {
  const f = await require("./helpers/delivery").deliveryFixture(t, {
    publish: true,
  });
  const base = (
    await f.store.query(
      "SELECT snapshot FROM personal_site.versions WHERE id=$1",
      [f.published],
    )
  ).rows[0].snapshot;
  base.assets = {
    ...base.assets,
    extraDoc: { resourceId: "doc-ref", document: true },
  };
  await f.store.transaction((tx) => contentRepository(tx).insertVersion(base));
  await agree(f.store);
  const preview = await f.service.preview({ revision: 3, actor: f.actor });
  await agree(f.store);
  await contentRepository(f.store).prunePreviews(new Date(Date.now() + 864e5));
  assert.equal(
    (
      await f.store.query(
        "SELECT count(*)::int AS n FROM personal_site.document_assets WHERE preview_id=$1",
        [preview],
      )
    ).rows[0].n,
    0,
  );
  await agree(f.store);
});

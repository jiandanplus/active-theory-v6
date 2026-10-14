const { toSafeInteger } = require("../postgres");
const {normalizeReferences}=require('../delivery/contracts');
const fail = (status, message) => Object.assign(new Error(message), { status });
const map = (r) =>
  r
    ? {
        ...r.details,
        id: r.id,
        source: r.source,
        storageId: r.storage_id,
        key: r.object_key,
        url: r.url,
        name: r.name,
        kind: r.kind,
        mime: r.mime,
        size: r.size === null ? null : toSafeInteger(r.size),
        checksum: r.checksum,
        status: r.status,
        originalId: r.original_id,
        trashed: r.trashed,
        created: r.created.toISOString(),
      }
    : null;
function resourceRepository(db) {
  const repo = {
    async list() {
      return (
        await db.query(
          "SELECT * FROM personal_site.resources ORDER BY created,id",
        )
      ).rows.map(map);
    },
    async get(id) {
      return map(
        (
          await db.query("SELECT * FROM personal_site.resources WHERE id=$1", [
            id,
          ])
        ).rows[0],
      );
    },
    async insert(resource) {
      await db.query(
        "SELECT id FROM personal_site.site_settings WHERE id=true FOR UPDATE",
      );
      const {
        id,
        source,
        storageId = null,
        key = null,
        url,
        name,
        kind,
        mime = null,
        size = null,
        checksum = null,
        status,
        originalId = null,
        trashed = false,
        created = new Date().toISOString(),
        ...details
      } = resource;
      const inserted = map(
        (
          await db.query(
            "INSERT INTO personal_site.resources(id,source,storage_id,object_key,url,name,kind,mime,size,checksum,status,original_id,trashed,created,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *",
            [
              id,
              source,
              storageId,
              key,
              url,
              name,
              kind,
              mime,
              size,
              checksum,
              status,
              originalId,
              trashed,
              created,
              details,
            ],
          )
        ).rows[0],
      );
      if (originalId)
        await repo.replaceReferences({
          ownerType: "resource",
          ownerId: id,
          references: [{ resourceId: originalId, slot: "original" }],
        });
      return inserted;
    },
    async setTrashed(id, trashed) {
      await db.query(
        "SELECT id FROM personal_site.site_settings WHERE id=true FOR UPDATE",
      );
      const row = (
        await db.query(
          "SELECT * FROM personal_site.resources WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (!row) throw fail(404, "资源不存在");
      if (trashed && (await repo.references(id)).length)
        throw fail(409, "资源仍被引用");
      return map(
        (
          await db.query(
            "UPDATE personal_site.resources SET trashed=$2 WHERE id=$1 RETURNING *",
            [id, trashed],
          )
        ).rows[0],
      );
    },
    async replaceReferences({ ownerType, ownerId, references }) {
      await db.query(
        "SELECT id FROM personal_site.site_settings WHERE id=true FOR UPDATE",
      );
      ownerId = String(ownerId);
      let owner;
      switch (ownerType) {
        case "draft":
          owner =
            ownerId === "draft" &&
            (
              await db.query(
                "SELECT id FROM personal_site.site_settings WHERE id=true",
              )
            ).rowCount;
          break;
        case "version":
          owner = (
            await db.query(
              "SELECT id FROM personal_site.versions WHERE id=$1",
              [ownerId],
            )
          ).rowCount;
          break;
        case "preview":
          owner = (
            await db.query(
              "SELECT id FROM personal_site.previews WHERE id=$1",
              [ownerId],
            )
          ).rowCount;
          break;
        case "resource":
          owner = (
            await db.query(
              "SELECT id FROM personal_site.resources WHERE id=$1",
              [ownerId],
            )
          ).rowCount;
          break;
        default:
          throw fail(400, "Invalid reference owner");
      }
      if (!owner) throw fail(404, "Reference owner does not exist");
      const ids = [...new Set(references.map((r) => r.resourceId))].sort();
      const locked = await db.query(
        "SELECT id,trashed FROM personal_site.resources WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE",
        [ids],
      );
      if (locked.rowCount !== ids.length)
        throw fail(400, "Referenced resource does not exist");
      if (locked.rows.some((r) => r.trashed))
        throw fail(409, "Referenced resource is trashed");
      await db.query(
        "DELETE FROM personal_site.resource_references WHERE owner_type=$1 AND owner_id=$2",
        [ownerType, ownerId],
      );
      for (const r of references)
        await db.query(
          "INSERT INTO personal_site.resource_references(resource_id,owner_type,owner_id,slot) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
          [r.resourceId, ownerType, ownerId, r.slot],
        );
    },
    // Owner-scoped frozen grants; references(id) below is the inverse lookup.
    async referencesForOwner({ownerType,ownerId}) {
      if(!['version','preview'].includes(ownerType))throw fail(400,'Invalid reference owner');
      const rows=(await db.query('SELECT resource_id,slot FROM personal_site.resource_references WHERE owner_type=$1 AND owner_id=$2',[ownerType,String(ownerId)])).rows;
      return normalizeReferences(rows.map(r=>({resourceId:r.resource_id,slot:r.slot})));
    },
    async references(id) {
      return (
        await db.query(
          "SELECT owner_type,owner_id,slot FROM personal_site.resource_references WHERE resource_id=$1 ORDER BY owner_type,owner_id,slot",
          [id],
        )
      ).rows.map((r) => ({
        ownerType: r.owner_type,
        ownerId: r.owner_id,
        slot: r.slot,
      }));
    },
    async isPublished(id) {
      return !!(
        await db.query(
          "SELECT 1 FROM personal_site.resource_references WHERE resource_id=$1 AND owner_type='version' LIMIT 1",
          [id],
        )
      ).rowCount;
    },
  };
  return repo;
}
module.exports = { resourceRepository };

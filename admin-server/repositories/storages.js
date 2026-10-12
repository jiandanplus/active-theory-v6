const fail = (status, message) => Object.assign(new Error(message), { status });
const map = (r) =>
  r
    ? {
        ...r.config,
        id: r.id,
        type: r.type,
        credentials: r.credentials === null ? null : JSON.parse(r.credentials),
        available: r.available,
      }
    : null;
function storageRepository(db) {
  return {
    async list() {
      return (
        await db.query("SELECT * FROM personal_site.storages ORDER BY id")
      ).rows.map(map);
    },
    async get(id) {
      return map(
        (
          await db.query("SELECT * FROM personal_site.storages WHERE id=$1", [
            id,
          ])
        ).rows[0],
      );
    },
    async upsert(storage) {
      const { id, type, credentials, available = true, ...config } = storage;
      await db.query(
        "SELECT id FROM personal_site.site_settings WHERE id=true FOR UPDATE",
      );
      const old = map(
        (
          await db.query(
            "SELECT * FROM personal_site.storages WHERE id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0],
      );
      if (old) {
        const used = await db.query(
          "SELECT id FROM personal_site.resources WHERE storage_id=$1 LIMIT 1",
          [id],
        );
        if (
          used.rowCount &&
          [
            "type",
            "endpoint",
            "bucket",
            "prefix",
            "publicBaseUrl",
            "forcePathStyle",
          ].some((k) => old[k] !== storage[k])
        )
          throw fail(409, "已有资源的存储位置不可更改，请新建配置");
      }
      const r = await db.query(
        "INSERT INTO personal_site.storages(id,type,config,credentials,available) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET type=EXCLUDED.type,config=EXCLUDED.config,credentials=EXCLUDED.credentials,available=EXCLUDED.available RETURNING *",
        [
          id,
          type,
          config,
          credentials === undefined
            ? old?.credentials
              ? JSON.stringify(old.credentials)
              : null
            : JSON.stringify(credentials),
          available,
        ],
      );
      return map(r.rows[0]);
    },
    async getDefault() {
      return (
        (
          await db.query(
            "SELECT default_storage FROM personal_site.site_settings WHERE id=true",
          )
        ).rows[0]?.default_storage || null
      );
    },
    async setDefault(id) {
      const r = await db.query(
        "UPDATE personal_site.site_settings SET default_storage=$1 WHERE id=true RETURNING id",
        [id],
      );
      if (!r.rowCount) throw fail(404, "网站不存在");
    },
  };
}
module.exports = { storageRepository };

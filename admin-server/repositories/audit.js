const { toSafeInteger } = require("../postgres");
const map = (r) => ({
  id: toSafeInteger(r.id),
  created: r.created.toISOString(),
  action: r.action,
  actor: r.actor,
});
function auditRepository(db) {
  return {
    async append(action, actor = null) {
      return map(
        (
          await db.query(
            "INSERT INTO personal_site.audit_events(action,actor) VALUES($1,$2) RETURNING *",
            [action, actor],
          )
        ).rows[0],
      );
    },
    async recent(limit = 10) {
      if (!Number.isSafeInteger(limit) || limit < 0 || limit > 1000)
        throw new RangeError("Invalid audit limit");
      return (
        await db.query(
          "SELECT * FROM personal_site.audit_events ORDER BY id DESC LIMIT $1",
          [limit],
        )
      ).rows.map(map);
    },
  };
}
module.exports = { auditRepository };

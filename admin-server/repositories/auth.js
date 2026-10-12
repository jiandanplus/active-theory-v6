const { toSafeInteger } = require("../postgres");
const fail = (status, message) => Object.assign(new Error(message), { status });
const session = (r) =>
  r
    ? {
        id: r.id,
        username: r.username,
        csrf: r.csrf,
        created: toSafeInteger(r.created),
        touched: toSafeInteger(r.touched),
      }
    : null;
function authRepository(db) {
  return {
    async getAdmin() {
      return (
        (
          await db.query(
            "SELECT username,hash FROM personal_site.admins WHERE id=true",
          )
        ).rows[0] || null
      );
    },
    async getSession(id) {
      return session(
        (
          await db.query("SELECT * FROM personal_site.sessions WHERE id=$1", [
            id,
          ])
        ).rows[0],
      );
    },
    async putSession(row) {
      if (!/^[a-f0-9]{64}$/.test(row.id))
        throw fail(400, "Session ID must be a SHA-256 digest");
      await db.query(
        "INSERT INTO personal_site.sessions(id,username,csrf,created,touched) VALUES($1,$2,$3,$4,$5)",
        [row.id, row.username, row.csrf, row.created, row.touched],
      );
    },
    async touchSession(id, now) {
      await db.query(
        "UPDATE personal_site.sessions SET touched=GREATEST(touched,$2) WHERE id=$1",
        [id, now],
      );
    },
    async deleteSession(id) {
      await db.query("DELETE FROM personal_site.sessions WHERE id=$1", [id]);
    },
    async clearSessions() {
      await db.query("DELETE FROM personal_site.sessions");
    },
    async pruneSessions(now) {
      await db.query(
        "DELETE FROM personal_site.sessions WHERE touched <= $1 OR created <= $2",
        [now - 12 * 60 * 60 * 1000, now - 7 * 24 * 60 * 60 * 1000],
      );
    },
    async replaceAdmin({ username, hash }) {
      await db.query(
        "SELECT id FROM personal_site.site_settings WHERE id=true FOR UPDATE",
      );
      await db.query(
        "DELETE FROM personal_site.resource_references WHERE owner_type='preview'",
      );
      await db.query("DELETE FROM personal_site.previews");
      await db.query("DELETE FROM personal_site.sessions");
      await db.query(
        "UPDATE personal_site.admins SET username=$1,hash=$2 WHERE id=true",
        [username, hash],
      );
      await db.query(
        "INSERT INTO personal_site.admins(id,username,hash) VALUES(true,$1,$2) ON CONFLICT(id) DO NOTHING",
        [username, hash],
      );
    },
    async reserveAttempt(keys, now, limit) {
      for (const key of [...new Set(keys)].sort()) {
        const r = await db.query(
          "INSERT INTO personal_site.login_attempts(key,count,expires) VALUES($1,1,$2) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN personal_site.login_attempts.expires <= $3 THEN 1 ELSE personal_site.login_attempts.count+1 END, expires=CASE WHEN personal_site.login_attempts.expires <= $3 THEN $2 ELSE personal_site.login_attempts.expires END WHERE personal_site.login_attempts.expires <= $3 OR personal_site.login_attempts.count < $4 RETURNING count",
          [key, now + 15 * 60000, now, limit],
        );
        if (!r.rowCount) throw fail(429, "尝试过于频繁，请稍后再试");
      }
      return true;
    },
    async clearAttempts(keys) {
      await db.query(
        "DELETE FROM personal_site.login_attempts WHERE key=ANY($1::text[])",
        [keys],
      );
    },
  };
}
module.exports = { authRepository };

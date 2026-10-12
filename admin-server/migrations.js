const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { createHash } = require("node:crypto");
const sql = readFileSync(join(__dirname, "migrations/001-initial.sql"), "utf8");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const checksum = digest(sql);
// PostgreSQL 18 catalog signature of the exact 001 schema, excluding row data.
const schemaSignature =
  "d707b879563d88ac731f0e95982187542f1d260bec0ad866110bc3f155f90534";

// Catalog definitions, not row data or object OIDs, detect structural drift.
const signatureQuery = `
 SELECT kind, name, definition FROM (
 SELECT 'relation' AS kind, c.relname AS name, c.relkind::text || ':' || c.relrowsecurity || ':' || c.relforcerowsecurity AS definition
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='personal_site'
 UNION ALL
 SELECT 'column', c.relname || '.' || a.attname,
 format_type(a.atttypid,a.atttypmod) || ':' || a.attnotnull || ':' || a.attidentity::text || ':' || COALESCE(pg_get_expr(d.adbin,d.adrelid),'')
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE n.nspname='personal_site' AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped
 UNION ALL
 SELECT 'constraint', c.relname || '.' || k.conname, pg_get_constraintdef(k.oid)
 FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='personal_site'
 UNION ALL
 SELECT 'index', indexname, indexdef FROM pg_indexes WHERE schemaname='personal_site'
 UNION ALL
 SELECT 'function', p.proname || ':' || pg_get_function_identity_arguments(p.oid), p.prokind::text
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='personal_site'
 UNION ALL
 SELECT 'type', t.typname, t.typtype::text
 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='personal_site'
 UNION ALL
 SELECT 'trigger', c.relname || '.' || tr.tgname, pg_get_triggerdef(tr.oid)
 FROM pg_trigger tr JOIN pg_class c ON c.oid=tr.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='personal_site' AND NOT tr.tgisinternal
 ) definitions ORDER BY kind COLLATE "C", name COLLATE "C"`;

async function inspectInstallation(store) {
  const exists = (
    await store.query(
      "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='personal_site') AS present",
    )
  ).rows[0].present;
  if (!exists) return { state: "uninstalled", schemaVersion: null };
  const signature = digest(
    JSON.stringify((await store.query(signatureQuery)).rows),
  );
  if (signature !== schemaSignature)
    return { state: "incompatible", schemaVersion: null };
  const versions = (
    await store.query(
      "SELECT version,checksum FROM personal_site.schema_migrations ORDER BY version",
    )
  ).rows;
  if (
    versions.length !== 1 ||
    versions[0].version !== 1 ||
    versions[0].checksum !== checksum
  )
    return { state: "incompatible", schemaVersion: null };
  const rows = (
    await store.query("SELECT schema_version FROM personal_site.installation")
  ).rows;
  if (rows.length > 1 || (rows.length && rows[0].schema_version !== 1))
    return { state: "incompatible", schemaVersion: 1 };
  return { state: rows.length ? "installed" : "uninstalled", schemaVersion: 1 };
}
async function migrate(tx) {
  await tx.query("SELECT pg_advisory_xact_lock($1)", [734216901]);
  const state = await inspectInstallation(tx);
  if (state.state === "incompatible")
    throw new Error("Incompatible personal_site schema");
  if (state.schemaVersion !== null) return;
  await tx.query(sql);
  await tx.query(
    "INSERT INTO personal_site.schema_migrations(version,checksum) VALUES($1,$2)",
    [1, checksum],
  );
}
module.exports = { migrate, inspectInstallation, checksum };

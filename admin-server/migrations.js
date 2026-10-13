const { createHash } = require("node:crypto");
const {migrations,currentSchemaVersion,checksum,schemaSignature} = require('./migration-registry');
const {validateIdentity} = require('../shared/site-identity');
const digest = (value) => createHash("sha256").update(value).digest("hex");

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

async function supportedPostgresVersion(store) {
  const version = (
    await store.query(
      "SELECT current_setting('server_version_num')::int AS server_version",
    )
  ).rows[0].server_version;
  return version >= 180000 && version < 190000;
}

function knownPrefix(rows) {
  return rows.length > 0 && rows.length <= migrations.length && rows.every((row,index)=>
    row.version===migrations[index].version && row.checksum===migrations[index].checksum);
}
async function inspectInstallation(store,{verifyStructure=true}={}) {
  if (store.configured === false) return {state:'unconfigured',schemaVersion:null};
  if (!(await supportedPostgresVersion(store)))
    return { state: "incompatible", schemaVersion: null };
  const exists = (
    await store.query(
      "SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='personal_site') AS present",
    )
  ).rows[0].present;
  if (!exists) return { state: "uninstalled", schemaVersion: null };
  // Check catalog before reading tables: missing tables are incompatible here,
  // while the lightweight request guard still lets query failures propagate.
  let catalogSignature;
  if (verifyStructure) {
    catalogSignature = digest(JSON.stringify((await store.query(signatureQuery)).rows));
    if (!migrations.some(migration=>migration.schemaSignature===catalogSignature))
      return { state: "incompatible", schemaVersion: null };
  }
  const versions = (
    await store.query(
      "SELECT version,checksum FROM personal_site.schema_migrations ORDER BY version",
    )
  ).rows;
  if (!knownPrefix(versions))
    return { state: "incompatible", schemaVersion: null };
  const schemaVersion = versions.at(-1).version;
  if (verifyStructure && catalogSignature !== migrations[schemaVersion-1].schemaSignature)
    return { state: "incompatible", schemaVersion: null };
  const rows = (
    await store.query("SELECT schema_version FROM personal_site.installation")
  ).rows;
  if (rows.length > 1 || rows.some(row=>row.schema_version !== schemaVersion))
    return { state: "incompatible", schemaVersion };
  return { state: !rows.length ? "uninstalled" : schemaVersion < currentSchemaVersion ? "upgrade_required" : "installed", schemaVersion };
}
async function migrate(tx) {
  await tx.query("SELECT pg_advisory_xact_lock($1)", [734216901]);
  if (!(await supportedPostgresVersion(tx)))
    throw Object.assign(new Error("PostgreSQL 18 is required"), {
      status: 503,
    });
  const state = await inspectInstallation(tx);
  if (!['uninstalled','upgrade_required','installed'].includes(state.state))
    throw new Error("Incompatible personal_site schema");
  for (const migration of migrations.filter(m=>m.version>(state.schemaVersion||0))) {
    await tx.query(migration.sql);
    await tx.query('INSERT INTO personal_site.schema_migrations(version,checksum) VALUES($1,$2)',[migration.version,migration.checksum]);
    await tx.query('UPDATE personal_site.installation SET schema_version=$1',[migration.version]);
    const after = await inspectInstallation(tx);
    if (after.state==='incompatible' || after.schemaVersion!==migration.version) throw Error('Migration validation failed');
  }
  const identities=(await tx.query("SELECT site FROM personal_site.site_settings UNION ALL SELECT schema_config->'site' AS site FROM personal_site.templates")).rows;
  for(const row of identities) validateIdentity(row.site);
}
module.exports = {
  migrate,
  inspectInstallation,
  checksum,
  supportedPostgresVersion,
  currentSchemaVersion,
  signatureQuery,
  schemaSignature,
};

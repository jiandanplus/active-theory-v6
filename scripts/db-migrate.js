#!/usr/bin/env node
const {openPostgres} = require('../admin-server/postgres');
const {inspectInstallation, migrate, currentSchemaVersion} = require('../admin-server/migrations');
const {loadOptions} = require('../admin-server/options');

async function upgradeInstalled(store) {
  return store.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [734216901]);
    const before = await inspectInstallation(tx);
    if (!['installed','upgrade_required'].includes(before.state))
      throw Object.assign(new Error(before.state === 'incompatible' ? 'Database schema is incompatible' : 'An installed instance is required; use the web installer first'),
        {code:before.state==='incompatible'?'SCHEMA_INCOMPATIBLE':'NOT_INSTALLED'});
    await migrate(tx);
    const after = await inspectInstallation(tx);
    if (after.state!=='installed' || after.schemaVersion!==currentSchemaVersion)
      throw Object.assign(Error('Database upgrade verification failed'),{code:'SCHEMA_VERIFICATION_FAILED'});
    return {schemaVersion:after.schemaVersion,previousSchemaVersion:before.schemaVersion,
      upgraded:after.schemaVersion!==before.schemaVersion};
  });
}

async function main() {
  const options = loadOptions();
  if (!options.databaseUrl) throw new Error('DATABASE_URL is required');
  const store = openPostgres({databaseUrl:options.databaseUrl,ssl:options.databaseSSL});
  try {
    const result = await upgradeInstalled(store);
    console.log(result.upgraded
      ? `Installed schema upgraded from ${result.previousSchemaVersion} to ${result.schemaVersion}; no administrator was created.`
      : `Installed schema verified at version ${result.schemaVersion}; no administrator was created.`);
  } finally { await store.close(); }
}
if (require.main === module) main().catch(error => {
  const messages={NOT_INSTALLED:'An installed instance is required; use the web installer first.',
    SCHEMA_INCOMPATIBLE:'Database schema is incompatible; inspect the backup and migration checksums.',
    SCHEMA_VERIFICATION_FAILED:'Database upgrade verification failed; transaction was not accepted.'};
  const connectionFailure=['ECONNREFUSED','ENOTFOUND','ETIMEDOUT','ECONNRESET','28P01','3D000'].includes(error.code);
  console.error(messages[error.code]||(connectionFailure
    ?'Database connection failed; check PostgreSQL 18, credentials and network.'
    :'Database upgrade failed; inspect the isolated diagnostics before retrying.'));
  process.exitCode = 1;
});
module.exports = {upgradeInstalled, main};

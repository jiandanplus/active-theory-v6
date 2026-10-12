#!/usr/bin/env node
const {openPostgres} = require('../admin-server/postgres');
const {inspectInstallation, migrate} = require('../admin-server/migrations');
const {loadOptions} = require('../admin-server/options');

async function upgradeInstalled(store) {
  return store.transaction(async tx => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [734216901]);
    const before = await inspectInstallation(tx);
    if (before.state !== 'installed')
      throw new Error(before.state === 'incompatible' ? 'Database schema is incompatible' : 'An installed instance is required; use the web installer first');
    await migrate(tx);
    const after = await inspectInstallation(tx);
    return {schemaVersion:after.schemaVersion};
  });
}

async function main() {
  const options = loadOptions();
  if (!options.databaseUrl) throw new Error('DATABASE_URL is required');
  const store = openPostgres({databaseUrl:options.databaseUrl});
  try {
    const result = await upgradeInstalled(store);
    console.log(`Installed schema verified at version ${result.schemaVersion}; no administrator was created.`);
  } finally { await store.close(); }
}
if (require.main === module) main().catch(() => {
  console.error('Database upgrade failed. Check installation, PostgreSQL 18 compatibility and migration checksums during the maintenance window.');
  process.exitCode = 1;
});
module.exports = {upgradeInstalled, main};

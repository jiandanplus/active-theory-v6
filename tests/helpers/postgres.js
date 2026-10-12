const {randomUUID} = require('node:crypto');
const {openPostgres} = require('../../admin-server/postgres');
const {migrate} = require('../../admin-server/migrations');

async function postgresFixture(t, {migrated = true} = {}) {
  if (!process.env.TEST_DATABASE_URL || process.env.TEST_DATABASE_CONFIRMED !== 'yes') {
    throw new Error('Use node scripts/test-postgres.js after docker compose -f compose.test.yaml -p site-pg-test up -d --wait; custom TEST_DATABASE_URL requires TEST_DATABASE_CONFIRMED=yes.');
  }
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.pathname.startsWith('/site_test_')) throw new Error('TEST_DATABASE_URL must point to a dedicated site_test_ database');
  const name = `site_test_${randomUUID().replaceAll('-', '')}`;
  if (!/^site_test_[a-f0-9]{32}$/.test(name)) throw new Error('Invalid isolated database name');
  const control = openPostgres({databaseUrl:url.href});
  let store;
  try {
    await control.query(`CREATE DATABASE "${name}"`);
    url.pathname = `/${name}`;
    store = openPostgres({databaseUrl:url.href});
    t.after(async () => {
      try {
        await store.close();
        await control.query(`DROP DATABASE "${name}"`);
      } finally { await control.close(); }
    });
    if (migrated) await store.transaction(migrate);
    return {store, databaseUrl:url.href};
  } catch (error) {
    if (!store) await control.close();
    throw error;
  }
}
module.exports = {postgresFixture};

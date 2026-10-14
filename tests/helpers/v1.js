const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {createHash} = require('node:crypto');
const {postgresFixture} = require('./postgres');
const {contentFixture} = require('./content');
const {legacyBundle,seedLegacy} = require('./legacy-seed');
async function v1Fixture(t) {
  const fixture = await postgresFixture(t,{migrated:false});
  const content = contentFixture(t);
  const bundle = legacyBundle();
  const sql = readFileSync(join(__dirname,'../../admin-server/migrations/001-initial.sql'),'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  await fixture.store.transaction(async tx => {
    await tx.query(sql);
    await tx.query('INSERT INTO personal_site.schema_migrations(version,checksum) VALUES(1,$1)',[checksum]);
    await seedLegacy(tx,bundle);
  });
  return {...fixture,...content,bundle};
}
module.exports = {v1Fixture};

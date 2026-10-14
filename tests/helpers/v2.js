const {v1Fixture} = require('./v1');
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {createHash} = require('node:crypto');
async function v2Fixture(t) {
  const f = await v1Fixture(t);
  const sql = readFileSync(join(__dirname,'../../admin-server/migrations/002-site-identity.sql'),'utf8');
  await f.store.transaction(async tx=>{
    await tx.query(sql);
    await tx.query('INSERT INTO personal_site.schema_migrations(version,checksum) VALUES(2,$1)',[createHash('sha256').update(sql).digest('hex')]);
    await tx.query('UPDATE personal_site.installation SET schema_version=2');
  });
  return f;
}
module.exports = {v2Fixture};

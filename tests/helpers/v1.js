const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {createHash} = require('node:crypto');
const {postgresFixture} = require('./postgres');
const {contentFixture} = require('./content');
const {contentRepository} = require('../../admin-server/repositories/content');
async function v1Fixture(t) {
  const fixture = await postgresFixture(t,{migrated:false});
  const content = contentFixture(t);
  const bundle = structuredClone(content.bundle);
  bundle.versions.push({...structuredClone(bundle.versions[0]),id:43});
  for(const config of [bundle.draft.config,bundle.schema,...bundle.versions.map(v=>v.snapshot.config)])
    for(const key of ['description','language','socialImage']) delete config.site[key];
  bundle.storages.push({id:'fixture-cloud',type:'s3',name:'Fake credentials preservation',
    credentials:{iv:'fixture-not-a-key',tag:'fixture-not-a-key',ciphertext:'fixture-not-a-key'}});
  const sql = readFileSync(join(__dirname,'../../admin-server/migrations/001-initial.sql'),'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  await fixture.store.transaction(async tx => {
    await tx.query(sql);
    await tx.query('INSERT INTO personal_site.schema_migrations(version,checksum) VALUES(1,$1)',[checksum]);
    await contentRepository(tx).importBundle(bundle);
    await contentRepository(tx).putPreview({id:'preview-fixture-upgrade',owner:'admin',
      expires:new Date('2099-01-01T00:00:00Z'),snapshot:bundle.draft});
    await tx.query("INSERT INTO personal_site.sessions(id,username,csrf,created,touched) VALUES('fixture-session','admin','fixture-csrf',1,1)");
    await tx.query("UPDATE personal_site.site_settings SET site=site-ARRAY['description','language','socialImage']::text[]");
    await tx.query("UPDATE personal_site.templates SET schema_config=jsonb_set(schema_config,'{site}',(schema_config->'site')-ARRAY['description','language','socialImage']::text[])");
    await tx.query("INSERT INTO personal_site.installation(source,schema_version) VALUES('fixture',1)");
  });
  return {...fixture,...content,bundle};
}
module.exports = {v1Fixture};

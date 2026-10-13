const {test} = require('node:test');
const assert = require('node:assert/strict');
const {v1Fixture} = require('./helpers/v1');
const {upgradeInstalled} = require('../scripts/db-migrate');
const {inspectInstallation} = require('../admin-server/migrations');
function inspectorWithSignatures(signatures) {
  const filename = require.resolve('../admin-server/migrations');
  const {createRequire} = require('node:module');
  const localRequire = createRequire(filename);
  const registry = localRequire('./migration-registry');
  const replacement = {...registry,migrations:Object.freeze(registry.migrations.map((entry,index)=>
    Object.freeze({...entry,schemaSignature:signatures[index]})))};
  const module = {exports:{}};
  require('node:vm').runInNewContext(require('node:fs').readFileSync(filename,'utf8'),{
    module,exports:module.exports,
    require:name=>name==='./migration-registry'?replacement:localRequire(name),
  },{filename});
  return module.exports;
}
test('inspection accepts a known catalog signature assigned to the recorded version',async t=>{
  const {store} = await require('./helpers/postgres').postgresFixture(t);
  await store.query("ALTER TABLE personal_site.site_settings ADD COLUMN signature_fixture text");
  await store.query("INSERT INTO personal_site.installation(source,schema_version) VALUES('fixture',2)");
  const {schemaSignature,signatureQuery} = require('../admin-server/migrations');
  const changed = require('node:crypto').createHash('sha256').update(JSON.stringify((await store.query(signatureQuery)).rows)).digest('hex');
  const inspect = inspectorWithSignatures([schemaSignature,changed]).inspectInstallation;
  assert.equal((await inspect(store)).state,'installed');
});
test('inspection rejects another known version catalog even when the prefix checksum matches',async t=>{
  const {store} = await require('./helpers/postgres').postgresFixture(t);
  await store.query("INSERT INTO personal_site.installation(source,schema_version) VALUES('fixture',2)");
  const {schemaSignature} = require('../admin-server/migrations');
  const inspect = inspectorWithSignatures([schemaSignature,'different-version-signature']).inspectInstallation;
  assert.equal((await inspect(store)).state,'incompatible');
  const light = {query:async(sql,args)=>{
    assert.notEqual(sql,require('../admin-server/migrations').signatureQuery,'lightweight inspection must not scan catalogs');
    return store.query(sql,args);
  }};
  assert.equal((await inspect(light,{verifyStructure:false})).state,'installed');
});
test('new imports normalize current identity but leave historical snapshots untouched', async t=>{
  const {store} = await require('./helpers/postgres').postgresFixture(t);
  const {bundle} = require('./helpers/content').contentFixture(t);
  const repo = require('../admin-server/repositories/content').contentRepository(store);
  await store.transaction(tx=>require('../admin-server/repositories/content').contentRepository(tx).importBundle(bundle));
  assert.equal((await repo.getDraft()).config.site.language,'en');
  assert.equal((await store.query('SELECT schema_config FROM personal_site.templates')).rows[0].schema_config.site.language,'en');
  assert.deepEqual((await repo.getVersion(42)).snapshot.config,bundle.versions[0].snapshot.config);
});
async function preserved(store) {
  const tables = ['admins','sessions','storages','resources','projects','songs','scenes','versions','previews','resource_references','audit_events'];
  const data = {};
  for (const table of tables) {
    const rows = (await store.query(`SELECT row_to_json(t) AS row FROM personal_site.${table} t`)).rows;
    data[table] = rows.map(row=>JSON.stringify(row.row)).sort();
  }
  data.installation = (await store.query('SELECT source,completed_at FROM personal_site.installation')).rows;
  data.published = (await store.query('SELECT published FROM personal_site.site_settings')).rows;
  return data;
}
test('V1 upgrades once, preserves history and serializes competitors', async t => {
  const {store} = await v1Fixture(t);
  const before = await preserved(store);
  const revision = (await store.query('SELECT revision FROM personal_site.site_settings')).rows[0].revision;
  const historySql = 'SELECT id,created,snapshot::text AS snapshot FROM personal_site.versions ORDER BY id';
  const previewsSql = 'SELECT id,owner,expires,snapshot::text AS snapshot FROM personal_site.previews ORDER BY id';
  const credentialsSql = 'SELECT id,credentials FROM personal_site.storages ORDER BY id';
  const beforeHistory = (await store.query(historySql)).rows;
  const beforePreviews = (await store.query(previewsSql)).rows;
  const beforeCredentials = (await store.query(credentialsSql)).rows;
  assert.equal(beforeHistory.length,2);
  assert.equal(beforePreviews.length,1);
  assert.ok(beforeCredentials.some(row=>row.id==='fixture-cloud' && row.credentials));
  assert.deepEqual(await inspectInstallation(store),{state:'upgrade_required',schemaVersion:1});
  const results = await Promise.all([upgradeInstalled(store),upgradeInstalled(store)]);
  assert.equal(results.filter(r=>r.upgraded).length,1);
  assert.deepEqual(await inspectInstallation(store),{state:'installed',schemaVersion:2});
  assert.deepEqual(await preserved(store),before);
  assert.deepEqual((await store.query(historySql)).rows,beforeHistory);
  assert.deepEqual((await store.query(previewsSql)).rows,beforePreviews);
  assert.deepEqual((await store.query(credentialsSql)).rows,beforeCredentials);
  assert.equal((await store.query("SELECT snapshot->'config'->'site' ? 'language' AS present FROM personal_site.versions WHERE id=42")).rows[0].present,false);
  assert.equal((await store.query("SELECT schema_config->'site'->>'language' AS language FROM personal_site.templates")).rows[0].language,'en');
  const row = (await store.query('SELECT site,revision FROM personal_site.site_settings')).rows[0];
  assert.equal(row.revision,revision+1);
  assert.equal(row.site.language,'en');
  assert.equal(row.site.description,'');
  assert.equal(row.site.socialImage,'');
  assert.equal((await upgradeInstalled(store)).upgraded,false);
  assert.equal((await store.query('SELECT revision FROM personal_site.site_settings')).rows[0].revision,revision+1);
});
test('failure after 002 SQL rolls back data and migration records', async t => {
  const {store} = await v1Fixture(t);
  const before = await preserved(store);
  const settings = (await store.query('SELECT * FROM personal_site.site_settings')).rows;
  const schemas = (await store.query('SELECT id,schema_config::text AS schema FROM personal_site.templates')).rows;
  const broken = {transaction:fn=>store.transaction(tx=>fn({query:async(sql,args=[])=>{
    const result=await tx.query(sql,args);
    if (/INSERT INTO personal_site\.schema_migrations/.test(sql) && args[0]===2) throw Error('injected');
    return result;
  }}))};
  await assert.rejects(upgradeInstalled(broken),/injected/);
  assert.deepEqual(await preserved(store),before);
  assert.deepEqual((await store.query('SELECT * FROM personal_site.site_settings')).rows,settings);
  assert.deepEqual((await store.query('SELECT id,schema_config::text AS schema FROM personal_site.templates')).rows,schemas);
  assert.deepEqual((await store.query('SELECT version FROM personal_site.schema_migrations')).rows,[{version:1}]);
});
test('upgrade preserves existing identity values and fills only missing keys', async t=>{
  const {store} = await v1Fixture(t);
  const identity = {description:'Existing description',language:'zh-CN',socialImage:'/media/image'};
  await store.query('UPDATE personal_site.site_settings SET site=site || $1::jsonb',[identity]);
  await store.query("UPDATE personal_site.templates SET schema_config=jsonb_set(schema_config,'{site}',(schema_config->'site') || $1::jsonb)",[identity]);
  await upgradeInstalled(store);
  for(const row of (await store.query("SELECT site FROM personal_site.site_settings UNION ALL SELECT schema_config->'site' AS site FROM personal_site.templates")).rows)
    for(const [key,value] of Object.entries(identity)) assert.equal(row.site[key],value);
});
for(const [name,sql] of [
  ['non-object current site',"UPDATE personal_site.site_settings SET site='null'::jsonb"],
  ['non-object template identity',"UPDATE personal_site.templates SET schema_config=jsonb_set(schema_config,'{site}','[]'::jsonb)"],
  ['invalid existing language',"UPDATE personal_site.site_settings SET site=site || '{\"language\":\"invalid\"}'::jsonb"]
]) test(`upgrade rolls back ${name}`,async t=>{
  const {store} = await v1Fixture(t);
  await store.query(sql);
  const settings=(await store.query('SELECT * FROM personal_site.site_settings')).rows;
  const templates=(await store.query('SELECT * FROM personal_site.templates')).rows;
  await assert.rejects(upgradeInstalled(store));
  assert.deepEqual((await store.query('SELECT * FROM personal_site.site_settings')).rows,settings);
  assert.deepEqual((await store.query('SELECT * FROM personal_site.templates')).rows,templates);
  assert.deepEqual((await store.query('SELECT version FROM personal_site.schema_migrations')).rows,[{version:1}]);
  assert.deepEqual(await inspectInstallation(store),{state:'upgrade_required',schemaVersion:1});
});
test('V1 maintenance never permits setup overwrite', async t=>{
  const {store} = await v1Fixture(t);
  const f = await require('./helpers/http').httpFixture(t,{store,installed:false});
  const before = await preserved(store);
  const status = await f.request('/api/setup/status');
  assert.equal(status.status,503);
  assert.equal((await status.json()).state,'upgrade_required');
  const page = await f.request('/');
  assert.equal(page.status,503);
  assert.match(await page.text(),/网站需要维护升级/);
  const headers = await f.setupSession();
  assert.equal((await f.request('/api/setup/database',{headers})).status,503);
  for (const path of ['/api/setup/preflight','/api/setup/install']) {
    const response = await f.request(path,{method:'POST',headers,body:JSON.stringify({mode:'empty'})});
    assert.equal(response.status,503);
  }
  assert.deepEqual(await preserved(store),before);
});
for (const [name,sql] of [
  ['checksum',"UPDATE personal_site.schema_migrations SET checksum='corrupt' WHERE version=1"],
  ['gap',"DELETE FROM personal_site.schema_migrations WHERE version=1"],
  ['future',"INSERT INTO personal_site.schema_migrations(version,checksum) VALUES(99,'future')"],
  ['structure',"ALTER TABLE personal_site.site_settings ADD COLUMN unexpected text"],
  ['missing table',"DROP TABLE personal_site.sessions"]
]) test(`upgrade refuses ${name}`,async t=>{
  const {store} = await v1Fixture(t);
  await store.query(sql);
  assert.deepEqual(await inspectInstallation(store),{state:'incompatible',schemaVersion:null});
  await assert.rejects(upgradeInstalled(store));
  assert.equal((await store.query('SELECT count(*)::int AS n FROM personal_site.admins')).rows[0].n,1);
});

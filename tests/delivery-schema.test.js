const {test} = require('node:test');
const assert = require('node:assert/strict');
const {v1Fixture} = require('./helpers/v1');
const {v2Fixture} = require('./helpers/v2');
const {upgradeInstalled} = require('../scripts/db-migrate');
const {inspectInstallation} = require('../admin-server/migrations');
async function retained(store) {
  const data={};
  for(const table of ['admins','sessions','storages','resources','projects','songs','scenes','versions','previews','resource_references','audit_events','site_settings','templates'])
    data[table]=(await store.query(`SELECT row_to_json(t)::text AS row FROM personal_site.${table} t ORDER BY row_to_json(t)::text`)).rows;
  data.installation=(await store.query('SELECT id,source,completed_at FROM personal_site.installation')).rows;
  return data;
}
test('frozen V1 seed contains complete history, assets and explicit references',async t=>{
  const {store,bundle} = await v1Fixture(t);
  assert.equal((await inspectInstallation(store)).schemaVersion,1);
  assert.deepEqual((await store.query('SELECT id,snapshot FROM personal_site.versions ORDER BY id')).rows,bundle.versions.map(v=>({id:String(v.id),snapshot:v.snapshot})));
  assert.equal((await store.query('SELECT count(*)::int AS n FROM personal_site.resource_references')).rows[0].n,28);
  assert.equal((await store.query('SELECT count(*)::int AS n FROM personal_site.resources')).rows[0].n,4);
  assert.equal((await store.query("SELECT count(*)::int AS n FROM personal_site.resource_references WHERE resource_id='unused'")).rows[0].n,0);
  const configs=(await store.query("SELECT site FROM personal_site.site_settings UNION ALL SELECT schema_config->'site' FROM personal_site.templates UNION ALL SELECT snapshot->'config'->'site' FROM personal_site.versions UNION ALL SELECT snapshot->'config'->'site' FROM personal_site.previews")).rows;
  for(const {site} of configs) for(const key of ['description','language','socialImage']) assert.equal(Object.hasOwn(site,key),false);
  assert.equal((await store.query("SELECT nextval(pg_get_serial_sequence('personal_site.versions','id')) AS id")).rows[0].id,'44');
});
test('V2 adds explicit legacy bindings without changing revision or history',async t=>{
  const {store}=await v2Fixture(t);
  const before=await retained(store);
  const settings=(await store.query('SELECT revision,published FROM personal_site.site_settings')).rows;
  const history=(await store.query('SELECT id,created,snapshot::text FROM personal_site.versions ORDER BY id')).rows;
  await upgradeInstalled(store);
  assert.equal((await inspectInstallation(store)).schemaVersion,3);
  assert.deepEqual((await store.query('SELECT revision,published FROM personal_site.site_settings')).rows,settings);
  assert.deepEqual((await store.query('SELECT id,created,snapshot::text FROM personal_site.versions ORDER BY id')).rows,history);
  const bindings=(await store.query('SELECT mode,artifact_digest FROM personal_site.delivery_bindings')).rows;
  assert.equal(bindings.length,3);
  assert(bindings.every(b=>b.mode==='legacy'&&b.artifact_digest===null));
  assert.deepEqual(await retained(store),before);
  assert.deepEqual((await store.query('SELECT version_id,preview_id FROM personal_site.delivery_bindings ORDER BY id')).rows,[{version_id:'42',preview_id:null},{version_id:'43',preview_id:null},{version_id:null,preview_id:'preview-fixture-upgrade'}]);
});
test('V2 concurrent upgrades apply schema3 once and preserve all legacy data',async t=>{
  const {store}=await v2Fixture(t);
  const before=await retained(store);
  const results=await Promise.all([upgradeInstalled(store),upgradeInstalled(store)]);
  assert.equal(results.filter(r=>r.upgraded).length,1);
  assert.deepEqual(await retained(store),before);
  assert.equal((await store.query('SELECT count(*)::int AS n FROM personal_site.delivery_bindings')).rows[0].n,3);
});
test('failure midway through 003 rolls back tables, records and legacy data',async t=>{
  const {store}=await v2Fixture(t);
  const before=await retained(store);
  const broken={transaction:fn=>store.transaction(tx=>fn({query:async(sql,args)=>{
    if(sql.includes('CREATE TABLE personal_site.runtime_bundles')) {
      await tx.query(sql.slice(0,sql.indexOf('CREATE TABLE personal_site.delivery_artifacts')));
      throw Error('injected midway 003');
    }
    return tx.query(sql,args);
  }}))};
  await assert.rejects(upgradeInstalled(broken),/injected midway 003/);
  assert.deepEqual(await retained(store),before);
  assert.deepEqual((await store.query('SELECT version FROM personal_site.schema_migrations ORDER BY version')).rows,[{version:1},{version:2}]);
  for(const name of ['runtime_bundles','runtime_selection','delivery_artifacts','delivery_bindings']) assert.equal((await store.query('SELECT to_regclass($1) AS name',[`personal_site.${name}`])).rows[0].name,null);
  assert.deepEqual(await inspectInstallation(store),{state:'upgrade_required',schemaVersion:2});
  assert.equal((await upgradeInstalled(store)).schemaVersion,3);
});
test('delivery constraints enforce targets, pinned artifacts, manifest versions and generations',async t=>{
  const {store}=await v2Fixture(t);
  await upgradeInstalled(store);
  const checks=(await store.query("SELECT conname,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='personal_site.delivery_bindings'::regclass AND contype='c'")).rows;
  const xor=checks.find(r=>r.definition.includes('version_id IS NULL')&&r.definition.includes('preview_id IS NULL'));
  assert.equal(xor.conname,'delivery_bindings_check');
  for(const sql of [
    "INSERT INTO personal_site.delivery_bindings(mode) VALUES('legacy')",
    "INSERT INTO personal_site.delivery_bindings(version_id,preview_id,mode) VALUES(42,'preview-fixture-upgrade','legacy')",
  ])await assert.rejects(store.query(sql),{code:'23514',constraint:xor.conname});
  for(const sql of [
    "UPDATE personal_site.delivery_bindings SET mode='pinned' WHERE version_id=42",
    "UPDATE personal_site.delivery_bindings SET generation=-1 WHERE version_id=42",
    "UPDATE personal_site.runtime_selection SET generation=-1",
    "INSERT INTO personal_site.runtime_bundles(digest,profile_id,manifest) VALUES(repeat('a',64),'fixture','{}')",
    "INSERT INTO personal_site.runtime_bundles(digest,profile_id,manifest) VALUES('bad','fixture','{\"manifestVersion\":1}')",
  ]) await assert.rejects(store.query(sql));
  await assert.rejects(store.query("INSERT INTO personal_site.delivery_bindings(version_id,mode) VALUES(42,'legacy')"),{code:'23505'});
  await assert.rejects(store.query("INSERT INTO personal_site.delivery_bindings(version_id,mode) VALUES(999,'legacy')"),{code:'23503'});
  await assert.rejects(store.query("INSERT INTO personal_site.delivery_bindings(preview_id,mode) VALUES('preview-fixture-upgrade','legacy')"),{code:'23505'});
  await assert.rejects(store.query("UPDATE personal_site.delivery_bindings SET artifact_digest=repeat('a',64) WHERE version_id=42"),{code:'23503'});
  await assert.rejects(store.query("INSERT INTO personal_site.delivery_artifacts(digest,runtime_digest,kind,manifest) VALUES(repeat('a',64),repeat('b',64),'pinned','{\"manifestVersion\":1}')"),{code:'23503'});
  await store.query("DELETE FROM personal_site.previews WHERE id='preview-fixture-upgrade'");
  assert.equal((await store.query('SELECT count(*)::int AS n FROM personal_site.delivery_bindings')).rows[0].n,2);
  await store.query("INSERT INTO personal_site.versions(id,snapshot) VALUES(44,'{}')");
  assert.equal((await store.query('SELECT count(*)::int AS n FROM personal_site.delivery_bindings WHERE version_id=44')).rows[0].n,0,'no blanket legacy insertion trigger');
});

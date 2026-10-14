const {test}=require('node:test');
const assert=require('node:assert/strict');
const {contentRepository}=require('../admin-server/repositories/content');
const {deliveryFixture}=require('./helpers/delivery');
const {buildArtifact}=require('../admin-server/delivery/builder');
const {digestJSON,assertArtifactManifest}=require('../admin-server/delivery/contracts');
function barrier(){let enter,release;return {entered:new Promise(r=>enter=r),released:new Promise(r=>release=r),enter:()=>enter(),release:()=>release()};}
async function state(store){
  const values={draft:await contentRepository(store).getDraft(),versions:await contentRepository(store).listVersions()};
  for(const table of ['delivery_artifacts','delivery_bindings','resource_references','audit_events'])values[table]=(await store.query(`SELECT * FROM personal_site.${table} ORDER BY 1,2`)).rows;
  return values;
}
test('publish atomically binds independently captured identity and preserves raw source; restart forwards fresh getters',async t=>{
  const f=await deliveryFixture(t),before=await contentRepository(f.store).getDraft();
  const result=await f.service.publish({revision:before.revision,actor:f.actor,withWarnings:true});
  assert.equal(result.version,43);assert.ok(Array.isArray(result.warnings));
  const version=await contentRepository(f.store).getVersion(result.version);
  assert.deepEqual(version.snapshot,before.snapshot);
  const {deliveryRepository}=require('../admin-server/repositories/deliveries');
  const binding=await deliveryRepository(f.store).getBinding({type:'version',id:String(result.version)});
  assert.equal(binding.mode,'pinned');
  const artifact=await deliveryRepository(f.store).getArtifact(binding.artifactDigest);
  for(const entry of artifact.manifest.files)assert.equal((await f.cas.read(entry)).length,entry.size);
  const oldStore=f.store,oldService=f.service;
  await f.restart();assert.notEqual(f.store,oldStore);assert.notEqual(f.service,oldService);
  assert.equal(f.cas,f.service.cas);assert.equal(f.app.locals.deliveryService,f.service);
  assert.equal(await f.service.publish({revision:3,actor:f.actor}),44);
});
for(const [name,status,mutate] of [
  ['draft',409,async f=>{const d=await contentRepository(f.store).getDraft();d.config.site.title='changed';await require('../admin-server/config').saveDraft(f.store,d.config,d.revision);}],
  ['selection',409,async f=>{
    const fs=require('node:fs/promises'),{sha256}=require('../admin-server/delivery/contracts');
    const manifest=structuredClone(f.runtime.manifest),entry=manifest.files.find(file=>file.key==='app');
    const bytes=Buffer.from('self.TEST_RUNTIME = true; // another registered runtime');
    await fs.writeFile(f.runtimeAppPath,bytes);entry.size=bytes.length;entry.sha256=sha256(bytes);
    const registered=await f.service.register({root:f.runtime.root,manifest,actor:f.actor});
    await f.service.select({digest:registered.digest,expectedGeneration:1,actor:f.actor});
  }],
  ['resource',422,async f=>{await f.store.transaction(async tx=>{await contentRepository(tx).getDraft({lock:true});await tx.query("UPDATE personal_site.resources SET status='disabled' WHERE id='image'");});}],
  ['logout',401,async f=>{await require('../admin-server/repositories/auth').authRepository(f.store).deleteSession(f.actor.id);}],
  ['reset',401,async f=>{await f.store.transaction(tx=>require('../admin-server/repositories/auth').authRepository(tx).replaceAdmin({username:'owner',hash:'reset-hash'}));}],
  ['expired',401,async f=>{await f.store.query('UPDATE personal_site.sessions SET touched=$1',[Date.now()-12*60*60*1000]);}],
  ['absolute expiry',401,async f=>{await f.store.query('UPDATE personal_site.sessions SET created=$1',[Date.now()-7*24*60*60*1000]);}],
  ['future session',401,async f=>{await f.store.query('UPDATE personal_site.sessions SET touched=$1',[Date.now()+60000]);}],
  ['unavailable storage',422,async f=>{await f.store.transaction(async tx=>{await contentRepository(tx).getDraft({lock:true});await tx.query("UPDATE personal_site.resources SET storage_id='local' WHERE id='image'");await tx.query("UPDATE personal_site.storages SET available=false WHERE id='local'");});}],
])test(`paused real build rejects ${name} change and holds no site lock`,async t=>{
  const b=barrier(),f=await deliveryFixture(t,{build:async input=>{b.enter();await b.released;return buildArtifact(input);}});
  const pending=f.service.publish({revision:3,actor:f.actor});
  const rejection=assert.rejects(pending,{status});
  await b.entered;
  // This separate transaction would hit the existing 5s lock timeout if build held it.
  await f.store.transaction(tx=>contentRepository(tx).getDraft({lock:true}));
  await mutate(f);const before=await state(f.store);b.release();await rejection;
  assert.deepEqual(await state(f.store),before);
});
for(const key of ['origin','target','runtimeDigest','references','projectionDigest','adapterDigest'])test(`substituted valid ${key} identity rejected before version INSERT`,async t=>{
  const f=await deliveryFixture(t,{build:async input=>{
    const artifact=await buildArtifact(input),m=artifact.manifest;
    if(key==='origin')m.origin='https://other.example';
    else if(key==='target')m.target={type:'version',id:'999'};
    else if(key==='references'){m.references=[];m.referencesDigest=digestJSON([]);artifact.references=[];}
    else m[key]='a'.repeat(64);
    artifact.digest=digestJSON(m);assertArtifactManifest(m);return artifact;
  }});
  await f.store.query("CREATE FUNCTION personal_site.no_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'version INSERT reached'; END; $$");
  await f.store.query('CREATE TRIGGER reject_version BEFORE INSERT ON personal_site.versions FOR EACH ROW EXECUTE FUNCTION personal_site.no_insert()');
  const before=await state(f.store);
  await assert.rejects(f.service.publish({revision:3,actor:f.actor}),{status:422});
  assert.deepEqual(await state(f.store),before);
});
for(const table of ['delivery_artifacts','delivery_bindings','audit_events'])test(`${table} failure rolls back complete publication and permits sequence holes`,async t=>{
  const f=await deliveryFixture(t),before=await state(f.store);
  await f.store.query("CREATE FUNCTION personal_site.no_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected write failure'; END; $$");
  await f.store.query(`CREATE TRIGGER reject_write BEFORE INSERT ON personal_site.${table} FOR EACH ROW EXECUTE FUNCTION personal_site.no_write()`);
  await assert.rejects(f.service.publish({revision:3,actor:f.actor}),/injected write failure/);
  assert.deepEqual(await state(f.store),before);
  await f.store.query(`DROP TRIGGER reject_write ON personal_site.${table}`);
  assert.equal(await f.service.publish({revision:3,actor:f.actor}),44);
});
test('old string actors are rejected, never assumed valid',async t=>{
  const f=await deliveryFixture(t);
  await assert.rejects(f.service.publish({revision:3,actor:'owner'}),{status:401});
});
test('reverse completion preserves reserved IDs and each binding; later reservation remains monotonic',async t=>{
  const gates=[barrier(),barrier()];let call=0;
  const f=await deliveryFixture(t,{build:async input=>{const gate=gates[call++];if(gate){gate.enter();await gate.released;}return buildArtifact(input);}});
  const first=f.service.publish({revision:3,actor:f.actor});await gates[0].entered;
  const second=f.service.publish({revision:3,actor:f.actor});await gates[1].entered;
  gates[1].release();assert.equal(await second,44);
  gates[0].release();assert.equal(await first,43);
  const {deliveryRepository}=require('../admin-server/repositories/deliveries');
  for(const id of ['43','44'])assert.equal((await deliveryRepository(f.store).getBinding({type:'version',id})).mode,'pinned');
  assert.equal((await contentRepository(f.store).getDraft()).published,43);
  assert.equal(await f.service.publish({revision:3,actor:f.actor}),45);
});
test('local file removal during build rejects fixed references without publishing',async t=>{
  const fs=require('node:fs/promises'),b=barrier();
  const f=await deliveryFixture(t,{build:async input=>{b.enter();await b.released;return buildArtifact(input);}});
  await f.store.query("UPDATE personal_site.resources SET details=$1 WHERE id='image'",[{path:'assets/images/image.png'}]);
  const pending=f.service.publish({revision:3,actor:f.actor}),rejection=assert.rejects(pending,{status:422});
  await b.entered;const before=await state(f.store);
  await fs.unlink(f.root+'/assets/images/image.png');b.release();await rejection;
  assert.deepEqual(await state(f.store),before);
});
test('capture is repeatable read read only and precedes reserved sequence and build',async t=>{
  const f=await deliveryFixture(t),observed=[];
  const store={query:f.store.query,transaction:fn=>f.store.transaction(tx=>fn({query:async(sql,params)=>{
    observed.push(sql);
    const result=await tx.query(sql,params);
    if(sql.startsWith('SET TRANSACTION')){
      const settings=await tx.query("SELECT current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS readonly");
      assert.deepEqual(settings.rows[0],{isolation:'repeatable read',readonly:'on'});
    }
    return result;
  }}))};
  const candidate=await require('../admin-server/delivery/candidates').prepareDraftCandidate({store,options:{root:f.root,dataDir:f.root+'/data',origin:'http://localhost:3000'},registry:f.runtime.registry,cas:f.cas,revision:3,actor:f.actor});
  assert.match(observed[0],/^SET TRANSACTION/);
  assert.equal(observed.some(sql=>sql.includes('FOR UPDATE')),false);
  const artifact=await buildArtifact({...candidate,cas:f.cas});
  require('../admin-server/delivery/candidates').assertArtifactMatchesCandidate(artifact,candidate,'pinned');
  assert.equal(artifact.manifest.projectionDigest,candidate.projectionDigest);
  assert.equal(candidate.projectionDigest,digestJSON({profileId:candidate.profile.id,templateId:candidate.profile.templateId,
    policy:candidate.profile.policy,snapshot:candidate.projectedSnapshot}));
  assert.equal(artifact.manifest.adapterDigest,candidate.adapterDigest);
});
test('HTTP publication takes actor and origin only from authenticated trusted constructor',async t=>{
  const f=await deliveryFixture(t);
  const response=await f.request('/api/admin/publish',{method:'POST',headers:{...f.headers,Host:'evil.example'},body:JSON.stringify({revision:3,
    actor:{id:'f'.repeat(64),username:'attacker'},origin:'https://evil.example',deliveryService:{},registry:'tiny-test-runtime'})});
  assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.version,43);assert.ok(Array.isArray(result.warnings));
  const rows=(await f.store.query('SELECT manifest FROM personal_site.delivery_artifacts')).rows;
  assert.equal(rows[0].manifest.origin,'http://localhost:3000');
  assert.equal((await f.store.query("SELECT actor FROM personal_site.audit_events WHERE action='config.publish'")).rows[0].actor,'owner');
});
test('candidate owns origin and validation paths before asynchronous capture',async t=>{
  const f=await deliveryFixture(t),gate=barrier(),options={root:f.root,dataDir:f.root+'/data',origin:'http://localhost:3000'};
  let first=true;
  const cas={read:async entry=>{if(first){first=false;gate.enter();await gate.released;}return f.cas.read(entry);}};
  const pending=require('../admin-server/delivery/candidates').prepareDraftCandidate({store:f.store,options,registry:f.runtime.registry,cas,revision:3,actor:f.actor});
  await gate.entered;options.origin='https://changed.example';gate.release();
  assert.equal((await pending).origin,'http://localhost:3000');
});
test('session lock first commits publication before concurrent logout can delete',async t=>{
  const f=await deliveryFixture(t),gate=barrier();
  const store={query:f.store.query,transaction:fn=>f.store.transaction(tx=>fn({query:async(sql,params)=>{
    const result=await tx.query(sql,params);
    if(sql.includes('FOR UPDATE OF s')){gate.enter();await gate.released;}
    return result;
  }}))};
  const service=require('../admin-server/delivery/service').createDeliveryService({store,options:{root:f.root,dataDir:f.root+'/data'},registry:f.runtime.registry});
  const publication=service.publish({revision:3,actor:f.actor});await gate.entered;
  const logout=require('../admin-server/repositories/auth').authRepository(f.store).deleteSession(f.actor.id);
  const deadline=Date.now()+2000;let waiting=false;
  while(!waiting&&Date.now()<deadline){
    const rows=await f.store.query("SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND query LIKE 'DELETE FROM personal_site.sessions WHERE id=%' AND wait_event_type='Lock'");
    waiting=rows.rowCount>0;
    if(!waiting)await new Promise(setImmediate);
  }
  gate.release();assert.equal(await publication,43);await logout;
  assert.equal(waiting,true,'logout must wait on the locked session');
  assert.equal((await f.store.query('SELECT id FROM personal_site.sessions')).rowCount,0);
  assert.equal((await contentRepository(f.store).getDraft()).published,43);
});
test('failed build does not change published or create a version',async t=>{
  const f=await require('./helpers/delivery').deliveryFixture(t,{build:async()=>{throw Error('injected build failure');}});
  const repo=require('../admin-server/repositories/content').contentRepository(f.store);
  const before=await repo.getDraft(),versions=await repo.listVersions();
  await assert.rejects(f.service.publish({revision:before.revision,actor:f.actor}),/injected/);
  assert.equal((await repo.getDraft()).published,before.published);
  assert.deepEqual(await repo.listVersions(),versions);
});

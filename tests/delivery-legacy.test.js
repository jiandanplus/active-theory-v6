const {test}=require('node:test');
const assert=require('node:assert/strict');
const {deliveryFixture}=require('./helpers/delivery');
const {contentRepository}=require('../admin-server/repositories/content');
const {deliveryRepository}=require('../admin-server/repositories/deliveries');
const {buildArtifact}=require('../admin-server/delivery/builder');
const {digestJSON}=require('../admin-server/delivery/contracts');

const target={type:'version',id:'42'};
const generate=f=>f.service.legacy({versionId:42,expectedGeneration:0,actor:f.actor});
function barrier(){
  let enter,release;
  return {entered:new Promise(r=>enter=r),released:new Promise(r=>release=r),enter:()=>enter(),release:()=>release()};
}
async function state(store){
  const result={draft:await contentRepository(store).getDraft()};
  for(const table of ['versions','previews','delivery_artifacts','delivery_bindings','resource_references','audit_events'])
    result[table]=(await store.query(`SELECT * FROM personal_site.${table} ORDER BY 1,2`)).rows;
  return result;
}
test('legacy preserves exact history, full old references and draft and cannot be replaced',async t=>{
  const f=await deliveryFixture(t),repo=contentRepository(f.store),deliveries=deliveryRepository(f.store);
  await f.store.query(`UPDATE personal_site.versions SET snapshot=snapshot || '{"unknownHistoricalField":{"raw":"retained"}}'::jsonb WHERE id=42`);
  await f.store.query("INSERT INTO personal_site.resource_references(owner_type,owner_id,resource_id,slot) VALUES('version','42','unused','historic-unused')");
  const before=await state(f.store),refs=await deliveries.references(target),old=await repo.getVersion(42);
  const result=await generate(f);
  assert.equal(result.version,42);
  const binding=await deliveries.getBinding(target),artifact=await deliveries.getArtifact(result.artifactDigest);
  assert.equal(binding.mode,'legacy');assert.equal(binding.generation,1);assert.equal(binding.artifactDigest,result.artifactDigest);
  assert.equal(artifact.kind,'legacy-render');assert.equal(artifact.manifest.sourceSnapshotDigest,digestJSON(old.snapshot));
  assert.deepEqual(artifact.manifest.references,refs);
  assert.deepEqual((await state(f.store)).versions,before.versions);
  assert.deepEqual((await state(f.store)).resource_references,before.resource_references);
  assert.deepEqual(await repo.getDraft(),before.draft);
  assert.equal((await f.store.query("SELECT actor FROM personal_site.audit_events WHERE action='delivery.legacy'")).rows[0].actor,f.actor.username);
  const bound=await state(f.store);
  await assert.rejects(f.service.legacy({versionId:42,expectedGeneration:1,actor:f.actor}),{status:409});
  assert.deepEqual(await state(f.store),bound);
  await f.restart();assert.deepEqual(await contentRepository(f.store).getVersion(42),old);
  assert.equal((await deliveryRepository(f.store).getBinding(target)).artifactDigest,result.artifactDigest);
});
test('legacy ignores changed current draft and restore changes only draft',async t=>{
  const gate=barrier(),f=await deliveryFixture(t,{build:async input=>{gate.enter();await gate.released;return buildArtifact(input);}});
  const old=await contentRepository(f.store).getVersion(42),pending=generate(f);
  await gate.entered;
  const draft=await contentRepository(f.store).getDraft();draft.config.site.title='New draft only';
  await require('../admin-server/config').saveDraft(f.store,draft.config,draft.revision);
  gate.release();const result=await pending;
  const before=await state(f.store);
  assert.equal((await contentRepository(f.store).getDraft()).config.site.title,'New draft only');
  await require('../admin-server/config').restore(f.store,42,4,f.actor.username);
  const after=await state(f.store);
  assert.deepEqual(after.versions,before.versions);assert.deepEqual(after.delivery_bindings,before.delivery_bindings);
  assert.deepEqual(after.delivery_artifacts,before.delivery_artifacts);
  assert.equal(after.draft.published,before.draft.published);assert.equal(after.draft.config.site.title,old.snapshot.config.site.title);
  assert.equal(result.version,42);
});
test('legacy refuses pinned, old preview, stale generation, absent binding and no selected runtime',async t=>{
  const f=await deliveryFixture(t);
  const pinned=await f.service.publish({revision:3,actor:f.actor});
  await assert.rejects(f.service.legacy({versionId:pinned,expectedGeneration:0,actor:f.actor}),{status:409});
  await f.store.query("INSERT INTO personal_site.previews(id,owner,expires,snapshot) SELECT 'preview-old','owner',now()+interval '30 minutes',snapshot FROM personal_site.versions WHERE id=42");
  await assert.rejects(f.service.legacy({versionId:'preview-old',expectedGeneration:0,actor:f.actor}),{status:400});
  await assert.rejects(f.service.legacy({versionId:42,expectedGeneration:1,actor:f.actor}),{status:409});
  await assert.rejects(f.service.legacy({versionId:42,expectedGeneration:-1,actor:f.actor}),{status:400});
  await assert.rejects(f.service.legacy({versionId:42,expectedGeneration:0,actor:'owner'}),{status:401});
  await f.store.query('UPDATE personal_site.runtime_selection SET runtime_digest=NULL');
  await assert.rejects(generate(f),{status:422});
  await f.store.query('DELETE FROM personal_site.delivery_bindings WHERE version_id=42');
  await assert.rejects(generate(f),{status:409});
});
test('two real first builds have one winner and one legacy audit',async t=>{
  const gate=barrier();let count=0;
  const f=await deliveryFixture(t,{build:async input=>{if(++count===2)gate.enter();await gate.released;return buildArtifact(input);}});
  const pending=Promise.allSettled([generate(f),generate(f)]);
  await gate.entered;
  await f.store.transaction(tx=>tx.query('SELECT id FROM personal_site.site_settings WHERE id=true FOR UPDATE'));
  gate.release();const results=await pending;
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  assert.equal((await deliveryRepository(f.store).getBinding(target)).generation,1);
  assert.equal((await f.store.query("SELECT * FROM personal_site.audit_events WHERE action='delivery.legacy'")).rowCount,1);
});
for(const [name,status,mutate] of [
  ['source',409,f=>f.store.query(`UPDATE personal_site.versions SET snapshot=snapshot || '{"unknown":true}'::jsonb WHERE id=42`)],
  ['references',409,f=>f.store.query("INSERT INTO personal_site.resource_references(owner_type,owner_id,resource_id,slot) VALUES('version','42','unused','added')")],
  ['selection',409,f=>f.store.query('UPDATE personal_site.runtime_selection SET generation=generation+1')],
  ['resource',422,f=>f.store.query("UPDATE personal_site.resources SET status='disabled' WHERE id='image'")],
  ['storage',422,async f=>{await f.store.query("UPDATE personal_site.resources SET storage_id='local' WHERE id='image'");await f.store.query("UPDATE personal_site.storages SET available=false WHERE id='local'");}],
  ['logout',401,f=>f.store.query('DELETE FROM personal_site.sessions WHERE id=$1',[f.actor.id])],
  ['idle expiry',401,f=>f.store.query('UPDATE personal_site.sessions SET touched=$1',[Date.now()-12*60*60*1000])],
])test(`legacy rechecks ${name} after build without partial writes`,async t=>{
  const gate=barrier(),f=await deliveryFixture(t,{build:async input=>{gate.enter();await gate.released;return buildArtifact(input);}});
  const rejected=assert.rejects(generate(f),{status});await gate.entered;await mutate(f);const before=await state(f.store);
  gate.release();await rejected;assert.deepEqual(await state(f.store),before);
});
for(const [table,event] of [['delivery_artifacts','INSERT'],['delivery_bindings','UPDATE'],['audit_events','INSERT']])
test(`legacy ${table} failure rolls back the entire binding`,async t=>{
  const f=await deliveryFixture(t),before=await state(f.store);
  await f.store.query("CREATE FUNCTION personal_site.no_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected legacy failure'; END; $$");
  await f.store.query(`CREATE TRIGGER reject_write BEFORE ${event} ON personal_site.${table} FOR EACH ROW EXECUTE FUNCTION personal_site.no_write()`);
  await assert.rejects(generate(f),/injected legacy failure/);assert.deepEqual(await state(f.store),before);
});
for(const key of ['target','origin','runtimeDigest','references','projectionDigest','adapterDigest'])
test(`legacy independently rejects substituted ${key}`,async t=>{
  const f=await deliveryFixture(t,{build:async input=>{
    const artifact=await buildArtifact(input),m=artifact.manifest;
    if(key==='target')m.target={type:'version',id:'43'};
    else if(key==='origin')m.origin='https://other.example';
    else if(key==='references'){m.references=[];m.referencesDigest=digestJSON([]);artifact.references=[];}
    else m[key]='a'.repeat(64);
    artifact.digest=digestJSON(m);return artifact;
  }}),before=await state(f.store);
  await f.store.query("CREATE FUNCTION personal_site.no_artifact() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'artifact INSERT reached'; END; $$");
  await f.store.query('CREATE TRIGGER reject_artifact BEFORE INSERT ON personal_site.delivery_artifacts FOR EACH ROW EXECUTE FUNCTION personal_site.no_artifact()');
  await assert.rejects(generate(f),{status:422});assert.deepEqual(await state(f.store),before);
});
async function historicalDocument(f,{grantIcon=true,declared=false}={}){
  const old=await contentRepository(f.store).getVersion(42);
  old.snapshot.assets.unused={resourceId:'unused',fileName:'assets/old.webmanifest',document:declared?{name:'Old'}:{icons:[{src:'icon.png'}]}};
  old.snapshot.assets.oldIcon={resourceId:'old-icon',fileName:'assets/icon.png'};
  if(declared)old.snapshot.assets.unused.dependencies=['old-icon'];
  await f.store.query('UPDATE personal_site.versions SET snapshot=$1 WHERE id=42',[old.snapshot]);
  await f.store.query("INSERT INTO personal_site.resources(id,source,url,name,kind,status,size) VALUES('old-icon','bundled','/media/old-icon','old icon','image','ready',1)");
  await f.store.query("INSERT INTO personal_site.resource_references(owner_type,owner_id,resource_id,slot) VALUES('version','42','unused','historical-document')");
  if(grantIcon)await f.store.query("INSERT INTO personal_site.resource_references(owner_type,owner_id,resource_id,slot) VALUES('version','42','old-icon','historical-icon')");
}
test('policy-unused granted document is projected before independent identity and preserves full historical slots',async t=>{
  const f=await deliveryFixture(t);await historicalDocument(f);
  const before=await state(f.store),refs=await deliveryRepository(f.store).references(target);
  const result=await generate(f),artifact=await deliveryRepository(f.store).getArtifact(result.artifactDigest);
  const entry=artifact.manifest.files.find(file=>file.key===artifact.manifest.documents.unused);
  assert.match((await f.cas.read(entry)).toString(),/\/api\/site\/42\/resources\/old-icon\/icon.png/);
  assert.deepEqual(artifact.manifest.references,refs);
  assert.deepEqual((await state(f.store)).versions,before.versions);
  assert.deepEqual((await state(f.store)).resource_references,before.resource_references);
});
for(const declared of [false,true])test(`historical document ${declared?'declared':'actual'} dependency cannot expand old grants`,async t=>{
  const f=await deliveryFixture(t);await historicalDocument(f,{grantIcon:false,declared});const before=await state(f.store);
  await assert.rejects(generate(f),{status:422});assert.deepEqual(await state(f.store),before);
});
test('active projected resource cannot expand incomplete historical references',async t=>{
  const f=await deliveryFixture(t);await f.store.query("DELETE FROM personal_site.resource_references WHERE owner_type='version' AND owner_id='42' AND resource_id='image'");
  const before=await state(f.store);await assert.rejects(generate(f),{status:422});assert.deepEqual(await state(f.store),before);
});
test('bound legacy refuses a new package and trusted new origin without replacement',async t=>{
  const f=await deliveryFixture(t),result=await generate(f);
  const fs=require('node:fs/promises'),{sha256}=require('../admin-server/delivery/contracts');
  const manifest=structuredClone(f.runtime.manifest),entry=manifest.files.find(file=>file.key==='app');
  const bytes=Buffer.from('self.TEST_RUNTIME = true; // second runtime');
  await fs.writeFile(f.runtimeAppPath,bytes);entry.size=bytes.length;entry.sha256=sha256(bytes);
  const registered=await f.service.register({root:f.runtime.root,manifest,actor:f.actor});
  await f.service.select({digest:registered.digest,expectedGeneration:1,actor:f.actor});
  const service=require('../admin-server/delivery/service').createDeliveryService({store:f.store,
    options:{root:f.root,dataDir:f.root+'/data',origin:'https://new.example'},registry:f.runtime.registry});
  const before=await state(f.store);
  await assert.rejects(service.legacy({versionId:42,expectedGeneration:1,actor:f.actor}),{status:409});
  assert.deepEqual(await state(f.store),before);
  assert.equal((await deliveryRepository(f.store).getBinding(target)).artifactDigest,result.artifactDigest);
});
test('legacy input cannot override trusted origin, runtime, paths or builder',async t=>{
  const f=await deliveryFixture(t);
  const result=await f.service.legacy({versionId:42,expectedGeneration:0,actor:f.actor,
    origin:'https://evil.example',root:'/no-such-runtime',dataDir:'/no-such-data',runtimeDigest:'a'.repeat(64),
    build:()=>{throw Error('untrusted builder');},referenceCeiling:[]});
  const artifact=await deliveryRepository(f.store).getArtifact(result.artifactDigest);
  assert.equal(artifact.manifest.origin,'http://localhost:3000');
  assert.equal(artifact.runtimeDigest,(await require('../admin-server/repositories/runtime').runtimeRepository(f.store).getSelection()).digest);
});
test('failed build leaves historical binding and all database content unchanged',async t=>{
  const f=await deliveryFixture(t,{build:async()=>{throw Error('injected build failure');}}),before=await state(f.store);
  await assert.rejects(generate(f),/injected build failure/);assert.deepEqual(await state(f.store),before);
});
test('legacy final local-file check rejects removal during build',async t=>{
  const fs=require('node:fs/promises'),gate=barrier();
  const f=await deliveryFixture(t,{build:async input=>{gate.enter();await gate.released;return buildArtifact(input);}});
  await f.store.query("UPDATE personal_site.resources SET details=$1 WHERE id='image'",[{path:'assets/images/image.png'}]);
  const rejected=assert.rejects(generate(f),{status:422});await gate.entered;
  await fs.unlink(f.root+'/assets/images/image.png');const before=await state(f.store);
  gate.release();await rejected;assert.deepEqual(await state(f.store),before);
});
test('capture is short read-only repeatable-read and final lock/check sequence precedes every write',async t=>{
  const f=await deliveryFixture(t),events=[];let transaction=0,active=null;
  const store={query:f.store.query.bind(f.store),transaction:fn=>f.store.transaction(async tx=>{
    const id=++transaction;active=id;
    try{return await fn({query:async(sql,args)=>{
      events.push({id,sql});const result=await tx.query(sql,args);
      if(sql.startsWith('SET TRANSACTION')){
        const settings=await tx.query("SELECT current_setting('transaction_isolation') AS isolation,current_setting('transaction_read_only') AS readonly");
        assert.deepEqual(settings.rows[0],{isolation:'repeatable read',readonly:'on'});
      }
      return result;
    }});}finally{active=null;}
  })};
  const service=require('../admin-server/delivery/service').createDeliveryService({store,
    options:{root:f.root,dataDir:f.root+'/data'},registry:f.runtime.registry,
    build:async input=>{assert.equal(active,null);return buildArtifact(input);}});
  const read=service.cas.read;
  t.mock.method(service.cas,'read',entry=>{assert.equal(active,null);return read(entry);});
  await service.legacy({versionId:42,expectedGeneration:0,actor:f.actor});
  const capture=events.filter(e=>e.id===1).map(e=>e.sql),final=events.filter(e=>e.id===2).map(e=>e.sql);
  assert.equal(capture[0],'SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert(!capture.some(sql=>/FOR UPDATE|INSERT|DELETE|UPDATE personal_site/.test(sql)));
  assert(!capture.some(sql=>/templates|scenes|projects|songs/.test(sql)));
  assert.match(final[0],/site_settings.*FOR UPDATE/);
  const binding=final.findIndex(sql=>/delivery_bindings.*FOR UPDATE/.test(sql));
  const selection=final.findIndex(sql=>/FROM personal_site.runtime_selection/.test(sql));
  const source=final.findIndex(sql=>/FROM personal_site.versions/.test(sql));
  const refs=final.findIndex(sql=>/FROM personal_site.resource_references/.test(sql));
  const resources=final.findIndex(sql=>/FROM personal_site.resources.*ORDER BY id FOR UPDATE/.test(sql));
  const session=final.findIndex(sql=>/FOR UPDATE OF s/.test(sql));
  const artifact=final.findIndex(sql=>/INSERT INTO personal_site.delivery_artifacts/.test(sql));
  assert(binding>0&&selection>binding&&source>selection&&refs>source&&resources>refs&&session>resources&&artifact>session);
});
test('an actual valid artifact from another historical version cannot be borrowed',async t=>{
  const f=await deliveryFixture(t),first=await generate(f),deliveries=deliveryRepository(f.store);
  const artifact=await deliveries.getArtifact(first.artifactDigest),old=await contentRepository(f.store).getVersion(42);
  await f.store.transaction(async tx=>{
    await contentRepository(tx).insertReservedVersion({id:43,snapshot:old.snapshot,references:artifact.manifest.references});
    await tx.query("INSERT INTO personal_site.delivery_bindings(version_id,mode) VALUES(43,'legacy')");
  });
  const service=require('../admin-server/delivery/service').createDeliveryService({store:f.store,
    options:{root:f.root,dataDir:f.root+'/data'},registry:f.runtime.registry,
    build:async()=>({digest:artifact.digest,manifest:artifact.manifest,references:artifact.manifest.references})});
  const before=await state(f.store);
  await assert.rejects(service.legacy({versionId:43,expectedGeneration:0,actor:f.actor}),{status:422});
  assert.deepEqual(await state(f.store),before);
});

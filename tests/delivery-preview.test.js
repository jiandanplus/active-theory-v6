const {test}=require('node:test');
const assert=require('node:assert/strict');
const {deliveryFixture}=require('./helpers/delivery');
const {contentRepository}=require('../admin-server/repositories/content');
const {deliveryRepository}=require('../admin-server/repositories/deliveries');
const {buildArtifact}=require('../admin-server/delivery/builder');
const {digestJSON,assertArtifactManifest}=require('../admin-server/delivery/contracts');

function barrier(){
  let enter,release;
  return {entered:new Promise(r=>enter=r),released:new Promise(r=>release=r),enter:()=>enter(),release:()=>release()};
}
async function state(store){
  const result={draft:await contentRepository(store).getDraft()};
  for(const table of ['versions','previews','delivery_artifacts','delivery_bindings','resource_references','audit_events']){
    result[table]=(await store.query(`SELECT * FROM personal_site.${table} ORDER BY 1,2`)).rows;
  }
  return result;
}
test('preview is a new pinned target, preserves raw source and never publishes',async t=>{
  const f=await deliveryFixture(t),repo=contentRepository(f.store),draft=await repo.getDraft();
  const id=await f.service.preview({revision:draft.revision,actor:f.actor});
  assert.match(id,/^preview-[a-f0-9-]{36}$/);
  assert.deepEqual(await repo.getDraft(),draft);
  const row=await repo.getPreview(id,f.actor.username,new Date());
  assert.deepEqual(row.snapshot,draft.snapshot);
  assert(Date.parse(row.expires)>Date.now()+29*60000);
  assert.equal(await repo.getPreview(id,'another-owner',new Date()),null);
  const deliveries=deliveryRepository(f.store),binding=await deliveries.getBinding({type:'preview',id});
  assert.equal(binding.mode,'pinned');
  const artifact=await deliveries.getArtifact(binding.artifactDigest);
  assert.deepEqual(artifact.manifest.target,{type:'preview',id});
  await assert.rejects(deliveries.bindPinned({type:'version',id:String(draft.published)},artifact.digest),{status:409});
  assert.equal((await repo.getDraft()).published,draft.published);
  for(const file of artifact.manifest.files)assert.equal((await f.cas.read(file)).length,file.size);
  assert.equal((await f.store.query("SELECT actor FROM personal_site.audit_events WHERE action='config.preview'")).rows[0].actor,f.actor.username);
  const oldStore=f.store,oldService=f.service;
  await f.restart();
  assert.notEqual(f.store,oldStore);assert.notEqual(f.service,oldService);
  assert.deepEqual((await contentRepository(f.store).getPreview(id,f.actor.username,new Date())).snapshot,draft.snapshot);
});
test('UUID exists before long build and expiry begins only after final recheck',async t=>{
  const gate=barrier();let target;
  const f=await deliveryFixture(t,{build:async input=>{
    target=input.target;gate.enter();await gate.released;return buildArtifact(input);
  }});
  const originalNow=Date.now,start=originalNow();let now=start;
  try{
    Date.now=()=>now;
    const pending=f.service.preview({revision:3,actor:f.actor});
    await gate.entered;
    assert.match(target.id,/^preview-/);
    assert.equal((await f.store.query('SELECT id FROM personal_site.previews')).rowCount,0);
    await f.store.transaction(tx=>contentRepository(tx).getDraft({lock:true}));
    now=start+5*60000;gate.release();
    const id=await pending,row=await contentRepository(f.store).getPreview(id,f.actor.username,new Date(now));
    assert.equal(Date.parse(row.expires),now+30*60000);
  }finally{gate.release();Date.now=originalNow;}
});
test('six new previews retain five immutable IDs, prune references and cascade binding without deleting CAS',async t=>{
  const f=await deliveryFixture(t),repo=contentRepository(f.store),deliveries=deliveryRepository(f.store);
  const first=await f.service.preview({revision:3,actor:f.actor});
  const original=await repo.getPreview(first,f.actor.username,new Date());
  const binding=await deliveries.getBinding({type:'preview',id:first});
  const artifact=await deliveries.getArtifact(binding.artifactDigest);
  await assert.rejects(repo.insertPreview({id:first,owner:f.actor.username,expires:new Date(Date.now()+60000),snapshot:{},references:[]}),{code:'23505'});
  assert.deepEqual(await repo.getPreview(first,f.actor.username,new Date()),original);
  const ids=[first];
  for(let i=0;i<5;i++)ids.push(await f.service.preview({revision:3,actor:f.actor}));
  assert.equal(new Set(ids).size,6);
  const remaining=(await f.store.query('SELECT id FROM personal_site.previews')).rows.map(row=>row.id);
  assert.equal(remaining.length,5);
  const removed=ids.find(id=>!remaining.includes(id));
  assert.equal(await deliveries.getBinding({type:'preview',id:removed}),null);
  assert.equal((await f.store.query("SELECT * FROM personal_site.resource_references WHERE owner_type='preview' AND owner_id=$1",[removed])).rowCount,0);
  for(const file of artifact.manifest.files)assert.equal((await f.cas.read(file)).length,file.size);
  assert.ok(await deliveries.getArtifact(binding.artifactDigest));
  await repo.prunePreviews(new Date(Date.now()+31*60000));
  assert.equal((await f.store.query('SELECT * FROM personal_site.delivery_bindings WHERE preview_id IS NOT NULL')).rowCount,0);
  assert.equal((await f.store.query("SELECT * FROM personal_site.resource_references WHERE owner_type='preview'")).rowCount,0);
});
for(const [name,status,mutate] of [
  ['draft',409,async f=>{const d=await contentRepository(f.store).getDraft();d.config.site.title='changed';await require('../admin-server/config').saveDraft(f.store,d.config,d.revision);}],
  ['resource',422,async f=>{await f.store.query("UPDATE personal_site.resources SET status='disabled' WHERE id='image'");}],
  ['logout',401,async f=>{await require('../admin-server/repositories/auth').authRepository(f.store).deleteSession(f.actor.id);}],
  ['reset',401,async f=>{await f.store.transaction(tx=>require('../admin-server/repositories/auth').authRepository(tx).replaceAdmin({username:'owner',hash:'reset-hash'}));}],
  ['idle expiry',401,async f=>{await f.store.query('UPDATE personal_site.sessions SET touched=$1',[Date.now()-12*60*60*1000]);}],
])test(`preview final recheck rejects ${name} and leaves no partial preview`,async t=>{
  const gate=barrier(),f=await deliveryFixture(t,{build:async input=>{gate.enter();await gate.released;return buildArtifact(input);}});
  const pending=f.service.preview({revision:3,actor:f.actor}),rejected=assert.rejects(pending,{status});
  await gate.entered;await mutate(f);const before=await state(f.store);
  gate.release();await rejected;assert.deepEqual(await state(f.store),before);
});
for(const key of ['target','origin','runtimeDigest','references','projectionDigest','adapterDigest'])test(`preview rejects independently mismatched ${key} before INSERT`,async t=>{
  const f=await deliveryFixture(t,{build:async input=>{
    const artifact=await buildArtifact(input),m=artifact.manifest;
    if(key==='target')m.target={type:'preview',id:'preview-00000000-0000-0000-0000-000000000000'};
    else if(key==='origin')m.origin='https://other.example';
    else if(key==='references'){m.references=[];m.referencesDigest=digestJSON([]);artifact.references=[];}
    else m[key]='a'.repeat(64);
    artifact.digest=digestJSON(m);assertArtifactManifest(m);return artifact;
  }});
  await f.store.query("CREATE FUNCTION personal_site.no_preview() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'preview INSERT reached'; END; $$");
  await f.store.query('CREATE TRIGGER reject_preview BEFORE INSERT ON personal_site.previews FOR EACH ROW EXECUTE FUNCTION personal_site.no_preview()');
  const before=await state(f.store);
  await assert.rejects(f.service.preview({revision:3,actor:f.actor}),{status:422});
  assert.deepEqual(await state(f.store),before);
});
for(const table of ['delivery_artifacts','delivery_bindings','audit_events'])test(`preview ${table} failure rolls back INSERT, references and binding`,async t=>{
  const f=await deliveryFixture(t),before=await state(f.store);
  await f.store.query("CREATE FUNCTION personal_site.no_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected preview failure'; END; $$");
  await f.store.query(`CREATE TRIGGER reject_write BEFORE INSERT ON personal_site.${table} FOR EACH ROW EXECUTE FUNCTION personal_site.no_write()`);
  await assert.rejects(f.service.preview({revision:3,actor:f.actor}),/injected preview failure/);
  assert.deepEqual(await state(f.store),before);
});
test('failed preview build and untrusted string actor never consume a preview row',async t=>{
  const f=await deliveryFixture(t,{build:async()=>{throw Error('injected build failure');}}),before=await state(f.store);
  await assert.rejects(f.service.preview({revision:3,actor:f.actor}),/injected build failure/);
  await assert.rejects(f.service.preview({revision:3,actor:'owner'}),{status:401});
  assert.deepEqual(await state(f.store),before);
});
test('HTTP preview takes owner and Actor only from trusted authenticated context',async t=>{
  const f=await deliveryFixture(t);
  const response=await f.request('/api/admin/preview',{method:'POST',headers:f.headers,body:JSON.stringify({revision:3,
    owner:'attacker',actor:{id:'f'.repeat(64),username:'attacker'},origin:'https://evil.example',registry:'tiny-test-runtime'})});
  assert.equal(response.status,200);
  const id=(await response.json()).url.split('=')[1];
  const row=await contentRepository(f.store).getPreview(id,f.actor.username,new Date());
  assert.equal(row.owner,'owner');
  const binding=await deliveryRepository(f.store).getBinding({type:'preview',id});
  assert.equal((await deliveryRepository(f.store).getArtifact(binding.artifactDigest)).manifest.origin,'http://localhost:3000');
});

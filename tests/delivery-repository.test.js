const {test}=require('node:test');
const assert=require('node:assert/strict');
const {contentRepository}=require('../admin-server/repositories/content');
const {digestJSON}=require('../admin-server/delivery/contracts');
const make=db=>require('../admin-server/repositories/deliveries').deliveryRepository(db);
const previewId='preview-12345678-1234-4234-8234-123456789abc';
async function fixture(t){
  const {store}=await require('./helpers/postgres').postgresFixture(t);
  const {bundle}=require('./helpers/content').contentFixture(t);
  await store.transaction(tx=>contentRepository(tx).importBundle(bundle));
  const runtime=require('./helpers/runtime').testRuntime(t).manifest,runtimeDigest=digestJSON(runtime);
  await require('../admin-server/repositories/runtime').runtimeRepository(store).insertBundle({digest:runtimeDigest,manifest:runtime});
  const references=[{resourceId:'image',slot:'frozen-only'}],snapshot={...bundle.draft,identityExtra:'preserved'};
  const target={type:'version',id:'43'};
  const files=[['html','html','text/html'],['js','program','text/javascript'],['data','data','application/json'],['shader','shader','text/plain']].map(([key,role,mime])=>({key,role,mime,size:1,sha256:'a'.repeat(64)}));
  const manifest={manifestVersion:1,kind:'pinned',target,runtimeDigest,profileId:runtime.profileId,templateId:runtime.templateId,selectionGeneration:0,sourceSnapshotDigest:digestJSON(snapshot),projectionDigest:'b'.repeat(64),referencesDigest:digestJSON(references),adapterDigest:'c'.repeat(64),origin:'https://example.test',files,routes:{'/':'html','/work':'html'},endpoints:{config:'data','identity.js':'js','bridge.js':'js','app.js':'js','uil.json':'data','projects.json':'data','compiled.vs':'shader','metadata.json':'data','contact.json':'data','unsupported.html':'html'},runtime:{app:'js'},documents:{},references,patchReport:[]};
  return {store,bundle,snapshot,references,manifest,target,artifact:m=>({digest:digestJSON(m),manifest:m})};
}
test('reserved ids never rewind and frozen snapshot and references are inserted unchanged',async t=>{
  const f=await fixture(t),repo=contentRepository(f.store),a=await repo.reserveVersionId(),b=await repo.reserveVersionId();
  for(const id of [b,a])await f.store.transaction(tx=>contentRepository(tx).insertReservedVersion({id,snapshot:f.snapshot,references:f.references}));
  assert((await repo.reserveVersionId())>b);
  assert.deepEqual((await repo.getVersion(a)).snapshot,f.snapshot);
  assert.deepEqual(await make(f.store).references({type:'version',id:String(a)}),f.references);
  assert.equal(await make(f.store).getBinding({type:'version',id:String(a)}),null);
  await assert.rejects(repo.insertReservedVersion({id:0,snapshot:f.snapshot,references:[]}),{status:400});
});
test('artifact compare, pinned binding, summaries and INSERT-only previews',async t=>{
  const f=await fixture(t),repo=make(f.store),a=f.artifact(f.manifest);
  assert.equal(await repo.getArtifact(a.digest),null);
  await f.store.transaction(async tx=>{
    await contentRepository(tx).insertReservedVersion({id:43,snapshot:f.snapshot,references:f.references});
    assert.equal((await make(tx).putArtifact(a)).digest,a.digest);
    await make(tx).bindPinned(f.target,a.digest);
  });
  assert.deepEqual(await repo.putArtifact(a),await repo.getArtifact(a.digest));
  assert.deepEqual(await repo.getBinding(f.target),{target:f.target,mode:'pinned',artifactDigest:a.digest,generation:0});
  assert.deepEqual(await repo.summaries([43,999]),[await repo.getBinding(f.target)]);
  assert.deepEqual((await repo.summaries([43,'42'])).map(b=>b.target.id),['43','42']);
  await assert.rejects(repo.bindPinned(f.target,a.digest),{code:'23505'});
  await assert.rejects(repo.putArtifact({digest:a.digest,manifest:{...f.manifest,origin:'https://other.test'}}));
  const p={type:'preview',id:previewId},pm={...f.manifest,target:p};
  await f.store.transaction(async tx=>{
    await contentRepository(tx).insertPreview({id:previewId,owner:'admin',expires:'2026-01-01',snapshot:f.snapshot,references:f.references});
    await make(tx).putArtifact(f.artifact(pm));await make(tx).bindPinned(p,digestJSON(pm));
  });
  await assert.rejects(contentRepository(f.store).insertPreview({id:previewId,owner:'admin',expires:'2027-01-01',snapshot:{},references:[]}),{code:'23505'});
  assert.deepEqual(await repo.references(p),f.references);
  await contentRepository(f.store).prunePreviews('2026-02-01');assert.equal(await repo.getBinding(p),null);
});
test('legacy import is explicit and legacy binding is generation checked and once only',async t=>{
  const f=await fixture(t),repo=make(f.store),target={type:'version',id:'42'};
  assert.deepEqual(await repo.getBinding(target),{target,mode:'legacy',artifactDigest:null,generation:0});
  const references=await repo.references(target),snapshot=(await contentRepository(f.store).getVersion(42)).snapshot;
  const m={...f.manifest,target,kind:'legacy-render',sourceSnapshotDigest:digestJSON(snapshot),references,referencesDigest:digestJSON(references)};
  await repo.putArtifact(f.artifact(m));
  await assert.rejects(repo.bindLegacyOnce(target,digestJSON(m),1),{status:409});
  await repo.bindLegacyOnce(target,digestJSON(m),0);
  assert.equal((await repo.getBinding(target)).generation,1);
  await assert.rejects(repo.bindLegacyOnce(target,digestJSON(m),1),{status:409});
  await assert.rejects(repo.bindLegacyOnce({type:'preview',id:previewId},digestJSON(m),0));
});
test('binding validates target snapshot references runtime and kind; failure rolls back chain',async t=>{
  const f=await fixture(t);
  for(const change of [{target:{type:'version',id:'44'}},{target:{type:'preview',id:previewId}},{sourceSnapshotDigest:'d'.repeat(64)},{references:[],referencesDigest:digestJSON([])},{kind:'legacy-render'},{runtimeDigest:'e'.repeat(64)},{profileId:'wrong'},{templateId:'wrong'}]){
    const m={...f.manifest,...change};
    await assert.rejects(f.store.transaction(async tx=>{
      await contentRepository(tx).insertReservedVersion({id:43,snapshot:f.snapshot,references:f.references});
      await make(tx).putArtifact(f.artifact(m));await make(tx).bindPinned(f.target,digestJSON(m));
    }));
    assert.equal(await contentRepository(f.store).getVersion(43),null);
    assert.deepEqual(await make(f.store).references(f.target),[]);
    assert.equal((await f.store.query('SELECT count(*)::int AS n FROM personal_site.delivery_artifacts')).rows[0].n,0);
  }
});
test('artifact and binding reads fail closed on nested SQL/JSON identity corruption',async t=>{
  const f=await fixture(t),repo=make(f.store),a=f.artifact(f.manifest);
  await f.store.transaction(async tx=>{await contentRepository(tx).insertReservedVersion({id:43,snapshot:f.snapshot,references:f.references});await make(tx).putArtifact(a);await make(tx).bindPinned(f.target,a.digest);});
  const cases=[['UPDATE personal_site.delivery_artifacts SET kind=$1 WHERE digest=$2',['legacy-render',a.digest]],['UPDATE personal_site.delivery_artifacts SET manifest=$1 WHERE digest=$2',[{...f.manifest,origin:'https://tampered.test'},a.digest]],['UPDATE personal_site.runtime_bundles SET profile_id=$1 WHERE digest=$2',['wrong',f.manifest.runtimeDigest]],['UPDATE personal_site.runtime_bundles SET manifest=manifest || $1::jsonb WHERE digest=$2',[{templateId:'wrong'},f.manifest.runtimeDigest]]];
  for(const [sql,args] of cases)await assert.rejects(f.store.transaction(async tx=>{await tx.query(sql,args);await make(tx).getArtifact(a.digest);}),/./);
  await assert.rejects(f.store.transaction(async tx=>{
    await tx.query('UPDATE personal_site.delivery_artifacts SET manifest=$1 WHERE digest=$2',[{...f.manifest,origin:'https://conflict.test'},a.digest]);
    await make(tx).putArtifact(a);
  }),{status:409});
  for(const sql of ["UPDATE personal_site.versions SET snapshot='{}' WHERE id=43","DELETE FROM personal_site.resource_references WHERE owner_type='version' AND owner_id='43'","UPDATE personal_site.delivery_bindings SET mode='legacy' WHERE version_id=43"]){
    await assert.rejects(f.store.transaction(async tx=>{await tx.query(sql);await make(tx).getBinding(f.target,{lock:true});}));
  }
  assert.equal((await repo.getBinding(f.target)).artifactDigest,a.digest);
});
test('concurrent legacy attempts have exactly one winner and never replace the winner',async t=>{
  const f=await fixture(t),repo=make(f.store),target={type:'version',id:'42'},references=await repo.references(target);
  const base={...f.manifest,target,kind:'legacy-render',references,referencesDigest:digestJSON(references),sourceSnapshotDigest:digestJSON((await contentRepository(f.store).getVersion(42)).snapshot)};
  const artifacts=[base,{...base,origin:'https://other.test'}].map(f.artifact);
  for(const a of artifacts)await repo.putArtifact(a);
  const results=await Promise.allSettled(artifacts.map(a=>f.store.transaction(tx=>make(tx).bindLegacyOnce(target,a.digest,0))));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  assert.equal((await repo.getBinding(target)).artifactDigest,results.find(r=>r.status==='fulfilled').value.artifactDigest);
});
test('reference failure and post-binding fault roll back content refs artifacts and binding',async t=>{
  const f=await fixture(t);
  for(const fault of ['references','after-binding']){
    await assert.rejects(f.store.transaction(async tx=>{
      await contentRepository(tx).insertReservedVersion({id:43,snapshot:f.snapshot,references:fault==='references'?[{resourceId:'missing',slot:'x'}]:f.references});
      await make(tx).putArtifact(f.artifact(f.manifest));await make(tx).bindPinned(f.target,digestJSON(f.manifest));
      throw Error('post-binding fault');
    }),fault==='references'?/Referenced resource does not exist/:/post-binding fault/);
    assert.equal(await contentRepository(f.store).getVersion(43),null);
    assert.deepEqual(await make(f.store).references(f.target),[]);
    assert.equal(await make(f.store).getBinding(f.target),null);
    assert.equal(await make(f.store).getArtifact(digestJSON(f.manifest)),null);
  }
});

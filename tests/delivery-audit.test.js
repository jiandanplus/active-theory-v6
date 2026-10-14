const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {deliveryFixture}=require('./helpers/delivery');
const {httpFixture}=require('./helpers/http');
const {createCAS}=require('../admin-server/delivery/cas');
const {sha256}=require('../admin-server/delivery/contracts');
const audit=input=>require('../scripts/delivery-audit').auditDelivery(input);
async function snapshot(root){
  const result={};
  async function visit(name){const stat=await fs.lstat(name,{bigint:true});
    result[path.relative(root,name)]={mtime:String(stat.mtimeNs),size:String(stat.size),
      hash:stat.isFile()?sha256(await fs.readFile(name)):null};
    if(stat.isDirectory())for(const child of (await fs.readdir(name)).sort())await visit(path.join(name,child));
  }
  await visit(root);return result;
}
test('audit hashes referenced and orphan objects without changing bytes, mtime or staging',async t=>{
  const f=await deliveryFixture(t,{publish:true});
  await f.cas.put(Buffer.from('unreferenced test object'));
  await fs.writeFile(path.join(f.root,'data/delivery/staging/keep'),'staged data');
  const before=await snapshot(path.join(f.root,'data'));
  const report=await audit(f),inventory=await f.cas.inspect();
  assert.equal(report.objectCount,inventory.objects.length);
  assert.equal(report.totalBytes,inventory.bytes);
  assert.equal(report.referencedObjectCount+report.unreferencedObjectCount,report.objectCount);
  assert.equal(report.unreferencedObjectCount,1);
  assert.deepEqual(report.missingObjects,[]);assert.deepEqual(report.invalidObjects,[]);
  assert.deepEqual(await snapshot(path.join(f.root,'data')),before);
});
test('fresh installation audit does not create absent delivery, objects or staging directories',async t=>{
  const f=await httpFixture(t),cas=createCAS(path.join(f.root,'data'));
  for(const suffix of ['', 'delivery', 'delivery/objects']){
    if(suffix)await fs.mkdir(path.join(f.root,'data',suffix));
    const before=await snapshot(path.join(f.root,'data'));
    assert.deepEqual(await audit({store:f.store,cas}),{objectCount:0,totalBytes:0,referencedObjectCount:0,unreferencedObjectCount:0,missingObjects:[],invalidObjects:[]});
    assert.deepEqual(await snapshot(path.join(f.root,'data')),before);
  }
});
test('audit retains all artifacts after expired previews and bindings are removed',async t=>{
  const f=await deliveryFixture(t,{publish:true});
  await f.service.preview({revision:3,actor:f.actor});
  const before=await audit(f);
  await f.store.query('DELETE FROM personal_site.previews');
  await f.store.query('DELETE FROM personal_site.delivery_bindings');
  assert.deepEqual(await audit(f),before);
  assert.equal(before.unreferencedObjectCount,0);
});
test('audit lists corrupt referenced and orphan digests and missing references without exposing paths',async t=>{
  const f=await deliveryFixture(t,{publish:true}),entries=(await f.cas.inspect()).objects;
  const orphan=await f.cas.put(Buffer.from('orphan'));
  const location=e=>path.join(f.root,'data/delivery/objects',e.sha256);
  await fs.writeFile(location(entries[0]),'bad');
  await fs.writeFile(location(orphan),'broken');
  await fs.unlink(location(entries[1]));
  const report=await audit(f);
  assert.deepEqual(report.missingObjects,[entries[1].sha256]);
  assert.deepEqual(report.invalidObjects,[entries[0].sha256,orphan.sha256].sort());
  assert.equal(report.unreferencedObjectCount,1);
  assert(!JSON.stringify(report).includes(f.root));
});
test('audit fails closed on malformed manifests, SQL errors, unsafe files and oversized orphans',async t=>{
  const f=await deliveryFixture(t,{publish:true});
  await f.store.query("UPDATE personal_site.runtime_bundles SET manifest=jsonb_set(manifest,'{dependencies}','null')");
  await assert.rejects(audit(f),{message:'Delivery audit could not complete safely'});
  const g=await deliveryFixture(t,{publish:true});
  const file=path.join(g.root,'data/delivery/objects','a'.repeat(64));
  await fs.writeFile(file,'');await fs.truncate(file,256*1024*1024+1);
  await assert.rejects(audit(g),{message:'Delivery audit could not complete safely'});
  await fs.unlink(file);await fs.symlink(path.join(g.root,'data'),file);
  await assert.rejects(audit(g),{message:'Delivery audit could not complete safely'});
  await fs.unlink(file);
  await g.store.query('ALTER TABLE personal_site.delivery_artifacts RENAME TO unavailable_artifacts');
  await assert.rejects(audit(g),{message:'Delivery audit could not complete safely'});
});
test('audit CLI requires installed schema 3, closes pool and returns failure for corrupt objects',async t=>{
  const f=await deliveryFixture(t,{publish:true});let closed=0;
  const deps={loadOptions:()=>({databaseUrl:'test-only',dataDir:path.join(f.root,'data')}),openPostgres:()=>({...f.store,close:async()=>{closed++;}})};
  const {main}=require('../scripts/delivery-audit');
  t.mock.method(console,'log',()=>{});
  assert.equal((await main([],deps)).missingObjects.length,0);assert.equal(closed,1);
  const entry=(await f.cas.inspect()).objects[0];await fs.unlink(path.join(f.root,'data/delivery/objects',entry.sha256));
  await assert.rejects(main([],deps));assert.equal(closed,2);
  await f.store.query('DELETE FROM personal_site.installation');
  await assert.rejects(main([],deps));assert.equal(closed,3);
});

test('audit rejects contradictory declared sizes and mismatched artifact identity',async t=>{
  const f=await deliveryFixture(t,{publish:true});
  const row=(await f.store.query('SELECT * FROM personal_site.delivery_artifacts')).rows[0];
  const m=structuredClone(row.manifest);
  m.files[0].size++;
  // SQL corruption keeps the row digest unchanged: listing must validate it.
  await f.store.query('UPDATE personal_site.delivery_artifacts SET manifest=$1',[JSON.stringify(m)]);
  await assert.rejects(audit(f),{message:'Delivery audit could not complete safely'});
  const {digestJSON}=require('../admin-server/delivery/contracts');
  await f.store.query('DELETE FROM personal_site.delivery_bindings');
  await f.store.query('DELETE FROM personal_site.delivery_artifacts');
  const original=structuredClone(row.manifest);
  m.files[0].sha256=original.files[1].sha256;m.files[0].size=original.files[1].size+1;
  await f.store.query('INSERT INTO personal_site.delivery_artifacts(digest,runtime_digest,kind,manifest) VALUES($1,$2,$3,$4)',
    [digestJSON(m),row.runtime_digest,row.kind,JSON.stringify(m)]);
  await assert.rejects(audit(f),{message:'Delivery audit could not complete safely'});
});
test('audit aborts an incomplete scan instead of classifying vanished objects as corrupt',async t=>{
  const f=await deliveryFixture(t,{publish:true}),original=f.cas.read;
  let once=true;
  const cas={...f.cas,read:async entry=>{
    if(once){once=false;await fs.unlink(path.join(f.root,'data/delivery/objects',entry.sha256));}
    return original(entry);
  }};
  await assert.rejects(audit({store:f.store,cas}),{message:'Delivery audit could not complete safely'});
});

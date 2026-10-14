const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {deliveryFixture}=require('./helpers/delivery');
const endpoints=['config','identity.js','bridge.js','app.js','uil.json','projects.json','compiled.vs','metadata.json','contact.json','unsupported.html'];
const programs=new Set(['identity.js','bridge.js','app.js','compiled.vs']);
const deliveries=store=>require('../admin-server/repositories/deliveries').deliveryRepository(store);
async function artifact(f,id=f.published) {
  return deliveries(f.store).getArtifact((await deliveries(f.store).getBinding({type:String(id).startsWith('preview-')?'preview':'version',id:String(id)})).artifactDigest);
}
function publicRoutes(f) {
  return [...endpoints.map(name=>`/api/site/${f.published}/${name}`),`/api/site/${f.published}/runtime/worker`,`/api/site/${f.published}/runtime/wasm`,'/','/work','/work/one','/unsupported.html'];
}
async function denied(f,routes,status,headers={}) {
  for(const route of routes) {
    const response=await f.request(route,{headers:{'If-None-Match':'*',...headers},redirect:'manual'});
    assert.equal(response.status,status,route);
    assert.equal(response.headers.get('etag'),null,route);
    assert.match(response.headers.get('cache-control'),/no-store/,route);
    assert.match(response.headers.get('x-robots-tag'),/noindex/,route);
  }
}
test('pinned app survives source deletion and old static route is closed',async t=>{
  const f=await deliveryFixture(t,{publish:true});
  const route=`/api/site/${f.published}/app.js`;
  const first=await f.request(route),before=await first.text();
  assert.equal(first.status,200);
  await fs.unlink(f.runtimeAppPath);
  await fs.unlink(f.root+'/index.html');
  await fs.unlink(f.root+'/assets/js/app.fixture.js');
  await f.restart();
  assert.equal(await (await f.request(route)).text(),before);
  assert.equal((await f.request('/assets/js/app.fixture.js')).status,404);
  const response=await f.request(route);
  assert.equal(response.headers.get('cache-control'),'public, no-cache, must-revalidate');
  const cached=await f.request(route,{headers:{'If-None-Match':response.headers.get('etag')}});
  assert.equal(cached.status,304);
});
test('every endpoint and runtime worker/WASM reads verified artifact bytes with explicit cache rules',async t=>{
  const f=await deliveryFixture(t,{publish:true});
  const {manifest}=await require('../admin-server/repositories/deliveries').deliveryRepository(f.store).getArtifact(
    (await require('../admin-server/repositories/deliveries').deliveryRepository(f.store).getBinding({type:'version',id:String(f.published)})).artifactDigest);
  for(const name of [...endpoints,...Object.keys(manifest.runtime).map(key=>'runtime/'+key)]) {
    const route=`/api/site/${f.published}/${name}`;
    const key=name.startsWith('runtime/')?manifest.runtime[name.slice(8)]:manifest.endpoints[name];
    const entry=manifest.files.find(file=>file.key===key),expected=await f.cas.read(entry);
    const response=await f.request(route,{headers:{Host:'evil.test'}});
    assert.equal(response.status,200,route);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected,route);
    const cacheable=programs.has(name)||name.startsWith('runtime/');
    assert.equal(response.headers.get('cache-control'),cacheable?'public, no-cache, must-revalidate':'no-store',name);
    assert.equal(response.headers.get('etag'),cacheable?`"${entry.sha256}"`:null,name);
    for(const tag of ['*',`W/"${entry.sha256}"`,`"wrong", "${entry.sha256}"`]) {
      const cached=await f.request(route,{headers:{'If-None-Match':tag}});
      assert.equal(cached.status,cacheable?304:200,`${name}: ${tag}`);
    }
    assert.equal((await f.request(route,{headers:{'If-None-Match':'"wrong"'}})).status,200);
    const head=await f.request(route,{method:'HEAD'});
    assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(expected.length));assert.equal(await head.text(),'');
  }
  for(const page of ['/','/work','/work/one','/unsupported.html']) {
    const response=await f.request(page,{headers:{'If-None-Match':'*'}});
    assert.equal(response.status,200,page);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('etag'),null);
  }
  for(const route of ['/work/missing','/assets/js/app.fixture.js','/assets/js/worker.js','/assets/js/empty.wasm',`/api/site/${f.published}/runtime/config`]) {
    const response=await f.request(route,{headers:{'If-None-Match':'*'}});
    assert.equal(response.status,404,route);assert.equal(response.headers.get('cache-control'),'no-store');assert.match(response.headers.get('x-robots-tag'),/noindex/);
  }
});
test('preview endpoint/runtime/page reads remain private and expiry never deletes the preview',async t=>{
  const f=await deliveryFixture(t);
  await f.store.query("UPDATE personal_site.resources SET details=details || '{\"path\":\"assets/images/image.png\"}'::jsonb WHERE id='image'");
  const id=await f.service.preview({revision:3,actor:f.actor});
  const routes=[...endpoints.map(name=>`/api/site/${id}/${name}`),`/api/site/${id}/runtime/worker`,`/api/site/${id}/runtime/wasm`,`/api/site/${id}/resources/image/x.png`,`/?preview=${id}`,`/work?preview=${id}`,`/work/one?preview=${id}`,`/unsupported.html?preview=${id}`];
  for(const route of routes) {
    const response=await f.request(route,{headers:{...f.headers,'If-None-Match':'*'}});
    assert.equal(response.status,200,route);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('etag'),null);
    assert.equal((await f.request(route,{headers:{'If-None-Match':'*'}})).status,401,route);
  }
  await f.store.query('UPDATE personal_site.previews SET expires=$1 WHERE id=$2',[new Date(Date.now()-1000),id]);
  for(const route of routes) assert.equal((await f.request(route,{headers:{...f.headers,'If-None-Match':'*'}})).status,404,route);
  assert.equal((await f.store.query('SELECT id FROM personal_site.previews WHERE id=$1',[id])).rowCount,1);
});
test('encoded preview target keeps endpoint, runtime and ordinary media private for GET and HEAD',async t=>{
  const f=await deliveryFixture(t);
  await f.store.query("UPDATE personal_site.resources SET details=details || '{\"path\":\"assets/images/image.png\"}'::jsonb WHERE id='image'");
  const id=await f.service.preview({revision:3,actor:f.actor});
  const encoded=id.replace(/^preview-/,'%70review-');
  const routes=[`/api/site/${encoded}/app.js`,`/api/site/${encoded}/config`,
    `/api/site/${encoded}/runtime/worker`,`/api/site/${encoded}/resources/image/x.png`];
  for(const route of routes)for(const method of ['GET','HEAD']) {
    const response=await f.request(route,{method,headers:{...f.headers,'If-None-Match':'*'}});
    assert.equal(response.status,200,`${method} ${route}`);
    assert.equal(response.headers.get('cache-control'),'private, no-store',`${method} ${route}`);
    assert.match(response.headers.get('x-robots-tag'),/noindex/,`${method} ${route}`);
    assert.equal(response.headers.get('etag'),null,`${method} ${route}`);
  }
  for(const route of [...routes,`/api/site/${encoded}/runtime/missing`]) {
    const denied=await f.request(route,{headers:{'If-None-Match':'*'}});
    assert.equal(denied.status,401,route);
    assert.equal(denied.headers.get('cache-control'),'private, no-store',route);
    assert.match(denied.headers.get('x-robots-tag'),/noindex/,route);
  }
  const missing=await f.request(`/api/site/${encoded}/runtime/missing`,{headers:f.headers});
  assert.equal(missing.status,404);
  assert.equal(missing.headers.get('cache-control'),'private, no-store');
  assert.match(missing.headers.get('x-robots-tag'),/noindex/);
  await f.store.query('UPDATE personal_site.previews SET expires=$1 WHERE id=$2',[new Date(Date.now()-1000),id]);
  for(const route of routes) {
    const expired=await f.request(route,{headers:{...f.headers,'If-None-Match':'*'}});
    assert.equal(expired.status,404,route);
    assert.equal(expired.headers.get('cache-control'),'private, no-store',route);
    assert.match(expired.headers.get('x-robots-tag'),/noindex/,route);
  }
});
test('each mapped file fails closed on missing and same-size corrupted CAS bytes even with its exact ETag',async t=>{
  const f=await deliveryFixture(t,{publish:true});
  const {manifest}=await artifact(f);
  const mappings=[...Object.entries(manifest.endpoints).map(([name,key])=>[`/api/site/${f.published}/${name}`,key]),
    ...Object.entries(manifest.runtime).map(([name,key])=>[`/api/site/${f.published}/runtime/${name}`,key]),...Object.entries(manifest.routes)];
  for(const [route,key] of mappings) {
    const entry=manifest.files.find(file=>file.key===key);
    const file=require('node:path').join(f.root,'data/delivery/objects',entry.sha256),bytes=await fs.readFile(file);
    await fs.rename(file,file+'.held');
    try { await denied(f,[route],503,{'If-None-Match':`"${entry.sha256}"`}); }
    finally { await fs.rename(file+'.held',file); }
    const corrupt=Buffer.from(bytes);corrupt[0]^=1;
    await fs.writeFile(file,corrupt);
    try { await denied(f,[route],503,{'If-None-Match':`"${entry.sha256}"`}); }
    finally { await fs.writeFile(file,bytes); }
    assert.equal((await f.request(route)).status,200,route);
  }
});
test('all program/data/page routes fail closed for origin changes and DB outage before conditional GET',async t=>{
  const f=await deliveryFixture(t,{publish:true});
  const routes=publicRoutes(f);
  f.options.origin='https://changed.example';await f.restart();
  await denied(f,routes,503);
  f.options.origin='http://localhost:3000';await f.restart();
  await f.store.query('ALTER TABLE personal_site.installation RENAME TO unavailable_installation');
  await denied(f,[...routes,'/media/image','/models/image.bin','/assets/geometry/admin/image.bin'],503);
});
test('binding, manifest, source and frozen reference corruption never fall back or return 304',async t=>{
  const f=await deliveryFixture(t,{publish:true});
  const original=await artifact(f),routes=publicRoutes(f);
  // Simulate a future/corrupted stored manifest, bypassing only this isolated
  // fixture's version guard; the reader must independently fail closed.
  await f.store.query('ALTER TABLE personal_site.delivery_artifacts DROP CONSTRAINT delivery_artifacts_manifest_check');
  for(const mutate of [manifest=>({...manifest,manifestVersion:2}),manifest=>({...manifest,runtime:{...manifest.runtime,worker:manifest.endpoints.config}}),
    manifest=>({...manifest,target:{type:'version',id:'42'}})]) {
    await f.store.query('UPDATE personal_site.delivery_artifacts SET manifest=$1 WHERE digest=$2',[mutate(original.manifest),original.digest]);
    await denied(f,routes,503);
    await f.store.query('UPDATE personal_site.delivery_artifacts SET manifest=$1 WHERE digest=$2',[original.manifest,original.digest]);
  }
  const source=(await f.store.query('SELECT snapshot FROM personal_site.versions WHERE id=$1',[f.published])).rows[0].snapshot;
  await f.store.query("UPDATE personal_site.versions SET snapshot=snapshot || '{\"changed\":true}'::jsonb WHERE id=$1",[f.published]);
  await denied(f,routes,503);
  await f.store.query('UPDATE personal_site.versions SET snapshot=$1 WHERE id=$2',[source,f.published]);
  await f.store.query("DELETE FROM personal_site.resource_references WHERE owner_type='version' AND owner_id=$1",[String(f.published)]);
  await denied(f,routes,503);
  await require('../admin-server/repositories/resources').resourceRepository(f.store).replaceReferences({ownerType:'version',ownerId:String(f.published),references:original.manifest.references});
  await f.store.query('DELETE FROM personal_site.delivery_bindings WHERE version_id=$1',[f.published]);
  await denied(f,routes,503);
});
test('historical A worker remains A after publishing B and removing runtime source and current registry',async t=>{
  const f=await deliveryFixture(t,{publish:true});
  const route=`/api/site/${f.published}/runtime/worker`,before=await (await f.request(route)).text();
  assert.match(before,new RegExp(`/api/site/${f.published}/runtime/wasm`));
  const next=await f.service.publish({revision:3,actor:f.actor});
  assert.notEqual(next,f.published);
  assert.equal(await (await f.request(route)).text(),before);
  await fs.unlink(f.runtimeAppPath);
  // Reconstruct with the production registry, which rejects the test profile.
  const app=require('../admin-server/app').createApp({store:f.store,root:f.root,dataDir:f.root+'/data',origin:'http://localhost:3000'});
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try { const result=await fetch(`http://127.0.0.1:${server.address().port}${route}`);assert.equal(result.status,200);assert.equal(await result.text(),before); }
  finally { await new Promise(resolve=>server.close(resolve)); }
});
for(const revocation of ['logout','reset','idle-expiry','absolute-expiry'])test(`all preview routes recheck ${revocation} despite If-None-Match`,async t=>{
  const f=await deliveryFixture(t);
  const id=await f.service.preview({revision:3,actor:f.actor});
  const routes=[...endpoints.map(name=>`/api/site/${id}/${name}`),`/api/site/${id}/runtime/worker`,`/api/site/${id}/runtime/wasm`,...['/','/work','/work/one','/unsupported.html'].map(p=>p+'?preview='+id)];
  if(revocation==='logout')assert.equal((await f.request('/api/admin/logout',{method:'POST',headers:f.headers})).status,200);
  if(revocation==='reset')await require('../admin-server/security').createAccount(f.store,'replacement','another-long-password-2026',{reset:true});
  if(revocation==='idle-expiry')await f.store.query('UPDATE personal_site.sessions SET touched=$1',[Date.now()-12*60*60*1000]);
  if(revocation==='absolute-expiry')await f.store.query('UPDATE personal_site.sessions SET created=$1',[Date.now()-7*24*60*60*1000]);
  await denied(f,routes,401,f.headers);
});
test('another preview owner is denied before any file selector or CAS access',async t=>{
  const f=await deliveryFixture(t),id=await f.service.preview({revision:3,actor:f.actor});
  // Single-admin schema intentionally cannot create a second simultaneous user.
  // Exercise the trusted reader boundary directly for another owner's context.
  await assert.rejects(require('../admin-server/delivery/reader').resolveDelivery({store:f.store,cas:f.cas,options:{origin:'http://localhost:3000'},version:id,admin:{id:'a'.repeat(64),username:'other'}}),{status:404});
});
test('current published pages do not compose the contemporary editable draft',async t=>{
  const f=await deliveryFixture(t,{publish:true});
  await f.store.query('ALTER TABLE personal_site.projects RENAME TO unavailable_projects');
  for(const route of publicRoutes(f))assert.equal((await f.request(route)).status,200,route);
});
test('legacy artifacts never revalidate and missing legacy delivery is explicit 503',async t=>{
  const f=await deliveryFixture(t);
  await denied(f,endpoints.map(name=>'/api/site/42/'+name),503);
  await f.service.legacy({versionId:42,expectedGeneration:0,actor:f.actor});
  for(const route of [...endpoints.map(name=>'/api/site/42/'+name),'/api/site/42/runtime/worker','/api/site/42/runtime/wasm','/','/work','/work/one','/unsupported.html']) {
    const response=await f.request(route,{headers:{'If-None-Match':'*'}});
    assert.equal(response.status,200,route);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('etag'),null);
  }
});
test('unpublished pages explain unavailability and private admin files never use automatic 304',async t=>{
  const f=await deliveryFixture(t);
  await f.store.query('UPDATE personal_site.site_settings SET published=NULL');
  await denied(f,['/','/work','/work/one','/unsupported.html'],503);
  for(const route of ['/admin/','/admin/site-identity.js']) {
    const response=await f.request(route,{headers:{...f.headers,'If-None-Match':'*'}});
    assert.equal(response.status,200,route);assert.equal(response.headers.get('etag'),null);assert.equal(response.headers.get('cache-control'),'private, no-store');
  }
});
test('file reader requires exactly one selector and runtime cannot impersonate data or documents',async t=>{
  const f=await deliveryFixture(t,{publish:true});
  const {resolveDelivery,readDeliveryFile}=require('../admin-server/delivery/reader');
  const resolved=await resolveDelivery({store:f.store,cas:f.cas,options:{origin:'http://localhost:3000'},version:f.published});
  for(const lookup of [{},{endpoint:'config',runtimeKey:'app'},{other:'app'},{pagePath:null}])await assert.rejects(readDeliveryFile(resolved,lookup,f.cas),{status:400});
  for(const key of ['config','uil','metadata','__proto__','constructor','../app'])await assert.rejects(readDeliveryFile(resolved,{runtimeKey:key},f.cas),{status:404});
  const invalid=structuredClone(resolved);
  invalid.manifest.runtime.worker=invalid.manifest.endpoints.config;
  await assert.rejects(readDeliveryFile(invalid,{runtimeKey:'worker'},f.cas),{status:503});
});
test('service read binds constructor authority and does not require the original profile',async t=>{
  const f=await deliveryFixture(t,{publish:true});
  const service=require('../admin-server/delivery/service').createDeliveryService({store:f.store,options:{root:f.root,dataDir:f.root+'/data',origin:'http://localhost:3000'}});
  const resolved=await service.read({version:f.published,store:null,cas:null,options:{origin:'https://evil.test'},registry:{get(){throw Error('must not run');}}});
  assert.equal(resolved.target.id,String(f.published));assert.equal(resolved.manifest.origin,'http://localhost:3000');
  assert.equal(resolved.manifest.profileId,'tiny-test-runtime');
  const response=await f.request(`/api/site/${f.published}/app.js?preview=header-only`,{headers:{'If-None-Match':'*'}});
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('etag'),null);
});
test('media aliases keep any historical grant and no-store for bytes, ranges, redirects, missing and revoked storage',async t=>{
  const f=await deliveryFixture(t,{publish:true});
  await fs.mkdir(f.root+'/data/uploads',{recursive:true});await fs.writeFile(f.root+'/data/uploads/model.bin',Buffer.from('abcdefgh'));
  await f.store.query("UPDATE personal_site.resources SET source='local',storage_id='local',object_key='model.bin',mime='application/octet-stream' WHERE id='image'");
  await f.store.query('UPDATE personal_site.site_settings SET published=NULL');
  const routes=['/media/image','/models/image.bin','/assets/geometry/admin/image.bin',`/api/site/${f.published}/resources/image/anything.bin`];
  for(const route of routes)for(const [range,status] of [[undefined,200],['bytes=1-3',206],['bytes=999-',416]]) {
    const response=await f.request(route,{headers:{'If-None-Match':'*',...(range?{Range:range}:{})},redirect:'manual'});
    assert.equal(response.status,status,`${route} ${range}`);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('etag'),null);
    if(status===206)assert.equal(await response.text(),'bcd');
    if(status===416)assert.match(response.headers.get('x-robots-tag'),/noindex/);
  }
  for(const column of ['disabled','trashed','storage']) {
    if(column==='disabled')await f.store.query("UPDATE personal_site.resources SET status='disabled' WHERE id='image'");
    if(column==='trashed')await f.store.query("UPDATE personal_site.resources SET trashed=true WHERE id='image'");
    if(column==='storage')await f.store.query("UPDATE personal_site.storages SET available=false WHERE id='local'");
    await denied(f,routes,404);
    await f.store.query("UPDATE personal_site.resources SET status='ready',trashed=false WHERE id='image'");
    await f.store.query("UPDATE personal_site.storages SET available=true WHERE id='local'");
  }
  await f.store.query("UPDATE personal_site.resources SET source='s3',details=details || '{\"publicUrl\":\"https://cdn.example.test/model.bin\"}'::jsonb WHERE id='image'");
  for(const route of routes) {
    const response=await f.request(route,{redirect:'manual',headers:{'If-None-Match':'*'}});
    assert.equal(response.status,302,route);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('location'),'https://cdn.example.test/model.bin');
  }
});

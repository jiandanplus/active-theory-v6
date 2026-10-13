const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {httpFixture}=require('./helpers/http');
test('server identity ignores hostile host/query and unknown projects are 404',async t=>{
  const f=await httpFixture(t);
  const response=await f.request('/work/one?source=https://evil.example',{headers:{Host:'evil.example'}});
  assert.equal(response.status,200);
  const html=await response.text();
  assert.match(html,/href="http:\/\/localhost:3000\/work\/one"/);
  assert.match(html,/<title>One · Fixture<\/title>/);
  assert.doesNotMatch(html,/evil\.example|activetheory\.net/);
  const missing=await f.request('/work/not-present');
  assert.equal(missing.status,404);
  assert.match(missing.headers.get('x-robots-tag'),/noindex/);
  assert.doesNotMatch(await missing.text(),/bridge\.js|app\.js/);
});
test('preview dependencies and failures remain authenticated and private',async t=>{
  const f=await httpFixture(t); await f.createAdmin(); const headers=await f.login();
  fs.mkdirSync(path.join(f.root,'assets/shaders'),{recursive:true});
  fs.writeFileSync(path.join(f.root,'assets/shaders/compiled.vs'),'fixture shader');
  await f.store.query("UPDATE personal_site.resources SET details=details || $1::jsonb WHERE id='image'",[JSON.stringify({path:'assets/images/image.png'})]);
  const draft=await require('../admin-server/repositories/content').contentRepository(f.store).getDraft();
  const id=await require('../admin-server/config').createPreview(f.store,draft.revision,{root:f.root,dataDir:f.root+'/data'},'owner');
  for(const endpoint of [`/?preview=${id}`,`/api/site/${id}/config`,`/api/site/${id}/bridge.js`,`/api/site/${id}/app.js`,`/api/site/${id}/compiled.vs`,`/api/site/${id}/resources/image/image.png`,`/assets/js/app.fixture.js?preview=${id}`,'/admin/','/api/setup/status']) {
    const response=await f.request(endpoint,{headers});
    assert.equal(response.status,200,endpoint);
    assert.equal(response.headers.get('cache-control'),'private, no-store',endpoint);
    assert.match(response.headers.get('x-robots-tag'),/noindex/);
  }
  for(const endpoint of [`/api/site/${id}/config`,`/api/site/${id}/resources/image/image.png`,'/api/admin/config']) {
    const response=await f.request(endpoint);
    assert.equal(response.status,401);
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.match(response.headers.get('x-robots-tag'),/noindex/);
  }
});

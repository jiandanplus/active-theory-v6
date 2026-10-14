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
  assert.equal((html.match(/<title\b/gi)||[]).length,1);
  assert.equal((html.match(/<link\b[^>]*rel="canonical"/gi)||[]).length,1);
  for(const property of ['og:title','og:url','twitter:title','twitter:url'])
    assert.equal((html.match(new RegExp(`(?:name|property)="${property}"`,'g'))||[]).length,1,property);
  const titleIndex=html.indexOf('<title>One · Fixture</title>');
  const canonicalIndex=html.indexOf('<link rel="canonical"');
  const identityIndex=html.indexOf('/identity.js');
  const bridgeIndex=html.indexOf('/bridge.js');
  assert(titleIndex>=0 && canonicalIndex>=0 && identityIndex>=0 && bridgeIndex>=0);
  assert(titleIndex<identityIndex && canonicalIndex<identityIndex,
    'server-rendered title and canonical must precede identity bridge scripts');
  assert(identityIndex<bridgeIndex,'identity script must precede bridge script');
  const program=await f.request(html.match(/src="([^"]+\/identity\.js)"/)[1]);
  assert.equal(program.status,200);
  const source=await program.text();
  assert.match(source,/SiteMetadataDOM/);
  assert.doesNotMatch(source,/DATABASE_URL|MASTER_KEY|\/Users\//);
  assert.match(html,/href="http:\/\/localhost:3000\/work\/one"/);
  assert.doesNotMatch(html,/evil\.example|activetheory\.net/);
  const missing=await f.request('/work/not-present');
  assert.equal(missing.status,404);
  assert.match(missing.headers.get('x-robots-tag'),/noindex/);
  assert.doesNotMatch(await missing.text(),/bridge\.js|app\.js/);
});
test('preview dependencies and failures remain authenticated and private',async t=>{
  const f=await require('./helpers/delivery').deliveryFixture(t); const headers=f.headers;
  fs.mkdirSync(path.join(f.root,'assets/shaders'),{recursive:true});
  fs.writeFileSync(path.join(f.root,'assets/shaders/compiled.vs'),'fixture shader');
  fs.writeFileSync(path.join(f.root,'unsupported.html'),'<head><title>Unsupported fixture</title></head>');
  await f.store.query("UPDATE personal_site.resources SET details=details || $1::jsonb WHERE id='image'",[JSON.stringify({path:'assets/images/image.png'})]);
  const draft=await require('../admin-server/repositories/content').contentRepository(f.store).getDraft();
  const actor=(await f.store.query('SELECT id,username FROM personal_site.sessions')).rows[0];
  const id=await require('../admin-server/config').createPreview(f.store,draft.revision,{root:f.root,dataDir:f.root+'/data'},actor,{deliveryService:f.app.locals.deliveryService});
  for(const endpoint of [`/?preview=${id}`,`/api/site/${id}/config`,`/api/site/${id}/bridge.js`,`/api/site/${id}/app.js`,`/api/site/${id}/compiled.vs`,`/api/site/${id}/unsupported.html`,`/api/site/${id}/resources/image/image.png`,`/assets/js/app.fixture.js?preview=${id}`,'/admin/','/api/setup/status']) {
    const response=await f.request(endpoint,{headers});
    assert.equal(response.status,/\/api\/site\/[^/]+\/(?:app\.js|compiled\.vs)$/.test(endpoint)?422:200,endpoint);
    assert.equal(response.headers.get('cache-control'),'private, no-store',endpoint);
    assert.match(response.headers.get('x-robots-tag'),/noindex/);
  }
  const program=await f.request(`/api/site/${id}/identity.js`,{headers});
  assert.equal(program.status,200);
  assert.equal(program.headers.get('cache-control'),'private, no-store');
  assert.match(program.headers.get('x-robots-tag'),/noindex/);
  for(const endpoint of [`/api/site/${id}/identity.js`,`/api/site/${id}/config`,`/api/site/${id}/unsupported.html`,`/api/site/${id}/resources/image/image.png`,'/api/admin/config']) {
    const response=await f.request(endpoint);
    assert.equal(response.status,401);
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    assert.equal(response.headers.get('x-content-type-options'),'nosniff');
    assert.match(response.headers.get('x-robots-tag'),/noindex/);
  }
  const repo=require('../admin-server/repositories/content').contentRepository;
  await assert.rejects(require('../admin-server/frontend-resources').resolveVersion(f.store,{version:id,admin:{username:'other'}}),error=>error.status===404);
  for(const [owner,expires] of [['owner',new Date(Date.now()-1000)]]) {
    const deniedId='preview-denied-'+owner;
    await f.store.transaction(tx=>repo(tx).insertPreview({id:deniedId,owner,expires,snapshot:f.bundle.draft,
      references:require('../admin-server/snapshots').collectReferences(f.bundle.draft)}));
    const denied=await f.request(`/api/site/${deniedId}/identity.js`,{headers});
    assert.equal(denied.status,404);
    assert.equal(denied.headers.get('cache-control'),'private, no-store');
    assert.match(denied.headers.get('x-robots-tag'),/noindex/);
  }
});
test('unsupported relative CSS media retain target authorization and live resource status',async t=>{
  const f=await httpFixture(t); await f.createAdmin(); const headers=await f.login();
  const snapshot=structuredClone(f.bundle.draft);
  snapshot.legacyMap['assets/fonts/fixture.woff2']='font';
  snapshot.legacyMap['assets/images/unsupported-bg.jpg']='image';
  fs.writeFileSync(path.join(f.root,'assets/fonts/fixture.woff2'),'fixture font');
  fs.writeFileSync(path.join(f.root,'unsupported.html'),`<style>@font-face{src:url('./assets/fonts/fixture.woff2')}body{background-image:url('./assets/images/unsupported-bg.jpg')}</style>`);
  for(const [id,assetPath] of [['font','assets/fonts/fixture.woff2'],['image','assets/images/image.png']])
    await f.store.query('UPDATE personal_site.resources SET details=details || $1::jsonb WHERE id=$2',[JSON.stringify({path:assetPath}),id]);
  const id='preview-unsupported';
  await require('../admin-server/repositories/content').contentRepository(f.store).insertPreview({id,owner:'owner',expires:new Date(Date.now()+60000),snapshot,
    references:require('../admin-server/snapshots').collectReferences(snapshot)});
  await f.store.query('UPDATE personal_site.versions SET snapshot=$1::jsonb WHERE id=42',[JSON.stringify(snapshot)]);
  for(const target of ['42',id]) {
    const response=await f.request(`/api/site/${target}/unsupported.html`,{headers});
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),target===id?'private, no-store':'no-store');
    if(target===id) assert.match(response.headers.get('x-robots-tag'),/noindex/);
    const html=await response.text();
    assert.doesNotMatch(html,/url\(['"]\.\/assets|\/api\/site\/[^/]+\/assets\//);
    const urls=[...html.matchAll(/url\(['"]([^'"]+)['"]\)/g)].map(match=>match[1]);
    assert.equal(urls.length,2);
    for(const url of urls) {
      assert(url.startsWith(`/api/site/${target}/resources/`));
      assert.equal((await f.request(url,{headers})).status,200);
      if(target===id) assert.equal((await f.request(url)).status,401);
    }
    await f.store.query("UPDATE personal_site.resources SET status='disabled' WHERE id='font'");
    assert.equal((await f.request(urls[0],{headers})).status,404);
    await f.store.query("UPDATE personal_site.resources SET status='ready' WHERE id='font'");
  }
  fs.writeFileSync(path.join(f.root,'unsupported.html'),`<style>body{background:url('./assets/unmapped.png')}</style>`);
  const rejected=await f.request(`/api/site/${id}/unsupported.html`,{headers});
  assert.equal(rejected.status,422);
  assert.equal(rejected.headers.get('cache-control'),'private, no-store');
  assert.match(rejected.headers.get('x-robots-tag'),/noindex/);
});

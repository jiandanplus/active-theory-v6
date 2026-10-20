const test = require('node:test');
const assert = require('node:assert/strict');
const {httpFixture} = require('./helpers/http');
const {contentRepository} = require('../admin-server/repositories/content');

test('first-party demo installs as private draft without original assets', async t => {
  const bundle = await require('../admin-server/portfolio/sample').demoBundle();
  assert.equal(bundle.published, null);
  assert.equal(bundle.draft.config.site.language, 'zh-CN');
  assert.ok(bundle.draft.config.projects.length >= 2);
  assert.deepEqual(bundle.report.missingRequired, []);
  assert.deepEqual(bundle.draft.config.scenes, []);
  assert.equal(bundle.admin, null);
});

test('first-party runtime has fixed source identities and a closed trusted profile', async () => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const {builtinRuntime} = require('../admin-server/portfolio/builtin');
  const {validateRuntime,get} = require('../admin-server/engine/registry');
  const {root,manifest} = await builtinRuntime();
  const files = new Map(await Promise.all(manifest.files.map(async entry => [entry.key,await fs.readFile(path.join(root,entry.path))])));
  assert.equal(validateRuntime(manifest,files,get('portfolio-v1')).files,4);
  const invalid = structuredClone(manifest); invalid.dependencies=[];
  assert.throws(()=>validateRuntime(invalid,files,get('portfolio-v1')),{status:422});
  const corrupt = new Map(files); corrupt.set('app',Buffer.from('untrusted executable'));
  assert.throws(()=>validateRuntime(manifest,corrupt,get('portfolio-v1')),{status:422});
  assert.throws(()=>get('uploaded-template'),{status:422});
});

test('demo installer uses normal setup authorization and never auto publishes or selects a runtime', async t => {
  const f = await httpFixture(t,{installed:false});
  const headers = await f.setupSession();
  const preflight = await f.request('/api/setup/preflight',{method:'POST',headers,body:JSON.stringify({mode:'demo'})});
  assert.equal(preflight.status,200);
  const digest = (await preflight.json()).digest;
  const installed = await f.request('/api/setup/install',{method:'POST',headers,body:JSON.stringify({mode:'demo',digest,
    account:{username:'example-owner',password:'test-only-long-password-2026'}})});
  assert.equal(installed.status,201,await installed.clone().text());
  const draft = await contentRepository(f.store).getDraft();
  assert.equal(draft.published,null);
  assert.equal(draft.config.projects.length,2);
  assert.equal((await require('../admin-server/repositories/runtime').runtimeRepository(f.store).getSelection()).digest,null);
  assert.equal((await f.request('/')).status,503);
});

test('semantic renderer escapes content and never embeds arbitrary navigation protocols', () => {
  const {renderPortfolio} = require('../admin-server/portfolio/render');
  const config = {site:{title:'<script>bad()</script>',description:'A & B',emailLink:'x@example.test'},projects:[
    {slug:'example',name:'<img onerror=bad()>',description:'one\ntwo',projectURL:'javascript:alert(1)',tags:'Design'}
  ],scenes:[],songs:[]};
  const html = renderPortfolio({config,pathname:'/',target:{type:'version',id:'1'}});
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img onerror=bad\(\)&gt;/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.match(html, /<main\b/);
  assert.match(html, /href="#main"/);
  assert.match(html, /\/work\/example/);
});

test('built-in runtime registration is authenticated, explicit and publishes immutable semantic content', async t => {
  const f = await httpFixture(t);
  await f.createAdmin();
  const headers = await f.login();
  assert.equal((await f.request('/api/admin/runtime/builtin',{method:'POST',headers:f.json,body:'{}'})).status,401);
  const registered = await f.request('/api/admin/runtime/builtin',{method:'POST',headers,body:'{}'});
  assert.equal(registered.status,200,await registered.clone().text());
  const builtin = await registered.json();
  assert.equal(builtin.profileId,'portfolio-v1');
  const before = await (await f.request('/api/admin/runtime',{headers})).json();
  assert.equal(before.selection.digest,null);
  assert.equal((await f.request('/api/admin/runtime/selection',{method:'PUT',headers,
    body:JSON.stringify({digest:builtin.digest,generation:0})})).status,200);
  const publication = await f.request('/api/admin/publish',{method:'POST',headers,body:JSON.stringify({revision:3})});
  assert.equal(publication.status,200,await publication.clone().text());
  const initial = await (await f.request('/')).text();
  assert.match(initial, /Fixture/);
  assert.match(initial, /One/);
  assert.match(initial, /<main\b/);
  assert.equal((await f.request('/work/one')).status,200);
  assert.equal((await f.request('/contact')).status,200);
  assert.equal((await f.request('/basic/work/one')).status,200);
  const basic = await (await f.request('/basic')).text();
  assert.match(basic, /Fixture/);
  assert.doesNotMatch(basic, /<script\b/);
  const imageURLs = html => [...html.matchAll(/<img\b[^>]*src="([^"]+)"/g)].map(match => match[1]);
  assert.equal(imageURLs(basic).length, 1, 'fixture has one managed project thumbnail');
  const publicTarget = /\/api\/site\/([^/]+)\/identity\.js/.exec(initial)[1];
  const unsupported = await f.request('/api/site/' + publicTarget + '/unsupported.html');
  assert.equal(unsupported.status, 200);
  assert.deepEqual(imageURLs(await unsupported.text()), imageURLs(basic));
  for (const url of imageURLs(basic)) {
    assert.ok(url.startsWith('/api/site/' + publicTarget + '/resources/'));
  }
  const draft = await contentRepository(f.store).getDraft();
  draft.config.site.title = 'Unpublished secret title';
  const saved = await f.request('/api/admin/config',{method:'PUT',headers,body:JSON.stringify({config:draft.config,revision:draft.revision})});
  assert.equal(saved.status,200);
  assert.equal(await (await f.request('/')).text(),initial);
  const preview = await f.request('/api/admin/preview',{method:'POST',headers,body:JSON.stringify({revision:(await saved.json()).revision})});
  assert.equal(preview.status,200,await preview.clone().text());
  const previewURL = (await preview.json()).url;
  assert.equal((await f.request(previewURL)).status,401);
  const privatePage = await f.request(previewURL,{headers});
  assert.equal(privatePage.status,200);
  const previewHTML = await privatePage.text();
  assert.match(previewHTML,/Unpublished secret title/);
  assert.match(privatePage.headers.get('cache-control'),/private/);
  const privateTarget = new URL(previewURL, f.base).searchParams.get('preview');
  const privateUnsupportedURL = '/api/site/' + privateTarget + '/unsupported.html';
  assert.equal((await f.request(privateUnsupportedURL)).status, 401);
  const privateUnsupported = await f.request(privateUnsupportedURL, {headers});
  assert.equal(privateUnsupported.status, 200);
  assert.match(privateUnsupported.headers.get('cache-control'), /private/);
  const privateBasic = await f.request('/basic?preview=' + privateTarget, {headers});
  const privateImages = imageURLs(await privateBasic.text());
  assert.equal(privateImages.length, 1);
  assert.deepEqual(imageURLs(await privateUnsupported.text()), privateImages);
  for (const url of privateImages) {
    assert.ok(url.startsWith('/api/site/' + privateTarget + '/resources/'));
    assert.equal((await f.request(url)).status, 401);
  }
  for(const path of [
    /href="([^\"]*\/work\?preview=[^\"]+)"/.exec(previewHTML)?.[1],
    /href="(\/basic\?preview=[^\"]+)"/.exec(previewHTML)?.[1],
  ]){
    assert.ok(path,'preview exposes work and ordinary-page navigation');
    const response=await f.request(path,{headers});
    assert.equal(response.status,200,'preview navigation must preserve the full private target identity');
    assert.match(response.headers.get('cache-control'),/private/);
    assert.equal((await f.request(path)).status,401);
  }
});

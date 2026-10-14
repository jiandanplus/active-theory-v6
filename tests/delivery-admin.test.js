const {test}=require('node:test');
const assert=require('node:assert/strict');
const {deliveryFixture}=require('./helpers/delivery');

const json=async response=>({status:response.status,body:await response.json()});
test('runtime admin is authenticated and projects only public bundle metadata',async t=>{
  const f=await deliveryFixture(t);
  assert.equal((await f.request('/api/admin/runtime')).status,401);
  const result=await json(await f.request('/api/admin/runtime',{headers:f.headers}));
  assert.equal(result.status,200);
  assert.deepEqual(Object.keys(result.body).sort(),['bundles','selection']);
  assert.deepEqual(Object.keys(result.body.bundles[0]).sort(),['bytes','digest','files','profileId','registeredAt']);
  assert.equal(result.body.selection.digest,result.body.bundles[0].digest);
  assert.equal(JSON.stringify(result.body).includes(f.runtime.root),false);
  assert.equal(JSON.stringify(result.body).includes('manifest'),false);
});
test('selection validates exact body and existing auth CSRF Origin gates',async t=>{
  const f=await deliveryFixture(t),url='/api/admin/runtime/selection',body={digest:'a'.repeat(64),generation:1};
  const put=(value,headers=f.headers)=>f.request(url,{method:'PUT',headers,body:JSON.stringify(value)});
  assert.equal((await put(body,{...f.headers,'X-CSRF-Token':'bad'})).status,403);
  assert.equal((await put(body,{...f.headers,Origin:'https://other.invalid'})).status,403);
  for(const value of [{...body,root:'/tmp/forbidden'}, {...body,origin:'https://other.invalid'}, {...body,actor:'attacker'}, {digest:body.digest,generation:-1}, {digest:'not-a-digest',generation:1}, []])
    assert.equal((await put(value)).status,400);
  const current=(await json(await f.request('/api/admin/runtime',{headers:f.headers}))).body.selection;
  assert.equal((await put({digest:current.digest,generation:0})).status,409);
  const selected=await json(await put({digest:current.digest,generation:1}));
  assert.equal(selected.status,200);assert.equal(selected.body.generation,1);
});
test('versions expose safe per-target status and legacy action rejects overrides',async t=>{
  const f=await deliveryFixture(t,{publish:true});
  const versions=await json(await f.request('/api/admin/versions',{headers:f.headers}));
  assert.equal(versions.status,200);
  const row=versions.body.versions.find(v=>v.id===f.published);
  assert.deepEqual(Object.keys(row).sort(),['artifactDigest','created','generation','id','mode','status']);
  assert.equal(row.mode,'pinned');assert.equal(row.status,'已固定');
  assert.equal(JSON.stringify(versions.body).includes('manifest'),false);
  const post=(value)=>f.request(`/api/admin/versions/${f.published}/delivery`,{method:'POST',headers:f.headers,body:JSON.stringify(value)});
  for(const value of [{generation:0,root:'/tmp'}, {generation:0,origin:'https://other.invalid'}, {generation:-1}, {}])assert.equal((await post(value)).status,400);
  assert.equal((await post({generation:0})).status,409);
  assert.equal((await f.request('/api/admin/versions/not-an-id/delivery',{method:'POST',headers:f.headers,body:'{"generation":0}'})).status,400);
});
test('legacy HTTP pins once without changing draft and damaged binding does not hide other history',async t=>{
  const f=await deliveryFixture(t,{publish:true});
  const before=(await f.store.query('SELECT revision FROM personal_site.site_settings WHERE id=true')).rows[0].revision;
  const versionList=async()=>json(await f.request('/api/admin/versions',{headers:f.headers}));
  const initial=(await versionList()).body.versions;
  assert.equal(initial.find(v=>v.id===42).status,'legacy待生成');
  const route='/api/admin/versions/42/delivery',body='{"generation":0}';
  const result=await json(await f.request(route,{method:'POST',headers:f.headers,body}));
  assert.equal(result.status,200);
  assert.equal(result.body.version,42);
  assert.match(result.body.artifactDigest,/^[a-f0-9]{64}$/);
  assert.equal((await f.store.query('SELECT revision FROM personal_site.site_settings WHERE id=true')).rows[0].revision,before);
  assert.equal((await f.request(route,{method:'POST',headers:f.headers,body})).status,409);
  await f.store.query('UPDATE personal_site.delivery_artifacts SET manifest=manifest || $1::jsonb WHERE digest=$2',[{origin:'https://wrong.invalid'},result.body.artifactDigest]);
  const versions=(await versionList()).body.versions;
  assert.equal(versions.find(v=>v.id===42).status,'缺失/损坏');
  assert.equal(versions.find(v=>v.id===f.published).status,'已固定');
});
test('unselected runtime is explicit without hiding legacy history',async t=>{
  const f=await deliveryFixture(t);
  await f.store.query('UPDATE personal_site.runtime_selection SET runtime_digest=NULL,generation=generation+1 WHERE id=true');
  const versions=(await json(await f.request('/api/admin/versions',{headers:f.headers}))).body.versions;
  assert.equal(versions.find(v=>v.id===42).status,'未选包');
});

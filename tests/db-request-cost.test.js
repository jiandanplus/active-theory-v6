const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {deliveryFixture}=require('./helpers/delivery');

// SQL statements per request after warm-up. Budgets are ceilings; lower is fine.
// Lower a budget when an optimization lands so regressions fail loudly.
const BUDGET={page:17,endpoint:16,runtime:16,asset:10,resource:8,media:8,versions:7};

function counter(store) {
  const log=[];
  const query=store.query.bind(store),transaction=store.transaction.bind(store);
  store.query=(text,values)=>{log.push(text);return query(text,values);};
  store.transaction=fn=>transaction(tx=>fn({query:(text,values)=>{log.push(text);return tx.query(text,values);}}));
  return log;
}
async function cost(f,log,route,init) {
  await (await f.request(route,{redirect:'manual',...init})).arrayBuffer();
  log.length=0;
  const response=await f.request(route,{redirect:'manual',...init});
  await response.arrayBuffer();
  return {status:response.status,queries:log.length};
}

test('public and admin requests stay within SQL budgets',{timeout:120000},async t=>{
  const f=await deliveryFixture(t,{publish:true});
  fs.mkdirSync(f.root+'/data/uploads',{recursive:true});
  fs.writeFileSync(f.root+'/data/uploads/font.png',Buffer.from('font'));
  fs.writeFileSync(f.root+'/data/uploads/image.png',Buffer.from('image'));
  for(const id of ['image','font'])
    await f.store.query("UPDATE personal_site.resources SET source='local',storage_id='local',object_key=$1 WHERE id=$2",[id+'.png',id]);
  const log=counter(f.store);
  const v=f.published;
  const measured={
    page:await cost(f,log,'/'),
    endpoint:await cost(f,log,`/api/site/${v}/identity.js`),
    runtime:await cost(f,log,`/api/site/${v}/runtime/app`),
    asset:await cost(f,log,'/assets/font.png'),
    resource:await cost(f,log,`/api/site/${v}/resources/image/image.png`),
    media:await cost(f,log,'/media/image'),
  };
  for(const [name,{status,queries}] of Object.entries(measured)) {
    assert.equal(status,200,name);
    assert.ok(queries<=BUDGET[name],`${name}: ${queries} SQL > budget ${BUDGET[name]}`);
  }
  // Admin version list must not grow per version beyond the budget.
  for(let i=0;i<4;i++) await f.service.publish({revision:3,actor:f.actor});
  const versions=(await f.store.query('SELECT count(*)::int AS n FROM personal_site.versions')).rows[0].n;
  const list=await cost(f,log,'/api/admin/versions',{headers:{Cookie:f.headers.Cookie}});
  assert.equal(list.status,200);
  assert.ok(list.queries<=BUDGET.versions*versions+2,`versions: ${list.queries} SQL for ${versions} versions`);
  t.diagnostic(JSON.stringify({...measured,versions:{versions,queries:list.queries}}));
});


const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {postgresFixture}=require('./helpers/postgres');
const {contentFixture}=require('./helpers/content');
const {testRuntime}=require('./helpers/runtime');
const {createCAS}=require('../admin-server/delivery/cas');
const {sha256,digestJSON}=require('../admin-server/delivery/contracts');
const {runtimeRepository}=require('../admin-server/repositories/runtime');
const {registerRuntime,selectRuntime}=require('../admin-server/delivery/registration');
const {main}=require('../scripts/runtime-bundle');

async function fixture(t,{installed=false}={}) {
  const {store,databaseUrl}=await postgresFixture(t);
  await store.transaction(tx=>require('../admin-server/repositories/content').contentRepository(tx).importBundle(contentFixture(t).bundle));
  if(installed)await store.query("INSERT INTO personal_site.installation(source,schema_version) VALUES('bundle',3)");
  const runtime=testRuntime(t),dataDir=path.join(runtime.root,'data');
  await fs.mkdir(dataDir);
  return {store,databaseUrl,...runtime,dataDir,cas:createCAS(dataDir),actor:'admin'};
}
async function state(store) {
  return {settings:(await store.query('SELECT revision,published FROM personal_site.site_settings')).rows,
    bindings:(await store.query('SELECT * FROM personal_site.delivery_bindings ORDER BY id')).rows,
    selection:await runtimeRepository(store).getSelection()};
}
test('registration never selects and equal selection is a no-op with no extra audit',async t=>{
  const f=await fixture(t),before=await state(f.store);
  const result=await registerRuntime(f),repo=runtimeRepository(f.store);
  assert.deepEqual(result,{digest:digestJSON(f.manifest),profileId:f.manifest.profileId,files:6,bytes:f.manifest.files.reduce((n,e)=>n+e.size,0)});
  assert.deepEqual(await state(f.store),before);
  assert.equal((await repo.listBundles()).length,1);
  assert.deepEqual((await repo.getBundle(result.digest)).manifest,f.manifest);
  const input={...f,digest:result.digest,expectedGeneration:0};
  assert.deepEqual(await selectRuntime(input),{digest:result.digest,generation:1});
  const audits=(await f.store.query('SELECT action,actor FROM personal_site.audit_events ORDER BY id')).rows;
  assert.equal(audits.at(-1).actor,'admin');
  assert.deepEqual(await selectRuntime({...input,expectedGeneration:1}),{digest:result.digest,generation:1});
  assert.deepEqual((await f.store.query('SELECT action,actor FROM personal_site.audit_events ORDER BY id')).rows,audits);
  await assert.rejects(selectRuntime(input),{status:409});
  const after=await state(f.store);assert.deepEqual(after.settings,before.settings);assert.deepEqual(after.bindings,before.bindings);
});
test('registration ignores mtime and unlisted executable files; byte changes have new identity',async t=>{
  const f=await fixture(t),first=await registerRuntime(f);
  await fs.utimes(path.join(f.root,'app.js'),new Date(0),new Date(0));
  await fs.writeFile(path.join(f.root,'unlisted.js'),"throw new Error('must never execute')");
  assert.equal((await registerRuntime(f)).digest,first.digest);
  const row=await runtimeRepository(f.store).getBundle(first.digest);
  await fs.appendFile(path.join(f.root,'app.js'),'\n');
  const manifest=structuredClone(f.manifest),app=manifest.files.find(e=>e.key==='app');
  const bytes=await fs.readFile(path.join(f.root,app.path));app.size=bytes.length;app.sha256=sha256(bytes);
  const second=await registerRuntime({...f,manifest});assert.notEqual(second.digest,first.digest);
  assert.deepEqual(await runtimeRepository(f.store).getBundle(first.digest),row);
});
test('schema, profile, hash, size, missing source, closure and patch errors precede all CAS and DB writes',async t=>{
  const f=await fixture(t),before=await state(f.store);
  const cases=[];
  for(const change of [m=>m.manifestVersion=2,m=>m.profileId='unknown',m=>m.files[0].sha256='a'.repeat(64),m=>m.files[0].size++,m=>m.dependencies.pop(),m=>m.files[0].path='missing.html']) {
    const manifest=structuredClone(f.manifest);change(manifest);cases.push(manifest);
  }
  for(const manifest of cases)await assert.rejects(registerRuntime({...f,manifest}));
  await fs.writeFile(path.join(f.root,'app.js'),'self.NO_ANCHOR = true;');
  const manifest=structuredClone(f.manifest),entry=manifest.files.find(e=>e.key==='app'),bytes=await fs.readFile(path.join(f.root,entry.path));
  entry.size=bytes.length;entry.sha256=sha256(bytes);await assert.rejects(registerRuntime({...f,manifest}));
  assert.deepEqual(await fs.readdir(f.dataDir),[]);
  assert.deepEqual(await runtimeRepository(f.store).listBundles(),[]);assert.deepEqual(await state(f.store),before);
});
test('repository refuses same digest with different manifest and preserves original',async t=>{
  const f=await fixture(t),result=await registerRuntime(f),repo=runtimeRepository(f.store),before=await repo.getBundle(result.digest);
  const manifest=structuredClone(f.manifest);manifest.files[0].size++;
  await assert.rejects(f.store.transaction(tx=>runtimeRepository(tx).insertBundle({digest:result.digest,manifest})),{status:409});
  assert.deepEqual(await repo.getBundle(result.digest),before);
});
test('selection rereads every CAS entry and rejects corruption or unsupported stored manifests',async t=>{
  const f=await fixture(t),result=await registerRuntime(f),before=await state(f.store);
  const last=f.manifest.files.at(-1),object=path.join(f.dataDir,'delivery/objects',last.sha256);
  await fs.writeFile(object,Buffer.alloc(last.size));
  await assert.rejects(selectRuntime({...f,digest:result.digest,expectedGeneration:0}));
  assert.deepEqual(await state(f.store),before);
  const unknown=structuredClone(f.manifest);unknown.profileId='unknown';
  const digest=digestJSON(unknown);await runtimeRepository(f.store).insertBundle({digest,manifest:unknown});
  await assert.rejects(selectRuntime({...f,digest,expectedGeneration:0}),{status:422});
  assert.deepEqual(await state(f.store),before);
});
test('invalid selection input fails 400 before database or CAS access',async()=>{
  const forbidden={query:()=>{throw Error('DB accessed');},transaction:()=>{throw Error('DB accessed');}};
  for(const digest of [null,'../x','https://example.test/x',42,'A'.repeat(64)])await assert.rejects(selectRuntime({store:forbidden,cas:{},digest,expectedGeneration:0,actor:'admin'}),{status:400});
  for(const expectedGeneration of [null,-1,0.1,'0',NaN,Number.MAX_SAFE_INTEGER+1])await assert.rejects(selectRuntime({store:forbidden,cas:{},digest:'a'.repeat(64),expectedGeneration,actor:'admin'}),{status:400});
});
test('concurrent explicit selections serialize and only one generation-zero request succeeds',async t=>{
  const f=await fixture(t),{digest}=await registerRuntime(f);
  const results=await Promise.allSettled([selectRuntime({...f,digest,expectedGeneration:0}),selectRuntime({...f,digest,expectedGeneration:0})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  assert.deepEqual(await runtimeRepository(f.store).getSelection(),{digest,generation:1});
});
async function cliArgs(f) {
  const manifest=path.join(f.root,'runtime.json');await fs.writeFile(manifest,JSON.stringify(f.manifest));
  return ['--root',f.root,'--manifest',manifest,'--profile',f.manifest.profileId];
}
function capture(t) {
  const lines=[];t.mock.method(console,'log',(...args)=>lines.push(args.join(' ')));return lines;
}
test('CLI registers installed schema3 only, reports safe summary and closes pool',async t=>{
  const f=await fixture(t,{installed:true}),args=await cliArgs(f),lines=capture(t);
  let closed=false;
  const result=await main(args,{loadOptions:()=>({databaseUrl:f.databaseUrl,dataDir:f.dataDir}),registry:f.registry,
    openPostgres:options=>{const db=require('../admin-server/postgres').openPostgres(options);return {...db,close:async()=>{closed=true;await db.close();}};}});
  assert.ok(closed);assert.equal(lines.length,1);assert.ok(lines[0].includes(result.digest));assert.ok(lines[0].includes(result.profileId));
  assert.ok(!lines[0].includes(f.root));assert.ok(!lines[0].includes(f.databaseUrl));
  assert.deepEqual(await runtimeRepository(f.store).getSelection(),{digest:null,generation:0});
});
test('CLI refuses absent config, non-installed schema and unsupported options without migration',async t=>{
  const f=await fixture(t),args=await cliArgs(f);let closed=false;
  await assert.rejects(main(args,{loadOptions:()=>({dataDir:f.dataDir}),openPostgres:()=>{throw Error('should not open');},registry:f.registry}));
  await assert.rejects(main(args,{loadOptions:()=>({databaseUrl:f.databaseUrl,dataDir:f.dataDir}),registry:f.registry,
    openPostgres:options=>{const db=require('../admin-server/postgres').openPostgres(options);return {...db,close:async()=>{closed=true;await db.close();}};}}));
  assert.ok(closed);assert.deepEqual(await runtimeRepository(f.store).listBundles(),[]);
  for(const extra of ['--scan','--latest','--download','--execute','--registry'])await assert.rejects(main([...args,extra,'x'],{loadOptions:()=>{throw Error('must parse first');}}),{status:400});
});
test('CLI rejects malformed/oversize manifest and profile mismatch without source execution',async t=>{
  const f=await fixture(t,{installed:true}),args=await cliArgs(f),deps={loadOptions:()=>({databaseUrl:f.databaseUrl,dataDir:f.dataDir}),registry:f.registry};
  await assert.rejects(main(args.slice(0,-1).concat('other'),deps));
  const marker=path.join(f.root,'executed');
  await fs.writeFile(args[3],`require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`);
  await assert.rejects(main(args,deps));await assert.rejects(fs.stat(marker),{code:'ENOENT'});
  await fs.writeFile(args[3],' '.repeat(2*1024*1024+1));await assert.rejects(main(args,deps));
  assert.deepEqual(await runtimeRepository(f.store).listBundles(),[]);
});
test('registration freezes caller manifest identity before asynchronous source reads',async t=>{
  const f=await fixture(t),original=structuredClone(f.manifest),pending=registerRuntime(f);
  f.manifest.profileId='unknown';f.manifest.files[0].sha256='a'.repeat(64);f.manifest.dependencies.length=0;
  const result=await pending;assert.equal(result.digest,digestJSON(original));
  assert.deepEqual((await runtimeRepository(f.store).getBundle(result.digest)).manifest,original);
});
test('CAS failure leaves registration, selection, published and audit unchanged',async t=>{
  const f=await fixture(t),before=await state(f.store),audits=(await f.store.query('SELECT * FROM personal_site.audit_events')).rows;
  let puts=0;
  const cas={put:async bytes=>{if(++puts===2)throw Error('disk failed');return f.cas.put(bytes);}};
  await assert.rejects(registerRuntime({...f,cas}),{message:'disk failed'});
  assert.deepEqual(await runtimeRepository(f.store).listBundles(),[]);assert.deepEqual(await state(f.store),before);
  assert.deepEqual((await f.store.query('SELECT * FROM personal_site.audit_events')).rows,audits);
});
test('concurrent repeated registration preserves immutable original and adds only one registration audit',async t=>{
  const f=await fixture(t),results=await Promise.all([registerRuntime(f),registerRuntime(f)]);
  assert.equal(results[0].digest,results[1].digest);assert.equal((await runtimeRepository(f.store).listBundles()).length,1);
  assert.equal((await f.store.query("SELECT * FROM personal_site.audit_events WHERE action='runtime.register'")).rowCount,1);
});
test('CLI refuses an absent dataDir instead of creating it',async t=>{
  const f=await fixture(t,{installed:true}),args=await cliArgs(f),dataDir=path.join(f.root,'absent');
  await assert.rejects(main(args,{loadOptions:()=>({databaseUrl:f.databaseUrl,dataDir}),registry:f.registry}));
  await assert.rejects(fs.stat(dataDir),{code:'ENOENT'});
  assert.deepEqual(await runtimeRepository(f.store).listBundles(),[]);
});
test('profile metadata acceptance happens before any source path is read',async t=>{
  const f=testRuntime(t);
  for(const change of [m=>m.templateId='other',m=>m.entryKey='unsupported',m=>m.files[0].path='other.html',m=>m.dependencies.pop()]) {
    const manifest=structuredClone(f.manifest);change(manifest);
    await assert.rejects(registerRuntime({...f,manifest,root:'/not-a-real-runtime-root',actor:'admin'}),{status:422});
  }
});
test('a different registered package increments selection only, never content revision or historical binding',async t=>{
  const f=await fixture(t),first=await registerRuntime(f),before=await state(f.store);
  await selectRuntime({...f,digest:first.digest,expectedGeneration:0});
  await fs.appendFile(path.join(f.root,'app.js'),'\n// another revision');
  const app=f.manifest.files.find(e=>e.key==='app'),bytes=await fs.readFile(path.join(f.root,app.path));
  app.sha256=sha256(bytes);app.size=bytes.length;
  const second=await registerRuntime(f);
  assert.deepEqual(await selectRuntime({...f,digest:second.digest,expectedGeneration:1}),{digest:second.digest,generation:2});
  const after=await state(f.store);assert.deepEqual(after.settings,before.settings);assert.deepEqual(after.bindings,before.bindings);
});
test('registration treats declared executable source as bytes, including top-level side effects',async t=>{
  const f=await fixture(t),marker=path.join(f.root,'executed'),app=f.manifest.files.find(e=>e.key==='app');
  await fs.appendFile(path.join(f.root,app.path),`\nrequire('node:fs').writeFileSync(${JSON.stringify(marker)},'bad');`);
  const bytes=await fs.readFile(path.join(f.root,app.path));app.sha256=sha256(bytes);app.size=bytes.length;
  const result=await registerRuntime(f);await selectRuntime({...f,digest:result.digest,expectedGeneration:0});
  await assert.rejects(fs.stat(marker),{code:'ENOENT'});
});
test('CLI refuses schema2 and leaves migration records unchanged',async t=>{
  const {store,databaseUrl}=await require('./helpers/v2').v2Fixture(t),runtime=testRuntime(t),dataDir=path.join(runtime.root,'data');
  await fs.mkdir(dataDir);const args=await cliArgs(runtime),before=(await store.query('SELECT * FROM personal_site.schema_migrations ORDER BY version')).rows;
  await assert.rejects(main(args,{loadOptions:()=>({databaseUrl,dataDir}),registry:runtime.registry}));
  assert.deepEqual((await store.query('SELECT * FROM personal_site.schema_migrations ORDER BY version')).rows,before);
  assert.equal((await store.query("SELECT to_regclass('personal_site.runtime_bundles') AS table_name")).rows[0].table_name,null);
  assert.deepEqual(await fs.readdir(dataDir),[]);
});

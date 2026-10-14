const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {testRuntime}=require('./helpers/runtime');
const {createCAS}=require('../admin-server/delivery/cas');
const {digestJSON,canonicalJSON,assertArtifactManifest}=require('../admin-server/delivery/contracts');
const {projectSnapshot}=require('../admin-server/delivery/projection');
const {buildArtifact}=require('../admin-server/delivery/builder');
async function replaceInput(f,key,value){
  const entry=f.manifest.files.find(e=>e.key===key),bytes=Buffer.from(value),stored=await f.cas.put(bytes);
  entry.size=stored.size;entry.sha256=stored.sha256;
  f.args.bundle.digest=digestJSON(f.manifest);f.args.selection.digest=f.args.bundle.digest;
}
function sourceSnapshot(){return {format:2,config:{site:{title:'Fixture'},projects:[{slug:'one',name:'One',image:{url:'/media/image'}}],scenes:[{id:'Home',fields:[{key:'SceneLayoutConfig_1_Home_geometry',type:'geometry',value:'/media/image'}]}],songs:[]},template:{baseUIL:{SceneLayoutConfig_1_Home_geometry:{src:'/media/image'}},metadata:{title:'Fixture'},contact:{},readiness:{missingRequired:[]}},assets:{image:{resourceId:'image',fileName:'image.png'}},legacyMap:{}};}
async function fixture(t){
  const runtime=testRuntime(t),data=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'artifact-test-')));
  t.after(()=>fs.rmSync(data,{recursive:true,force:true}));
  const cas=createCAS(data);
  for(const entry of runtime.manifest.files)await cas.put(fs.readFileSync(path.join(runtime.root,entry.path)));
  const bundle={digest:digestJSON(runtime.manifest),manifest:runtime.manifest};
  return {...runtime,cas,args:{cas,bundle,source:sourceSnapshot(),target:{type:'version',id:'43'},origin:'https://example.test',selection:{digest:bundle.digest,generation:2},profile:runtime.registry.get(runtime.manifest.profileId),kind:'pinned'}};
}
test('projection preserves raw source and freezes layout policy',()=>{
  const {projectSnapshot}=require('../admin-server/delivery/projection');
  const source=sourceSnapshot(),before=JSON.stringify(source),profile={policy:{inactiveLayouts:[]},programs:[]};
  const next=projectSnapshot(source,{type:'version',id:'43'},profile,{runtimeFiles:new Map()});
  assert.equal(JSON.stringify(source),before);assert.equal(next.config.site.language,'en');
  assert(next.references.some(r=>r.resourceId==='image'));assert.deepEqual(next.geometryIds,['image']);
  const inactive=projectSnapshot(source,{type:'version',id:'43'},{...profile,policy:{inactiveLayouts:['Home']}},{runtimeFiles:new Map()});
  assert.deepEqual(inactive.geometryIds,[]);assert.notDeepEqual(inactive.snapshot,next.snapshot);
});
test('complete artifact is deterministic from CAS after original runtime root disappears',async t=>{
  const {buildArtifact}=require('../admin-server/delivery/builder');
  const f=await fixture(t),before=JSON.stringify(f.args.source);
  fs.rmSync(f.root,{recursive:true,force:true});
  const first=await buildArtifact(f.args),second=await buildArtifact(f.args);
  assert.deepEqual(first,second);assert.equal(JSON.stringify(f.args.source),before);
  assertArtifactManifest(first.manifest);assert.equal(first.manifest.sourceSnapshotDigest,digestJSON(f.args.source));
  assert.equal(Object.keys(first.manifest.endpoints).length,10);
  assert.deepEqual(Object.keys(first.manifest.routes),['/','/work','/work/one']);
  assert.equal(first.manifest.routes['/work/unknown'],undefined);
  for(const entry of first.manifest.files)assert.deepEqual(await f.cas.read(entry),await f.cas.read(second.manifest.files.find(e=>e.key===entry.key)));
  const app=first.manifest.files.find(e=>e.key===first.manifest.endpoints['app.js']);
  assert.match((await f.cas.read(app)).toString(),/PINNED_RUNTIME/);
  assert.equal(first.digest,digestJSON(first.manifest));
  assert.equal(canonicalJSON(first.manifest).includes(f.root),false);
});
test('frozen publication context honors explicit empty refs and geometry without losing readiness checks',async()=>{
  const {checkPublicationState}=require('../admin-server/publication');
  const source=sourceSnapshot(),store={query(){throw Error('must not query unfrozen resources');}};
  assert.deepEqual(await checkPublicationState(store,source,{references:[],geometryIds:[],policy:{inactiveLayouts:[]}}),[]);
  source.template.readiness.missingRequired=['unknown-global'];
  await assert.rejects(checkPublicationState(store,source,{references:[],geometryIds:[],policy:{inactiveLayouts:[]}}),/缺少前台/);
});
test('actual declared HTML/CSS media discovers transitive documents before candidate checks',()=>{
  const source=sourceSnapshot();source.assets.manifest={resourceId:'manifest',fileName:'nested/site.webmanifest',document:{icons:[{src:'/assets/icon.png'}]},dependencies:['icon']};
  source.assets.icon={resourceId:'icon',fileName:'assets/icon.png'};
  source.assets.background={resourceId:'background',fileName:'nested/assets/background.png'};
  source.assets.font={resourceId:'font',fileName:'nested/font.woff2'};
  const profile={policy:{inactiveLayouts:[]},programs:[{key:'index',path:'nested/index.html',role:'html'},{key:'style',path:'nested/style.css',role:'stylesheet'}]};
  const runtimeFiles=new Map([['index',Buffer.from('<link rel="manifest" href="site.webmanifest"><style>body{background:url(./assets/background.png)}</style>')],['style',Buffer.from('@font-face{src:url(font.woff2)}')]]);
  const next=projectSnapshot(source,{type:'version',id:'43'},profile,{runtimeFiles});
  assert.deepEqual([...new Set(next.references.map(r=>r.resourceId))].sort(),['background','font','icon','image','manifest']);
  source.assets.other={...source.assets.manifest,document:{name:'different'}};
  assert.throws(()=>projectSnapshot(source,{type:'version',id:'43'},profile,{runtimeFiles}),/文档定义冲突/);
});
test('unknown or unsafe local HTML media fails, external signed URLs stay exact',()=>{
  const {runtimeMedia}=require('../admin-server/delivery/projection'),source=sourceSnapshot(),entry={key:'index',path:'index.html',role:'html'},profile={policy:{inactiveLayouts:[]},programs:[entry]},target={type:'version',id:'43'};
  for(const url of ['assets/missing.png','../outside.png','assets/%2e%2e/x.png','assets/a\\b.png'])assert.throws(()=>projectSnapshot(source,target,profile,{runtimeFiles:new Map([['index',Buffer.from(`<style>x{background:url(${url})}</style>`)]])}),{status:422});
  const html='<style>x{background:url(https://example.test/image.png?b=2&a=1)}</style>';
  assert.equal(runtimeMedia(html,entry,source,target,[]),html);
});
test('deleted instances remain excluded while invisible instances retain media',()=>{
  const source=sourceSnapshot();source.config.projects=[];
  source.template.baseUIL.sl_Home_1_deleted=true;
  assert.deepEqual(projectSnapshot(source,{type:'version',id:'43'},{policy:{inactiveLayouts:[]},programs:[]}).references,[]);
  delete source.template.baseUIL.sl_Home_1_deleted;source.template.baseUIL.sl_Home_1_visible=false;
  assert(projectSnapshot(source,{type:'version',id:'43'},{policy:{inactiveLayouts:[]},programs:[]}).references.some(r=>r.resourceId==='image'));
});
test('derived document actual media is frozen even without inventory dependency metadata',()=>{
  const source=sourceSnapshot();source.assets.manifest={resourceId:'manifest',fileName:'site.webmanifest',document:{icons:[{src:'/assets/icon.png'}]}};
  source.assets.icon={resourceId:'icon',fileName:'assets/icon.png'};
  const profile={policy:{inactiveLayouts:[]},programs:[{key:'index',path:'index.html',role:'html'}]},runtimeFiles=new Map([['index',Buffer.from('<link rel="manifest" href="site.webmanifest">')]]);
  assert(projectSnapshot(source,{type:'version',id:'43'},profile,{runtimeFiles}).references.some(r=>r.resourceId==='icon'));
});
test('unresolved active station-local typed media cannot enter public projection',()=>{
  const source=sourceSnapshot();source.config.projects[0].image.url='/assets/missing.png';
  assert.throws(()=>projectSnapshot(source,{type:'version',id:'43'},{policy:{inactiveLayouts:[]},programs:[]}),{status:422});
});
test('replaced base UIL media does not keep stale template grants or false missing blockers',()=>{
  const source=sourceSnapshot();source.template.baseUIL.SceneLayoutConfig_1_Home_geometry.src='assets/old-missing.bin';
  const result=projectSnapshot(source,{type:'version',id:'43'},{policy:{inactiveLayouts:[]},programs:[]});
  assert(result.references.every(r=>r.resourceId==='image'));
});
test('target origin source and runtime bytes independently change artifact identity',async t=>{
  const f=await fixture(t),first=await buildArtifact(f.args);
  for(const change of [{target:{type:'version',id:'44'}},{origin:'https://other.test'},{source:{...f.args.source,config:{...f.args.source.config,site:{title:'Changed'}}}}]){
    const next=await buildArtifact({...f.args,...change});assert.notEqual(next.digest,first.digest);
  }
  await replaceInput(f,'app','self.TEST_RUNTIME = true; // revised bytes');
  assert.notEqual((await buildArtifact(f.args)).digest,first.digest);
});
test('legacy grants preserve all historical slots and refuse inventory promotion',async t=>{
  const f=await fixture(t);f.args.source.assets.background={resourceId:'background',fileName:'assets/background.png'};
  await replaceInput(f,'unsupported','<html><head><style>body{background:url(./assets/background.png)}</style></head><body>Unsupported</body></html>');
  const pinned=await buildArtifact(f.args);assert(pinned.references.some(r=>r.resourceId==='background'));
  const ceiling=[{resourceId:'image',slot:'old-slot'},{resourceId:'old-unused',slot:'historical'}];
  await assert.rejects(buildArtifact({...f.args,kind:'legacy-render',referenceCeiling:ceiling}),{status:422});
  ceiling.push({resourceId:'background',slot:'old-background'});
  const legacy=await buildArtifact({...f.args,kind:'legacy-render',referenceCeiling:ceiling});
  assert.deepEqual(legacy.references,require('../admin-server/delivery/contracts').normalizeReferences(ceiling));
  assert.equal(legacy.manifest.referencesDigest,digestJSON(legacy.references));
});
test('manifest documents stay resource-authorized and program URLs share the preview target',async t=>{
  const f=await fixture(t);f.args.target={type:'preview',id:'preview-01234567-1234-1234-1234-123456789abc'};
  f.args.source.assets.manifest={resourceId:'manifest',fileName:'site.webmanifest',document:{icons:[{src:'/assets/icon.png'}]},dependencies:['icon']};
  f.args.source.assets.icon={resourceId:'icon',fileName:'assets/icon.png'};
  await replaceInput(f,'index','<html><head><link rel="manifest" href="site.webmanifest"></head><body>TEST_RUNTIME</body></html>');
  const result=await buildArtifact(f.args),manifest=result.manifest;
  const read=async key=>(await f.cas.read(manifest.files.find(e=>e.key===key))).toString();
  const documentKey=manifest.documents.manifest;
  assert(documentKey);assert(!Object.values(manifest.runtime).includes(documentKey));assert(!Object.values(manifest.endpoints).includes(documentKey));
  assert.match(await read(documentKey),new RegExp('/api/site/'+f.args.target.id+'/resources/icon/'));
  for(const key of [manifest.routes['/'],manifest.runtime.worker,manifest.endpoints['bridge.js']]){
    const text=await read(key);assert(text.includes('/api/site/'+f.args.target.id+'/'));assert(!text.includes('/api/site/43/'));
  }
  const html=await read(manifest.routes['/']);assert(html.indexOf('/identity.js')<html.indexOf('/bridge.js'));assert(html.indexOf('/bridge.js')<html.indexOf('/runtime/app'));
  assert.match(html,/name="robots" content="noindex, nofollow"/);
  assert.equal(new Set(manifest.patchReport.map(p=>p.id)).size,manifest.patchReport.length);
  assert.equal(manifest.patchReport.filter(p=>p.id.endsWith('test.app')).length,1);
});
test('invalid output, secrets, empty app and snapshot refusal fail before any output CAS put',async t=>{
  const f=await fixture(t),before=await f.cas.inspect();
  for(const override of [
    {source:{...f.args.source,template:{...f.args.source.template,metadata:{password:'do-not-deliver'}}}},
    {profile:{...f.args.profile,transformApp:()=>({source:'',report:[]})}},
    {profile:{...f.args.profile,validateSnapshot:()=>{throw Object.assign(Error('snapshot rejected'),{status:422});}}},
    {profile:{...f.args.profile,transformHTML:()=>({source:'<html><head></head><head></head></html>',report:[]})}},
    {profile:{...f.args.profile,transformPrograms:()=>({files:new Map(),report:[]})}},
  ]){await assert.rejects(buildArtifact({...f.args,...override}));assert.deepEqual(await f.cas.inspect(),before);}
});
test('actual generated file count cannot exceed artifact quota',async t=>{
  const f=await fixture(t);f.args.source.config.projects=Array.from({length:4090},(_,i)=>({slug:'p-'+i,name:'Project'}));
  const before=await f.cas.inspect();await assert.rejects(buildArtifact(f.args),{status:422});assert.deepEqual(await f.cas.inspect(),before);
});
test('actual generated Buffer bytes cannot exceed artifact byte quota',async t=>{
  const f=await fixture(t),before=await f.cas.inspect();
  const profile={...f.args.profile,transformApp:()=>({source:Buffer.alloc(256*1024*1024+1),report:[]})};
  await assert.rejects(buildArtifact({...f.args,profile}),{status:422});assert.deepEqual(await f.cas.inspect(),before);
});
test('caller mutations during CAS awaits do not change owned build inputs',async t=>{
  const f=await fixture(t),baseline=await buildArtifact(f.args),read=f.cas.read;
  let changed=false;
  t.mock.method(f.cas,'read',async entry=>{
    if(!changed){changed=true;f.args.source.config.site.title='Mutated';f.args.target.id='99';f.args.selection.generation=99;f.args.bundle.manifest.files[0].size++;}
    return read(entry);
  });
  const result=await buildArtifact(f.args);assert.deepEqual(result,baseline);
});
test('pinned media output cannot silently substitute another resource outside frozen grants',()=>{
  const {runtimeMedia}=require('../admin-server/delivery/projection');
  assert.throws(()=>runtimeMedia('<link rel="icon" href="/api/site/43/resources/other/file.png">',{path:'nested/index.html',role:'html'},sourceSnapshot(),{type:'version',id:'43'},[{resourceId:'image',slot:'test'}]),{status:422});
});
test('policy-unused historical document is frozen only when its media stays within old grants',async t=>{
  const f=await fixture(t);f.args.source.assets.historical={resourceId:'old-manifest',fileName:'assets/old.webmanifest',document:{icons:[{src:'old-icon.png'}]}};
  f.args.source.assets.oldIcon={resourceId:'old-icon',fileName:'assets/old-icon.png'};
  const ceiling=[{resourceId:'image',slot:'old-image'},{resourceId:'old-manifest',slot:'old-document'}];
  const before=await f.cas.inspect();
  await assert.rejects(buildArtifact({...f.args,kind:'legacy-render',referenceCeiling:ceiling}),{status:422});
  assert.deepEqual(await f.cas.inspect(),before);
  ceiling.push({resourceId:'old-icon',slot:'old-icon'});
  const result=await buildArtifact({...f.args,kind:'legacy-render',referenceCeiling:ceiling});
  const entry=result.manifest.files.find(e=>e.key===result.manifest.documents['old-manifest']);
  assert.match((await f.cas.read(entry)).toString(),/\/api\/site\/43\/resources\/old-icon\/old-icon.png/);
  assert.deepEqual(result.references,require('../admin-server/delivery/contracts').normalizeReferences(ceiling));
});
test('historical document declared dependency cannot evade the grant ceiling',async t=>{
  const f=await fixture(t);f.args.source.assets.historical={resourceId:'old-manifest',fileName:'old.webmanifest',document:{name:'Old'},dependencies:['ungranted']};
  const ceiling=[{resourceId:'image',slot:'old-image'},{resourceId:'old-manifest',slot:'old-document'}];
  await assert.rejects(buildArtifact({...f.args,kind:'legacy-render',referenceCeiling:ceiling}),{status:422});
});
const authorizedRoot=process.env.AUTHORIZED_RUNTIME_ROOT;
if(authorizedRoot&&authorizedRoot!=='/Users/jiandan/Code/MyCode/active-theory-v6')throw Error('Unauthorized runtime root');
test('fixed production profile builds original audited bytes with synthetic six-scene content',{skip:!authorizedRoot},async t=>{
  const profile=require('../admin-server/engine/registry').get('legacy-six-scenes-v1');
  const f=await fixture(t),files=new Map(profile.programs.map(e=>[e.key,fs.readFileSync(path.join(authorizedRoot,e.path))]));
  const mime={html:'text/html',program:'text/javascript',wasm:'application/wasm',shader:'text/plain'};
  const manifest={manifestVersion:1,profileId:profile.id,templateId:profile.templateId,entryKey:'index',dependencies:structuredClone(profile.dependencies),files:[]};
  for(const entry of profile.programs){const stored=await f.cas.put(files.get(entry.key));manifest.files.push({key:entry.key,path:entry.path,role:entry.role,mime:mime[entry.role],...stored});}
  const source=sourceSnapshot();source.config.scenes=profile.sceneIds.map(id=>({id,fields:[]}));
  source.template.baseUIL=Object.fromEntries(profile.sceneIds.map(id=>['sl_'+id+'_0',{}]));
  source.template.baseUIL.INPUT_P_Element_21_TreeScenecode_1_code='vec3 pointShape = texture2D(tPointCloud, uv).xyz;\nvec3 target = pointShape;';
  const urls=new Set();
  for(const key of ['index','unsupported']){
    const html=files.get(key).toString();
    for(const match of html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g))urls.add(match[1].replace(/^\.\//,''));
    for(const tag of html.matchAll(/<link\b[^>]*>/g))if(/rel="[^"]*\b(?:icon|manifest)\b/.test(tag[0]))urls.add(/href="([^"]+)"/.exec(tag[0])[1]);
  }
  for(const [index,url] of [...urls].entries())source.assets['html-'+index]={resourceId:'html-'+index,fileName:url};
  const digest=digestJSON(manifest),args={...f.args,profile:undefined,bundle:{digest,manifest},selection:{digest,generation:1},source};
  const before=JSON.stringify(source),result=await buildArtifact(args);assert.equal(JSON.stringify(source),before);
  assertArtifactManifest(result.manifest);assert.equal(Object.keys(result.manifest.runtime).length,8);
  assert.equal(result.manifest.patchReport.filter(r=>r.id==='programs.program.worker-create').length,1);
  assert.equal(result.manifest.patchReport.filter(r=>r.id.endsWith('html.app-startup')).length,3);
  const app=(await f.cas.read(result.manifest.files.find(e=>e.key===result.manifest.endpoints['app.js']))).toString();
  assert(app.includes('new Worker(Thread.PATH)'));assert(app.includes('window.__SITE_WRAPPER_CODE__'));
  const invalid=structuredClone(source);invalid.config.scenes.pop();
  await assert.rejects(buildArtifact({...args,source:invalid}),{status:422});
  for(const entry of profile.programs)assert.deepEqual(fs.readFileSync(path.join(authorizedRoot,entry.path)),files.get(entry.key));
});

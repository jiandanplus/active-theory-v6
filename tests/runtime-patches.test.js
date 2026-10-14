const {test}=require('node:test');
const assert=require('node:assert/strict');
const {exactReplace,classBody}=require('../admin-server/engine/patches');
test('required anchor count is exact and replacement is literal',()=>{
  const rule={id:'example',find:'OLD',replace:'$& $1',count:1};
  const result=exactReplace('a OLD b',rule);
  assert.equal(result.source,'a $& $1 b');
  assert.deepEqual(result.report,{id:'example',status:'applied',matches:1,expected:1});
  for(const value of ['none','OLD OLD'])assert.throws(()=>exactReplace(value,rule),{status:422,patchId:'example'});
  assert.throws(()=>classBody('','ViewController',x=>x),{status:422});
});
test('an exact existing value remains an applied patch rather than a compatibility error',()=>{
  assert.deepEqual(exactReplace('OLD',{id:'same',find:'OLD',replace:'OLD',count:1}),{source:'OLD',report:{id:'same',status:'applied',matches:1,expected:1}});
});
test('class body is unique and transforms only its next-Class-bounded slice',()=>{
  const a='Class((function A(){OLD}));',b='Class((function B(){OLD}));';
  assert.equal(classBody(a+b,'A',code=>exactReplace(code,{id:'a',find:'OLD',replace:'NEW',count:1}).source),a.replace('OLD','NEW')+b);
  assert.throws(()=>classBody(a+a,'A',x=>x),{status:422});
});
test('single patch replaces captures but treats configured dollar text literally',()=>{
  const {applyAppPatch}=require('../admin-server/engine/legacy-adapter');
  const loaded=applyAppPatch('contact.loaded','Class((function ContactUI(){'+('await _this.wait((_ => _this.email.dimensions.width));'.repeat(10))+'}));',{site:{}});
  assert.match(loaded.source,/await _this.email.loaded\(\)/);
  assert.deepEqual(loaded.report,{id:'contact.loaded',status:'applied',matches:10,expected:10});
  const nav=applyAppPatch('nav.work','Class((function NavUI(){text: "Work", _type:1}));',{site:{navWork:'$& $1'}});
  assert.match(nav.source,/text: "\$& \$1", link: "work"/);
});
test('comprehensive app and shader entry points reject incomplete inputs',()=>{
  const {patchAppSource,patchShaders}=require('../admin-server/engine/legacy-adapter');
  assert.throws(()=>patchAppSource('let SONGS = [];',{site:{},songs:[],scenes:[]}),{status:422});
  assert.throws(()=>patchShaders('fixture shader',{scenes:[]}),{status:422});
});
test('render HTML requires unique app and unsupported startup mappings',()=>{
  const {renderHTML}=require('../admin-server/engine/render');
  const snapshot={config:{site:{title:'T',language:'zh-CN'},projects:[]},assets:{},legacyMap:{}};
  const html='<html><head></head><body><script>window._UNSUPPORTED_PAGE_ = "unsupported.html"; var s = "assets/js/app." + window._CACHE_ + ".js";</script></body></html>';
  const result=renderHTML({html,snapshot,target:{type:'version',id:'7'},origin:'https://site.test',programs:{}});
  assert.match(result.source,/\/api\/site\/7\/app.js/);
  assert.match(result.source,/\/api\/site\/7\/unsupported.html/);
  assert.equal(result.report.length,3);
  assert.throws(()=>renderHTML({html:'<head></head>',snapshot,target:{type:'version',id:'7'},origin:'https://site.test'}),{status:422});
});
test('bridge authorization is frozen from references, independent of inactive layout mutations',()=>{
  const {bridgeSource}=require('../admin-server/engine/render');
  const snapshot={template:{baseUIL:{sl_CleanRoom_0_deleted:true}},config:{site:{title:'T'},projects:[],scenes:[],songs:[]},assets:{pic:{resourceId:'pic',fileName:'pic.png'}},legacyMap:{'assets/images/pic.png':'pic'}};
  const refs=[{resourceId:'pic',slot:'pic'}];
  const before=bridgeSource(7,snapshot.config,snapshot,'https://site.test',refs,{});
  snapshot.template.baseUIL.sl_CleanRoom_0_deleted=false;
  assert.equal(bridgeSource(7,snapshot.config,snapshot,'https://site.test',refs,{}),before);
  assert.match(before,/resources\/pic\/pic.png/);
  assert.doesNotMatch(bridgeSource(7,snapshot.config,snapshot,'https://site.test',[],{}),/resources\/pic\/pic.png/);
});
test('UIL Lensed branch requires five time anchors and preserves size/speed formulas',()=>{
  const {patchUIL,buildUIL}=require('../admin-server/engine/legacy-adapter');
  const key='INPUT_P_Element_21_TreeScenecode_1_code';
  const snapshot=code=>({template:{baseUIL:{[key]:code}},config:{scenes:[{id:'TreeScene',fields:[{key:'__blackhole_speed',value:2},{key:'__blackhole_size',value:0.5}]}]}});
  const input='// Lensed accretion\n'+Array.from({length:5},(_,i)=>`float x${i} = time;`).join('\n');
  const result=patchUIL(snapshot(input));
  assert.equal(result.data[key],input.replace(/\btime\b/g,'(time * 2.0000)')+'\npos *= 0.5000;');
  assert.deepEqual(result.report,[{id:'uil.blackhole-time',status:'applied',matches:5,expected:5},{id:'uil.blackhole-size',status:'applied',matches:1,expected:1}]);
  for(const count of [0,4,6])assert.throws(()=>patchUIL(snapshot('// Lensed accretion\n'+'time;'.repeat(count))),{status:422});
  const pointCloud='vec3 pointShape = texture2D(tPointCloud, uv).xyz;\nvec3 target = pointShape;';
  assert.equal(buildUIL(snapshot(pointCloud))[key],pointCloud);
});
test('single-patch families enforce their audited anchor cardinalities',()=>{
  const {applyAppPatch}=require('../admin-server/engine/legacy-adapter');
  const rows=[
    ['cms.empty-work','CMSData','_workPages.length ? _workPages : new StateArray(mockData())','_workPages',1],
    ['text3d.empty','Text3D','text && createText(text, _fontObject)','createText(text ?? "", _fontObject)',1],
    ['text-thread.empty-bounds','GLTextThread','let backing = [];','geom.boundingSphere.radius = 0',1],
    ['gltext.empty','GLText','&& (text = txt)) return','&& ((text = txt), true)) return',1],
    ['gltext.local-buffer','GLText','_this.geometry.attributes.uv.setArray(buffers.uv),','attributes.local.setArray(buffers.local)',1],
    ['gluitext.set-text',null,'async setText(text, options) { if (text && (text = text.toString(), !1 !== options?.seoText))','text != null',1],
    ['hydra.absolute-path',null,'this.absolutePath = function (path) {','new URL(path, location.origin).href',1],
    ['assets.get-path',null,'this.getPath = function (path) {','const mapped = window.__SITE_RESOURCE_URL__?.(path)',1],
    ['asset-loader.fetch','AssetLoader','fetch(path)','fetch(window.__SITE_RESOURCE_URL__?.(path) || path)',2],
    ['geometry.version-path','GeomThread','path.includes("assets/geometry/")','path.startsWith("/api/site/")',2],
    ['instance.version-path','InstanceMesh','file.includes("assets/geometry")','file.startsWith("/api/site/")',1],
    ['particles.version-path','ParticleDistributor','path.includes("assets/geometry")','path.startsWith("/api/site/")',1],
    ['nav.contact','NavUI','text: "Contact", _type:','link: "contact"',1],
    ['nav.link','NavUIItem','_this.params.text.toLowerCase()','_this.params.link ||',1],
    ['contact.single-character','ContactUI','function replaceRandomLetters(str, numReplacements) {','if (str.length < 2) return str',1],
    ['clean-room.url','CleanRoom','let url = "old";','let url = "";',1],
    ['songs.list',null,'let SONGS = [1];','let SONGS = [];',1],
    ['songs.empty',null,'let SONGS = []; SONGS = SONGS.shuffle()','_this.set("Global/audioEnabled", false)',1],
  ];
  for(const [id,scope,anchor,marker,count] of rows){
    const source=n=>scope?`Class((function ${scope}(){${anchor.repeat(n)}}));`:anchor.repeat(n);
    const result=applyAppPatch(id,source(count),{site:{},songs:[]});
    assert(result.source.includes(marker),id);
    assert.deepEqual(result.report,{id,status:'applied',matches:count,expected:count});
    for(const n of [0,count+1])assert.throws(()=>applyAppPatch(id,source(n),{site:{},songs:[]}),{status:422});
  }
});
test('conditional contact patches still require class uniqueness and report exact shapes',()=>{
  const {applyAppPatch}=require('../admin-server/engine/legacy-adapter');
  const source='Class((function ContactUI(){}));';
  for(const id of ['contact.remove-email','contact.remove-ig','contact.sync.inner-text']){
    const config={site:{emailLink:'person@example.test',labUrl:'https://example.test'}};
    assert.deepEqual(applyAppPatch(id,source,config),{source,report:{id,status:'not-applicable'}});
    for(const input of ['',source+source])assert.throws(()=>applyAppPatch(id,input,config),{status:422});
  }
});
test('shader mutations preserve unrelated duplicate sections and fail on logo drift',()=>{
  const {patchShaders}=require('../admin-server/engine/legacy-adapter');
  const body='time time time time time time 2.16 2.16 0.54 vec4(emission, 1.0) vec4(color, 1.0)';
  const prefix='luma.fs{@}unchanged{@}luma.fs{@}unchanged again{@}';
  const source=prefix+'LogoParticleShader.glsl{@}'+body+'{@}Other{@}time';
  const config={scenes:[{id:'TreeScene',fields:[{key:'__blackhole_speed',value:2},{key:'__blackhole_size',value:0.5},{key:'__blackhole_brightness',value:3}]}]};
  const result=patchShaders(source,config);
  assert(result.source.startsWith(prefix));
  assert.match(result.source,/1\.080000 1\.080000 0\.270000/);
  assert.match(result.source,/vec4\(emission \* 3\.0000, 1\.0\)/);
  assert(result.source.endsWith('{@}Other{@}time'));
  for(const bad of [source.replace('time time','time'),source+'{@}LogoParticleShader.glsl{@}'+body,source.replace('vec4(color, 1.0)','old')])assert.throws(()=>patchShaders(bad,config),{status:422});
});

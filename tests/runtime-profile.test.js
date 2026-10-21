const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {sha256}=require('../admin-server/delivery/contracts');
const root=process.env.AUTHORIZED_RUNTIME_ROOT;
let authorizedRuntime;
test.before(async()=>{
  if(root)authorizedRuntime=await require('../scripts/authorized-runtime-input').loadAuthorizedRuntime(root);
});
function productionInput(){return authorizedRuntime;}

test('production registry contains only its fixed production profile',()=>{
  const registry=require('../admin-server/engine/registry');
  const profile=registry.get('legacy-six-scenes-v1');
  assert.equal(profile.id,'legacy-six-scenes-v1');
  assert.deepEqual(profile.policy.inactiveLayouts,['Tester']);
  assert.deepEqual(profile.programs.map(f=>[f.key,f.role]),[
    ['index','html'],['unsupported','html'],['app','program'],['modules','program'],
    ['hydra-thread','program'],['basis-js','program'],['basis-wasm','wasm'],
    ['draco-js','program'],['draco-wasm','wasm'],['qrious','program'],['compiled-shaders','shader'],
  ]);
  for(const id of ['tiny-test','fixture','__proto__','constructor','unknown'])
    assert.throws(()=>registry.get(id),{status:422});
  assert(Object.isFrozen(profile));
  assert(Object.isFrozen(profile.programs));
  assert(Object.isFrozen(profile.policy.inactiveLayouts));
});

test('runtime validates bytes, exact typed dependency closure and explicit input selection',{skip:!root},()=>{
  const {validateRuntime}=require('../admin-server/engine/registry');
  const {profile,files,manifest}=productionInput();
  const report=validateRuntime(manifest,files,profile);
  assert.equal(report.files,11);assert.equal(report.totalBytes,[...files.values()].reduce((n,b)=>n+b.length,0));
  assert(report.patches.length>61);
  assert.equal(new Set(report.patches.map(p=>p.id)).size,report.patches.length);
  for(const mutate of [m=>m.dependencies.pop(),m=>m.dependencies.push(m.dependencies[0]),m=>m.dependencies[0].via='unknown',
    m=>m.files.find(f=>f.key==='app').path='assets/js/app.newest.js',m=>m.files.pop(),m=>m.files[0].sha256='0'.repeat(64),
    m=>m.files[0].size++,m=>m.templateId='other']){
    const copy=structuredClone(manifest);mutate(copy);assert.throws(()=>validateRuntime(copy,files,profile),{status:422});
  }
  const copy=new Map(files);copy.delete('basis-wasm');assert.throws(()=>validateRuntime(manifest,copy,profile),{status:422});
  copy.set('basis-wasm',Buffer.from('bad'));assert.throws(()=>validateRuntime(manifest,copy,profile),{status:422});
});

test('audited program rewrites preserve internal callsites and isolate public wrapper ingestion',{skip:!root},()=>{
  const {programMappings,rewritePrograms}=require('../admin-server/engine/program-paths');
  const {profile,files,manifest}=productionInput();
  const output=rewritePrograms(files,programMappings(manifest,{type:'version',id:'43'}),profile);
  const app=output.get('app').toString();
  assert.equal((app.match(/\.importCode\(/g)||[]).length,1);
  assert.equal((app.match(/\.importRuntimeInternal\("zutils"\)/g)||[]).length,1);
  assert.equal((app.match(/\.importRuntimeInternal\("draco"\)/g)||[]).length,2);
  assert(app.includes('window.__SITE_WRAPPER_CODE__(code)'));
  assert(app.includes('window.__SITE_WRAPPER_CODE__(loadedLibs[0])'));
  assert(app.includes('new Worker(Thread.PATH)'));
  assert(app.includes('navigator.serviceWorker.register(window.__SITE_PROGRAM_URL__('));
  assert(!app.includes('new Worker(Thread.PATH + file)'));
  assert(output.get('hydra-thread').toString().startsWith('(function installProgramBridge'));
  assert(files.get('app').toString().includes('new Worker(Thread.PATH + file)'));
  assert.deepEqual(output.get('basis-wasm'),files.get('basis-wasm'));
  // Parsing is not execution: never run the package or its Node/UMD branches.
  const {Script}=require('node:vm');
  assert.doesNotThrow(()=>new Script(profile.transformApp(app,{site:{},songs:[],scenes:[]}).source));
  for(const key of ['hydra-thread','basis-js','draco-js'])assert.doesNotThrow(()=>new Script(output.get(key).toString()));
  for(const source of [files.get('app').toString()+';thread.importCode(arbitrary);',
    files.get('app').toString().replace('thread.importCode(js)','thread.importCode(other)'),
    files.get('app').toString().replace('class GLUIText','class LostText')]){
    const invalid=new Map(files);invalid.set('app',Buffer.from(source));
    assert.throws(()=>rewritePrograms(invalid,programMappings(manifest,{type:'version',id:'43'}),profile),{status:422});
  }
});

test('test runtime is a trusted isolated registry with real hashes, dependencies and patches',t=>{
  const {testRuntime}=require('./helpers/runtime');
  const {validateRuntime,get}=require('../admin-server/engine/registry');
  const {root,manifest,registry}=testRuntime(t);
  const files=new Map(manifest.files.map(f=>[f.key,fs.readFileSync(path.join(root,f.path))]));
  const profile=registry.get(manifest.profileId);
  assert.throws(()=>get(manifest.profileId),{status:422});
  assert.equal(validateRuntime(manifest,files,profile).files,manifest.files.length);
  fs.writeFileSync(path.join(root,'app.zzzz.js'),'must not be selected');
  assert.equal(validateRuntime(manifest,files,profile).files,manifest.files.length);
  const bad=structuredClone(manifest);bad.dependencies=[];
  assert.throws(()=>validateRuntime(bad,files,profile),{status:422});
  const changed=new Map(files);changed.set('app',Buffer.from('wrong anchor'));
  const altered=structuredClone(manifest),entry=altered.files.find(f=>f.key==='app');
  entry.size=changed.get('app').length;entry.sha256=sha256(changed.get('app'));
  assert.throws(()=>validateRuntime(altered,changed,profile),{status:422});
});

test('production HTML rejects extra programs, strips known artifacts, guards capabilities before startup',{skip:!root},()=>{
  const vm=require('node:vm');
  const {programMappings}=require('../admin-server/engine/program-paths');
  const {profile,files,manifest}=productionInput();
  const programs=programMappings(manifest,{type:'version',id:'43'});
  const snapshot={config:{site:{title:'Title'},projects:[]},assets:{},legacyMap:{}};
  const args={html:files.get('index').toString(),snapshot,target:{type:'version',id:'43'},origin:'https://site.test',programs};
  const rendered=profile.transformHTML(args);
  assert(!rendered.source.includes('href="undefined"'));
  assert(rendered.source.indexOf('/identity.js')<rendered.source.indexOf('/bridge.js'));
  const startup=[...rendered.source.matchAll(/<script>([\s\S]*?)<\/script>/g)].find(m=>m[1].includes('_UNSUPPORTED_PAGE_'))[1];
  for(const missing of ['WebAssembly','Worker','WebGL']){
    const calls=[],context={WebAssembly:{},Worker:function(){},document:{head:{appendChild:e=>calls.push(e)},createElement:tag=>tag==='canvas'?{getContext:()=>missing==='WebGL'?null:{}}:{}},location:{replace:url=>calls.push(url)}};
    context.window=context;
    if(missing!=='WebGL')context[missing]=undefined;
    vm.runInNewContext(startup,context);
    assert.deepEqual(calls,['/api/site/43/unsupported.html']);
  }
  for(const html of [args.html+'<script src="https://evil.test/x.js"></script>',args.html+'<link rel="stylesheet" href="extra.css">',args.html.replace('</head>','</head></head>')])
    assert.throws(()=>profile.transformHTML({...args,html}),{status:422});
  const unsupported=files.get('unsupported').toString();
  const blankMedia=unsupported.replace(/url\([^)]*\)/g,'none');
  const clean=profile.transformUnsupportedHTML({...args,html:blankMedia,references:[]});
  assert(!clean.source.includes('gtag'));assert(clean.source.includes('Your browser is not supported'));
  assert.throws(()=>profile.transformUnsupportedHTML({...args,html:blankMedia+'<script src="https://evil.test/a.js"></script>',references:[]}),{status:422});
});

test('production template requires six scenes and a supported preserved TreeScene code variant',()=>{
  const profile=require('../admin-server/engine/registry').get('legacy-six-scenes-v1');
  const ids=['Home','About','Work','TreeScene','CleanRoom','Footer'];
  const snapshot={config:{scenes:ids.map(id=>({id,fields:[]}))},template:{baseUIL:Object.fromEntries(ids.map(id=>['sl_'+id+'_0',{}]))}};
  const key='INPUT_P_Element_21_TreeScenecode_1_code';
  snapshot.template.baseUIL[key]='vec3 pointShape = texture2D(tPointCloud, uv).xyz;\nvec3 target = pointShape;';
  profile.validateSnapshot(snapshot);
  for(const change of [s=>s.config.scenes.pop(),s=>s.config.scenes.push(s.config.scenes[0]),s=>delete s.template.baseUIL.sl_About_0,s=>s.template.baseUIL[key]='unknown formula']){
    const copy=structuredClone(snapshot);change(copy);assert.throws(()=>profile.validateSnapshot(copy),{status:422});
  }
  const lensed=structuredClone(snapshot);lensed.template.baseUIL[key]='// Lensed accretion\n'+'time;'.repeat(5);
  profile.validateSnapshot(lensed);
  lensed.template.baseUIL[key]+='time;';assert.throws(()=>profile.validateSnapshot(lensed),{status:422});
});

test('full adapter requires all audited classes including ES6 GLUIText',{skip:!root},()=>{
  const {profile,files}=productionInput(),source=files.get('app').toString(),config={site:{},songs:[],scenes:[]};
  for(const name of ['CMSData','Text3D','GLTextThread','GLText','Hydra','Assets','AssetLoader','GeomThread','InstanceMesh','ParticleDistributor','ViewController','NavUI','NavUIItem','ContactUI','CleanRoom']){
    const marker='Class((function '+name+'(';
    assert.throws(()=>profile.transformApp(source.replace(marker,'Class((function Missing'+name+'('),config),{status:422},name);
    assert.throws(()=>profile.transformApp(source+marker+') {}));',config),{status:422},name);
  }
  for(const code of [source.replace('class GLUIText {','class MissingText {'),source+' class GLUIText {}'])
    assert.throws(()=>profile.transformApp(code,config),{status:422});
  const required = profile.patches.filter(patch => !patch.id.startsWith('page.'));
  const optional = profile.patches.filter(patch => patch.id.startsWith('page.'));
  assert.equal(required.length,61,'the original audited patch contract remains intact');
  const pageIds = [
    'page.hero-video','page.hero-poster','page.reel-video','page.lab-background',
    ...['home','join','about'].flatMap(name => ['text','glitch','a11y','url'].map(suffix => `page.contact-${name}-${suffix}`)),
    ...['instagram','linkedin','x'].flatMap(name => ['url','name','icon'].map(suffix => `page.social-${name}-${suffix}`)),
    ...['text','container','lookup','blending','image'].map(suffix => `page.qr-${suffix}`),
  ];
  assert.deepEqual(optional.map(patch => patch.id),pageIds);
  assert(optional.every(patch => patch.expected===1));
  const report = profile.transformApp(source,config).report;
  assert.deepEqual(report.filter(patch => patch.id.startsWith('page.')),pageIds.map(id => ({id,status:'not-applicable'})));
  assert.equal(new Set(profile.patches.map(patch => patch.id)).size,91);
});

test('actual transformed wrapper locators and Thread ingestion work in independent realms',{skip:!root},async()=>{
  const vm=require('node:vm');
  const {programMappings,programBridgeSource,rewritePrograms}=require('../admin-server/engine/program-paths');
  const {profile,files,manifest}=productionInput(),target={type:'preview',id:'preview-01234567-1234-1234-1234-123456789abc'};
  const mappings=programMappings(manifest,target),out=rewritePrograms(files,mappings,profile);
  for(const worker of [false,true]){
    const context={URL,location:{origin:'https://site.test:8443'},fetch:async()=>({ok:true,text:async()=> 'VALIDATED_WRAPPER'}),importScripts(){}};
    context.self=context;if(!worker)context.window=context;
    vm.createContext(context);vm.runInContext(programBridgeSource(mappings,{worker}),context);
    const basis=out.get('basis-js').toString(),draco=out.get('draco-js').toString();
    const locate=basis.slice(basis.indexOf('function locateFile(path)'),basis.indexOf('var read_,readAsync'));
    vm.runInContext('var Module={},scriptDirectory="/api/site/'+target.id+'/runtime/";'+locate,context);
    assert.equal(context.locateFile('basis_transcoder.wasm?q=1'),`/api/site/${target.id}/runtime/basis-wasm?q=1`);
    const dracoLocate=draco.match(/function l\(e\)\{return self\.__SITE_PROGRAM_URL__\(a\.locateFile\?a\.locateFile\(e,U\):U\+e\)\}/)[0];
    vm.runInContext('var a={},U="/api/site/'+target.id+'/runtime/";'+dracoLocate,context);
    assert.equal(context.l('draco_decoder.wasm'),`/api/site/${target.id}/runtime/draco-wasm`);
    if(!worker){
      const app=out.get('app').toString(),start=app.indexOf('this.importCode = function'),end=app.indexOf(', this.importClass = function',start);
      const sent=[];context._worker={postMessage:value=>sent.push(value.code)};context.zUtils3D={constructor:function ZUtils(){}};
      vm.runInContext('function Imports(){'+app.slice(start,end)+'} var imports=new Imports();',context);
      assert.throws(()=>context.imports.importCode('arbitrary()'));
      const token=await context.__SITE_LOAD_WRAPPER__('assets/js/lib/basis_transcoder.js');context.imports.importCode(token);
      assert.equal(sent.pop(),'VALIDATED_WRAPPER');
      context.imports.importRuntimeInternal('draco');assert.equal(sent.pop(),'self.loadDraco = loadDraco();');
      context.imports.importRuntimeInternal('zutils');assert.equal(sent.pop(),`Class(${context.zUtils3D.constructor.toString()}, 'static')`);
      assert.throws(()=>context.imports.importRuntimeInternal('arbitrary()'));
    }
  }
});

test('qrious is loaded as script even though pinned runtime keys have no extension',{skip:!root},()=>{
  const vm=require('node:vm'),{profile,files,manifest}=productionInput();
  const {rewritePrograms,programMappings}=require('../admin-server/engine/program-paths');
  const app=rewritePrograms(files,programMappings(manifest,{type:'version',id:'43'}),profile).get('app').toString();
  const begin=app.indexOf('function loadLib() { _this.flag("loadLib", !0),'),end=app.indexOf('}(), await AssetLoader.waitForLib("QRious")',begin);
  const scripts=[],context={_this:{flag(){}},window:{__SITE_PROGRAM_URL__:()=>'/api/site/43/runtime/qrious'},
    document:{createElement:tag=>({tag}),head:{appendChild:script=>scripts.push(script)}},
    AssetLoader:{loadAssets:paths=>{assert(paths.every(p=>p.endsWith('.js')),'extless URL loses AssetLoader JS evaluation');}}};
  vm.runInNewContext('('+app.slice(begin,end+1)+')()',context);
  assert.equal(scripts.length,1);assert.equal(scripts[0].src,'/api/site/43/runtime/qrious');
});

test('program patch families reject missing and duplicate audited anchors',{skip:!root},()=>{
  const {profile,files,manifest}=productionInput();
  const {programMappings}=require('../admin-server/engine/program-paths');
  const mappings=programMappings(manifest,{type:'version',id:'43'});
  for(const [key,anchor] of [
    ['app','new Worker(Thread.PATH + file)'],['app','Thread.PATH = window._THREAD_PATH_ || "assets/js/hydra"'],
    ['app','let module = window._ES5_ ? "es5-modules" : "modules",'],
    ['app','["~assets/js/lib/basis_transcoder.js", "~assets/js/lib/basis_transcoder.wasm"].map(Assets.getPath).map(Thread.absolutePath)'],
    ['app','let response = await fetch(path); return 0 === i ? response.text() : response.arrayBuffer()'],
    ['app','const useJS = "object" != typeof WebAssembly, libFolder = "~assets/js/lib/_draco/",'],
    ['app','fetch(Assets.getPath(url)).then((res => { if (!res.ok) throw new Error; return 0 === i ? res.text() : res.arrayBuffer() }))'],
    ['app','"/* draco decoder */", loadedLibs[0],'],['app','AssetLoader.loadAssets(["assets/js/lib/qrious.js"])'],
    ['app','this.importCode = function (code) { _worker.postMessage({ code: code }) }'],
    ['app',"thread.importCode(`Class(${zUtils3D.constructor.toString()}, 'static')`)"],
    ['app','t.importCode("self.loadDraco = loadDraco();")'],
    ['basis-js','return scriptDirectory+path'],['draco-js','return a.locateFile?a.locateFile(e,U):U+e'],
  ]){
    const source=files.get(key).toString();assert(source.includes(anchor));
    for(const replacement of ['',anchor+anchor]){
      const changed=new Map(files);changed.set(key,Buffer.from(source.replace(anchor,replacement)));
      assert.throws(()=>profile.transformPrograms(changed,mappings),{status:422},anchor);
    }
  }
});

test('validation never evaluates package programs and quotas remain mandatory',t=>{
  const {testRuntime}=require('./helpers/runtime'),{validateRuntime}=require('../admin-server/engine/registry');
  const fixture=testRuntime(t),profile=fixture.registry.get(fixture.manifest.profileId),manifest=structuredClone(fixture.manifest);
  const files=new Map(manifest.files.map(f=>[f.key,fs.readFileSync(path.join(fixture.root,f.path))]));
  const bytes=Buffer.from('self.TEST_RUNTIME = true; throw new Error("MUST NOT EXECUTE");');files.set('app',bytes);
  const app=manifest.files.find(f=>f.key==='app');app.size=bytes.length;app.sha256=sha256(bytes);
  assert.doesNotThrow(()=>validateRuntime(manifest,files,profile));
  app.size=32*1024*1024+1;assert.throws(()=>validateRuntime(manifest,files,profile),{status:422});
  const tooMany=structuredClone(fixture.manifest);tooMany.files=Array.from({length:513},(_,i)=>({...tooMany.files[0],key:'file-'+i,path:'file-'+i}));
  assert.throws(()=>validateRuntime(tooMany,files,profile),{status:422});
});

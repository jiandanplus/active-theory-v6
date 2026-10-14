const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');

test('program URLs are pinned to the final target and exclude media and HTML',()=>{
  const {runtimeURL,programMappings}=require('../admin-server/engine/program-paths');
  const target={type:'version',id:'43'};
  assert.equal(runtimeURL(target,'basis-wasm'),'/api/site/43/runtime/basis-wasm');
  const manifest={files:[
    {key:'basis-wasm',path:'assets/js/lib/basis_transcoder.wasm',role:'wasm'},
    {key:'app',path:'assets/js/app.explicit.js',role:'program'},
    {key:'style',path:'assets/style.css',role:'stylesheet'},
    {key:'index',path:'index.html',role:'html'},
    {key:'reel',path:'assets/shaders/reel.mp4',role:'resource-document'},
  ]};
  assert.deepEqual(programMappings(manifest,target),{
    'assets/js/lib/basis_transcoder.wasm':'/api/site/43/runtime/basis-wasm',
    'assets/js/app.explicit.js':'/api/site/43/runtime/app',
    'assets/style.css':'/api/site/43/runtime/style',
  });
});

test('independent browser and worker bridges pin programs, reject unknown programs, preserve media',async()=>{
  const {programBridgeSource}=require('../admin-server/engine/program-paths');
  const mappings={
    'assets/js/lib/basis_transcoder.js':'/api/site/43/runtime/basis-js',
    'assets/js/lib/basis_transcoder.wasm':'/api/site/43/runtime/basis-wasm',
    'assets/js/hydra/hydra-thread.js':'/api/site/43/runtime/hydra-thread',
  };
  for(const worker of [false,true]){
    const calls=[];
    const context={URL,Request,location:{origin:'https://site.test:8443',href:'https://site.test:8443/api/site/43/runtime/hydra-thread'},
      fetch:async(input)=>{calls.push(String(input));return {ok:true,text:async()=> 'controlled wrapper'};},
      XMLHttpRequest:class {open(method,url){calls.push(url);}},importScripts:(...urls)=>calls.push(...urls)};
    context[worker?'self':'window']=context;
    vm.runInNewContext(programBridgeSource(mappings,{worker}),context);
    assert.equal(context.__SITE_RESOURCE_URL__,undefined);
    for(const input of ['~assets/js/lib/basis_transcoder.wasm?v=1','/assets/js/lib/basis_transcoder.wasm?v=1',
      'https://site.test:8443/assets/js/lib/basis_transcoder.wasm?v=1','basis_transcoder.wasm?v=1',
      '/api/site/43/runtime/basis_transcoder.wasm?v=1']){
      await context.fetch(input);
      assert.equal(calls.at(-1),'/api/site/43/runtime/basis-wasm?v=1');
    }
    const media='/api/site/43/resources/geometry/file.bin';
    await context.fetch(media);assert.equal(calls.at(-1),media);
    for(const input of ['assets/js/evil.js','https://site.test:444/assets/js/lib/basis_transcoder.wasm',
      '/api/site/44/runtime/basis-wasm','/api/site/43/runtime/unknown','assets/../js/lib/basis_transcoder.wasm'])
      assert.throws(()=>context.__SITE_PROGRAM_URL__(input));
    new context.XMLHttpRequest().open('GET','~assets/js/lib/basis_transcoder.wasm');
    assert.equal(calls.at(-1),'/api/site/43/runtime/basis-wasm');
    if(worker){context.importScripts('~assets/js/lib/basis_transcoder.js');assert.equal(calls.at(-1),'/api/site/43/runtime/basis-js');assert.throws(()=>context.importScripts('evil.js'));}
    else {
      const token=await context.__SITE_LOAD_WRAPPER__('~assets/js/lib/basis_transcoder.js');
      assert.equal(context.__SITE_WRAPPER_CODE__(token),'controlled wrapper');
      for(const value of ['controlled wrapper',{code:'controlled wrapper'},{}])assert.throws(()=>context.__SITE_WRAPPER_CODE__(value));
      await assert.rejects(context.__SITE_LOAD_WRAPPER__('assets/js/evil.js'));
      await assert.rejects(context.__SITE_LOAD_WRAPPER__('assets/js/hydra/hydra-thread.js'));
    }
  }
});

test('program targets and logical keys reject ambiguous or traversal identifiers',()=>{
  const {runtimeURL}=require('../admin-server/engine/program-paths');
  const preview={type:'preview',id:'preview-01234567-1234-1234-1234-123456789abc'};
  assert.equal(runtimeURL(preview,'app'),`/api/site/${preview.id}/runtime/app`);
  for(const target of [{type:'other',id:'43'},{type:'version',id:'../43'},{type:'version',id:'0'},{type:'preview',id:'43'}])
    assert.throws(()=>runtimeURL(target,'app'),{status:422});
  for(const key of ['../app','app/x','app%2fx',''])
    assert.throws(()=>runtimeURL({type:'version',id:'43'},key),{status:422});
});

test('full main bridge keeps program mappings separate from authorized media',async()=>{
  const {bridgeSource}=require('../admin-server/engine/render');
  const snapshot={config:{site:{title:'T'},projects:[]},assets:{pic:{resourceId:'pic',fileName:'pic.png'}},legacyMap:{'assets/images/pic.png':'pic'}};
  const programs={'assets/js/lib/qrious.js':'/api/site/43/runtime/qrious'};
  const calls=[],context={URL,Request,location:{origin:'https://site.test:8443'},fetch:async value=>calls.push(value),XMLHttpRequest:class{open(){}},document:{}};
  context.window=context;
  vm.runInNewContext(bridgeSource('43',snapshot.config,snapshot,'https://site.test:8443',[{resourceId:'pic',slot:'pic'}],programs),context);
  await context.fetch('assets/images/pic.png');assert.equal(calls.pop(),'/api/site/43/resources/pic/pic.png');
  await context.fetch('~assets/js/lib/qrious.js');assert.equal(calls.pop(),'/api/site/43/runtime/qrious');
  assert.throws(()=>context.fetch('assets/js/unknown.js'));
  assert.throws(()=>context.fetch('/api/site/44/runtime/qrious'));
});

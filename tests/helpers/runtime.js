const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {sha256}=require('../../admin-server/delivery/contracts');
const {exactReplace}=require('../../admin-server/engine/patches');
const {fail}=require('../../admin-server/security');
const {programBridgeSource}=require('../../admin-server/engine/program-paths');
// Trusted test constructor only; no production profile ID or environment selector.
function testRuntime(t) {
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'runtime-test-')));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const entries=[['index','index.html','html','text/html','<html><head></head><body>TEST_RUNTIME</body></html>'],
    ['unsupported','unsupported.html','html','text/html','<html><head></head><body>Unsupported</body></html>'],
    ['app','app.js','program','text/javascript','self.TEST_RUNTIME = true;'],
    ['worker','worker.js','program','text/javascript','self.TEST_WORKER = true;'],
    ['compiled-shaders','compiled.vs','shader','text/plain','TEST_SHADER'],
    ['wasm','empty.wasm','wasm','application/wasm',Buffer.from([0,97,115,109,1,0,0,0])]];
  const files=entries.map(([key,file,role,mime,value])=>{
    const bytes=Buffer.from(value);fs.writeFileSync(path.join(root,file),bytes);
    return {key,path:file,role,mime,size:bytes.length,sha256:sha256(bytes)};
  });
  const dependencies=[{from:'index',to:'app',via:'script'},{from:'index',to:'unsupported',via:'navigation'},
    {from:'app',to:'worker',via:'worker'},{from:'app',to:'compiled-shaders',via:'fetch'},{from:'worker',to:'wasm',via:'wasm'}];
  const patch=source=>exactReplace(source,{id:'test.app',find:'TEST_RUNTIME',replace:'PINNED_RUNTIME',count:1});
  const profile=Object.freeze({id:'tiny-test-runtime',templateId:'tiny-template',policy:{inactiveLayouts:[]},
    programs:files.map(({key,path,role})=>({key,path,role})),dependencies,
    validateSources:values=>[patch(values.get('app').toString()).report],
    validateSnapshot:snapshot=>{if(!snapshot?.config||!snapshot?.template)throw fail(422,'Invalid test snapshot');},
    transformPrograms:(values,mappings)=>{
      const files=new Map(values);
      files.set('worker',Buffer.from(programBridgeSource(mappings,{worker:true})+'\n'+values.get('worker')+'\nself.fetch(self.__SITE_PROGRAM_URL__("empty.wasm"));'));
      files.set('app',Buffer.from(values.get('app')+'\nnew Worker(window.__SITE_PROGRAM_URL__("worker.js"));'));
      return {files,report:[]};
    },
    transformApp:source=>{const result=patch(source);return {source:result.source,report:[result.report]};},
    transformShaders:source=>({source,report:[]}),transformHTML:({html,target,programs})=>{
      const result=exactReplace(html,{id:'test.html-startup',find:'TEST_RUNTIME',replace:`<script src="${programs['app.js']}"></script>`,count:1});
      const head=exactReplace(result.source,{id:'test.html-bridge',find:'<head>',replace:`<head><script src="/api/site/${target.id}/identity.js"></script><script src="/api/site/${target.id}/bridge.js"></script>`,count:1});
      return {source:head.source,report:[result.report,head.report]};
    },
    transformUnsupportedHTML:({html})=>({source:html,report:[]}),transformUIL:snapshot=>({data:structuredClone(snapshot.template.baseUIL||{}),report:[]}),
  });
  const registry=Object.freeze({get:id=>{if(id!==profile.id)throw fail(422,'Unknown test profile');return profile;}});
  return {root,manifest:{manifestVersion:1,profileId:profile.id,templateId:profile.templateId,entryKey:'index',files,dependencies:structuredClone(dependencies)},registry};
}
module.exports={testRuntime};

const {exactReplace,incompatible}=require('../patches');
const adapter=require('../legacy-adapter');
const {programBridgeSource}=require('../program-paths');
// Audited input identities, never inferred from a candidate package or directory.
const programs=[
  ['index','index.html','html','77f7062badb10b5110c069d8fdab0b3b5d619fa9969cbdd471720d9209232d98'],
  ['unsupported','unsupported.html','html','6aae50dbeb1dbcb2620575a3f26142f9cc91d37e5f6216603d69d165351b6953'],
  ['app','assets/js/app.1778129964370.js','program','1081e211f6301554d2311ca40205f5025a91102759eaa5f0a80dc5870e1ed689'],
  ['modules','assets/js/modules.1778129964370.js','program','e0346e49f92d5db8ad9d9b8e49c61ad52cd2b3994c28e598f4dec548a628cc3c'],
  ['hydra-thread','assets/js/hydra/hydra-thread.js','program','c1133f09166fcb4c5e338040ef08189c60dcbca41e7057a18c5e098ecc5988cd'],
  ['basis-js','assets/js/lib/basis_transcoder.js','program','dee6fa695014e9c2f0370b6c1f052ebfaf7e11a55143be20b8a77ebc33e1c127'],
  ['basis-wasm','assets/js/lib/basis_transcoder.wasm','wasm','5e456711b9a87288a13d8baf4a0312d1ed2edd2f8f99073b07013466215e7e18'],
  ['draco-js','assets/js/lib/_draco/draco_wasm_wrapper.js','program','b93f6384147828f857456c84845f4dbceada5b7a8455991109c853e236a1f018'],
  ['draco-wasm','assets/js/lib/_draco/draco_decoder.wasm','wasm','0103c8bff79532c2f1a496dd9ea0764ac692ed8585d9136596ef9f043873a61f'],
  ['qrious','assets/js/lib/qrious.js','program','db99dcaf40a926181bce4522477c2efc5924f6c4b29111b6a97faea477c9528b'],
  ['compiled-shaders','assets/shaders/compiled.vs','shader','e2cf6406b30f86ab838b000cc3313e4de520e60484b1eb6402ba0016c09c8f98'],
].map(([key,path,role,sha256])=>Object.freeze({key,path,role,sha256}));

const dependencies=[
  ['index','app','script'],['index','unsupported','navigation'],['app','modules','script'],
  ['app','hydra-thread','worker'],['app','basis-js','fetch-wrapper'],['app','basis-wasm','fetch'],
  ['app','draco-js','fetch-wrapper'],['app','draco-wasm','fetch'],['app','qrious','script'],
  ['app','compiled-shaders','fetch'],['basis-js','basis-wasm','wasm'],['draco-js','draco-wasm','wasm'],
  ['hydra-thread','basis-js','import-code'],['hydra-thread','draco-js','import-code'],
].map(([from,to,via])=>Object.freeze({from,to,via}));
function transformPrograms(files,mappings) {
  const output=new Map(files),report=[];
  function patch(key,id,find,replace,count=1,anchor=find){
    // Audit the request expression too: a duplicated expression can otherwise
    // leave one full context anchor and a second unclassified request behind.
    exactReplace(output.get(key).toString(),{id,find:anchor,replace:anchor,count});
    const result=exactReplace(output.get(key).toString(),{id,find,replace,count});
    output.set(key,Buffer.from(result.source));report.push(result.report);
  }
  const app=files.get('app').toString();
  if((app.match(/class GLUIText\b/g)||[]).length!==1||(app.match(/\.importCode\(/g)||[]).length!==4)
    throw incompatible('program.ingestion-closure');
  patch('app','program.worker-create','let file = window._ES5_ ? "/hydra-thread-es5.js" : "/hydra-thread.js"; _callbacks = {}, _worker = new Worker(Thread.PATH + file)',
    '_callbacks = {}, _worker = new Worker(Thread.PATH)',1,'new Worker(Thread.PATH + file)');
  patch('app','program.worker-path','Thread.PATH = window._THREAD_PATH_ || "assets/js/hydra"',
    'Thread.PATH = window.__SITE_PROGRAM_URL__("assets/js/hydra/hydra-thread.js")');
  // Service.init is dormant in this production source; if invoked, its undeclared
  // sw.js must fail closed before the browser's separate registration loader.
  patch('app','program.service-worker','navigator.serviceWorker.register(`${window._SW_PATH_ ? window._SW_PATH_ : ""}sw.js`)',
    'navigator.serviceWorker.register(window.__SITE_PROGRAM_URL__(`${window._SW_PATH_ ? window._SW_PATH_ : ""}sw.js`))');
  patch('app','program.modules','let module = window._ES5_ ? "es5-modules" : "modules", src = window._CACHE_ ? "assets/js/" + module + "." + window._CACHE_ + ".js" : "assets/js/" + module + ".js";',
    'let src = window.__SITE_PROGRAM_URL__("assets/js/modules.1778129964370.js");',1,'let module = window._ES5_ ? "es5-modules" : "modules",');
  patch('app','program.basis-paths','["~assets/js/lib/basis_transcoder.js", "~assets/js/lib/basis_transcoder.wasm"].map(Assets.getPath).map(Thread.absolutePath)',
    '["assets/js/lib/basis_transcoder.js", "assets/js/lib/basis_transcoder.wasm"].map(window.__SITE_PROGRAM_URL__)');
  patch('app','program.basis-wrapper','let response = await fetch(path); return 0 === i ? response.text() : response.arrayBuffer()',
    'if (0 === i) return window.__SITE_LOAD_WRAPPER__(path); let response = await fetch(window.__SITE_PROGRAM_URL__(path)); if (!response.ok) throw new Error("WASM unavailable"); return response.arrayBuffer()');
  patch('app','program.draco-paths','const useJS = "object" != typeof WebAssembly, libFolder = "~assets/js/lib/_draco/", libs = useJS ? [`${libFolder}draco_decoder.js`] : [`${libFolder}draco_wasm_wrapper.js`, `${libFolder}draco_decoder.wasm`];',
    'const useJS = false, libs = ["assets/js/lib/_draco/draco_wasm_wrapper.js", "assets/js/lib/_draco/draco_decoder.wasm"].map(window.__SITE_PROGRAM_URL__);',2,'const useJS = "object" != typeof WebAssembly, libFolder = "~assets/js/lib/_draco/",');
  patch('app','program.draco-wrapper','fetch(Assets.getPath(url)).then((res => { if (!res.ok) throw new Error; return 0 === i ? res.text() : res.arrayBuffer() }))',
    '(0 === i ? window.__SITE_LOAD_WRAPPER__(url) : fetch(window.__SITE_PROGRAM_URL__(url)).then((res => { if (!res.ok) throw new Error; return res.arrayBuffer() })))',2);
  patch('app','program.draco-ingestion','"/* draco decoder */", loadedLibs[0],',
    '"/* draco decoder */", window.__SITE_WRAPPER_CODE__(loadedLibs[0]),',2);
  patch('app','program.qrious','AssetLoader.loadAssets(["assets/js/lib/qrious.js"])',
    '(()=>{let script=document.createElement("script");script.src=window.__SITE_PROGRAM_URL__("assets/js/lib/qrious.js");document.head.appendChild(script)})()');
  // Internal entry accepts only two audited operations, never caller-provided code.
  patch('app','program.import-boundary','this.importCode = function (code) { _worker.postMessage({ code: code }) }',
    'this.importCode = function (code) { _worker.postMessage({ code: window.__SITE_WRAPPER_CODE__(code) }) }, this.importRuntimeInternal = function (operation) { let code; if (operation === "zutils") code = `Class(${zUtils3D.constructor.toString()}, \'static\')`; else if (operation === "draco") code = "self.loadDraco = loadDraco();"; else throw new Error("Unknown internal operation"); _worker.postMessage({ code: code }) }');
  patch('app','program.internal-zutils',"thread.importCode(`Class(${zUtils3D.constructor.toString()}, 'static')`)",'thread.importRuntimeInternal("zutils")');
  patch('app','program.internal-draco','t.importCode("self.loadDraco = loadDraco();")','t.importRuntimeInternal("draco")',2);
  if((output.get('app').toString().match(/\.importCode\(/g)||[]).length!==1||!output.get('app').toString().includes('thread.importCode(js)'))
    throw incompatible('program.ingestion-postcondition');
  patch('basis-js','program.basis-locate','return scriptDirectory+path','return self.__SITE_PROGRAM_URL__(scriptDirectory+path)');
  patch('draco-js','program.draco-locate','return a.locateFile?a.locateFile(e,U):U+e','return self.__SITE_PROGRAM_URL__(a.locateFile?a.locateFile(e,U):U+e)');
  output.set('hydra-thread',Buffer.from(programBridgeSource(mappings,{worker:true})+'\n'+files.get('hydra-thread').toString()));
  return {files:output,report};
}
function validateSources(files) {
  const config={site:{},songs:[],scenes:[]};
  const patches=[...adapter.patchAppSource(files.get('app').toString(),config).report,
    ...adapter.patchShaders(files.get('compiled-shaders').toString(),config).report];
  const mappings=Object.fromEntries(programs.filter(f=>['program','wasm'].includes(f.role)).map(f=>[f.path,'/api/site/1/runtime/'+f.key]));
  patches.push(...transformPrograms(files,mappings).report);
  patches.push(...prepareHTML(files.get('index').toString(),false).report,...prepareHTML(files.get('unsupported').toString(),true).report);
  return patches;
}
function prepareHTML(html,unsupported) {
  const report=[];
  for(const [id,find] of [['document',/<html\b/gi],['head',/<head\b/gi],['head-end',/<\/head\s*>/gi]]){
    if((html.match(find)||[]).length!==1)throw incompatible('html.'+id);
  }
  const rules=unsupported?[
    {id:'unsupported.gtag-script',find:'<script async src="https://www.googletagmanager.com/gtag/js?id=G-J7TMDT4F8N"></script>',replace:'',count:1},
    {id:'unsupported.gtag-init',find:/<script>\s*window\.dataLayer = window\.dataLayer \|\| \[\];\s*function gtag\(\)\{dataLayer\.push\(arguments\);\}\s*gtag\('js', new Date\(\)\);\s*gtag\('config', 'G-J7TMDT4F8N'\);\s*<\/script>/g,replace:'',count:1},
  ]:[{id:'html.remove-undefined-style',find:'<link href="undefined" rel="stylesheet">',replace:'',count:1}];
  for(const rule of rules){const result=exactReplace(html,rule);html=result.source;report.push(result.report);}
  if(/<script\b[^>]*\bsrc\s*=/i.test(html)||/<link\b[^>]*\brel\s*=\s*["']stylesheet["']/i.test(html)
    ||/@import\b/i.test(html)||(unsupported&&/<script\b/i.test(html)))throw incompatible('html.program-closure');
  if(!unsupported&&(html.match(/<script\b/gi)||[]).length!==1)throw incompatible('html.startup-closure');
  return {source:html,report};
}
function transformHTML(args) {
  if(!args.programs||!Object.keys(args.programs).length)throw incompatible('html.programs');
  const prepared=prepareHTML(args.html,false);
  const result=require('../render').renderHTML({...args,html:prepared.source});
  return {source:result.source,report:[...prepared.report,...result.report]};
}
function transformUnsupportedHTML(args) {
  const prepared=prepareHTML(args.html,true);
  const result=require('../render').renderUnsupportedHTML({...args,html:prepared.source});
  return {source:result.source,report:[...prepared.report,...result.report]};
}
const sceneIds=Object.freeze(['Home','About','Work','TreeScene','CleanRoom','Footer']);
function validateSnapshot(snapshot) {
  const scenes=snapshot?.config?.scenes,uil=snapshot?.template?.baseUIL;
  if(!Array.isArray(scenes)||scenes.length!==sceneIds.length||!uil||typeof uil!=='object'||Array.isArray(uil))throw incompatible('template.six-scenes');
  for(const id of sceneIds){
    const matches=scenes.filter(scene=>scene.id===id);
    if(matches.length!==1||!Array.isArray(matches[0].fields)
      ||!Object.keys(uil).some(key=>new RegExp('(?:_|/)'+id+'(?:_|/|$)').test(key)))throw incompatible('template.scene');
    for(const field of matches[0].fields)if(typeof field.key!=='string'||(!field.key.startsWith('__')&&!Object.hasOwn(uil,field.key)))throw incompatible('template.field');
  }
  const code=uil.INPUT_P_Element_21_TreeScenecode_1_code;
  if(code!=='vec3 pointShape = texture2D(tPointCloud, uv).xyz;\nvec3 target = pointShape;'
    &&!(typeof code==='string'&&code.includes('Lensed accretion')&&(code.match(/\btime\b/g)||[]).length===5))throw incompatible('template.tree-code');
}
module.exports=Object.freeze({
  id:'legacy-six-scenes-v1',templateId:'six-scenes',
  policy:Object.freeze({inactiveLayouts:Object.freeze(['Tester'])}),
  programs:Object.freeze(programs),
  patches:Object.freeze(adapter.patchContracts().map(Object.freeze)),
  postconditions:Object.freeze(['unique-required-classes','gluitext-es6-method','no-legacy-title-writers','no-width-waits','conditional-contact-removals','unique-logo-segment','mapped-wrapper-provenance','classified-internal-ingestion']),
  dependencies:Object.freeze(dependencies),sceneIds,validateSources,validateSnapshot,transformPrograms,transformHTML,transformUnsupportedHTML,
  transformApp:adapter.patchAppSource,transformShaders:adapter.patchShaders,transformUIL:adapter.patchUIL,
});

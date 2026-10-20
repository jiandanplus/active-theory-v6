const {fail}=require('../security');
const {canonicalJSON,digestJSON,sha256,assertRuntimeManifest,assertArtifactManifest,logicalKey,normalizeReferences}=require('./contracts');
const registry=require('../engine/registry');
const {programMappings}=require('../engine/program-paths');
const {bridgeSource,mapUIL}=require('../engine/render');
const {mapResourceTree}=require('../snapshots');
const {pageMetadata}=require('../../shared/site-identity');
const {renderPageMetadata}=require('../page-metadata');
const {projectSnapshot,projectDocuments,runtimeMedia}=require('./projection');
const {ADAPTER_SOURCES,captureAdapterIdentity,projectionDigest}=require('./identity');
const {renderPortfolio}=require('../portfolio/render');
const MIME={html:'text/html',program:'text/javascript',stylesheet:'text/css',wasm:'application/wasm',shader:'text/plain',data:'application/json','resource-document':'application/manifest+json'};
const bad=()=>fail(422,'交付构建验证失败');
function safeData(value){
  if(!value||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value)){
    if(/^(?:password|passwordHash|secret|credentials?|accessKey|secretKey|apiKey|accessToken|refreshToken)$/i.test(key))throw bad();
    safeData(item);
  }
}
function validateHTML(html,target,programs,unsupported){
  if((html.match(/<head\b/gi)||[]).length!==1||(html.match(/<\/head\s*>/gi)||[]).length!==1)throw bad();
  const allowed=new Set([...Object.values(programs),...['identity.js','bridge.js','app.js'].map(key=>`/api/site/${target.id}/${key}`)]);
  for(const match of html.matchAll(/<(script|link)\b[^>]*>/gi)){
    const tag=match[0],program=match[1].toLowerCase()==='script'||/\brel\s*=\s*["']stylesheet["']/i.test(tag);
    if(!program)continue;
    const url=/\b(?:src|href)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if(url&&!allowed.has(url))throw bad();
  }
  if(!unsupported){
    const identity=`<script src="/api/site/${target.id}/identity.js"></script>`,bridge=`<script src="/api/site/${target.id}/bridge.js"></script>`;
    if(html.split(identity).length!==2||html.split(bridge).length!==2||html.indexOf(identity)>html.indexOf(bridge))throw bad();
    const before=html.slice(0,html.indexOf(bridge));
    if(/<script\b(?![^>]*\bsrc=["'][^"']*\/identity\.js["'])/i.test(before))throw bad();
  }
}
async function buildArtifact({cas,bundle,source,target,origin,selection,profile,kind='pinned',referenceCeiling}){
  // Own all untrusted mutable data across CAS awaits; profile is trusted server code.
  bundle=JSON.parse(canonicalJSON(bundle));
  source=JSON.parse(canonicalJSON(source));
  target=JSON.parse(canonicalJSON(target));
  selection=JSON.parse(canonicalJSON(selection));
  if(referenceCeiling!==undefined)referenceCeiling=normalizeReferences(referenceCeiling);
  const runtime=bundle.manifest;
  assertRuntimeManifest(runtime);
  if(bundle.digest!==digestJSON(runtime)||selection.digest!==bundle.digest||!Number.isSafeInteger(selection.generation)||selection.generation<0)throw bad();
  profile=profile||registry.get(runtime.profileId);
  const files=new Map();
  for(const entry of runtime.files)files.set(entry.key,await cas.read(entry));
  registry.validateRuntime(runtime,files,profile);
  profile.validateSnapshot(source);
  const projected=projectSnapshot(source,target,profile,{runtimeFiles:files});
  let {snapshot}=projected;
  const {config}=projected;
  let references=projected.references;
  if(kind==='legacy-render'){
    if(!referenceCeiling)throw bad();
    const allowed=new Set(referenceCeiling.map(r=>r.resourceId));
    if(references.some(r=>!allowed.has(r.resourceId)))throw bad();
    const documented=projectDocuments(snapshot,referenceCeiling,profile.policy);
    if(documented.references.some(r=>!allowed.has(r.resourceId)))throw bad();
    snapshot=documented.snapshot;
    references=referenceCeiling;
  }else if(referenceCeiling!==undefined)throw bad();
  const programs=programMappings(runtime,target),outputs=new Map(),patchReport=[];
  let totalBytes=0;
  function report(key,entries){
    if(!Array.isArray(entries))throw bad();
    for(const entry of entries)patchReport.push({...entry,id:logicalKey(key+'.'+entry.id)});
  }
  function add(key,role,value){
    logicalKey(key);if(outputs.has(key)||!Object.hasOwn(MIME,role))throw bad();
    const size=Buffer.isBuffer(value)?value.length:typeof value==='string'?Buffer.byteLength(value):NaN;
    if(!Number.isSafeInteger(size)||size===0||outputs.size>=4096||totalBytes+size>256*1024*1024)throw bad();
    const bytes=Buffer.from(value);totalBytes+=bytes.length;
    if(!bytes.length)throw bad();
    outputs.set(key,{entry:{key,role,mime:MIME[role],size:bytes.length,sha256:sha256(bytes)},bytes});return key;
  }
  function json(key,role,value){safeData(value);return add(key,role,canonicalJSON(value));}
  const rewritten=profile.transformPrograms(files,programs);
  if(!(rewritten.files instanceof Map)||rewritten.files.size!==files.size||[...files.keys()].some(key=>!Buffer.isBuffer(rewritten.files.get(key))))throw bad();
  report('programs',rewritten.report);
  const app=profile.transformApp(rewritten.files.get('app').toString(),config);
  report('app',app.report);
  const shaders=profile.transformShaders(files.get('compiled-shaders').toString(),config);
  report('shaders',shaders.report);
  const uil=profile.transformUIL(snapshot);
  report('uil',uil.report);
  const endpoints={config:json('config','data',config),'uil.json':json('uil','data',mapUIL(snapshot,target.id,uil.data)),
    'projects.json':json('projects','data',config.projects),'metadata.json':json('metadata','data',mapResourceTree(snapshot,target.id,snapshot.template.metadata||{})),
    'contact.json':json('contact','data',mapResourceTree(snapshot,target.id,snapshot.template.contact||{}))};
  const {sources:trustedSources,digest:adapterDigest}=await captureAdapterIdentity();
  endpoints['identity.js']=add('identity','program',Buffer.concat(['shared/site-identity.js','shared/page-metadata-dom.js'].flatMap(name=>[trustedSources.get(name),Buffer.from('\n')])));
  endpoints['bridge.js']=add('bridge','program',bridgeSource(target.id,config,snapshot,origin,references,programs));
  endpoints['app.js']=add('app','program',app.source);
  endpoints['compiled.vs']=add('compiled-shaders','shader',shaders.source);
  const runtimeMap={};
  for(const entry of runtime.files.filter(f=>['program','stylesheet','wasm'].includes(f.role))){
    runtimeMap[entry.key]=entry.key==='app'?'app':add('runtime-'+entry.key,entry.role,entry.role==='stylesheet'
      ?runtimeMedia(rewritten.files.get(entry.key).toString(),entry,snapshot,target,references):rewritten.files.get(entry.key));
  }
  const routes={};
  const pagePaths=['/', '/work',...config.projects.map(p=>'/work/'+p.slug)];
  if(profile.id==='legacy-six-scenes-v1')pagePaths.push('/contact');
  for(const [index,pathname] of pagePaths.entries()){
    if(Object.hasOwn(routes,pathname))throw bad();
    const key='page-'+index,entry=runtime.files.find(f=>f.key===runtime.entryKey);
    const result=profile.transformHTML({html:files.get(entry.key).toString(),snapshot:{...snapshot,config},target,origin,programs,pathname,inputPath:entry.path,references});
    report(key,result.report);
    let source=runtimeMedia(result.source,entry,snapshot,target,references);
    const html=renderPageMetadata(source,pageMetadata(config,origin,pathname),{preview:target.type==='preview'});
    validateHTML(html,target,programs,false);routes[pathname]=add(key,'html',html);
    const basicPath=pathname==='/'?'/basic':'/basic'+pathname;
    const basicHTML=renderPageMetadata(renderPortfolio({config,target,pathname:basicPath,basic:true,scripts:false}),pageMetadata(config,origin,pathname),{preview:target.type==='preview'});
    routes[basicPath]=add('basic-page-'+index,'html',basicHTML);
  }
  for(const pathname of ['/contact','/basic/contact']){
    if(Object.hasOwn(routes,pathname))continue;
    const html=renderPageMetadata(renderPortfolio({config,target,pathname,basic:pathname.startsWith('/basic'),scripts:false}),pageMetadata(config,origin,'/contact'),{preview:target.type==='preview'});
    routes[pathname]=add(pathname.startsWith('/basic')?'basic-contact':'contact-page','html',html);
  }
  const unsupportedEntry=runtime.files.find(f=>f.key==='unsupported');
  const unsupportedSnapshot=profile.id==='portfolio-v1'?{...snapshot,config}:snapshot;
  const unsupported=profile.transformUnsupportedHTML({html:files.get('unsupported').toString(),snapshot:unsupportedSnapshot,target,references,inputPath:unsupportedEntry.path});
  report('unsupported',unsupported.report);
  let unsupportedSource=runtimeMedia(unsupported.source,unsupportedEntry,snapshot,target,references);
  const unsupportedHTML=renderPageMetadata(unsupportedSource,pageMetadata(config,origin,'/'),{preview:target.type==='preview'});
  validateHTML(unsupportedHTML,target,programs,true);endpoints['unsupported.html']=add('unsupported','html',unsupportedHTML);
  const documents=Object.create(null),allowed=new Set(references.map(r=>r.resourceId));
  for(const asset of Object.values(snapshot.assets||{}).filter(a=>allowed.has(a.resourceId)&&a.document!==undefined).sort((a,b)=>a.resourceId<b.resourceId?-1:1)){
    if(Object.hasOwn(documents,asset.resourceId))continue;
    documents[asset.resourceId]=json('document-'+Object.keys(documents).length,'resource-document',mapResourceTree(snapshot,target.id,asset.document));
  }
  const manifest={manifestVersion:1,kind,target,runtimeDigest:bundle.digest,profileId:profile.id,templateId:profile.templateId,
    selectionGeneration:selection.generation,sourceSnapshotDigest:digestJSON(source),projectionDigest:projectionDigest(snapshot,profile),
    referencesDigest:digestJSON(references),adapterDigest,origin,files:[...outputs.values()].map(o=>o.entry).sort((a,b)=>a.key<b.key?-1:1),
    routes,endpoints,runtime:runtimeMap,documents,references,patchReport};
  // Structural validation includes actual-buffer quotas. No writes before all outputs succeed.
  assertArtifactManifest(manifest);
  for(const entry of manifest.files){
    const stored=await cas.put(outputs.get(entry.key).bytes);
    if(stored.sha256!==entry.sha256||stored.size!==entry.size)throw bad();
  }
  return {digest:digestJSON(manifest),manifest,references};
}
module.exports={buildArtifact,ADAPTER_SOURCES};

const path=require('node:path').posix;
const {fail}=require('../security');
const {normalizeSite}=require('../../shared/site-identity');
const {canonicalJSON,sourcePath,normalizeReferences}=require('./contracts');
const {inactiveUIL,collectReferences,publicSnapshot,resourceAsset,mapResourceURL}=require('../snapshots');
const {runtimeURL}=require('../engine/program-paths');
const bad=()=>fail(422,'运行页面引用的站内资源无效');

// Only declared media-bearing attributes/CSS URLs: never navigation or scripts.
function mediaURLs(text,role,visit) {
  if(role==='html')text=text.replace(/<(?:link|img|source|video)\b[^>]*>/gi,tag=>{
    const link=/^<link\b/i.test(tag);
    if(link&&!/\brel\s*=\s*["'][^"']*\b(?:icon|manifest)\b/i.test(tag))return tag;
    return tag.replace(/(\b(?:href|src|poster)\s*=\s*)(["'])(.*?)\2/gi,(all,start,q,url)=>start+q+visit(url)+q);
  });
  return text.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi,(all,q,url)=>`url(${q}${visit(url.trim())}${q})`);
}
function mediaPath(value,inputPath) {
  if(/^(?:https?:\/\/|data:|#)/i.test(value))return value;
  if(!value||/[\\%\x00-\x1f\x7f]/.test(value)||/^[a-z][a-z0-9+.-]*:/i.test(value)||value.startsWith('//'))throw bad();
  const [file]=value.split(/[?#]/),suffix=value.slice(file.length);
  const relative=file.startsWith('/')?file.slice(1):path.join(path.dirname(inputPath),file);
  sourcePath(relative);
  return relative+suffix;
}
function runtimeMedia(text,entry,snapshot,target,references) {
  const allowed=references&&new Set(references.map(r=>r.resourceId));
  return mediaURLs(text,entry.role,value=>{
    if(value.startsWith(`/api/site/${target.id}/resources/`)){
      const id=value.slice(`/api/site/${target.id}/resources/`.length).split('/')[0];
      let decoded;try{decoded=decodeURIComponent(id);}catch{throw bad();}
      if(!allowed?.has(decoded))throw bad();return value;
    }
    const resolved=mediaPath(value,entry.path);
    if(/^(?:data:|#)/i.test(resolved))return value;
    const asset=resourceAsset(snapshot,resolved);
    if(!asset?.resourceId||!asset.fileName){if(/^https?:\/\//i.test(resolved))return value;throw bad();}
    if(allowed&&!allowed.has(asset.resourceId))throw bad();
    return mapResourceURL(snapshot,target.id,resolved);
  });
}
function requireMedia(snapshot,value) {
  if(typeof value!=='string'||!value||/^(?:https?:\/\/|data:|#)/i.test(value))return;
  if(!/^(?:\/?assets\/|\/media\/|\/models\/|room\/|bush\.bin\/)/.test(value))return;
  const asset=resourceAsset(snapshot,value);
  if(!asset?.resourceId||!asset.fileName)throw bad();
}
function validateMediaTree(snapshot,value) {
  if(typeof value==='string')requireMedia(snapshot,value);
  else if(value&&typeof value==='object')for(const item of Object.values(value))validateMediaTree(snapshot,item);
}
function projectSnapshot(source,target,profile,{runtimeFiles=new Map()}={}) {
  runtimeURL(target,'projection');
  if(!profile?.policy||!Array.isArray(profile.policy.inactiveLayouts)
    ||profile.policy.inactiveLayouts.some(v=>typeof v!=='string')||!(runtimeFiles instanceof Map))throw bad();
  const snapshot=structuredClone(source),policy=structuredClone(profile.policy);
  snapshot.config.site=normalizeSite(snapshot.config.site);
  const originalTemplate=structuredClone(snapshot.template);
  for(const key of Object.keys(snapshot.template.baseUIL||{}))if(inactiveUIL(originalTemplate,key,policy)){
    const match=/(?:Config|Element)_(\d+)_([A-Za-z][A-Za-z0-9]*)/.exec(key);
    snapshot.template.baseUIL[`sl_${match[2]}_${match[1]}_deleted`]=true;
    delete snapshot.template.baseUIL[key];
  }
  for(const scene of snapshot.config.scenes)scene.fields=scene.fields.filter(f=>!inactiveUIL(originalTemplate,f.key,policy));
  requireMedia(snapshot,snapshot.config.site.socialImage);
  for(const project of snapshot.config.projects)for(const key of ['video','image','projectLogo'])validateMediaTree(snapshot,project[key]);
  for(const scene of snapshot.config.scenes)for(const field of scene.fields)if(['resource','geometry'].includes(field.type))requireMedia(snapshot,field.value);
  for(const song of snapshot.config.songs)requireMedia(snapshot,song.src);
  const activeUIL=structuredClone(snapshot.template.baseUIL||{});
  for(const scene of snapshot.config.scenes)for(const field of scene.fields)if(!field.key.startsWith('__')){
    if(['resource','geometry'].includes(field.type)){
      if(activeUIL[field.key]?.src!==field.value)activeUIL[field.key]={src:field.value};
    }else if(['text','number'].includes(field.type))delete activeUIL[field.key];
    else activeUIL[field.key]=field.value;
  }
  validateMediaTree(snapshot,activeUIL);
  for(const key of ['metadata','contact'])validateMediaTree(snapshot,snapshot.template[key]);
  const references=collectReferences(snapshot,policy),assets=snapshot.assets||{};
  // Reuse collector dependency semantics without turning inventory into grants.
  for(const entry of profile.programs||[])if(['html','stylesheet'].includes(entry.role)){
    const bytes=runtimeFiles.get(entry.key);if(!Buffer.isBuffer(bytes))throw bad();
    let index=0;
    mediaURLs(bytes.toString('utf8'),entry.role,value=>{
      const resolved=mediaPath(value,entry.path);
      if(/^(?:data:|#)/i.test(resolved))return value;
      const asset=resourceAsset(snapshot,resolved);
      if(!asset?.resourceId||!asset.fileName){if(/^https?:\/\//i.test(resolved))return value;throw bad();}
      const probe={config:{site:{},projects:[],scenes:[],songs:[{src:resolved}]},template:{baseUIL:{}},assets,legacyMap:snapshot.legacyMap};
      const prefix=`runtime.${entry.key}.${index++}`;
      references.push(...collectReferences(probe,policy).map(ref=>({...ref,slot:prefix+':'+ref.slot})));
      return value;
    });
  }
  const documented=projectDocuments(snapshot,references,policy);
  const geometryIds=[...new Set(snapshot.config.scenes.flatMap(s=>s.fields).filter(f=>f.type==='geometry')
    .map(f=>resourceAsset(snapshot,f.value)?.resourceId||/^\/media\/([^/?#]+)/.exec(f.value)?.[1]).filter(Boolean))].sort();
  return {snapshot:documented.snapshot,config:publicSnapshot(documented.snapshot,target.id),references:documented.references,geometryIds};
}
function projectDocuments(input,initialReferences,policy) {
  const snapshot=structuredClone(input),assets=snapshot.assets||{},references=[...initialReferences],documents=new Set();
  // Derived documents may introduce media absent from old inventory dependency metadata.
  // Only referenced documents are traversed; unused inventory is still not authority.
  for(let previous=-1;previous!==documents.size;){
    previous=documents.size;
    const ids=new Set(references.map(r=>r.resourceId));
    for(const id of ids){
      const definitions=Object.values(assets).filter(a=>a.resourceId===id&&a.document!==undefined);
      if(!definitions.length||documents.has(id))continue;
      if(new Set(definitions.map(a=>canonicalJSON(a.document))).size!==1)throw fail(422,'资源文档定义冲突');
      documents.add(id);
      const document=definitions[0].document;
      for(const icon of document.icons||[])if(typeof icon.src==='string'){
        const resolved=mediaPath(icon.src,definitions[0].fileName);
        if(!/^https?:\/\//i.test(resolved)&&!resourceAsset(snapshot,resolved)?.resourceId)throw bad();
        icon.src=/^https?:\/\//i.test(resolved)?resolved:'/'+resolved;
      }
      validateMediaTree(snapshot,document);
      for(const asset of definitions)asset.document=structuredClone(document);
      const probe={config:{site:{},projects:[],scenes:[],songs:[{src:id}]},template:{baseUIL:{},metadata:document},assets,legacyMap:snapshot.legacyMap};
      references.push(...collectReferences(probe,policy).map(ref=>({...ref,slot:`document.${id}:`+ref.slot})));
    }
  }
  return {snapshot,references:normalizeReferences(references)};
}
module.exports={projectSnapshot,projectDocuments,runtimeMedia};

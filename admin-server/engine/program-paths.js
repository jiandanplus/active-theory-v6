const {logicalKey,sourcePath}=require('../delivery/contracts');
const {fail}=require('../security');
function runtimeURL(target,key) {
  const {type,id}=target||{};
  if(typeof id!=='string'||(type==='version'
    ? !/^[1-9][0-9]*$/.test(id)||!Number.isSafeInteger(Number(id))
    : type!=='preview'||!/^preview-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)))
    throw fail(422,'无效运行目标');
  return '/api/site/'+encodeURIComponent(id)+'/runtime/'+logicalKey(key);
}
function programMappings(manifest,target) {
  return Object.fromEntries(manifest.files.filter(f=>['program','stylesheet','wasm'].includes(f.role))
    .map(f=>[sourcePath(f.path),runtimeURL(target,f.key)]));
}
// Serialized into each realm independently. It deliberately closes over no Node code.
function installProgramBridge(global,mappings,worker) {
  const targets=Object.values(mappings),allowed=new Set(targets),base=targets[0].split('/runtime/')[0];
  const aliases=Object.create(null);
  for(const [path,url] of Object.entries(mappings)){
    const name=path.split('/').pop();
    if(Object.hasOwn(aliases,name)&&aliases[name]!==url)throw new Error('Ambiguous program');
    aliases[name]=url;
  }
  function map(value) {
    if(typeof value!=='string'||/[\\%\x00-\x1f]/.test(value))throw new Error('Invalid program');
    const input=value.replace(/^~/,'');
    if(input.split(/[?#]/)[0].split('/').some(x=>x==='.'||x==='..'))throw new Error('Invalid program');
    const url=new URL(input,global.location.origin+'/');
    if(url.origin!==global.location.origin)throw new Error('Foreign program');
    const suffix=url.search+url.hash,path=url.pathname;
    if(allowed.has(path))return path+suffix;
    let mapped=mappings[path.replace(/^\//,'')];
    if(!mapped&&path.startsWith(base+'/runtime/'))mapped=aliases[path.slice((base+'/runtime/').length)];
    if(!mapped&&!input.split(/[?#]/)[0].includes('/'))mapped=aliases[input.split(/[?#]/)[0]];
    if(!mapped)throw new Error('Unknown program');
    return mapped+suffix;
  }
  const programRequest=value=>/\.(?:js|wasm|css)(?:[?#]|$)/i.test(value)||String(value).includes('/runtime/');
  const fetchOriginal=global.fetch;
  global.__SITE_PROGRAM_URL__=map;
  global.fetch=function(input,init){
    const request=typeof Request!=='undefined'&&input instanceof Request;
    const old=request?input.url:String(input);
    const next=programRequest(old)?map(old):old;
    return fetchOriginal.call(this,request&&next!==old?new Request(new URL(next,global.location.origin),input):next!==old?next:input,init);
  };
  if(global.XMLHttpRequest){
    const open=global.XMLHttpRequest.prototype.open;
    global.XMLHttpRequest.prototype.open=function(method,url,...args){return open.call(this,method,programRequest(url)?map(String(url)):url,...args);};
  }
  if(worker){
    const original=global.importScripts;
    global.importScripts=function(...urls){return original.apply(this,urls.map(map));};
  }else{
    const wrappers=new WeakMap();
    const wrapperURLs=new Set(['assets/js/lib/basis_transcoder.js','assets/js/lib/_draco/draco_wasm_wrapper.js'].map(p=>mappings[p]).filter(Boolean));
    global.__SITE_LOAD_WRAPPER__=async function(path){
      const url=map(path);
      if(!wrapperURLs.has(url.split(/[?#]/)[0]))throw new Error('Not a wrapper');
      const response=await fetchOriginal.call(global,url,{credentials:'same-origin'});
      if(!response.ok||response.redirected)throw new Error('Wrapper unavailable');
      const token=Object.freeze({});wrappers.set(token,await response.text());return token;
    };
    global.__SITE_WRAPPER_CODE__=function(token){
      if(!wrappers.has(token))throw new Error('Untrusted wrapper');
      return wrappers.get(token);
    };
  }
}
function programBridgeSource(mappings,{worker=false}={}) {
  const entries=Object.entries(mappings);
  if(!entries.length)throw fail(422,'缺少程序映射');
  let base;
  for(const [path,url] of entries){
    sourcePath(path);
    const match=typeof url==='string'&&url.match(/^\/api\/site\/([^/]+)\/runtime\/([^/]+)$/);
    if(!match)throw fail(422,'无效程序映射');
    runtimeURL({type:match[1].startsWith('preview-')?'preview':'version',id:match[1]},match[2]);
    if(base&&base!==match[1])throw fail(422,'混合程序目标');
    base=match[1];
  }
  return `(${installProgramBridge.toString()})(${worker?'self':'window'},${JSON.stringify(mappings)},${worker});`;
}
function rewritePrograms(files,mappings,profile) { return profile.transformPrograms(files,mappings).files; }
module.exports={runtimeURL,programMappings,programBridgeSource,rewritePrograms};

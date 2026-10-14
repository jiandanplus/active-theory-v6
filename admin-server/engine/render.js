const {buildUIL}=require('./legacy-adapter');
const {canonicalResourceURL,mapResourceURL}=require('../snapshots');
const {pageMetadata}=require('../../shared/site-identity');
const {renderPageMetadata}=require('../page-metadata');
const {exactReplace}=require('./patches');
const quote=value=>JSON.stringify(value??'');
function identityBridgeSource(config,origin,preview) {
  return `const identityConfig=${quote(config)},identityOrigin=${quote(origin)};
    window.__SITE_UPDATE_IDENTITY__=function(state){
      if(!window.SiteIdentity||!window.SiteMetadataDOM)return;
      const path=state===undefined?location.pathname:window.SiteIdentity.publicPathForState(state);
      const meta=window.SiteIdentity.pageMetadata(identityConfig,identityOrigin,path||'/__not-found');
      window.SiteMetadataDOM.applyPageMetadata(document,meta,{preview:${JSON.stringify(preview)}});
    };
    window.__SITE_UPDATE_IDENTITY__();`;
}
function bridgeSource(
  version,
  config,
  snapshot = { assets: {}, legacyMap: {} },
  origin,
  references = [],
  programs = {},
) {
  const allowed = new Set(references.map(r=>r.resourceId));
  const mappings = Object.fromEntries(
    Object.entries(snapshot.legacyMap || {})
      .filter(([, slot]) => allowed.has(snapshot.assets[slot]?.resourceId))
      .map(([alias]) => [
        canonicalResourceURL(alias),
        mapResourceURL(snapshot, version, alias).split(/[?#]/)[0],
      ]),
  );
  return `(()=>{const base=${quote(`/api/site/${version}`)}, mappings=${quote(mappings)};
    function map(value){try{if(typeof value!=='string')return value;const u=new URL(value.replace(/^~/,''),location.origin+'/');if(u.pathname.includes('/api/site/'))return value;
      let key=/^https?:\\/\\//i.test(value)&&Object.hasOwn(mappings,value)?value:u.origin===location.origin?decodeURIComponent(u.pathname).replace(/^\\//,''):value;
      if(Object.hasOwn(mappings,key))return mappings[key]+(/\\.ktx2?$/i.test(mappings[key])?u.search:u.search.replace(/-compressedKtx2?/g,''))+u.hash;
      if(u.origin!==location.origin)return value;
      if(/\\/cms\\/projects-[^/]+\\.json$/.test(u.pathname))return base+'/projects.json';
      if(/\\/cms\\/metadata-[^/]+\\.json$/.test(u.pathname))return base+'/metadata.json';
      if(/\\/cms\\/contact-[^/]+\\.json$/.test(u.pathname))return base+'/contact.json';
      if(u.origin===location.origin&&/\\/assets\\/data\\/uil\\.[^/]+\\.json$/.test(u.pathname))return base+'/uil.json';
      if(u.origin===location.origin&&u.pathname==='/assets/shaders/compiled.vs')return base+'/compiled.vs';
      return value;}catch{return value;}}
    window.__SITE_RESOURCE_URL__=map;
    const fetchOriginal=window.fetch;window.fetch=function(input,init){const old=input instanceof Request?input.url:String(input);const next=map(old);return fetchOriginal.call(this,next!==old&&input instanceof Request?new Request(new URL(next,location.origin).href,input):next!==old?next:input,init);};
    const open=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(method,url,...args){return open.call(this,method,map(url),...args);};
    window.__SITE_VERSION__=${quote(String(version))};${identityBridgeSource(config,origin,String(version).startsWith('preview-'))}
  })();`;
}
function versionedUIL(snapshot, id) {
  const data = buildUIL(snapshot);
  for (const [key, value] of Object.entries(data)) {
    if (!value || typeof value !== "object" || typeof value.src !== "string")
      continue;
    const original =
      /(?:geometry|initialPositions)$/.test(key) &&
      value.relative?.includes(".")
        ? value.relative
        : value.src;
    const src = mapResourceURL(snapshot, id, original);
    if (src !== original)
      data[key] = {
        ...value,
        src,
        relative: "",
        prefix: "",
        filename: src.split("/").at(-1).split("?")[0],
        compressed: false,
        useCompressed: false,
        hotreload: false,
      };
  }
  return data;
}
function renderHTML({html,snapshot,target,origin,programs={},pathname='/'}) {
  const id=target.id,report=[];
  html=html.replace(/(<link\b[^>]*\bhref=["'])([^"']+)(["'][^>]*>)/gi,(all,start,url,end)=>/\brel=["'][^"']*(?:icon|manifest)/i.test(all)?start+mapResourceURL(snapshot,id,url)+end:all);
  html=html.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g,(all,q,url)=>/\.(?:woff2?|ttf|otf)(?:[?#]|$)/i.test(url)?`url(${q}${mapResourceURL(snapshot,id,url)}${q})`:all);
  for(const rule of [
    {id:'html.app-startup',find:'s = "assets/js/app." + window._CACHE_ + ".js"',replace:`s = "/api/site/${id}/app.js"`,count:1},
    {id:'html.unsupported-startup',find:'window._UNSUPPORTED_PAGE_ = "unsupported.html"',replace:`window._UNSUPPORTED_PAGE_ = "/api/site/${id}/unsupported.html"`,count:1},
  ]){const result=exactReplace(html,rule);html=result.source;report.push(result.report);}
  const identity=exactReplace(html,{id:'html.identity-bridge',find:/<head\b[^>]*>/i,replace:head=>head+`<script src="/api/site/${id}/identity.js"></script><script src="/api/site/${id}/bridge.js"></script>`,count:1});
  html=identity.source;report.push(identity.report);
  html=renderPageMetadata(html,pageMetadata(snapshot.config,origin,pathname),{preview:target.type==='preview'});
  return {source:html,report};
}
module.exports={bridgeSource,identityBridgeSource,versionedUIL,renderHTML};

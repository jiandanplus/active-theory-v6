const {exactReplace,classBody,incompatible}=require('./patches');
const quote=value=>JSON.stringify(value??'');
const viewAnchor='_this.bind("navigate", (path => _this.navigate(path))), document.title = "AGI旅行者· AGI Voyager", _this.bind("Work/project", (data => { document.title = data ? `${data.title} · Active Theory` : "AGI旅行者· AGI Voyager" }));';
// These are the legacy source's exact transformations, not a general JS parser.
function appRules(config) {
  const site=config.site;
  const rules=[];
  const add=(id,scope,find,replace,count=1,applicable=true)=>rules.push({id,scope,find,replace,count,applicable});
  add('cms.empty-work','CMSData','_workPages.length ? _workPages : new StateArray(mockData())','_workPages');
  add('text3d.empty','Text3D','text && createText(text, _fontObject)','createText(text ?? "", _fontObject)');
  add('text-thread.empty-bounds','GLTextThread','let backing = [];','if (geom && !buffers.position.length) { geom.boundingBox.min.set(0, 0, 0); geom.boundingBox.max.set(0, 0, 0); geom.boundingSphere.center.set(0, 0, 0); geom.boundingSphere.radius = 0; } let backing = [];');
  add('gltext.empty','GLText','&& (text = txt)) return','&& ((text = txt), true)) return');
  add('gltext.local-buffer','GLText','_this.geometry.attributes.uv.setArray(buffers.uv),','_this.geometry.attributes.uv.setArray(buffers.uv), _this.geometry.attributes.local.setArray(buffers.local),');
  add('gluitext.set-text',null,'async setText(text, options) { if (text && (text = text.toString(), !1 !== options?.seoText))','async setText(text, options) { if (text != null && (text = text.toString(), !1 !== options?.seoText))');
  add('hydra.absolute-path',null,'this.absolutePath = function (path) {','this.absolutePath = function (path) { path = typeof window !== "undefined" && window.__SITE_RESOURCE_URL__ ? window.__SITE_RESOURCE_URL__(path) : path; if (path.startsWith("/")) return new URL(path, location.origin).href;');
  add('assets.get-path',null,'this.getPath = function (path) {','this.getPath = function (path) { const mapped = window.__SITE_RESOURCE_URL__?.(path); if (mapped && mapped !== path) return mapped;');
  add('asset-loader.fetch','AssetLoader','fetch(path)','fetch(window.__SITE_RESOURCE_URL__?.(path) || path)',2);
  add('geometry.version-path','GeomThread','path.includes("assets/geometry/")','(path.includes("assets/geometry/") || path.startsWith("/api/site/"))',2);
  add('instance.version-path','InstanceMesh','file.includes("assets/geometry")','(file.includes("assets/geometry") || file.startsWith("/api/site/"))');
  add('particles.version-path','ParticleDistributor','path.includes("assets/geometry")','(path.includes("assets/geometry") || path.startsWith("/api/site/"))');
  add('view.identity','ViewController',viewAnchor,'_this.bind("navigate", (path => _this.navigate(path))), _this.bind("Router/state", (state => window.__SITE_UPDATE_IDENTITY__?.(state))), window.__SITE_UPDATE_IDENTITY__?.();');
  add('nav.work','NavUI','text: "Work", _type:',()=>`text: ${quote(site.navWork)}, link: "work", _type:`);
  add('nav.contact','NavUI','text: "Contact", _type:',()=>`text: ${quote(site.navContact)}, link: "contact", _type:`);
  add('nav.link','NavUIItem','_this.params.text.toLowerCase()','(_this.params.link || _this.params.text.toLowerCase())');
  add('contact.single-character','ContactUI','function replaceRandomLetters(str, numReplacements) {','function replaceRandomLetters(str, numReplacements) { if (str.length < 2) return str;');
  add('contact.loaded','ContactUI',/await _this\.wait\(\(_ => _this\.(\w+)\.dimensions\.width\)\)/g,(_,ref)=>`await _this.${ref}.loaded()`,10);
  for(const [ref,key] of Object.entries({contact:'contactTitle',lax:'cityLax',nyc:'cityNyc',ams:'cityAms',email:'email',subscribe:null,privacy:null,careers:null,sync:null})) {
    const applicable=key!==null || !site.labUrl;
    add(`contact.${ref}.inner-text`,'ContactUI',new RegExp(`(_innerText: )"(?:[^"\\\\]|\\\\.)*"(, refName: "${ref}")`),(_,a,b)=>a+quote(site[key])+b,1,applicable);
    if(ref==='sync')continue;
    add(`contact.${ref}.set-text`,'ContactUI',new RegExp(`(_this\\.${ref}\\.setText\\(replaceRandomLetters\\()"(?:[^"\\\\]|\\\\.)*"`),(_,a)=>a+quote(site[key]),1,applicable);
    add(`contact.${ref}.a11y`,'ContactUI',new RegExp(`GLA11y\\.textNode\\(_this\\.${ref}\\.group, "[^"]*"\\)`),()=>`GLA11y.textNode(_this.${ref}.group, ${quote(site[key])})`,1,applicable);
  }
  add('contact.remove-email','ContactUI',/_this\.email\.interact\(hover, \(_ => window\.open\("mailto:[^"]*"\)\), "#"\), /,'',1,!site.emailLink);
  for(const ref of ['subscribe','privacy','careers','ig','in','tw'])add(`contact.remove-${ref}`,'ContactUI',new RegExp(`_this\\.${ref}\\.interact\\(hover, \\(_ => window\\.open\\("[^"]*", "_blank"\\)\\), "#"(?:, "[^"]*")?\\), `),'',1,!site.labUrl);
  add('contact.remove-mobile-sync','ContactUI','_this.ref_MobileSync980 = _this.initClass(MobileSync), _this.ref_MobileSync980.isFragment && _promises.push(_this.wait(_this.ref_MobileSync980, "__ready")), ','',1,!site.labUrl);
  add('contact.hide-links','ContactUI','_this.bind("ViewController/contact",','["ig", "in", "tw", "subscribe", "privacy", "careers", "sync", "line2", "line3", "line4"].forEach(key => _this[key].hide()), _this.bind("ViewController/contact",',1,!site.labUrl);
  add('contact.mailto','ContactUI',/"mailto:[^"\s]*"/g,()=>quote(`mailto:${site.emailLink}`),1,!!site.emailLink);
  add('clean-room.url','CleanRoom',/let url = "[^"]*";/,()=>`let url = ${quote(site.labUrl)};`);
  add('songs.list',null,/let SONGS = \[[\s\S]*?\];/,()=>`let SONGS = ${JSON.stringify(config.songs)};`);
  add('songs.empty',null,'let SONGS = []; SONGS = SONGS.shuffle()','let SONGS = []; if (!SONGS.length) { _this.wrapper?.hide?.(); _this.set("Global/audioEnabled", false); _this.flag?.("__ready", true); _this.onInit?.(); return; } SONGS = SONGS.shuffle()',1,config.songs?.length===0);
  return rules;
}
function applyRule(source,rule) {
  // Required classes remain required even when a configuration branch is inactive.
  let report;
  const transform=code=>{
    if(!rule.applicable){report={id:rule.id,status:'not-applicable'};return code;}
    const result=exactReplace(code,rule);report=result.report;
    const marker=typeof rule.replace==='string'?rule.replace:null;
    if(marker && !result.source.includes(marker))throw incompatible(rule.id);
    return result.source;
  };
  source=rule.scope?classBody(source,rule.scope,transform):transform(source);
  return {source,report};
}
function applyAppPatch(id,source,config) {
  const rule=appRules(config).find(rule=>rule.id===id);
  if(!rule)throw incompatible(id);
  return applyRule(source,rule);
}
function patchAppSource(source,config,contract) {
  if(!config || !config.site || !Array.isArray(config.songs))throw incompatible('app.config');
  const report=[];
  for(const rule of appRules(config)){const result=applyRule(source,rule);source=result.source;report.push(result.report);}
  classBody(source,'ViewController',code=>{if(/document\.title\s*=/.test(code))throw incompatible('view.identity');return code;});
  classBody(source,'ContactUI',code=>{if(/await _this\.wait\(\(_ => _this\.\w+\.dimensions\.width\)\)/.test(code)||(!config.site.emailLink&&code.includes('mailto:'))||(!config.site.labUrl&&code.includes('_this.initClass(MobileSync)')))throw incompatible('contact.postcondition');return code;});
  return {source,report};
}
function patchShaders(source,config,contract) {
  const fields=config.scenes.find(s=>s.id==='TreeScene')?.fields||[];
  const value=name=>fields.find(f=>f.key===`__blackhole_${name}`)?.value??1;
  const parts=source.split('{@}'),indices=[];
  for(let i=0;i<parts.length-1;i++)if(parts[i]==='LogoParticleShader.glsl')indices.push(i+1);
  if(indices.length!==1)throw incompatible('shader.logo-segment');
  const report=[],index=indices[0];
  for(const rule of [
    {id:'shader.logo-time',find:/\btime\b/g,replace:`(time * ${value('speed').toFixed(4)})`,count:6},
    {id:'shader.logo-size-large',find:/\b2\.16\b/g,replace:(2.16*value('size')).toFixed(6),count:2},
    {id:'shader.logo-size-small',find:/\b0\.54\b/g,replace:(0.54*value('size')).toFixed(6),count:1},
    {id:'shader.logo-emission',find:'vec4(emission, 1.0)',replace:`vec4(emission * ${value('brightness').toFixed(4)}, 1.0)`,count:1},
    {id:'shader.logo-color',find:'vec4(color, 1.0)',replace:`vec4(color * ${value('brightness').toFixed(4)}, 1.0)`,count:1},
  ]){const result=exactReplace(parts[index],rule);parts[index]=result.source;report.push(result.report);}
  return {source:parts.join('{@}'),report};
}
function patchUIL(snapshot) {
  const { config } = snapshot;
  const data = structuredClone(snapshot.template.baseUIL);
  for (const scene of config.scenes)
    for (const field of scene.fields) {
      if (field.key.startsWith("__")) continue;
      if (["resource", "geometry"].includes(field.type)) {
        const old = data[field.key];
        if (old?.src === field.value) continue;
        const src =
          field.type === "geometry"
            ? field.value.replace(/^\/models\//, "/assets/geometry/admin/")
            : field.value;
        const filename = src.split("/").at(-1).split("?")[0];
        data[field.key] = {
          ...old,
          src,
          filename,
          prefix: "",
          relative: "",
          compressed: false,
          useCompressed: false,
          hotreload: false,
        };
      } else data[field.key] = field.value;
    }
  const speed =
    config.scenes
      .find((s) => s.id === "TreeScene")
      ?.fields.find((f) => f.key === "__blackhole_speed")?.value ?? 1;
  const size =
    config.scenes
      .find((s) => s.id === "TreeScene")
      ?.fields.find((f) => f.key === "__blackhole_size")?.value ?? 1;
  const key = "INPUT_P_Element_21_TreeScenecode_1_code";
  const report=[];
  if (typeof data[key] === "string" && data[key].includes("Lensed accretion")) {
    for(const rule of [
      {id:'uil.blackhole-time',find:/\btime\b/g,replace:`(time * ${speed.toFixed(4)})`,count:5},
      {id:'uil.blackhole-size',find:/$/,replace:`\npos *= ${size.toFixed(4)};`,count:1},
    ]){const result=exactReplace(data[key],rule);data[key]=result.source;report.push(result.report);}
  }
  return {data,report};
}
function buildUIL(snapshot) { return patchUIL(snapshot).data; }
module.exports={applyAppPatch,patchAppSource,patchShaders,patchUIL,buildUIL};

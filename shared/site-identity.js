(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SiteIdentity = api;
})(globalThis, function () {
  'use strict';
  const DEFAULTS = Object.freeze({description:'',language:'en',socialImage:''});
  const LANGUAGES = Object.freeze(['zh-CN','zh-TW','en']);
  const bad = message => Object.assign(new Error(message), {status:400});
  function normalizeSite(site = {}) {
    if (!site || typeof site !== 'object' || Array.isArray(site)) throw bad('网站配置字段无效');
    return {...DEFAULTS,...structuredClone(site)};
  }
  function normalizeConfig(config) {
    const copy = structuredClone(config);
    copy.site = normalizeSite(copy.site);
    return copy;
  }
  function validateIdentity(site) {
    if (typeof site.description !== 'string' || site.description.length > 500 ||
        /<\/?[a-z!]|\x00/i.test(site.description)) throw bad('网站描述须为不超过 500 字符的纯文本');
    if (!LANGUAGES.includes(site.language)) throw bad('网站语言无效');
    if (typeof site.socialImage !== 'string') throw bad('分享图片地址必须是文本');
    return site;
  }
  function publicPathForState(state) {
    const value=String(state??'').replace(/^\//,'').replace(/\/$/,'');
    if (['','home','about','tree','contact','footer'].includes(value)) return '/';
    if (value==='work') return '/work';
    return /^work\/[a-z0-9][a-z0-9-]{0,100}$/.test(value)?'/'+value:null;
  }
  function pageMetadata(config,origin,pathname) {
    const base=new URL(origin);
    if (!['http:','https:'].includes(base.protocol) || base.origin!==origin.replace(/\/$/,'')) throw bad('SITE_ORIGIN 无效');
    let path;
    try { path=decodeURIComponent(String(pathname).split(/[?#]/)[0]); } catch { path=''; }
    if (path.length>1) path=path.replace(/\/$/,'');
    const site=normalizeSite(config.site), title=String(site.title||'');
    const meta={status:200,title,siteTitle:title,description:site.description,language:LANGUAGES.includes(site.language)?site.language:'en',image:'',url:''};
    let image=site.socialImage;
    if (path==='/work') meta.title=site.navWork?`${site.navWork} · ${title}`:title;
    else if (path!=='/') {
      const match=/^\/work\/([a-z0-9][a-z0-9-]{0,100})$/.exec(path);
      const project=match&&(config.projects||[]).find(p=>p.slug===match[1]);
      if (!project) return {...meta,status:404,title:'页面不存在',description:'',image:'',url:''};
      meta.title=project.name?`${project.name} · ${title}`:title;
      meta.description=project.description||site.description;
      image=project.image?.url||site.socialImage;
    }
    meta.url=new URL(path,base.origin).href;
    // Only authorized, mapped resource-entry paths can become share images.
    if (typeof image==='string' && /^\/api\/site\/(?:[1-9]\d*|preview-[\w-]+)\/resources\/[^/?#]+\/[^/?#]+(?:[?#].*)?$/.test(image)) meta.image=new URL(image,base.origin).href;
    return meta;
  }
  function headEntries(meta,{preview=false}={}) {
    const out=[{tag:'title',attributes:{},text:meta.title},{tag:'meta',attributes:{name:'apple-mobile-web-app-title',content:meta.siteTitle}}];
    const add=(key,content,property=false)=>{if(content) out.push({tag:'meta',attributes:{[property?'property':'name']:key,content}});};
    add('description',meta.description);
    if(meta.url) out.push({tag:'link',attributes:{rel:'canonical',href:meta.url}});
    add('og:type','website',true); add('og:title',meta.title,true);
    add('og:description',meta.description,true); add('og:url',meta.url,true); add('og:image',meta.image,true);
    add('twitter:card',meta.image?'summary_large_image':'summary');
    add('twitter:title',meta.title); add('twitter:description',meta.description); add('twitter:url',meta.url); add('twitter:image',meta.image);
    if(preview||meta.status===404) add('robots','noindex, nofollow');
    return out;
  }
  function ownedMeta(key) {
    key=String(key||'').toLowerCase();
    return ['description','robots','apple-mobile-web-app-title'].includes(key)||key.startsWith('og:')||key.startsWith('twitter:');
  }
  return {DEFAULTS,LANGUAGES,normalizeSite,normalizeConfig,validateIdentity,publicPathForState,pageMetadata,headEntries,ownedMeta};
});

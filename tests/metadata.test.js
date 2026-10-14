const {test}=require('node:test');
const assert=require('node:assert/strict');
const identity=require('../shared/site-identity');
const config={site:{title:'A $& ` \\',navWork:'Works',description:'Site & more',language:'zh-CN',socialImage:'/api/site/8/resources/i/share.png'},projects:[{slug:'one',name:'One',description:'Project',image:{url:'/api/site/8/resources/p/one.png'}}]};
function fakeDocument() {
  const items=[],doc={title:'',documentElement:{lang:''}};
  doc.createElement=tag=>({tagName:tag.toUpperCase(),attributes:{},textContent:'',setAttribute(k,v){this.attributes[k]=String(v);},getAttribute(k){return this.attributes[k]??null;},remove(){const index=items.indexOf(this);if(index>=0)items.splice(index,1);}});
  doc.head={querySelectorAll(){return [...items];},appendChild(item){items.push(item);}};
  doc.items=items;return doc;
}
test('DOM updates clear old image/description and do not inject HTML',()=>{
  const {applyPageMetadata}=require('../shared/page-metadata-dom'),doc=fakeDocument();
  const viewport=doc.createElement('meta');viewport.setAttribute('name','viewport');doc.head.appendChild(viewport);
  applyPageMetadata(doc,identity.pageMetadata(config,'https://owner.example','/work/one'));
  assert.equal(doc.title,'One · A $& ` \\');
  const blank={...config,site:{...config.site,title:'<img src=x>',description:'',socialImage:''},projects:[]};
  applyPageMetadata(doc,identity.pageMetadata(blank,'https://owner.example','/'),{preview:true});
  assert.equal(doc.documentElement.lang,'zh-CN');
  assert.equal(doc.items.filter(n=>n.getAttribute('name')==='viewport').length,1);
  assert.equal(doc.items.filter(n=>/image$/.test(n.getAttribute('name')||n.getAttribute('property')||'')).length,0);
  assert.equal(doc.items.filter(n=>/description$/.test(n.getAttribute('name')||n.getAttribute('property')||'')).length,0);
  assert.equal(doc.items.filter(n=>n.tagName==='TITLE').length,1);
  assert.equal(doc.items.find(n=>n.tagName==='TITLE').textContent,'<img src=x>');
  assert.equal(doc.items.find(n=>n.getAttribute('name')==='robots').getAttribute('content'),'noindex, nofollow');
});
test('bridge uses same projection for detail/list/internal home transitions',()=>{
  const document=fakeDocument(),window={SiteIdentity:identity,SiteMetadataDOM:require('../shared/page-metadata-dom'),fetch:async()=>{}};
  function XHR(){} XHR.prototype.open=function(){};
  const location={origin:'https://owner.example',pathname:'/work/one'};
  const script=require('../admin-server/frontend').bridgeSource(8,config,{assets:{},legacyMap:{}},location.origin,[],{});
  require('node:vm').runInNewContext(script,{window,document,location,URL,Request,XMLHttpRequest:XHR});
  assert.equal(document.title,identity.pageMetadata(config,location.origin,location.pathname).title);
  for(const state of ['work/one','work','about','contact','work/one','unknown']) {
    window.__SITE_UPDATE_IDENTITY__(state);
    assert.equal(document.title,identity.pageMetadata(config,location.origin,identity.publicPathForState(state)||'/__not-found').title);
  }
});
test('route projection uses trusted origin and real project data',()=>{
  const detail=identity.pageMetadata(config,'https://owner.example','/work/one?preview=x');
  assert.equal(detail.title,'One · A $& ` \\');
  assert.equal(detail.url,'https://owner.example/work/one');
  assert.equal(detail.image,'https://owner.example/api/site/8/resources/p/one.png');
  assert.equal(identity.pageMetadata(config,'https://owner.example','/work/nope').status,404);
  for(const state of ['','home','about','tree','contact','footer']) assert.equal(identity.publicPathForState(state),'/');
  assert.equal(identity.publicPathForState('work/one'),'/work/one');
  assert.equal(identity.publicPathForState('unknown'),null);
  assert.equal(identity.pageMetadata(config,'https://owner.example','/work').title,'Works · A $& ` \\');
  assert.throws(()=>identity.pageMetadata(config,'https://owner.example/path','/'));
  assert.equal(identity.pageMetadata({...config,site:{...config.site,socialImage:'https://evil.example/a.png'}},'https://owner.example','/').image,'');
});
test('SSR removes original identity variants, escapes and preserves program scripts',()=>{
  const {renderPageMetadata,ownedMeta}=require('../admin-server/page-metadata');
  const html='<html LANG=\'en\'><head><TITLE>Old</TITLE><META content="old" PROPERTY=\'twitter:image\'><meta name="twitter:image" content="old2"><meta content="old3" name=description><link href="https://activetheory.net" REL=\'canonical\'><script src="keep.js"></script><meta charset="utf-8"></head><body></body></html>';
  const result=renderPageMetadata(html,identity.pageMetadata(config,'https://owner.example','/'),{preview:true});
  assert.match(result,/lang="zh-CN"/);
  assert.equal((result.match(/rel="canonical"/g)||[]).length,1);
  assert.equal((result.match(/(?:name|property)="twitter:image"/g)||[]).length,1);
  assert.match(result,/Site &amp; more/);
  assert.match(result,/<script src="keep.js"><\/script>/);
  assert.match(result,/<meta charset="utf-8">/);
  assert.match(result,/noindex, nofollow/);
  assert.doesNotMatch(result,/activetheory\.net|content="old/);
  assert.equal(ownedMeta('OG:TITLE'),true);
  assert.equal(ownedMeta('charset'),false);
});

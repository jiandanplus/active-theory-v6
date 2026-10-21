const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const adapter=require('../admin-server/engine/legacy-adapter');
const {collectReferences,publicSnapshot}=require('../admin-server/snapshots');
const {projectSnapshot}=require('../admin-server/delivery/projection');
function snapshot(){return {config:{site:{title:'Test'},projects:[],scenes:[],songs:[]},template:{baseUIL:{},metadata:{},contact:{}},assets:{video:{resourceId:'video',fileName:'clip.mp4'},image:{resourceId:'image',fileName:'image.png'}},legacyMap:{'/media/video':'video','/media/image':'image'}};}
const fields={heroVideo:'/media/video',heroPoster:'/media/image',labBackground:'/media/image',contactInstagramIcon:'/media/image',contactLinkedinIcon:'/media/image',contactXIcon:'/media/image',contactQrImage:'/media/image'};
test('new site media is referenced and mapped without changing the raw snapshot',()=>{
 const source=snapshot();Object.assign(source.config.site,fields,{contactHomeURL:'https://example.test/home'});
 const before=JSON.stringify(source),refs=collectReferences(source),result=publicSnapshot(source,'45');
 for(const [key,url] of Object.entries(fields)){
  const id=url.endsWith('video')?'video':'image';
  assert.ok(refs.some(r=>r.resourceId===id&&r.slot==='config.site.'+key),key+' grant');
  assert.equal(result.site[key],'/api/site/45/resources/'+id+'/'+(id==='video'?'clip.mp4':'image.png'));
 }
 assert.equal(result.site.contactHomeURL,'https://example.test/home');
 assert.equal(JSON.stringify(source),before);
});
test('projection rejects unresolved new local site media instead of silently dropping the content field',()=>{
 const profile={policy:{inactiveLayouts:[]},programs:[]};
 for(const key of Object.keys(fields)){
  const source=snapshot();source.config.site[key]='/media/missing';
  assert.throws(()=>projectSnapshot(source,{type:'version',id:'45'},profile),{status:422},key);
 }
});
test('page content overrides have explicit audited patch identities',()=>{
 const ids=adapter.patchContracts().map(r=>r.id);
 for(const id of ['page.hero-video','page.hero-poster','page.lab-background','page.qr-image'])assert.ok(ids.includes(id),id);
});
test('hero video and poster patches remain scoped to the original controller',()=>{
 const original='Class((function ViewController() { let v = _this.createFragment(VideoTexture, "assets/video/reel.mp4", { firstFrame: "assets/video/reel-frame.jpg" }); }));';
 const config={site:{heroVideo:'/media/video',heroPoster:'/media/image'}};
 let next=adapter.applyAppPatch('page.hero-video',original,config).source;
 next=adapter.applyAppPatch('page.hero-poster',next,config).source;
 assert.ok(next.includes('"/media/video"'));assert.ok(next.includes('"/media/image"'));
 assert.ok(next.includes('createFragment(VideoTexture'));
 new vm.Script(next);
});
test('lab content patch changes the texture source without replacing the hexagon shader',()=>{
 const original='Class((function HexagonGrid() { const uniforms = { tVideo: { value: Utils3D.getTexture("assets/images/lab.gif") }, uTint: { value: new Color("#FFFFFF") } }; })), ';
 const next=adapter.applyAppPatch('page.lab-background',original,{site:{labBackground:'/media/image'}});
 assert.ok(next.source.includes('Utils3D.getTexture("/media/image")'));
 assert.ok(next.source.includes('uTint: { value: new Color("#FFFFFF") }'));
 assert.equal(next.report.matches,1);
});
test('optional patch absent from old content does not require a new class or modify its bytes',()=>{
 const original='Class((function Other() {})), ';
 const next=adapter.applyAppPatch('page.qr-image',original,{site:{}});
 assert.equal(next.source,original);assert.equal(next.report.status,'not-applicable');
});
test('custom QR image uses the given image instead of website or workids payload',()=>{
 const original='Class((function QRCode(_params) { let url = "https://example.test"; url += "&workids=123"; let qrCode = await QRGen.create(url, _params.size); _context.filter = "invert(1)", _context.drawImage(qrCode, 0, 0) })), ';
 const result=adapter.applyAppPatch('page.qr-image',original,{site:{contactQrImage:'/media/image'}});
 assert.ok(result.source.includes('/media/image'));
 assert.doesNotMatch(result.source,/workids|QRGen\.create|invert\(1\)/);
 assert.match(result.source,/drawImage/);
 assert.match(result.source,/crossOrigin/);
 assert.equal(result.report.matches,1);
});
for(const mobile of [true,false]){
 test(`custom QR container ${mobile?'does not create an unpositioned mobile QR':'creates the desktop QR at size 110'}`,()=>{
  const original='Class((function ContactUI() { const _this = this, _promises = []; _this.ref_MobileSync980 = _this.initClass(MobileSync), _this.ref_MobileSync980.isFragment && _promises.push(_this.wait(_this.ref_MobileSync980, "__ready")), _this.qrcode = _this.get("MobileSync/qrcode", !0); }));';
  const config={site:{contactQrImage:'/media/image'}};
  let output=adapter.applyAppPatch('page.qr-container',original,config).source;
  output=adapter.applyAppPatch('page.qr-lookup',output,config).source;
  new vm.Script(output);
  const calls=[],qrcode={},QRCode=function QRCode(){};
  const instance={initClass(type,options){calls.push({type,options});return qrcode;}};
  vm.runInNewContext(output,{Device:{mobile},QRCode,Class:constructor=>constructor.call(instance)});
  assert.equal(calls.length,mobile?0:1);
  assert.equal(instance.qrcode,mobile?undefined:qrcode);
  assert.equal(instance.ref_MobileSync980,mobile?undefined:qrcode);
  if(!mobile){
   assert.equal(calls[0].type,QRCode);
   assert.equal(calls[0].options.size,110);
   assert.deepEqual(Object.keys(calls[0].options),['size']);
  }
 });
}
test('authorized runtime: custom QR retains desktop-only creation and original MobileSync bytes',{
 skip:!process.env.AUTHORIZED_RUNTIME_ROOT,
},()=>{
 const source=fs.readFileSync(path.join(process.env.AUTHORIZED_RUNTIME_ROOT,'assets/js/app.1778129964370.js'),'utf8');
 const {classBody}=require('../admin-server/engine/patches');
 const output=adapter.patchAppSource(source,{site:{contactQrImage:'/media/image'},songs:[],scenes:[]});
 new vm.Script(output.source);
 classBody(output.source,'ContactUI',body=>{
  assert.ok(/!Device\.mobile && \(_this\.ref_MobileSync980 = _this\.initClass\(QRCode, \{ size: 110 \}\)\)/.test(body),'custom QR creation remains desktop-only');
  return body;
 });
 let originalMobileSync;
 classBody(source,'MobileSync',body=>{originalMobileSync=body;return body;});
 classBody(output.source,'MobileSync',body=>{assert.equal(body,originalMobileSync);return body;});
});
test('authorized runtime: content overrides preserve original runtime syntax and named visual classes',{
 skip:!process.env.AUTHORIZED_RUNTIME_ROOT,
},()=>{
 const source=fs.readFileSync(path.join(process.env.AUTHORIZED_RUNTIME_ROOT,'assets/js/app.1778129964370.js'),'utf8');
 const config={site:{title:'Test',navWork:'Work',navContact:'Contact',contactTitle:'Contact',cityLax:'A',cityNyc:'B',cityAms:'C',email:'test@example.test',emailLink:'test@example.test',labUrl:'https://example.test',...fields,
  contactHomeText:'HOME',contactJoinText:'JOIN US',contactAboutText:'ABOUT US',contactInstagramText:'My channel',contactLinkedinText:'Business',contactXText:'Updates',contactQrText:'WECHAT',
  contactHomeURL:'https://example.test/home',contactJoinURL:'https://example.test/join',contactAboutURL:'https://example.test/about',contactInstagramURL:'https://example.test/one',contactLinkedinURL:'https://example.test/two',contactXURL:'https://example.test/three'},songs:[],scenes:[]};
 const output=adapter.patchAppSource(source,config);
 new vm.Script(output.source);
 for(const value of ['/media/video','/media/image','https://example.test/one','https://example.test/join','JOIN US'])assert.ok(output.source.includes(value),value);
 const {classBody}=require('../admin-server/engine/patches');
 for(const name of ['HexagonGrid','HomeLogoShader','ParticleTest','Footer'])assert.doesNotThrow(()=>classBody(output.source,name,s=>s));
 classBody(output.source,'QRCode',body=>{assert.doesNotMatch(body,/workids|QRGen\.create/);return body;});
 classBody(output.source,'ContactUI',body=>{assert.ok(body.includes('https://example.test/three'));assert.ok(body.includes('My channel'));assert.ok(body.includes('bg: "/media/image"'));return body;});
 classBody(output.source,'ContactUI',body=>{assert.doesNotMatch(body,/_this\.qrcode\.glui\.shader\.blending = Shader\.ADDITIVE_BLENDING/);return body;});
});
test('authorized runtime: independent contact URLs retain inherited captions and matching underlines with no lab link',{
 skip:!process.env.AUTHORIZED_RUNTIME_ROOT,
},()=>{
 const source=fs.readFileSync(path.join(process.env.AUTHORIZED_RUNTIME_ROOT,'assets/js/app.1778129964370.js'),'utf8');
 const {classBody}=require('../admin-server/engine/patches');
 for(const [key,ref,line,caption] of [['contactHomeURL','privacy','line2','Home'],['contactJoinURL','subscribe','line3','JION US'],['contactAboutURL','careers','line4','ABOUT US']]){
  const output=adapter.patchAppSource(source,{site:{labUrl:'',[key]:'https://example.test/independent'},songs:[]});
  classBody(output.source,'ContactUI',body=>{
   assert.ok(body.includes(`_innerText: "${caption}", refName: "${ref}"`),key+' inherited caption');
   const hidden=JSON.parse(/(\[[^\]]*\])\.forEach\(key => _this\[key\]\.hide\(\)\)/.exec(body)[1]);
   assert.ok(!hidden.includes(ref),key+' visible link');assert.ok(!hidden.includes(line),key+' matching underline');
   return body;
  });
 }
});
for(const [name,ref] of [['Instagram','ig'],['Linkedin','in'],['X','tw']]){
 test(`authorized runtime: standalone ${name} text with no lab or social URL preserves legacy hiding`,{
  skip:!process.env.AUTHORIZED_RUNTIME_ROOT,
 },()=>{
  const source=fs.readFileSync(path.join(process.env.AUTHORIZED_RUNTIME_ROOT,'assets/js/app.1778129964370.js'),'utf8');
  const {classBody}=require('../admin-server/engine/patches');
  const config={site:{labUrl:'',['contact'+name+'Text']:'Independent social label'},songs:[],scenes:[]};
  const before=structuredClone(config),output=adapter.patchAppSource(source,config);
  new vm.Script(output.source);
  assert.deepEqual(config,before,'transformation must not add URLs or change stored fields');
  assert.deepEqual(output.report.find(p=>p.id==='page.social-'+name.toLowerCase()+'-name'),{
   id:'page.social-'+name.toLowerCase()+'-name',status:'not-applicable',
  });
  classBody(output.source,'ContactUI',body=>{
   assert.ok(!body.includes(`_this.${ref}.interact(`),'no link means no interaction');
   const hidden=JSON.parse(/(\[[^\]]*\])\.forEach\(key => _this\[key\]\.hide\(\)\)/.exec(body)[1]);
   assert.ok(hidden.includes(ref),'no link retains legacy hiding');
   return body;
  });
 });
 for(const [mode,links] of [
  ['independent URL',{labUrl:'',['contact'+name+'URL']:'https://example.test/social'}],
  ['inherited interaction',{labUrl:'https://example.test/lab'}],
 ]){
  test(`authorized runtime: ${name} text still applies with ${mode}`,{
   skip:!process.env.AUTHORIZED_RUNTIME_ROOT,
  },()=>{
   const source=fs.readFileSync(path.join(process.env.AUTHORIZED_RUNTIME_ROOT,'assets/js/app.1778129964370.js'),'utf8');
   const {classBody}=require('../admin-server/engine/patches');
   const config={site:{...links,['contact'+name+'Text']:'Independent social label'},songs:[],scenes:[]};
   const before=structuredClone(config),output=adapter.patchAppSource(source,config);
   new vm.Script(output.source);
   assert.deepEqual(config,before);
   assert.deepEqual(output.report.find(p=>p.id==='page.social-'+name.toLowerCase()+'-name'),{
    id:'page.social-'+name.toLowerCase()+'-name',status:'applied',matches:1,expected:1,
   });
   classBody(output.source,'ContactUI',body=>{
    assert.match(body,new RegExp(`_this\\.${ref}\\.interact\\([^;]*?"#", "Independent social label"`));
    if(!links.labUrl){
     const hidden=JSON.parse(/(\[[^\]]*\])\.forEach\(key => _this\[key\]\.hide\(\)\)/.exec(body)[1]);
     assert.ok(!hidden.includes(ref),'independent URL keeps the social link visible');
     assert.ok(body.includes('https://example.test/social'));
    }
    return body;
   });
  });
 }
}
const {TEXT_FIELDS,LINK_FIELDS,PAGE_KEYS}=require('../shared/page-content');
const independentFields={...fields,
 ...Object.fromEntries(Object.keys(TEXT_FIELDS).map(key=>[key,'Independent '+key])),
 ...Object.fromEntries(Object.keys(LINK_FIELDS).map(key=>[key,'https://example.test/'+key])),
};
for(const labUrl of ['', 'https://example.test/lab']){
 for(const [key,value] of Object.entries(independentFields)){
  test(`authorized runtime: single optional ${key} parses with ${labUrl?'nonblank':'blank'} lab URL`,{
   skip:!process.env.AUTHORIZED_RUNTIME_ROOT,
  },()=>{
   assert.equal(PAGE_KEYS.length,20);
   assert.deepEqual(Object.keys(independentFields),PAGE_KEYS);
   const source=fs.readFileSync(path.join(process.env.AUTHORIZED_RUNTIME_ROOT,'assets/js/app.1778129964370.js'),'utf8');
   const config={site:{labUrl,[key]:value},songs:[],scenes:[]},before=structuredClone(config);
   const output=adapter.patchAppSource(source,config);
   new vm.Script(output.source);
   assert.deepEqual(config,before,'single-field overrides must not materialize unrelated defaults');
  });
 }
}

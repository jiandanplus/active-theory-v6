const test = require("node:test");
const assert = require("node:assert/strict");
const adminSource = require("./helpers/admin-source");
const ui = require("../admin-ui/admin.js");
test('bundled media previews use authenticated ID URLs rather than admin-relative or bare asset paths', () => {
  assert.equal(ui.resourcePreviewURL({id:'bundle:id',source:'bundled',url:'assets/pic.png'}),'/media/bundle%3Aid');
  assert.equal(ui.resourcePreviewURL({id:'local',source:'local',url:'/media/local'}),'/media/local');
  assert.equal(ui.resourcePreviewURL({id:'external',source:'external',url:'https://example.test/img?q=1'}),'https://example.test/img?q=1');
});
test("new projects have complete engine media objects and unique identity", () => {
  const p = ui.newProject("test-id");
  assert.equal(p.id, "test-id");
  assert.equal(p.slug, "new-project-test-id");
  assert.deepEqual(p.video, { url: "", thumbnail: "" });
  assert.deepEqual(p.projectLogo, { url: "" });
  assert.match(p.completionDate, /^\d{4}-\d{2}-\d{2}T/);
});
test("geometry picker rejects raw uploaded GLB and accepts only converted ready models", () => {
  assert.equal(
    ui.canPick(
      { kind: "model", status: "uploaded", url: "/media/a" },
      "geometry",
    ),
    false,
  );
  assert.equal(
    ui.canPick(
      { kind: "model", status: "ready", url: "/models/example.bin" },
      "geometry",
    ),
    true,
  );
  assert.equal(
    ui.canPick(
      {
        kind: "model",
        status: "ready",
        url: "/models/example.bin",
        trashed: true,
      },
      "geometry",
    ),
    false,
  );
  assert.equal(
    ui.canPick(
      { kind: "model", status: "ready", url: "/media/raw-glb" },
      "geometry",
    ),
    false,
  );
});
test("resource picker limits audio and image slots to matching resources", () => {
  assert.equal(
    ui.canPick({ kind: "image", status: "uploaded" }, "audio"),
    false,
  );
  assert.equal(
    ui.canPick({ kind: "audio", status: "uploaded" }, "audio"),
    true,
  );
});
test("stored credentials are never reused as visible editor values", () => {
  assert.deepEqual(
    ui.storageBody({
      id: "s3",
      name: "Cloud",
      accessKeyId: "configured",
      secretAccessKey: "configured",
      sessionToken: "configured",
    }),
    { id: "s3", name: "Cloud", type: "s3" },
  );
});
test("admin DOM has no HTML injection sinks and includes navigation and dirty guard", () => {
  const source = adminSource();
  assert.doesNotMatch(
    source,
    /\.innerHTML\s*=|insertAdjacentHTML|document\.write/,
  );
  assert.match(source, /beforeunload/);
  for (const section of [
    "overview",
    "site",
    "scenes",
    "projects",
    "resources",
    "storage",
    "versions",
    "security",
  ])
    assert.ok(source.includes(section));
});
test("deployment and font guidance names actual env and explicit validation limits", () => {
  const source = adminSource();
  assert.doesNotMatch(source, /ADMIN_MASTER_KEY/);
  assert.match(source, /SITE_MASTER_KEY/);
  assert.match(source, /字形.*验证.*拒绝/);
  assert.match(source, /CORS/);
  assert.match(source, /前台预览/);
});
test("uploaded local and S3 models can convert but external and ready models cannot", () => {
  assert.equal(
    ui.canConvert({ kind: "model", source: "s3", status: "uploaded" }),
    true,
  );
  assert.equal(
    ui.canConvert({ kind: "model", source: "local", status: "uploaded" }),
    true,
  );
  assert.equal(
    ui.canConvert({ kind: "model", source: "external", status: "unverified" }),
    false,
  );
  assert.equal(
    ui.canConvert({ kind: "model", source: "local", status: "ready" }),
    false,
  );
});
test("confirmations use asynchronous accessible in-page dialogs without native blockers", () => {
  const source = adminSource();
  assert.doesNotMatch(source, /\bconfirm\(/);
  assert.match(source, /function confirmAction\(/);
  assert.match(source, /aria-labelledby/);
  assert.match(source, /aria-describedby/);
  assert.match(source, /await confirmAction\(/);
  assert.match(source, /addEventListener\(["']cancel["']/);
});
test("multiline field never writes the read-only textarea type property", () => {
  const vm = require("node:vm");
  const source = adminSource();
  const fieldSource = source.slice(source.indexOf("  function field("), source.indexOf("  function panel("));
  const created = [];
  const node = (tag) => {
    const element = { tag, append() {}, addEventListener() {} };
    if (tag === "textarea") Object.defineProperty(element, "type", { get: () => "textarea", set: () => { throw new TypeError("textarea.type is read-only"); } });
    created.push(element);
    return element;
  };
  const field = vm.runInNewContext(fieldSource + "\nfield;", { node, crypto: { randomUUID: () => "test" } });
  const textarea = field({ append() {} }, "场景文案", "保留原文", () => {}, { multiline: true });
  assert.equal(textarea.tag, "textarea");
  assert.equal(textarea.value, "保留原文");
  const number = field({ append() {} }, "尺寸", 0.8, () => {}, { type: "number" });
  assert.equal(number.type, "number");
});
test("identity fields provide controlled language choices and description limits", () => {
  const source = adminSource();
  const fieldSource = source.slice(source.indexOf("  function field("), source.indexOf("  function panel("));
  const node = (tag, text) => ({tagName:tag.toUpperCase(), textContent:text, children:[], listeners:{}, append(...children){this.children.push(...children);}, addEventListener(event,listener){this.listeners[event]=listener;}});
  const field = require('node:vm').runInNewContext(fieldSource+'\nfield;', {node,crypto:{randomUUID:()=> 'identity'}});
  const selected=[];
  const input=field(node('div'),'页面语言','en',v=>selected.push(v),{choices:[{value:'zh-CN',label:'简体中文'},{value:'en',label:'English'}]});
  assert.equal(input.tagName,'SELECT');
  assert.equal(input.value,'en');
  assert.deepEqual(input.children.map(option=>option.value),['zh-CN','en']);
  input.value='zh-CN'; input.listeners.change();
  assert.deepEqual(selected,['zh-CN']);
  assert.equal(input.listeners.input,undefined);
  const description=field(node('div'),'网站描述','',()=>{},{multiline:true,maxLength:500});
  assert.equal(description.tagName,'TEXTAREA');
  assert.equal(description.maxLength,500);
});
test('site identity interactions update the existing draft and dirty state', () => {
  const source=adminSource();
  const start=source.indexOf('  function siteView(');
  const end=source.indexOf('\n  function ',start+4);
  const controls=[]; const buttons=[]; const panels=[]; let changes=0;
  const state={config:{site:{title:'Fixture',description:'Draft',language:'en',socialImage:'https://example.test/old.png'},songs:[]}};
  const node=()=>({append(){}});
  const context={state,content:node(),labels:{},node,heading(){},warning(){},dirty(){changes++;},window:{SiteIdentity:require('../shared/site-identity')},panel(parent,title){panels.push(title);return node();},field(parent,label,value,onChange,options){const control={label,value,onChange,options};controls.push(control);return control;},button(label,action){buttons.push({label,action});return node();}};
  require('node:vm').runInNewContext(source.slice(start,end)+'\nsiteView();',context);
  assert.deepEqual(panels,['基本信息','搜索与分享','背景音乐']);
  assert.equal(controls.filter(c=>c.label==='网站描述').length,1);
  controls.find(c=>c.label==='网站描述').onChange('New description');
  const language=controls.find(c=>c.label==='页面语言');
  assert.deepEqual(Array.from(language.options.choices,c=>c.value),['zh-CN','zh-TW','en']);
  language.onChange('zh-TW');
  const social=controls.find(c=>c.label==='分享图片');
  assert.equal(social.options.pick,'image');
  social.onChange('https://example.test/new.png');
  buttons.find(b=>b.label==='清空分享图片').action();
  assert.equal(social.value,'');
  assert.deepEqual(state.config.site,{title:'Fixture',description:'New description',language:'zh-TW',socialImage:''});
  assert.equal(changes,4);
});
test('pending preview click blocks another preview and publish until completion',async()=>{
  const source=adminSource();
  const vm=require('node:vm');
  const start=source.indexOf('  async function save()');
  const end=source.indexOf('  async function render()',start);
  let release,posts=0,notices=[],opened=0;
  const pending=new Promise(resolve=>{release=resolve;});
  const state={config:{site:{title:'draft'}},dirty:false,busy:false,revision:3,section:'site',overview:{},sessionEpoch:0,runtime:{selection:{digest:'a'.repeat(64),generation:1}}};
  const el=(tag,text)=>({tag,text,children:[],listeners:{},append(...items){this.children.push(...items);},addEventListener(event,fn){this.listeners[event]=fn;},scrollIntoView(){}});
  const context={state,api:async(path)=>{if(path==='/preview'){posts++;return pending;}if(path==='/publish'){posts++;return {version:5};}},
    notify:(message,error)=>notices.push({message,error}),updateStatus(){},confirmAction:async()=>true,
    node:el,panel:()=>el('section'),content:el('main'),window:{open(){opened++;}},render:async()=>{}};
  const helperStart=source.indexOf('  async function building(');
  const helperEnd=source.indexOf('  window.addEventListener',helperStart);
  vm.runInNewContext(source.slice(helperStart,helperEnd)+source.slice(start,end)+'\nthis.actions={save,preview,publish};',context);
  const buttonSource=source.slice(source.indexOf('  function button('),source.indexOf('  function notify('));
  context.run=async action=>{try{await action();}catch(e){context.notify(e.message,true);}};
  vm.runInNewContext(buttonSource+'\nthis.makeButton=button;',context);
  const preview=context.makeButton('预览',context.actions.preview),publish=context.makeButton('发布',context.actions.publish);
  preview.listeners.click();
  await new Promise(resolve=>setImmediate(resolve));
  preview.listeners.click();publish.listeners.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(posts,1);
  release({url:'/?preview=preview-abc'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(state.busy,false);
  assert.equal(opened,0);
  assert.match(notices.at(-1).message,/响应无效/);
});
test('runtime choice serializes pending selection and leaves unsaved draft untouched',async()=>{
  const source=adminSource(),vm=require('node:vm');
  const a='a'.repeat(64),b='b'.repeat(64),bundle=digest=>({digest,profileId:'fixture',bytes:12});
  const state={config:{site:{title:'unsaved'}},revision:7,dirty:true,busy:false,sessionEpoch:0,
    runtime:{selection:{digest:a,generation:1},bundles:[bundle(a),bundle(b)]}};
  let release,posts=0,choice,notices=[];
  const pending=new Promise(resolve=>release=resolve);
  const p={replaceChildren(){},append(){}};
  const context={state,runtimeRequestSequence:0,api:async path=>{if(path==='/runtime/selection'){posts++;return pending;}return {selection:{digest:b,generation:2},bundles:[bundle(a),bundle(b)]};},
    updateStatus(){},node:()=>({}),button:()=>({}),field:(parent,label,value,onChange)=>{choice=onChange;return {dataset:{},focus(){}};},
    empty(){},notify:message=>notices.push(message),run:async action=>{try{await action();}catch(e){notices.push(e.message);}}};
  const helpers=source.slice(source.indexOf('  async function building('),source.indexOf('  window.addEventListener'));
  const panel=source.slice(source.indexOf('  function showRuntimePanel('),source.indexOf('  function siteView('));
  context.context=context;
  vm.runInNewContext(helpers+panel+'\nthis.show=showRuntimePanel;',context);
  context.show(p);choice(b);
  await new Promise(resolve=>setImmediate(resolve));
  choice(b);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(posts,1);
  release({digest:b,generation:2});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(state.runtime.selection.digest,b);
  assert.equal(state.config.site.title,'unsaved');assert.equal(state.revision,7);assert.equal(state.dirty,true);
});
test('legacy action appears only for unbound legacy versions',async()=>{
  const source=adminSource(),vm=require('node:vm');
  const labels=[];
  const node=()=>({append(){}});
  const context={state:{},content:node(),node,heading(){},panel:()=>node(),empty(){},button:(label)=>{labels.push(label);return node();},
    api:async()=>({published:3,versions:[
      {id:1,created:new Date().toISOString(),mode:'legacy',generation:0,artifactDigest:null,status:'legacy待生成'},
      {id:2,created:new Date().toISOString(),mode:'legacy',generation:1,artifactDigest:'a'.repeat(64),status:'已固定'},
      {id:3,created:new Date().toISOString(),mode:null,generation:null,artifactDigest:null,status:'缺失/损坏'},
    ]})};
  const start=source.indexOf('  async function versionsView()'),end=source.indexOf('  function securityView()',start);
  context.context=context;
  await vm.runInNewContext(source.slice(start,end)+'\nversionsView()',context);
  assert.equal(labels.filter(label=>label==='生成兼容交付').length,1);
});
test('late publish response after logout cannot report success',async()=>{
  const source=adminSource(),vm=require('node:vm');
  let release,notices=[];
  const pending=new Promise(resolve=>release=resolve);
  const state={busy:false,dirty:false,revision:3,sessionEpoch:0,section:'site',runtime:{selection:{digest:'a'.repeat(64),generation:1}},overview:{},config:{}};
  const context={state,api:async()=>pending,confirmAction:async()=>true,updateStatus(){},
    notify:message=>notices.push(message),render:async()=>{}};
  const helpers=source.slice(source.indexOf('  async function building('),source.indexOf('  window.addEventListener'));
  const actions=source.slice(source.indexOf('  async function save()'),source.indexOf('  async function render()'));
  vm.runInNewContext(helpers+actions+'\nthis.publishAction=publish;',context);
  const request=context.publishAction();
  await new Promise(resolve=>setImmediate(resolve));
  state.sessionEpoch++;state.config=null;
  release({version:5});await request;
  assert.equal(state.overview.published,undefined);
  assert.equal(notices.some(message=>message.includes('发布成功')),false);
});
test('malformed successful mutation response is uncertain, never a successful operation',async()=>{
  const source=adminSource(),vm=require('node:vm');
  const apiSource=source.slice(source.indexOf('  async function api('),source.indexOf('  function dirty('));
  const context={state:{csrf:'token',config:{}},fetch:async()=>({ok:true,status:200,json:async()=>{throw Error('bad JSON');}}),login(){}};
  vm.runInNewContext(apiSource+'\nthis.request=api;',context);
  await assert.rejects(context.request('/publish','POST',{revision:3}),/结果可能已生效.*不要自动重试/);
});
test('unselected runtime explains server registration before preview POST',async()=>{
  const source=adminSource(),vm=require('node:vm');
  const state={busy:false,dirty:false,revision:3,sessionEpoch:0,runtime:{selection:{digest:null,generation:0}},config:{}};
  let posts=0;
  const context={state,api:async()=>{posts++;return {url:'/?preview=preview-00000000-0000-0000-0000-000000000000'};},updateStatus(){},notify(){},
    node:()=>({}),panel:()=>({append(){},scrollIntoView(){}}),content:{},window:{open(){}}};
  const helpers=source.slice(source.indexOf('  async function building('),source.indexOf('  window.addEventListener'));
  const actions=source.slice(source.indexOf('  async function save()'),source.indexOf('  async function render()'));
  vm.runInNewContext(helpers+actions+'\nthis.previewAction=preview;',context);
  await assert.rejects(context.previewAction(),/服务器.*运行包/);
  assert.equal(posts,0);
});

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function tick(){return new Promise(resolve=>setImmediate(resolve));}
test('overlapping resource refreshes apply only the newest live view response',async()=>{
  const {document}=require('./helpers/admin-dom')();
  const state={sessionEpoch:0,section:'resources',resources:[]},pending=[deferred(),deferred(),deferred()];
  let reads=0;
  const context={state,document,window:{addEventListener(){}},api:()=>pending[reads++].promise};
  Object.assign(context,require('../admin-ui/modules/state').create(context));
  const {refreshResources}=require('../admin-ui/modules/resources').create(context);
  const first=refreshResources(),second=refreshResources();
  pending[1].resolve({resources:[{id:'newest'}]});await second;
  pending[0].resolve({resources:[{id:'old'}]});await first;
  assert.deepEqual(state.resources,[{id:'newest'}]);
  const beforeSession=refreshResources();state.sessionEpoch++;
  pending[2].resolve({resources:[{id:'private-old-session'}]});await beforeSession;
  assert.deepEqual(state.resources,[{id:'newest'}]);
});
test('first-run documentation uses the exact overview panel and action path',()=>{
  const fs=require('node:fs'),path=require('node:path');
  for(const name of ['README.md','DEPLOYMENT.md']) {
    const source=fs.readFileSync(path.join(__dirname,'..',name),'utf8');
    assert.match(source,/总览 → 运行包 → 添加内置个人主页模板 → 在下拉框选择 `portfolio-v1` → 保存草稿 → 预览草稿 → 发布网站/);
    assert.doesNotMatch(source,/引擎 \/ 运行包/);
  }
});
test('failed action restores trigger focus only within its live session and unchanged focus intent',async()=>{
  const source=adminSource();
  for(const scenario of ['recover','cancel','session','removed','disabled','moved','moved-back','pending-busy','not-focused']){
    const pending=deferred(),body={},listeners=new Set(),state={busy:false,sessionEpoch:0};
    const document={body,activeElement:null,addEventListener(type,fn){listeners.add(fn);},removeEventListener(type,fn){listeners.delete(fn);}};
    const b={disabled:false,dataset:{busyAction:'true'},isConnected:true,focus(){document.activeElement=this;},closest(){return null;}};
    document.activeElement=scenario==='not-focused'?body:b;
    const context={state,document,notify(){}};
    context.context=context;
    const run=require('node:vm').runInNewContext(source.slice(source.indexOf('  async function run('),source.indexOf('  async function api('))+'\nrun;',context);
    const request=run(()=>pending.promise,b);
    document.activeElement=body;
    assert.equal(b.disabled,true);
    if(scenario==='session')state.sessionEpoch++;
    if(scenario==='removed')b.isConnected=false;
    if(scenario==='disabled'||scenario==='pending-busy')state.busy=true;
    if(scenario.startsWith('moved')){
      const other={closest(){return null;}};document.activeElement=other;
      for(const fn of listeners)fn({target:other});
      if(scenario==='moved-back')document.activeElement=body;
    }
    if(scenario==='cancel')pending.resolve();else pending.reject(new Error('delayed failure'));await request;
    assert.equal(document.activeElement===b,scenario==='recover'||scenario==='cancel',scenario);
    assert.equal(b.disabled,scenario==='disabled'||scenario==='pending-busy',scenario);
    assert.equal(listeners.size,0,'focus observer cleaned');
  }
});
test('older overview runtime GET cannot replace a newer selection or redraw its old panel',async()=>{
  const source=adminSource(),vm=require('node:vm');
  const a='a'.repeat(64),b='b'.repeat(64),bundles=[a,b].map(digest=>({digest,profileId:'fixture',files:1,bytes:12,registeredAt:'2026-01-01T00:00:00Z'}));
  const pending=[deferred(),deferred(),deferred(),deferred()];let reads=0,selectionBody,choice;
  const elements=[];
  const node=(tag,text)=>({tag,textContent:text||'',children:[],dataset:{},isConnected:true,classList:{add(){}},append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},scrollIntoView(){},focus(){}});
  const state={config:{projects:[]},section:'overview',overview:{},storages:[],revision:8,dirty:true,busy:false,sessionEpoch:0,runtime:{selection:{digest:a,generation:1},bundles}};
  const content=node('main');
  const context={state,content,node,button:()=>node('button'),window:{},document:{querySelectorAll:()=>[]},saveStatus:null,runtimeRequestSequence:0,
    api:async(path,method,body)=>{if(path==='/overview')return {published:1,resources:0,defaultStorage:'local',masterKeyConfigured:true,audit:[]};if(path==='/runtime')return pending[reads++].promise;if(path==='/runtime/selection'){selectionBody=body;return {digest:body.digest,generation:body.generation+1};}throw Error(path);},
    heading(){},panel:(parent,title)=>{const p=node('section');p.title=title;parent.append(p);elements.push(p);return p;},
    field:(parent,label,value,onChange)=>{choice=onChange;return {dataset:{},disabled:false,focus(){}};},empty(){},warning(){},notify(){},run:async action=>{await action();}};
  const helpers=source.slice(source.indexOf('  function updateStatus()'),source.indexOf('  window.addEventListener'));
  const overview=source.slice(source.indexOf('  async function overviewView()'),source.indexOf('  function siteView('));
  context.context=context;
  vm.runInNewContext(helpers+overview+'\nthis.actions={overviewView,refreshRuntime};',context);
  const oldView=context.actions.overviewView();await tick();
  state.section='site';state.section='overview';
  const newView=context.actions.overviewView();await tick();
  pending[1].resolve({selection:{digest:a,generation:1},bundles});await newView;
  const oldPanel=elements[0],newPanel=elements.find(p=>p!==oldPanel&&p.title==='运行包');
  const oldChildren=oldPanel.children;
  choice(b);await tick();
  pending[2].resolve({selection:{digest:b,generation:2},bundles});await tick();
  assert.equal(state.runtime.selection.generation,2);
  pending[0].resolve({selection:{digest:null,generation:0},bundles});await oldView;
  assert.equal(state.runtime.selection.digest,b);
  assert.equal(state.runtime.selection.generation,2);
  assert.strictEqual(oldPanel.children,oldChildren);
  assert.match(newPanel.children.map(x=>x.textContent).join(' '),/当前：bbbbbbbbbbbb/);
  choice(a);await tick();
  assert.equal(selectionBody.generation,2);
  pending[3].resolve({selection:{digest:a,generation:3},bundles});await tick();
});
test('runtime GET begun before logout cannot enter the next session',async()=>{
  const source=adminSource(),vm=require('node:vm');
  const pending=deferred(),old='a'.repeat(64),state={sessionEpoch:0,config:{},runtime:{selection:{digest:old,generation:4},bundles:[]}};
  const helpers=source.slice(source.indexOf('  function validRevision('),source.indexOf('  window.addEventListener'));
  const context={state,runtimeRequestSequence:0,api:async()=>pending.promise};
  context.context=context;
  vm.runInNewContext(helpers+'\nthis.refresh=refreshRuntime;',context);
  const request=context.refresh();state.sessionEpoch++;state.config=null;
  pending.resolve({selection:{digest:null,generation:0},bundles:[]});await request;
  assert.equal(state.runtime.selection.digest,old);
  assert.equal(state.runtime.selection.generation,4);
});
test('failed or uncertain preview restores real busy controls while logout remains available',async()=>{
  const source=adminSource(),vm=require('node:vm');
  for(const outcome of ['reject','uncertain']){
  const pending=deferred(),controls=[],notices=[];let logoutClicks=0;
  const state={busy:false,dirty:false,revision:3,sessionEpoch:0,section:'site',runtime:{selection:{digest:'a'.repeat(64),generation:1}},config:{}};
  const node=(tag,text)=>({tag,textContent:text||'',dataset:{},listeners:{},disabled:false,addEventListener(event,fn){this.listeners[event]=fn;},replaceChildren(){},append(){}});
  const context={state,node,saveStatus:node('div'),document:{querySelectorAll:()=>controls},api:async()=>pending.promise,
    notify:(message,error)=>notices.push({message,error}),panel:()=>node('section'),content:node('main'),window:{open(){}}};
  const parts=[source.slice(source.indexOf('  function button('),source.indexOf('  function notify(')),source.slice(source.indexOf('  async function run('),source.indexOf('  async function api(')),source.slice(source.indexOf('  function updateStatus()'),source.indexOf('  window.addEventListener')),source.slice(source.indexOf('  async function save()'),source.indexOf('  async function render()'))];
  context.context=context;
  vm.runInNewContext(parts.join('\n')+'\nthis.makeButton=button;this.actions={preview,publish};',context);
  const preview=context.makeButton('预览',context.actions.preview,undefined,true),publish=context.makeButton('发布',context.actions.publish,undefined,true),logout=context.makeButton('退出',()=>{logoutClicks++;});
  controls.push(preview,publish);
  preview.listeners.click();await tick();
  assert.equal(state.busy,true,JSON.stringify(notices));assert.equal(preview.disabled,true);assert.equal(publish.disabled,true);assert.equal(logout.disabled,false);
  logout.listeners.click();await tick();assert.equal(logoutClicks,1);
  if(outcome==='reject')pending.reject(new Error('network uncertain'));
  else pending.resolve({url:'malformed-success'});
  await tick();
  assert.equal(state.busy,false);assert.equal(preview.disabled,false);assert.equal(publish.disabled,false);assert.equal(logout.disabled,false);
  assert.equal(notices.at(-1).error,true);
  assert.match(notices.at(-1).message,outcome==='reject'?/network uncertain/:/响应无效.*不要自动重试/);
  }
});
test('publish rechecks selection and busy state after pending confirmation',async()=>{
  const source=adminSource(),vm=require('node:vm');
  const helpers=source.slice(source.indexOf('  async function building('),source.indexOf('  window.addEventListener'));
  const actions=source.slice(source.indexOf('  async function save()'),source.indexOf('  async function render()'));
  for(const change of ['selection','busy']){
    const pending=deferred(),state={busy:false,dirty:false,revision:3,sessionEpoch:0,runtime:{selection:{digest:'a'.repeat(64),generation:1}},config:{}};
    let posts=0;
    const context={state,confirmAction:()=>pending.promise,api:async()=>{posts++;},updateStatus(){}};
    vm.runInNewContext(helpers+actions+'\nthis.publishAction=publish;',context);
    const request=context.publishAction();await tick();
    if(change==='selection')state.runtime.selection={digest:'b'.repeat(64),generation:2};else state.busy=true;
    pending.resolve(true);
    await assert.rejects(request,/运行包选择已变化|正在处理/);
    assert.equal(posts,0);
  }
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
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
  const source = fs.readFileSync(
    require.resolve("../admin-ui/admin.js"),
    "utf8",
  );
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
  const source = fs.readFileSync(
    require.resolve("../admin-ui/admin.js"),
    "utf8",
  );
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
  const source = fs.readFileSync(
    require.resolve("../admin-ui/admin.js"),
    "utf8",
  );
  assert.doesNotMatch(source, /\bconfirm\(/);
  assert.match(source, /function confirmAction\(/);
  assert.match(source, /aria-labelledby/);
  assert.match(source, /aria-describedby/);
  assert.match(source, /await confirmAction\(/);
  assert.match(source, /addEventListener\(["']cancel["']/);
});
test("multiline field never writes the read-only textarea type property", () => {
  const vm = require("node:vm");
  const source = fs.readFileSync(require.resolve("../admin-ui/admin.js"), "utf8");
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
  const source = fs.readFileSync(require.resolve("../admin-ui/admin.js"), "utf8");
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
  const source=fs.readFileSync(require.resolve('../admin-ui/admin.js'),'utf8');
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

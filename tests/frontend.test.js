const { test } = require("node:test");
const assert = require("node:assert/strict");
const authorizedRoot = process.env.AUTHORIZED_RUNTIME_ROOT;
if (authorizedRoot && authorizedRoot !== '/Users/jiandan/Code/MyCode/active-theory-v6') throw Error('Unauthorized runtime root');
const runtimeRoot = authorizedRoot || require("node:path").join(__dirname, "..");
const licensedRuntime = authorizedRoot ? 'app.1778129964370.js' : require("../admin-server/config").appFile(runtimeRoot);
const {applyAppPatch}=require('../admin-server/engine/legacy-adapter');
const completeConfig=(input={})=>{
  const {initialConfig,validateConfig}=require('../admin-server/config');
  const schema=initialConfig('/nonexistent');
  return validateConfig({...schema,site:{...schema.site,title:'Name',description:'',navWork:'',navContact:'',contactTitle:'',cityLax:'',cityNyc:'',cityAms:'',email:'',emailLink:'',labUrl:'',...input.site},projects:[],songs:input.songs||[]},schema);
};
const patchRuntime=(source,input)=>require('../admin-server/engine/legacy-adapter').patchAppSource(source,completeConfig(input)).source;
const single=(id,source,config)=>applyAppPatch(id,source,config).source;
const compose=(ids,source,config)=>ids.reduce((value,id)=>single(id,value,config),source);
const viewAnchor = '_this.bind("navigate", (path => _this.navigate(path))), document.title = "AGI旅行者· AGI Voyager", _this.bind("Work/project", (data => { document.title = data ? `${data.title} · Active Theory` : "AGI旅行者· AGI Voyager" }));';
const runtimeTest = (name, fn) => test(`authorized runtime: ${name}`, {
  skip: !licensedRuntime && "Authorized original runtime bundle absent; engine compatibility is not verified",
}, fn);
const runtimeSource = () => require("node:fs").readFileSync(
  require("node:path").join(runtimeRoot, "assets/js", licensedRuntime), "utf8");
function runtimeClass(source, name) {
  const start = source.indexOf(`Class((function ${name}(`);
  assert(start >= 0, `Missing original ${name} source anchor`);
  const end = source.indexOf("Class((function ", start + 20);
  return source.slice(start, end < 0 ? source.length : end);
}
runtimeTest('ViewController metadata hook replaces both legacy title writers',()=>{
  const patched=patchRuntime(runtimeSource(),{site:{title:'Name'},songs:[]});
  const view=runtimeClass(patched,'ViewController');
  assert.match(view,/__SITE_UPDATE_IDENTITY__/);
  assert.doesNotMatch(view,/document\.title\s*=/);
  assert.doesNotMatch(view,/data\.title\} · Active Theory/);
});
test('ViewController incompatible or duplicate navigation anchors fail closed',()=>{
  for(const body of ['document.title="old";',viewAnchor+viewAnchor]) assert.throws(()=>single('view.identity','Class((function ViewController(){'+body+'}));',{site:{},songs:[]}),error=>error.status===422);
});
runtimeTest("ContactUI empty and one-character text are safe and zero-width layout completes", async () => {
  const source = patchRuntime(runtimeSource(), { site: {}, songs: [] });
  const code = runtimeClass(source, "ContactUI");
  const helper = code.slice(code.indexOf("function replaceRandomLetters"), code.indexOf(" _this.element &&"));
  const replace = new Function(`${helper};return replaceRandomLetters;`)();
  assert.equal(replace("", 10), "");
  assert.equal(replace("A", 10), "A");
  assert.equal(replace("Contact", 0), "Contact");
  for (const mobile of [false, true]) {
    let loads = 0;
    const nodes = {};
    const self = new Proxy({ wait: async (fn) => assert(fn(), "layout must not await a truthy zero width") }, {
      get(target, key) { return target[key] ?? (nodes[key] ??= { width: 10, height: 10, dimensions: { width: 0, height: 0 }, loaded: async () => { loads++; } }); },
    });
    const layout = code.slice(code.indexOf("async function updateLayout"), code.indexOf("function replaceRandomLetters"));
    const math = Object.create(Math); math.range = (v, a, b, c, d) => c + (v - a) * (d - c) / (b - a);
    await new Function("_this", "Device", "Stage", "Math", `${layout};return updateLayout();`)(self, { mobile }, { width: mobile ? 400 : 1400, height: 900 }, math);
    assert(loads >= 4);
    for (const node of Object.values(nodes)) for (const key of ["x", "y", "width", "height"]) if (key in node) assert(Number.isFinite(node[key]));
  }
});
runtimeTest("ContactUI absent configured links and personal accessibility text are not retained", () => {
  const code = runtimeClass(patchRuntime(runtimeSource(), { site: {}, songs: [] }), "ContactUI");
  assert(!code.includes('mailto:'));
  assert(!code.includes("drawbookai.cn"));
  assert(!code.includes('"Los Angeles"'));
  const links = code.slice(code.indexOf('_this.email.interact'), code.indexOf('_this.bind("ViewController/contact"'));
  assert.equal(links, "", "absent targets must not register interactive links");
});
runtimeTest("ContactUI without external destination does not instantiate personal QR or advertise its controls", () => {
  const patch = patchRuntime;
  const empty = runtimeClass(patch(runtimeSource(), { site: {}, songs: [] }), "ContactUI");
  assert(!empty.includes("_this.initClass(MobileSync)"), "no source-domain QR or multiplayer session on an empty contact page");
  for (const label of ["JION US", "ABOUT US", "[ wechat ]", "Newsletter Signup", "Careers"])
    assert(!empty.includes(label), `empty contact retains ${label}`);
  const filled = runtimeClass(patch(runtimeSource(), { site: { labUrl: "https://example.test", emailLink: "person@example.test" } }), "ContactUI");
  assert(filled.includes("_this.initClass(MobileSync)"));
  assert(filled.includes('mailto:person@example.test'));
  assert(filled.includes("JION US"));
});
runtimeTest("CMS workItems uses real zero/one/many StateArrays through actual Model protocol", async () => {
  const source = patchRuntime(runtimeSource(), { site: {}, songs: [] });
  const model = runtimeClass(source, "Model");
  const method = model.slice(model.indexOf("this.makeRequest ="), model.indexOf(", this.request ="));
  const cms = runtimeClass(source, "CMSData");
  const handler = cms.slice(cms.indexOf('Data.handleRequest("workItems"'), cms.indexOf(', _this.flag("isReady"'));
  class StateArray extends Array {}
  for (const records of [[], [{ id: "a" }], [{ id: "b" }, { id: "a" }]]) {
    const pages = new StateArray(...records), requests = {}, target = {};
    new Function("Data", "_workPages", "StateArray", handler)({ handleRequest: (key, fn) => requests[key] = fn }, pages, StateArray);
    new Function("_requests", "StateArray", method).call(target, requests, StateArray);
    assert.equal(await target.makeRequest("workItems", {}, () => [{ id: "sample" }]), pages);
    assert.deepEqual([...pages], records);
  }
});
runtimeTest("Text3D initializes empty content through the real text creation path", () => {
  const source = patchRuntime(runtimeSource(), { site: {}, songs: [] });
  const code = runtimeClass(source, "Text3D");
  const init = code.slice(code.indexOf("function initText()"), code.indexOf("async function overrideLocalize"));
  for (const text of ["", "Hello"]) {
    const calls = [];
    new Function("_config", "Text3D", "parseData", "createText", `let _fontObject;${init};initText();`)({ get: (k) => k === "data" ? '{"size":12}' : text }, {}, (v) => v, (...args) => calls.push(args));
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], text);
  }
});
runtimeTest("actual text worker produces finite zero bounds and no glyphs for empty content", () => {
  const vm = require("node:vm");
  const source = patchRuntime(runtimeSource(), { site: {}, songs: [] });
  const code = runtimeClass(source, "GLTextThread").replace(/,\s*$/, ";");
  const context = { result: null, window: { zUtils3D: true }, Thread: { upload(fn) { context.generate = fn; } }, Class(fn) { new fn(); }, resolve: (buffers) => { context.result = buffers; }, GeometryAttribute: function(array) { this.array = array; }, Geometry: class {
    addAttribute(key, value) { this[key] = value; }
    computeBoundingBox() { this.boundingBox = { min: { x: Infinity, y: Infinity, z: Infinity, set(x,y,z) { Object.assign(this,{x,y,z}); } }, max: { x: -Infinity, y: -Infinity, z: -Infinity, set(x,y,z) { Object.assign(this,{x,y,z}); } } }; }
    computeBoundingSphere() { this.boundingSphere = { center: { x: NaN, y: NaN, z: NaN, set(x,y,z) { Object.assign(this,{x,y,z}); } }, radius: NaN }; }
  } };
  vm.runInNewContext('Array.prototype.last=function(){return this[this.length-1]};' + code, context);
  context.generate({ text: "", size: 12, json: { common: { base: 12, scaleW: 256, scaleH: 256 }, kernings: [] }, glyphs: {}, config: {} }, 1);
  assert.equal(context.result.position.length, 0);
  assert.equal(context.result.index.length, 0);
  assert.equal(context.result.lineLength, 0);
  for (const value of [context.result.boundingBox.min.x, context.result.boundingBox.max.x, context.result.boundingSphere.center.x, context.result.boundingSphere.radius]) assert.equal(value, 0);
});
runtimeTest("GLText clears existing geometry and string on nonempty to empty update", async () => {
  const source = patchRuntime(runtimeSource(), { site: {}, songs: [] });
  const code = runtimeClass(source, "GLText").replace(/,\s*$/, ";");
  let Type;
  const create = () => { let resolve; const p = new Promise(r => resolve = r); p.resolve = resolve; return p; };
  const P = { create };
  const buffers = (text) => ({ position: new Float32Array(text.length * 12), uv: new Float32Array(0), local: new Float32Array(0), animation: new Float32Array(0), weight: new Float32Array(0), index: new Uint16Array(text.length * 6), boundingBox: {}, boundingSphere: {}, letterCount: text.length, wordCount: -1, lineCount: -1 });
  function Geometry() { this.attributes = {}; this.addAttribute = (k,v) => this.attributes[k] = v; this.setIndex = (v) => this.index = v; }
  function Attribute(array) { this.array = array; this.setArray = (next) => this.array = next; }
  function TextGeometry({ text }) { this.loaded = Promise.resolve({ buffers: buffers(text), height: 0 }); }
  new Function("Class", "Promise", "GLTextGeometry", "Geometry", "GeometryAttribute", "Color", "Shader", "Mesh", "Utils3D", "Utils", "document", code)(fn => { Type = fn; Type.FONT_CONFIG = {}; }, P, TextGeometry, Geometry, Attribute, function(){}, function(){}, function(g,s){this.geometry=g;this.shader=s;}, { getEmptyTexture(){} }, { uuid: () => "test" }, { getElementById: () => null });
  const text = new Type({ font: "test", text: "Hello" });
  await text.ready();
  await text.setText("");
  assert.equal(text.string, "");
  assert.equal(text.geometry.attributes.position.array.length, 0);
  await text.setText("A");
  assert.equal(text.string, "A");
});
test("snapshot mapping handles encoded paths and queries only in resource fields", () => {
  const {
    mapResourceURL,
    publicSnapshot,
  } = require("../admin-server/snapshots");
  const snapshot = {
    config: {
      site: { labUrl: "https://outside.test/page" },
      projects: [],
      scenes: [],
      songs: [{ title: "Song", src: "assets/music/A%20B.mp3?q=2" }],
    },
    assets: { audio: { resourceId: "r", fileName: "A%20B.mp3" } },
    legacyMap: { "assets/music/A B.mp3": "audio" },
  };
  assert.equal(
    mapResourceURL(snapshot, 7, "assets/music/A%20B.mp3?q=2"),
    "/api/site/7/resources/r/A%2520B.mp3?q=2",
  );
  assert.equal(
    publicSnapshot(snapshot, 7).site.labUrl,
    "https://outside.test/page",
  );
  snapshot.template = { baseUIL: {} };
  assert(
    require("../admin-server/snapshots")
      .collectReferences(snapshot)
      .some((r) => r.resourceId === "r"),
    "encoded query aliases must authorize the same resource",
  );
  snapshot.assets.pic = { resourceId: "pic", fileName: "pic.png" };
  snapshot.legacyMap["assets/pic.png"] = "pic";
  assert.equal(
    mapResourceURL(snapshot, 7, "assets/pic.png?123-compressedKtx2"),
    "/api/site/7/resources/pic/pic.png?123",
    "an immutable PNG resource must not be inferred as KTX bytes",
  );
});
test("inactive UIL layers stay inventoried but do not authorize or block publication", async (t) => {
  const { inventoryResources } = require("../admin-server/resource-catalog");
  const { collectReferences } = require("../admin-server/snapshots");
  const { contentFixture } = require("./helpers/content");
  const { root } = contentFixture(t);
  const key = "INPUT_Config_0_CleanRoom_geometry";
  const template = {
    baseUIL: {
      [key]: { src: "assets/geometry/missing.bin" },
      sl_CleanRoom_0_deleted: true,
    },
    readiness: {},
  };
  const config = {
    projects: [],
    songs: [],
    scenes: [
      {
        id: "CleanRoom",
        fields: [
          { key, type: "geometry", value: "assets/geometry/missing.bin" },
        ],
      },
    ],
  };
  const catalog = await inventoryResources({
    root,
    config,
    template,
    manifest: { assets: [] },
  });
  assert.equal(catalog.report.missingRequired.length, 0);
  assert(catalog.resources.some((r) => r.status === "missing"));
  assert.deepEqual(collectReferences({ config, template, ...catalog }), []);
  template.baseUIL.sl_CleanRoom_0_deleted = false;
  template.baseUIL.sl_CleanRoom_0_visible = false;
  assert(
    (
      await inventoryResources({
        root,
        config,
        template,
        manifest: { assets: [] },
      })
    ).report.missingRequired.length > 0,
    "visibility does not imply inactive",
  );
});
test("bridge maps media at actual loader entry and preserves Request headers and XHR arguments", async () => {
  const vm = require("node:vm");
  const { bridgeSource } = require("../admin-server/frontend");
  const snapshot = {
    template: { baseUIL: { picture: { src: "assets/images/pic.png" } } },
    config: { site: { title: "T" }, songs: [], scenes: [], projects: [] },
    assets: { pic: { resourceId: "pic", fileName: "pic.png" } },
    legacyMap: { "assets/images/pic.png": "pic" },
  };
  const calls = [];
  const xhr = [];
  const context = {
    URL,
    Request,
    location: { href: "http://site.test/work/foo", origin: "http://site.test" },
    document: {},
    XMLHttpRequest: function () {},
    window: { fetch: (...args) => calls.push(args) },
  };
  context.XMLHttpRequest.prototype.open = (...args) => xhr.push(args);
  vm.runInNewContext(bridgeSource(9, snapshot.config, snapshot, 'http://site.test', require('../admin-server/snapshots').collectReferences(snapshot), {}), context);
  const request = new Request("http://site.test/assets/images/pic.png", {
    headers: { "x-test": "yes" },
  });
  context.window.fetch(request, { cache: "no-store" });
  assert.equal(calls[0][0].headers.get("x-test"), "yes");
  assert.equal(
    calls[0][0].url,
    "http://site.test/api/site/9/resources/pic/pic.png",
  );
  new context.XMLHttpRequest().open(
    "GET",
    "assets/images/pic.png",
    false,
    "u",
    "p",
  );
  assert.deepEqual(xhr[0], [
    "GET",
    "/api/site/9/resources/pic/pic.png",
    false,
    "u",
    "p",
  ]);
  assert.equal(
    context.window.__SITE_RESOURCE_URL__(
      "https://outside.test/cms/projects-dev.json",
    ),
    "https://outside.test/cms/projects-dev.json",
  );
  const source =
    "this.getPath = function (path) { return path; }; this.absolutePath = function (path) {return path;};";
  const target = {};
  new Function(
    "window",
    "location",
    compose(['assets.get-path','hydra.absolute-path'],source,snapshot.config),
  ).call(target, context.window, context.location);
  assert.equal(
    target.getPath("assets/images/pic.png"),
    "/api/site/9/resources/pic/pic.png",
  );
  assert.equal(
    target.absolutePath("assets/images/pic.png"),
    "http://site.test/api/site/9/resources/pic/pic.png",
  );
});
test("bridge and snapshot mappings distinguish exact external queries without rewriting unknown navigation", async (t) => {
  const urls = [
    "https://cdn.example.test/song.mp3?revision=1&sig=a%2Fb+z",
    "https://cdn.example.test/song.mp3?sig=b%2fc%20d&revision=2",
  ];
  const snapshot = {
    template: { baseUIL: {} },
    config: {
      site: { title: "T" },
      songs: urls.map((src) => ({ src })),
      scenes: [],
      projects: [],
    },
    assets: Object.fromEntries(
      urls.map((url, i) => [
        `song${i}`,
        { resourceId: `song${i}`, url, fileName: "song.mp3" },
      ]),
    ),
    legacyMap: Object.fromEntries(urls.map((url, i) => [url, `song${i}`])),
  };
  const {
    mapResourceURL,
    collectReferences,
  } = require("../admin-server/snapshots");
  const context = {
    URL,
    Request,
    location: { origin: "http://site.test" },
    document: {},
    window: { fetch() {} },
    XMLHttpRequest: function () {},
  };
  context.XMLHttpRequest.prototype.open = function () {};
  require("node:vm").runInNewContext(
    require("../admin-server/frontend").bridgeSource(
      9,
      snapshot.config,
      snapshot,
      'http://site.test',
      collectReferences(snapshot),
      {},
    ),
    context,
  );
  urls.forEach((url, i) => {
    assert.match(
      mapResourceURL(snapshot, 9, url),
      new RegExp(`/resources/song${i}/`),
    );
    assert.equal(
      context.window.__SITE_RESOURCE_URL__(url),
      mapResourceURL(snapshot, 9, url),
    );
  });
  assert.deepEqual(
    [...new Set(collectReferences(snapshot).map((r) => r.resourceId))].sort(),
    ["song0", "song1"],
  );
  const unknown = "https://cdn.example.test/song.mp3?revision=3";
  assert.equal(mapResourceURL(snapshot, 9, unknown), unknown);
  assert.equal(context.window.__SITE_RESOURCE_URL__(unknown), unknown);
  const { root } = require("./helpers/content").contentFixture(t);
  const catalog =
    await require("../admin-server/resource-catalog").inventoryResources({
      root,
      dataDir: require("node:path").join(root, "data"),
      config: snapshot.config,
      template: snapshot.template,
      manifest: { assets: [] },
    });
  const imported = { ...snapshot, ...catalog };
  const ids = urls.map(
    (url) =>
      require("../admin-server/snapshots").resourceAsset(imported, url)
        .resourceId,
  );
  assert.notEqual(ids[0], ids[1]);
  assert.deepEqual(
    [...new Set(collectReferences(imported).map((r) => r.resourceId))].sort(),
    ids.sort(),
  );
});
test("geometry and instance loader preserve already-versioned URLs before Worker dispatch", () => {
  const source =
    'Class((function GeomThread(){function load(path){path.includes("assets/geometry/") || (path = "assets/geometry/" + path); path.includes("assets/geometry/"); return path;}this.load=load;}));Class((function InstanceMesh(){this.load=function(file){file.includes("assets/geometry") || (file = `assets/geometry/${file}`);return file;};}));';
  const classes = {};
  new Function("Class", compose(['geometry.version-path','instance.version-path'],source,{site:{},songs:[]}))(
    (fn) => (classes[fn.name] = fn),
  );
  const url = "/api/site/3/resources/model/model.bin";
  assert.equal(new classes.GeomThread().load(url), url);
  assert.equal(new classes.InstanceMesh().load(url), url);
});
test("particle point-cloud loader preserves version URLs before worker dispatch", () => {
  const source =
    'Class((function ParticleDistributor(){this.path=function(path){path.includes("assets/geometry") || (path = "assets/geometry/" + path);return path;};}));';
  let Type;
  new Function("Class", single('particles.version-path',source,{site:{},songs:[]}))(
    (fn) => (Type = fn),
  );
  assert.equal(
    new Type().path("/api/site/1/resources/cloud/cloud.bin"),
    "/api/site/1/resources/cloud/cloud.bin",
  );
});
test("engine manifest declares runtime particle variants and actual network loader boundaries", () => {
  const manifest = require("../admin-server/engine-assets.json");
  for (const file of [
    "flower_spine-512.bin",
    "forest-1024.bin",
    "tree-256.bin",
  ])
    assert(
      manifest.assets.some(
        (a) => a.url === "assets/geometry/particles/" + file && a.required,
      ),
    );
  for (const entry of [
    "imageTexture",
    "videoAudio",
    "fontJSON",
    "fontAtlas",
    "geometryWorker",
    "pointCloudWorker",
    "programs",
  ])
    assert(manifest.loaderEntries[entry]);
});
test("unchanged empty UIL src preserves the active dotted relative geometry reference", () => {
  const { collectReferences } = require("../admin-server/snapshots");
  const key = "INPUT_Config_15_TreeScene_geometry";
  const snapshot = {
    template: {
      baseUIL: { [key]: { src: "", relative: "tree_room/rock.bin" } },
    },
    config: {
      projects: [],
      songs: [],
      scenes: [{ fields: [{ key, type: "geometry", value: "" }] }],
    },
    assets: {
      rock: {
        resourceId: "rock",
        fileName: "rock.bin",
        url: "tree_room/rock.bin",
      },
    },
    legacyMap: { "tree_room/rock.bin": "rock" },
  };
  assert(collectReferences(snapshot).some((r) => r.resourceId === "rock"));
});
test("worker root-relative geometry paths keep one slash and the actual origin", () => {
  const source = 'this.absolutePath = function (path) { return "old/"+path; };';
  const patched = single('hydra.absolute-path',source,{site:{},songs:[]});
  const target = {};
  new Function("location", patched).call(target, {
    origin: "http://localhost:3001",
  });
  assert.equal(
    target.absolutePath("/assets/geometry/admin/id.bin"),
    "http://localhost:3001/assets/geometry/admin/id.bin",
  );
});
test("versioned bridge rewrites CMS and shader requests without embedding secrets", () => {
  const { bridgeSource } = require("../admin-server/frontend");
  const config = {
    site: { title: "My site", navWork: "作品", navContact: "联系" },
    songs: [],
  };
  const script = bridgeSource(7, config, undefined, 'http://site.test');
  assert.match(script, /api\/site\/7/);
  assert.doesNotThrow(() => new Function(script));
  const source =
    'Class((function ViewController(){'+viewAnchor+'})), Class((function Main(){}));';
  assert.match(single('view.identity',source,config), /__SITE_UPDATE_IDENTITY__/);
});
test("converted models use engine-compatible geometry aliases", () => {
  const { buildUIL } = require("../admin-server/config");
  const result = buildUIL({
    template: { baseUIL: {} },
    config: {
      scenes: [
        {
          id: "Home",
          fields: [{ key: "logo", type: "geometry", value: "/models/abc.bin" }],
        },
      ],
    },
  });
  assert.equal(result.logo.src, "/assets/geometry/admin/abc.bin");
});
test("patches preserve dollar replacement characters and empty music lists", () => {
  const config = {
    site: {
      title: "$& title",
      navWork: "$& work",
      navContact: "Contact",
      email: "$& email",
    },
    songs: [],
  };
  const source =
    'Class((function ViewController(){'+viewAnchor+'}));Class((function NavUI(){let x={text: "Work", _type: 1};}));Class((function ContactUI(){let x={_innerText: "old", refName: "email"};})); let SONGS = [{title:"old",src:"x"}];';
  const patched = compose(['view.identity','nav.work','contact.email.inner-text','songs.list'],source,config);
  assert.match(patched,/__SITE_UPDATE_IDENTITY__/);
  assert.equal(require('../shared/site-identity').pageMetadata(config,'http://site.test','/').title,'$& title');
  assert(patched.includes('"$& work"'));
  assert(patched.includes('"$& email"'));
  assert(patched.includes("let SONGS = [];"));
  assert.doesNotThrow(() => new Function(patched));
});

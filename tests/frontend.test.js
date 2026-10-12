const { test } = require("node:test");
const assert = require("node:assert/strict");
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
  const { bridgeSource, patchAppSource } = require("../admin-server/frontend");
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
  vm.runInNewContext(bridgeSource(9, snapshot.config, snapshot), context);
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
    patchAppSource(source, snapshot.config),
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
  const { patchAppSource } = require("../admin-server/frontend");
  const source =
    'Class((function GeomThread(){function load(path){path.includes("assets/geometry/") || (path = "assets/geometry/" + path);return path;}this.load=load;}));Class((function InstanceMesh(){this.load=function(file){file.includes("assets/geometry") || (file = `assets/geometry/${file}`);return file;};}));';
  const classes = {};
  new Function("Class", patchAppSource(source, { site: {}, songs: [] }))(
    (fn) => (classes[fn.name] = fn),
  );
  const url = "/api/site/3/resources/model/model.bin";
  assert.equal(new classes.GeomThread().load(url), url);
  assert.equal(new classes.InstanceMesh().load(url), url);
});
test("particle point-cloud loader preserves version URLs before worker dispatch", () => {
  const { patchAppSource } = require("../admin-server/frontend");
  const source =
    'Class((function ParticleDistributor(){this.path=function(path){path.includes("assets/geometry") || (path = "assets/geometry/" + path);return path;};}));';
  let Type;
  new Function("Class", patchAppSource(source, { site: {}, songs: [] }))(
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
  const { patchAppSource } = require("../admin-server/frontend");
  const source = 'this.absolutePath = function (path) { return "old/"+path; };';
  const patched = patchAppSource(source, { site: {}, songs: [] });
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
  const { bridgeSource, patchAppSource } = require("../admin-server/frontend");
  const config = {
    site: { title: "My site", navWork: "作品", navContact: "联系" },
    songs: [],
  };
  const script = bridgeSource(7, config);
  assert.match(script, /api\/site\/7/);
  assert.doesNotThrow(() => new Function(script));
  const source =
    'Class((function ViewController(){ document.title = "AGI旅行者· AGI Voyager"; })), Class((function Main(){}));';
  assert.match(patchAppSource(source, config), /My site/);
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
  const { patchAppSource } = require("../admin-server/frontend");
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
    'Class((function ViewController(){ document.title = "AGI旅行者· AGI Voyager"; }));Class((function NavUI(){let x={text: "Work", _type: 1};}));Class((function ContactUI(){let x={_innerText: "old", refName: "email"};})); let SONGS = [{title:"old",src:"x"}];';
  const patched = patchAppSource(source, config);
  assert(patched.includes('"$& title"'));
  assert(patched.includes('"$& work"'));
  assert(patched.includes('"$& email"'));
  assert(patched.includes("let SONGS = [];"));
  assert.doesNotThrow(() => new Function(patched));
});

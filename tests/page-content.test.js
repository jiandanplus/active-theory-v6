const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { validateConfig } = require("../shared/content-contract");
const { normalizeConfig } = require("../shared/site-identity");
const schema = () =>
  normalizeConfig({
    site: { title: "Fixture", labUrl: "" },
    projects: [],
    songs: [],
    scenes: [
      {
        id: "Home",
        label: "Home",
        fields: [
          { key: "fixed", label: "Fixed", type: "number", value: 2 },
          { key: "copy", label: "Copy", type: "text", value: "Original" },
          {
            key: "INPUT_Config_8_ParticleTest_geometry",
            label: "Logo",
            type: "geometry",
            value: "assets/geometry/logo.bin",
          },
          {
            key: "internal",
            label: "Internal",
            type: "geometry",
            value: "assets/geometry/internal.bin",
          },
        ],
      },
    ],
  });
const policyFile = path.join(__dirname, "../shared/page-content.js");

test("page policy exposes the stable field registry in Node and browser without mutating defaults", () => {
  assert(fs.existsSync(policyFile), "shared page policy must exist");
  const policy = require(policyFile),
    browser = { structuredClone };
  vm.runInNewContext(fs.readFileSync(policyFile, "utf8"), browser);
  for (const api of [policy, browser.SitePageContent]) {
    assert.equal(api.MEDIA_FIELDS.heroVideo.kind, "video");
    assert.equal(api.MEDIA_FIELDS.heroVideo.default, "assets/video/reel.mp4");
    assert.equal(
      api.MEDIA_FIELDS.heroPoster.default,
      "assets/video/reel-frame.jpg",
    );
    assert.equal(
      api.MEDIA_FIELDS.labBackground.default,
      "assets/images/lab.gif",
    );
    assert.equal(api.PAGE_KEYS.length, 20);
    assert(Object.isFrozen(api.MEDIA_FIELDS));
    assert(Object.isFrozen(api.MEDIA_FIELDS.heroVideo));
    assert(Object.isFrozen(api.PAGE_KEYS));
  }
});

test("recognized optional page fields are accepted with old schemas, omitted with new schemas, and never materialized", () => {
  const old = schema(),
    next = structuredClone(old);
  Object.assign(next.site, {
    heroVideo: "https://media.example.test/reel.mp4",
    heroPoster: "/media/poster",
    contactHomeText: "Home",
    contactHomeURL: "https://example.test",
    contactQrImage: "",
  });
  const before = JSON.stringify(old);
  assert.equal(validateConfig(next, old), next);
  assert.doesNotThrow(() => validateConfig(old, next));
  assert.equal(JSON.stringify(old), before);
  assert(!Object.hasOwn(old.site, "heroVideo"));
  assert.throws(
    () =>
      validateConfig(
        { ...next, site: { ...next.site, unsupported: "x" } },
        old,
      ),
    { status: 400 },
  );
  const missing = structuredClone(next);
  delete missing.site.title;
  assert.throws(() => validateConfig(missing, old), { status: 400 });
});

test("all page fields reject unsafe links, media paths, non-strings and HTML", () => {
  const base = schema();
  for (const [key, values] of Object.entries({
    contactHomeURL: [
      "http://example.test",
      "javascript:alert(1)",
      "assets/local",
      "https://user:pass@example.test",
      " https://example.test",
      null,
    ],
    heroVideo: [
      "javascript:alert(1)",
      "../private",
      "assets/%2e%2e/private",
      "assets/a%2fb.png",
      null,
    ],
    contactQrText: ["<img src=x>", null],
    labUrl: ["assets/file", "http://example.test"],
  }))
    for (const value of values) {
      const config = structuredClone(base);
      config.site[key] = value;
      assert.throws(
        () => validateConfig(config, base),
        { status: 400 },
        `${key}: ${value}`,
      );
    }
});

test("locked schema copies only current fixed values and preserves inputs and editable originals", () => {
  assert(fs.existsSync(policyFile), "shared page policy must exist");
  const { lockSchema, isEditableSceneField } = require(policyFile);
  const base = schema(),
    current = structuredClone(base);
  current.scenes[0].fields[0].value = 20;
  current.scenes[0].fields[1].value = "Changed";
  const before = JSON.stringify([base, current]),
    locked = lockSchema(base, current);
  assert.equal(locked.scenes[0].fields[0].value, 20);
  assert.equal(locked.scenes[0].fields[1].value, "Original");
  assert.equal(JSON.stringify([base, current]), before);
  assert.equal(
    isEditableSceneField(base.scenes[0], base.scenes[0].fields[2]),
    true,
  );
  assert.equal(
    isEditableSceneField({ id: "Other" }, base.scenes[0].fields[2]),
    false,
  );
  assert.equal(
    isEditableSceneField(base.scenes[0], base.scenes[0].fields[3]),
    false,
  );
  assert.doesNotThrow(
    () => validateConfig(current, locked),
    "previously saved fixed numbers retain any old range",
  );
  const tampered = structuredClone(current);
  tampered.scenes[0].fields[0].value = 1;
  assert.throws(() => validateConfig(tampered, locked), { status: 400 });
  const internal = structuredClone(current);
  internal.scenes[0].fields[3].value = "assets/geometry/other.bin";
  assert.throws(() => validateConfig(internal, locked), { status: 400 });
  const editable = structuredClone(current);
  editable.scenes[0].fields[2].value = "/media/custom-model";
  assert.doesNotThrow(() => validateConfig(editable, locked));
});

test("resource policy hides bundled internals but keeps defaults, current business resources and the original top Logo", () => {
  assert(fs.existsSync(policyFile), "shared page policy must exist");
  const { isSystemResource } = require(policyFile),
    config = schema();
  config.site.heroPoster = "/media/poster";
  config.projects = [
    {
      video: { url: "/media/video", thumbnail: "assets/images/thumb.png" },
      projectLogo: { url: "/media/project-logo" },
    },
  ];
  config.songs = [{ src: "/media/song" }];
  const resource = (url, extra = {}) => ({ source: "bundled", url, ...extra });
  for (const url of [
    "assets/images/pbr/road.png",
    "assets/fonts/font.png",
    "assets/geometry/internal.bin",
  ])
    assert.equal(isSystemResource(resource(url), config), true, url);
  for (const url of [
    "assets/video/reel.mp4",
    "/assets/video/reel-frame.jpg",
    "assets/images/lab.gif",
    "assets/images/ui/ig.png",
    "assets/geometry/logo.bin",
    "assets/images/thumb.png",
  ])
    assert.equal(isSystemResource(resource(url), config), false, url);
  for (const id of ["poster", "video", "project-logo", "song"])
    assert.equal(
      isSystemResource(resource("assets/original/" + id, { id }), config),
      false,
      id,
    );
  assert.equal(
    isSystemResource(
      resource("assets/custom.png", { source: "local" }),
      config,
    ),
    false,
  );
  config.scenes[0].fields[2].value = "/media/new-logo";
  assert.equal(
    isSystemResource(resource("assets/geometry/logo/AT_logo.bin"), config),
    false,
    "original top Logo remains selectable after replacement",
  );
});

test("browser content contract uses the same page-field and locked-scene policy", () => {
  assert(fs.existsSync(policyFile), "shared page policy must exist");
  const browser = { structuredClone, URL };
  for (const file of [
    "site-identity.js",
    "page-content.js",
    "content-contract.js",
  ])
    vm.runInNewContext(
      fs.readFileSync(path.join(__dirname, "../shared", file), "utf8"),
      browser,
    );
  const base = schema(),
    next = structuredClone(base);
  next.site.contactXURL = "https://example.test";
  assert.doesNotThrow(() =>
    browser.SiteContentContract.validateConfig(next, base),
  );
  next.scenes[0].fields[0].value = 3;
  assert.throws(
    () => browser.SiteContentContract.validateConfig(next, base),
    (error) => error.status === 400,
  );
});

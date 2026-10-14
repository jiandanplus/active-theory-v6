const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { httpFixture } = require("./helpers/http");
const { contentRepository } = require("../admin-server/repositories/content");
test("uninstalled public pages explain installation while API remains JSON", async (t) => {
  const f = await httpFixture(t, { installed: false });
  for (const url of ["/", "/work", "/work/one"]) {
    const response = await f.request(url);
    assert.equal(response.status, 503);
    assert.match(response.headers.get("content-type"), /text\/html/);
    assert.match(await response.text(), /\/admin/);
  }
  const api = await f.request("/api/site/42/config");
  assert.equal(api.status, 503);
  assert.match(api.headers.get("content-type"), /json/);
});
test("database outage on public page is maintenance not a new installation", async (t) => {
  const f = await httpFixture(t);
  await f.store.query(
    "ALTER TABLE personal_site.installation RENAME TO unavailable_installation",
  );
  const response = await f.request("/");
  assert.equal(response.status, 503);
  assert.match(response.headers.get("content-type"), /html/);
  const html = await response.text();
  assert.match(html, /暂时不可用/);
  assert.doesNotMatch(html, /尚未|site_test_|postgresql/);
});

test("after closing the old pool and restarting the published UIL needs no source JSON", async (t) => {
  const f = await httpFixture(t);
  const oldStore = f.store;
  const before = await (await f.request("/api/site/42/uil.json")).json();
  fs.renameSync(
    path.join(f.root, "assets/data"),
    path.join(f.root, "retired-data"),
  );
  fs.renameSync(path.join(f.root, "cms"), path.join(f.root, "retired-cms"));
  await f.restart();
  assert.notEqual(
    f.store,
    oldStore,
    "restart creates a new store and PostgreSQL pool",
  );
  await assert.rejects(oldStore.query("SELECT 1"), /end|closed/i);
  const response = await f.request("/api/site/42/uil.json");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), before);
  assert.match(before.font.src, /^\/api\/site\/42\/resources\/font\//);
  assert.deepEqual(
    await (await f.request("/api/site/42/contact.json")).json(),
    f.bundle.draft.template.contact,
  );
  assert.deepEqual(
    await (await f.request("/api/site/42/metadata.json")).json(),
    f.bundle.draft.template.metadata,
  );
});

test("version resource endpoints authorize snapshot references not filenames or draft inventory", async (t) => {
  const f = await httpFixture(t);
  await f.store.query(
    "UPDATE personal_site.resources SET details=details || $1::jsonb WHERE id='image'",
    [JSON.stringify({ path: "assets/images/image.png" })],
  );
  const config = await (await f.request("/api/site/42/config")).json();
  assert.equal(
    config.projects[0].video.url,
    "/api/site/42/resources/image/image.png",
  );
  const image = await f.request(config.projects[0].video.url + "?cache=1");
  assert.equal(image.status, 200);
  assert.match(image.headers.get("content-type"), /image\/png/);
  assert.equal(
    (await image.arrayBuffer()).byteLength,
    fs.statSync(path.join(f.root, "assets/images/image.png")).size,
  );
  assert.equal(
    (await f.request("/api/site/42/resources/image/ignored.txt")).status,
    200,
  );
  assert.equal(
    (await f.request("/api/site/42/resources/unused/unused.png")).status,
    404,
  );
  assert.equal((await f.request("/api/site/draft/config")).status, 404);
  fs.writeFileSync(
    path.join(f.root, "assets/images/unregistered.png"),
    "private",
  );
  fs.writeFileSync(path.join(f.root, "assets/data/private.js"), "private");
  assert.equal(
    (await f.request("/assets/images/unregistered.png")).status,
    404,
  );
  assert.equal((await f.request("/assets/data/uil.fixture.json")).status, 404);
  assert.equal((await f.request("/assets/data/private.js")).status, 404);
  assert.equal((await f.request("/assets/js/app.fixture.js")).status, 200);
});
test("missing runtime code shows an explanatory page without launching partial 3D", async (t) => {
  const f = await httpFixture(t);
  fs.unlinkSync(path.join(f.root, "assets/js/app.fixture.js"));
  const response = await f.request("/");
  assert.equal(response.status, 503);
  const html = await response.text();
  assert.match(html, /缺少前台运行资源/);
  assert.doesNotMatch(html, /<script/);
});

test("version snapshots retain resource identity after a new published snapshot", async (t) => {
  const f = await httpFixture(t);
  const snapshot = structuredClone(f.bundle.draft);
  snapshot.assets.image.resourceId = "unused";
  snapshot.config.projects[0].video.url = "/media/unused";
  await f.store.transaction(async (tx) => {
    const repo = contentRepository(tx);
    assert.equal((await repo.insertVersion(snapshot)).id,43);
    await repo.setPublished(43);
  });
  const old = await (await f.request("/api/site/42/config")).json();
  const next = await (await f.request("/api/site/43/config")).json();
  assert.equal(
    old.projects[0].video.url,
    "/api/site/42/resources/image/image.png",
  );
  assert.match(next.projects[0].video.url, /\/43\/resources\/unused\//);
});
test("saving a new external song freezes only the selected media identity before publication", async (t) => {
  const f = await require('./helpers/delivery').deliveryFixture(t);
  const { saveDraft, publish } = require("../admin-server/config");
  const draft = await contentRepository(f.store).getDraft();
  draft.config.songs[0].src =
    "https://cdn.example.test/music/new.mp3?revision=2";
  const revision = await saveDraft(f.store, draft.config, draft.revision);
  const version = await publish(f.store, revision, {
    root: f.root,
    dataDir: path.join(f.root, "data"),
  }, f.actor, {deliveryService:f.service});
  const config = await (await f.request(`/api/site/${version}/config`)).json();
  assert.match(
    config.songs[0].src,
    new RegExp(`^/api/site/${version}/resources/external-`),
  );
  const id = config.songs[0].src.split("/")[5];
  const row = await require("../admin-server/repositories/resources")
    .resourceRepository(f.store)
    .get(id);
  assert.equal(row.kind, "audio");
  assert.equal(
    (await f.request(`/api/site/42/resources/${id}/new.mp3`)).status,
    404,
  );
  const redirect = await f.request(config.songs[0].src, { redirect: "manual" });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get("location"), draft.config.songs[0].src);
});
test("external query revisions and simultaneous signed URLs retain exact published identities", async (t) => {
  const f = await require('./helpers/delivery').deliveryFixture(t);
  const options = { root: f.root, dataDir: path.join(f.root, "data") };
  const { saveDraft, publish } = require("../admin-server/config");
  const urls = [
    "https://cdn.example.test/music/song.mp3?revision=1&signature=a%2Fb+z",
    "https://cdn.example.test/music/song.mp3?signature=b%2fc%20d&revision=2",
  ];
  async function publishSongs(sources) {
    const draft = await contentRepository(f.store).getDraft();
    draft.config.songs = sources.map((src, i) => ({ title: `Song ${i}`, src }));
    const revision = await saveDraft(f.store, draft.config, draft.revision);
    const version = await publish(f.store, revision, options, f.actor, {deliveryService:f.service});
    return {
      version,
      config: await (await f.request(`/api/site/${version}/config`)).json(),
    };
  }
  const old = await publishSongs([urls[0]]);
  const next = await publishSongs(urls);
  const oldId = old.config.songs[0].src.split("/")[5];
  const newId = next.config.songs[1].src.split("/")[5];
  assert.notEqual(
    oldId,
    newId,
    "different queries must have different resource IDs",
  );
  assert.equal(next.config.songs[0].src.split("/")[5], oldId);
  for (const [version, src, expected] of [
    [old.version, old.config.songs[0].src, urls[0]],
    [next.version, next.config.songs[0].src, urls[0]],
    [next.version, next.config.songs[1].src, urls[1]],
  ]) {
    const redirect = await f.request(src, { redirect: "manual" });
    assert.equal(redirect.status, 302);
    assert.equal(redirect.headers.get("location"), expected);
    assert.equal(
      (
        await (await f.request(`/api/site/${version}/config`)).json()
      ).songs[0].src.split("/")[5],
      oldId,
    );
  }
  assert.equal(
    (await f.request(`/api/site/${old.version}/resources/${newId}/song.mp3`))
      .status,
    404,
  );
  const refreshed = await publishSongs([urls[1]]);
  assert.equal(refreshed.config.songs[0].src.split("/")[5], newId);
  const redirect = await f.request(refreshed.config.songs[0].src, {
    redirect: "manual",
  });
  assert.equal(redirect.headers.get("location"), urls[1]);
  const original = await f.request(old.config.songs[0].src, {
    redirect: "manual",
  });
  assert.equal(original.headers.get("location"), urls[0]);
});
test("publishing a canonical local alias with query uses the registered resource", async (t) => {
  const f = await require('./helpers/delivery').deliveryFixture(t);
  const { saveDraft, publish } = require("../admin-server/config");
  const draft = await contentRepository(f.store).getDraft();
  draft.config.scenes[0].fields[0].value = "/assets/font.png?cache=2";
  const revision = await saveDraft(f.store, draft.config, draft.revision);
  const version = await publish(f.store, revision, {
    root: f.root,
    dataDir: path.join(f.root, "data"),
  }, f.actor, {deliveryService:f.service});
  const config = await (await f.request(`/api/site/${version}/config`)).json();
  assert.equal(
    config.scenes[0].fields[0].value,
    `/api/site/${version}/resources/font/font.png?cache=2`,
  );
});
test("expired preview and another owner cannot authorize resource bytes", async (t) => {
  const f = await httpFixture(t);
  await f.createAdmin();
  const headers = await f.login();
  await f.store.transaction((tx) =>
    contentRepository(tx).putPreview({
      id: "preview-expired",
      owner: "owner",
      expires: new Date(Date.now() - 1000),
      snapshot: f.bundle.draft,
    }),
  );
  assert.equal(
    (await f.request("/api/site/preview-expired/config", { headers })).status,
    404,
  );
  assert.equal(
    (
      await f.request("/api/site/preview-expired/resources/image/x.png", {
        headers,
      })
    ).status,
    404,
  );
  await f.store.transaction((tx) =>
    contentRepository(tx).putPreview({
      id: "preview-other",
      owner: "owner",
      expires: new Date(Date.now() + 60000),
      snapshot: f.bundle.draft,
    }),
  );
  await assert.rejects(
    require("../admin-server/frontend-resources").resolveVersion(f.store, {
      version: "preview-other",
      admin: { username: "other" },
    }),
    (e) => e.status === 404,
  );
  assert.equal((await f.request("/api/site/preview-other/config")).status, 401);
});
test("manifest is catalogued with frozen icon dependencies and HTML preserves navigation", async (t) => {
  const { inventoryResources } = require("../admin-server/resource-catalog");
  const f = await httpFixture(t, { installed: false });
  fs.mkdirSync(path.join(f.root, "assets/meta"));
  fs.writeFileSync(
    path.join(f.root, "assets/meta/manifest.json"),
    JSON.stringify({
      name: "Fixture",
      icons: [{ src: "../images/image.png", sizes: "1x1" }],
    }),
  );
  fs.writeFileSync(
    path.join(f.root, "index.html"),
    '<!doctype html><head><title>Fixture</title><link rel="manifest" href="assets/meta/manifest.json"><link rel="canonical" href="https://outside.test/page"></head><script>window._UNSUPPORTED_PAGE_ = "unsupported.html"; var s = "assets/js/app." + window._CACHE_ + ".js";</script>',
  );
  const catalog = await inventoryResources({
    root: f.root,
    manifest: { assets: [] },
  });
  const manifest = Object.values(catalog.assets).find(
    (a) => a.url === "assets/meta/manifest.json",
  );
  assert.ok(manifest, "manifest itself must be a database resource");
  assert.equal(manifest.document.icons[0].src, "assets/images/image.png");
  const bundle = structuredClone(f.bundle);
  bundle.resources.push(...catalog.resources);
  for (const snap of [bundle.draft, bundle.versions[0].snapshot]) {
    Object.assign(snap.assets, catalog.assets);
    Object.assign(snap.legacyMap, catalog.legacyMap);
    snap.template.readiness.engineAssets = {
      "html:manifest:0": "assets/meta/manifest.json",
    };
  }
  await f.store.transaction(async (tx) => {
    await contentRepository(tx).importBundle(bundle);
    await tx.query(
      "INSERT INTO personal_site.installation(id,source,schema_version) VALUES(true,'fixture',$1)",
      [require('../admin-server/migrations').currentSchemaVersion],
    );
  });
  const html = await (await f.request("/")).text();
  assert.match(html, /href="\/api\/site\/42\/resources\//);
  assert.match(html, /rel="canonical" href="http:\/\/localhost:3000\/"/);
  assert.doesNotMatch(html, /outside\.test/);
  fs.unlinkSync(path.join(f.root, "assets/meta/manifest.json"));
  const doc = await (
    await f.request(
      `/api/site/42/resources/${manifest.resourceId}/manifest.json`,
    )
  ).json();
  assert.match(doc.icons[0].src, /^\/api\/site\/42\/resources\//);
  assert.equal((await f.request(doc.icons[0].src)).status, 200);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { spawnSync } = require("node:child_process");
const { importFixture } = require("./helpers/import-content");
const { contentFixture } = require("./helpers/content");
const { readLegacy } = require("../admin-server/importers/sqlite");
const { readBundle } = require("../admin-server/importers/bundle");
const { inventoryResources } = require("../admin-server/resource-catalog");
const { postgresFixture } = require("./helpers/postgres");
const { contentRepository } = require("../admin-server/repositories/content");
const { publicSnapshot } = require("../admin-server/snapshots");
const hash = (file) =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const sourceHashes = (root) =>
  Object.fromEntries(
    fs
      .readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const file = path.join(e.parentPath, e.name);
        return [path.relative(root, file), hash(file)];
      }),
  );

test("legacy import preserves IDs, account, history, ciphertext, audit and source bytes", async (t) => {
  const f = importFixture(t);
  const b = await readLegacy({
    root: f.root,
    legacyPath: f.legacyPath,
    masterKey: f.masterKey,
  });
  assert.deepEqual(b.admin, {
    username: "legacy_owner",
    hash: "preserved-password-hash",
  });
  assert.deepEqual(
    b.versions.map((v) => v.id),
    [41, 42],
  );
  assert.equal(b.published, 42);
  assert.equal(b.revision, 7);
  assert.equal(
    b.resources.find((r) => r.id === "derived-logo").originalId,
    "source-logo",
  );
  assert.deepEqual(
    b.storages.find((s) => s.id === "cloud").credentials,
    f.credentials,
  );
  assert.equal(b.storages.find((s) => s.id === "cloud").available, true);
  assert.equal(b.audit[0].id, 12);
  assert.equal(b.audit[0].created, "2020-01-02T03:04:05.000Z");
  assert.equal(Object.hasOwn(b, "sessions"), false);
  assert.equal(b.versions[0].snapshot.format, 2);
  assert.deepEqual(
    b.versions[0].snapshot.template.baseUIL,
    b.draft.template.baseUIL,
  );
  assert.match(b.report.warnings.join(" "), /historical.*template/i);
  assert.equal(hash(f.legacyPath), f.sourceHash);
  assert.deepEqual(
    b,
    await readLegacy({
      root: f.root,
      legacyPath: f.legacyPath,
      masterKey: f.masterKey,
    }),
  );
});

test("missing or wrong master key disables only cloud storage without revealing secrets", async (t) => {
  const f = importFixture(t);
  for (const masterKey of [undefined, "cd".repeat(32)]) {
    const b = await readLegacy({
      root: f.root,
      legacyPath: f.legacyPath,
      masterKey,
    });
    assert.equal(b.storages.find((s) => s.id === "cloud").available, false);
    assert.deepEqual(b.report.credentialsUnavailable, ["cloud"]);
    assert.deepEqual(
      b.storages.find((s) => s.id === "cloud").credentials,
      f.credentials,
    );
    assert.doesNotMatch(
      JSON.stringify(b.report),
      /private-access|private-secret|preserved-password-hash/,
    );
  }
});

test("malformed whitelisted settings and multiple admins are migration conflicts", async (t) => {
  const f = importFixture(t);
  const db = new DatabaseSync(f.legacyPath);
  db.prepare("INSERT INTO admins VALUES(?,?)").run("other", "hash");
  db.close();
  await assert.rejects(readLegacy({ root: f.root, legacyPath: f.legacyPath }), {
    status: 409,
  });
  const db2 = new DatabaseSync(f.legacyPath);
  db2.exec(
    "DELETE FROM admins WHERE username='other';UPDATE settings SET value='invalid' WHERE key='draft'",
  );
  db2.close();
  await assert.rejects(readLegacy({ root: f.root, legacyPath: f.legacyPath }), {
    status: 409,
  });
});

test("empty bundle removes personal content and missing runtime prevents readiness", async (t) => {
  const f = importFixture(t);
  const b = await readBundle({ root: f.root, mode: "empty" });
  assert.deepEqual(b.draft.config.projects, []);
  assert.deepEqual(b.draft.config.songs, []);
  assert.equal(b.draft.config.site.email, "");
  assert.equal(b.draft.config.site.labUrl, "");
  assert.equal(b.draft.template.contact.email, "");
  assert.equal(b.draft.template.metadata.title, "");
  assert.equal(
    b.draft.template.baseUIL.INPUT_P_Element_3_About_text3d_text,
    "",
  );
  assert.equal(b.draft.template.readiness.ready, false);
  assert.equal(b.admin, null);
  assert.equal(b.published, null);
  assert.deepEqual(b.versions, []);
  assert.equal(
    b.report.digest,
    (await readBundle({ root: f.root, mode: "empty" })).report.digest,
  );
});

test("new deployment without assets yields a valid unavailable empty template", async (t) => {
  const f = contentFixture(t);
  fs.rmSync(path.join(f.root, "assets"), { recursive: true });
  const b = await readBundle({ root: f.root, mode: "empty" });
  assert.equal(b.draft.format, 2);
  assert.equal(b.draft.template.readiness.ready, false);
  assert.ok(b.report.missingRequired.length);
  assert.deepEqual(b.draft.config.projects, []);
});

test("catalog handles font dependencies, literal percent20 and extensionless resources", async (t) => {
  const f = contentFixture(t);
  fs.mkdirSync(path.join(f.root, "assets/music"));
  fs.mkdirSync(path.join(f.root, "assets/geometry"));
  fs.writeFileSync(path.join(f.root, "assets/music/Some%20Song.mp3"), "music");
  fs.writeFileSync(path.join(f.root, "assets/geometry/particles"), "bin");
  fs.writeFileSync(
    path.join(f.root, "assets/geometry/missing.bin.disabled"),
    "disabled",
  );
  fs.writeFileSync(path.join(f.root, "assets/js/program.js"), "program");
  const manifest = [
    {
      owner: "font",
      slot: "font-main",
      url: "assets/fonts/font.json",
      type: "font",
      required: true,
      group: "font-main",
    },
    {
      owner: "engine",
      slot: "particles",
      url: "assets/geometry/particles",
      type: "model",
      required: true,
      group: "particles",
    },
    {
      owner: "engine",
      slot: "optional",
      url: "assets/images/absent.png",
      type: "image",
      required: false,
      group: "optional",
    },
  ];
  const config = {
    site: { labUrl: "https://example.test/logo.png" },
    projects: [],
    scenes: [],
    songs: [{ src: "assets/music/Some Song.mp3" }],
  };
  const a = await inventoryResources({
    root: f.root,
    config,
    template: { baseUIL: {} },
    manifest,
  });
  assert.deepEqual(a.report.missingRequired, []);
  const font = a.assets["font-main"];
  assert.ok(font.dependencies.length);
  assert.equal(
    a.resources.find((r) => r.id === font.resourceId).checksum,
    hash(path.join(f.root, "assets/fonts/font.json")),
  );
  assert.ok(a.resources.some((r) => r.path === "assets/music/Some%20Song.mp3"));
  assert.ok(
    a.resources.some(
      (r) => r.path === "assets/geometry/particles" && r.status === "ready",
    ),
  );
  assert.ok(a.resources.some((r) => r.status === "disabled"));
  assert.ok(
    !a.resources.some(
      (r) => r.path === "assets/js/program.js" || r.url === config.site.labUrl,
    ),
  );
  assert.match(a.report.warnings.join(" "), /optional/);
  assert.deepEqual(
    a,
    await inventoryResources({
      root: f.root,
      config,
      template: { baseUIL: {} },
      manifest,
    }),
  );
});

test("required missing assets block readiness and escaping symlinks reject inventory", async (t) => {
  const f = contentFixture(t);
  const a = await inventoryResources({
    root: f.root,
    config: {},
    template: {},
    manifest: [
      {
        owner: "engine",
        slot: "required",
        url: "assets/images/absent.png",
        type: "image",
        required: true,
        group: "required",
      },
    ],
  });
  assert.deepEqual(a.report.missingRequired, ["required"]);
  fs.symlinkSync("/etc/hosts", path.join(f.root, "assets/images/escape.png"));
  await assert.rejects(
    inventoryResources({
      root: f.root,
      config: {},
      template: {},
      manifest: [],
    }),
    /outside|symlink|escape/i,
  );
});

test("check CLI prints a safe report only and writes no source", async (t) => {
  const f = importFixture(t);
  const before = sourceHashes(f.root);
  const result = spawnSync(
    process.execPath,
    [
      "scripts/import-site.js",
      "--check",
      "--root",
      f.root,
      "--legacy",
      f.legacyPath,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.ok(report.counts);
  assert.match(report.digest, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(report, "draft"), false);
  assert.doesNotMatch(
    result.stdout,
    /preserved-password-hash|secret-session|private-secret/,
  );
  assert.equal(hash(f.legacyPath), f.sourceHash);
  assert.deepEqual(sourceHashes(f.root), before);
});

test("manifest absolute icon paths are not joined twice", async (t) => {
  const f = contentFixture(t);
  fs.mkdirSync(path.join(f.root, "assets/meta"));
  fs.writeFileSync(path.join(f.root, "assets/meta/icon.png"), "icon");
  fs.writeFileSync(
    path.join(f.root, "assets/meta/manifest.json"),
    JSON.stringify({ icons: [{ src: "/assets/meta/icon.png" }] }),
  );
  fs.writeFileSync(
    path.join(f.root, "index.html"),
    '<link rel="manifest" href="assets/meta/manifest.json">',
  );
  const a = await inventoryResources({
    root: f.root,
    config: {},
    template: {},
    manifest: [],
  });
  assert.equal(
    a.resources.find((r) => r.id === a.assets["html:manifest:0"].resourceId)
      .status,
    "ready",
  );
});

test("every historical scene asset gets registered even when draft overrides it", async (t) => {
  const f = importFixture(t);
  fs.mkdirSync(path.join(f.root, "assets/geometry"));
  const db = new DatabaseSync(f.legacyPath),
    old = structuredClone(f.config);
  old.scenes[0].fields[0].value = "assets/geometry/old.bin";
  db.prepare("UPDATE versions SET config=? WHERE id=41").run(
    JSON.stringify(old),
  );
  db.close();
  const b = await readLegacy({ root: f.root, legacyPath: f.legacyPath });
  assert.ok(b.versions[0].snapshot.legacyMap["assets/geometry/old.bin"]);
  const slot = b.versions[0].snapshot.legacyMap["assets/geometry/old.bin"];
  assert.ok(b.report.missingRequired.includes(slot));
});

test("legacy converted-resource cycles and broken published references reject before import", async (t) => {
  const f = importFixture(t);
  const db = new DatabaseSync(f.legacyPath);
  const rows = structuredClone(f.resources);
  rows[0].originalId = "derived-logo";
  db.prepare("UPDATE settings SET value=? WHERE key=?").run(
    JSON.stringify(rows),
    "resources",
  );
  db.close();
  await assert.rejects(readLegacy({ root: f.root, legacyPath: f.legacyPath }), {
    status: 409,
  });
});

test("catalog rejects font atlas traversal and encoded traversal without source writes", async (t) => {
  const f = contentFixture(t);
  fs.writeFileSync(
    path.join(f.root, "assets/fonts/font.json"),
    JSON.stringify({ pages: ["../../../outside.png"], chars: [] }),
  );
  await assert.rejects(
    inventoryResources({
      root: f.root,
      config: {},
      template: {},
      manifest: [
        {
          owner: "font",
          slot: "font",
          url: "assets/fonts/font.json",
          type: "font",
          required: true,
        },
      ],
    }),
    /escape|outside|Invalid/,
  );
  await assert.rejects(
    inventoryResources({
      root: f.root,
      config: {},
      template: {},
      manifest: [
        {
          owner: "font",
          slot: "bad",
          url: "assets/%2e%2e/outside.png",
          type: "image",
          required: true,
        },
      ],
    }),
    /escape/,
  );
});

test("read-only imported bundle persists twice-retained versions and credential object in real PostgreSQL", async (t) => {
  const f = importFixture(t),
    { store } = await postgresFixture(t);
  const b = await readLegacy({
    root: f.root,
    legacyPath: f.legacyPath,
    masterKey: f.masterKey,
  });
  await store.transaction((tx) => contentRepository(tx).importBundle(b));
  const repo = contentRepository(store);
  assert.equal((await repo.getDraft()).revision, 7);
  assert.deepEqual(
    (await repo.listVersions()).map((v) => v.id),
    [42, 41],
  );
  const rows = (
    await store.query(
      "SELECT credentials FROM personal_site.storages WHERE id=$1",
      ["cloud"],
    )
  ).rows;
  assert.deepEqual(JSON.parse(rows[0].credentials), f.credentials);
  assert.equal(hash(f.legacyPath), f.sourceHash);
});

test("bundle mode inventories metadata images, but not contact or ordinary navigation URLs", async (t) => {
  const f = contentFixture(t);
  fs.writeFileSync(path.join(f.root, "cms/projects-dev.json"), "[]");
  fs.writeFileSync(
    path.join(f.root, "cms/metadata-dev.json"),
    JSON.stringify({
      title: "Title",
      ogImage: {
        url: "https://example.test/social.jpg",
        sizes: { thumbnail: { url: "https://example.test/thumb.jpg" } },
      },
    }),
  );
  fs.writeFileSync(
    path.join(f.root, "cms/contact-dev.json"),
    JSON.stringify({ links: [{ url: "https://example.test/profile.jpg" }] }),
  );
  const b = await readBundle({ root: f.root, mode: "bundle" });
  assert.ok(
    b.resources.some((r) => r.url === "https://example.test/social.jpg"),
  );
  assert.ok(
    b.resources.some((r) => r.url === "https://example.test/thumb.jpg"),
  );
  assert.ok(
    !b.resources.some((r) => r.url === "https://example.test/profile.jpg"),
  );
  assert.equal(b.draft.template.metadata.title, "Title");
  const { store } = await postgresFixture(t);
  await store.transaction((tx) => contentRepository(tx).importBundle(b));
  assert.equal(
    (await contentRepository(store).getTemplate()).template.metadata.title,
    "Title",
  );
});

test("bundle reader refuses index source symlink outside root", async (t) => {
  const f = contentFixture(t);
  fs.unlinkSync(path.join(f.root, "index.html"));
  fs.symlinkSync("/etc/hosts", path.join(f.root, "index.html"));
  await assert.rejects(
    readBundle({ root: f.root, mode: "empty" }),
    /outside|Invalid bundled/,
  );
});

test("required remote fonts cannot establish verified template readiness", async (t) => {
  const f = contentFixture(t);
  const a = await inventoryResources({
    root: f.root,
    config: {},
    template: {},
    manifest: [
      {
        owner: "engine",
        slot: "remote-font",
        url: "https://example.test/font.json",
        type: "font",
        required: true,
      },
    ],
  });
  assert.deepEqual(a.report.missingRequired, ["remote-font"]);
  assert.equal(
    a.resources.find((r) => r.url === "https://example.test/font.json").status,
    "unverified",
  );
});

test("historical songs with the same stable ID retain different immutable URLs", async (t) => {
  const f = importFixture(t);
  fs.mkdirSync(path.join(f.root, "assets/music"));
  for (const file of ["old.mp3", "new.mp3"])
    fs.writeFileSync(path.join(f.root, "assets/music", file), file);
  const db = new DatabaseSync(f.legacyPath);
  for (const id of [41, 42]) {
    const config = structuredClone(f.config);
    config.songs = [
      {
        id: "same-song",
        title: "Song",
        src: `assets/music/${id === 41 ? "old" : "new"}.mp3`,
      },
    ];
    db.prepare("UPDATE versions SET config=? WHERE id=?").run(
      JSON.stringify(config),
      id,
    );
  }
  db.close();
  const b = await readLegacy({ root: f.root, legacyPath: f.legacyPath });
  const old = b.versions[0].snapshot,
    next = b.versions[1].snapshot;
  const oldSlot = old.legacyMap["assets/music/old.mp3"],
    newSlot = next.legacyMap["assets/music/new.mp3"];
  assert.notEqual(
    old.assets[oldSlot].resourceId,
    next.assets[newSlot].resourceId,
  );
  assert.match(publicSnapshot(old, 41).songs[0].src, /\/old\.mp3$/);
  assert.match(publicSnapshot(next, 42).songs[0].src, /\/new\.mp3$/);
});

test("malformed resource rows are explicit migration conflicts", async (t) => {
  const f = importFixture(t);
  const db = new DatabaseSync(f.legacyPath);
  db.prepare("UPDATE settings SET value=? WHERE key=?").run(
    "[null]",
    "resources",
  );
  db.close();
  await assert.rejects(readLegacy({ root: f.root, legacyPath: f.legacyPath }), {
    status: 409,
  });
});

test("bundle mode validates malformed project lists instead of returning an invalid snapshot", async (t) => {
  const f = contentFixture(t);
  fs.writeFileSync(path.join(f.root, "cms/projects-dev.json"), "{}");
  await assert.rejects(readBundle({ root: f.root, mode: "bundle" }), {
    status: 409,
  });
});

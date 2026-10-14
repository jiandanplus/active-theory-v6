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

test('legacy historical-only site image is inventoried without draft grants or source mutation',async t=>{
  const f=importFixture(t), url='https://historical.invalid/share.png';
  const db=new DatabaseSync(f.legacyPath);
  try {
    const row=db.prepare('SELECT config FROM versions WHERE id=41').get();
    const config=JSON.parse(row.config); config.site.socialImage=url;
    db.prepare('UPDATE versions SET config=? WHERE id=41').run(JSON.stringify(config));
  } finally { db.close(); }
  const before=sourceHashes(f.root), bundle=await readLegacy(f);
  assert.deepEqual(sourceHashes(f.root),before);
  const image=bundle.resources.find(r=>r.url===url);
  assert.ok(image); assert.equal(image.kind,'image');
  assert.equal(bundle.versions.find(v=>v.id===41).snapshot.config.site.socialImage,url);
  assert.equal(bundle.draft.config.site.socialImage,'');
  const {collectReferences}=require('../admin-server/snapshots');
  assert(!collectReferences(bundle.draft).some(r=>r.resourceId===image.id));
  assert(collectReferences(bundle.versions.find(v=>v.id===41).snapshot).some(r=>r.resourceId===image.id&&r.slot==='config.site.socialImage'));
});

test("legacy private bytes are checked read-only with checksums and required geometry readiness", async (t) => {
  const f = importFixture(t);
  const before = sourceHashes(f.root);
  const present = await readLegacy(f);
  assert.equal(
    present.resources.find((r) => r.id === "derived-logo").checksum,
    hash(path.join(f.dataDir, "uploads/derived.bin")),
  );
  assert.deepEqual(sourceHashes(f.root), before);
  fs.unlinkSync(path.join(f.dataDir, "uploads/derived.bin"));
  const missing = await readLegacy(f);
  assert.ok(missing.report.missingRequired.includes("legacy:derived-logo"));
  for (const snapshot of [
    missing.draft,
    ...missing.versions.map((v) => v.snapshot),
  ]) {
    assert.equal(snapshot.template.readiness.ready, false);
    assert.ok(
      snapshot.template.readiness.missingRequired.includes(
        "legacy:derived-logo",
      ),
    );
  }
  assert.equal(missing.published, 42);
  assert.deepEqual(
    missing.versions.map((v) => v.id),
    [41, 42],
  );
  assert.notEqual(missing.report.digest, present.report.digest);
  assert.equal(hash(f.legacyPath), f.sourceHash);
  assert(!JSON.stringify(missing.report).includes(f.root));
});

test("missing original and unreferenced ordinary media warn without becoming required geometry", async (t) => {
  const f = importFixture(t);
  for (const file of ["source.glb", "optional.png"])
    fs.unlinkSync(path.join(f.dataDir, "uploads", file));
  const b = await readLegacy(f);
  for (const id of ["source-logo", "optional-image"]) {
    assert.match(b.report.warnings.join(" "), new RegExp(id));
    assert(!b.report.missingRequired.includes(`legacy:${id}`));
    assert.equal(b.resources.find((r) => r.id === id).status, "missing");
  }
  assert(!b.report.missingRequired.includes("legacy:derived-logo"));
});

test("legacy private checks refuse symlink escapes, unreadable shapes and implicit data paths safely", async (t) => {
  const f = importFixture(t);
  const file = path.join(f.dataDir, "uploads/derived.bin");
  fs.unlinkSync(file);
  fs.symlinkSync(f.legacyPath, file);
  const unsafe = await readLegacy(f);
  assert.ok(unsafe.report.missingRequired.includes("legacy:derived-logo"));
  assert.equal(
    unsafe.resources.find((r) => r.id === "derived-logo").checksum,
    null,
  );
  fs.unlinkSync(file);
  fs.mkdirSync(file);
  assert.ok(
    (await readLegacy(f)).report.missingRequired.includes(
      "legacy:derived-logo",
    ),
  );
  const implicit = await readLegacy({ root: f.root, legacyPath: f.legacyPath });
  assert.ok(implicit.report.missingRequired.includes("legacy:derived-logo"));
  assert(!JSON.stringify(unsafe.report).includes(f.root));
  assert.equal(hash(f.legacyPath), f.sourceHash);
});

test("legacy check CLI accepts only explicit trusted private data directory", (t) => {
  const f = importFixture(t);
  const result = spawnSync(
    process.execPath,
    [
      "scripts/import-site.js",
      "--check",
      "--root",
      f.root,
      "--legacy",
      f.legacyPath,
      "--data-dir",
      f.dataDir,
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert(!report.missingRequired.includes("legacy:derived-logo"));
  assert(!report.warnings.some((w) => w.includes("source-logo")));
});

test("unreadable staged private files are reported without leaking filesystem paths", async (t) => {
  const f = importFixture(t);
  const file = path.join(f.dataDir, "uploads/derived.bin");
  fs.chmodSync(file, 0o000);
  try {
    const b = await readLegacy(f);
    assert.ok(b.report.missingRequired.includes("legacy:derived-logo"));
    assert.equal(
      b.resources.find((r) => r.id === "derived-logo").checksum,
      null,
    );
    assert(!JSON.stringify(b.report).includes(f.root));
  } finally {
    fs.chmodSync(file, 0o600);
  }
});

test("only snapshots referencing missing private geometry become unavailable", async (t) => {
  const f = importFixture(t);
  const db = new DatabaseSync(f.legacyPath);
  const draft = structuredClone(f.config);
  draft.scenes[0].fields.find((field) => field.type === "geometry").value =
    "assets/geometry/alternate.bin";
  db.prepare("UPDATE settings SET value=? WHERE key='draft'").run(
    JSON.stringify(draft),
  );
  db.close();
  fs.unlinkSync(path.join(f.dataDir, "uploads/derived.bin"));
  const b = await readLegacy(f);
  assert(
    !b.draft.template.readiness.missingRequired.includes("legacy:derived-logo"),
  );
  assert(
    b.versions.every((v) =>
      v.snapshot.template.readiness.missingRequired.includes(
        "legacy:derived-logo",
      ),
    ),
  );
});

test("unsafe keys and upload directory symlinks never read outside staged private uploads", async (t) => {
  const f = importFixture(t);
  const db = new DatabaseSync(f.legacyPath);
  const rows = structuredClone(f.resources);
  rows.find((r) => r.id === "derived-logo").key = "../../legacy.sqlite";
  db.prepare("UPDATE settings SET value=? WHERE key='resources'").run(
    JSON.stringify(rows),
  );
  db.close();
  assert(
    (await readLegacy(f)).report.missingRequired.includes(
      "legacy:derived-logo",
    ),
  );
  fs.renameSync(
    path.join(f.dataDir, "uploads"),
    path.join(f.dataDir, "staged"),
  );
  fs.symlinkSync(
    path.join(f.dataDir, "staged"),
    path.join(f.dataDir, "uploads"),
  );
  const b = await readLegacy(f);
  assert(b.report.warnings.some((w) => w.includes("source-logo")));
  assert.equal(b.resources.find((r) => r.id === "source-logo").checksum, null);
});

test("geometry aliases use engine paths, retain aliases and report missing required slots", async (t) => {
  const f = contentFixture(t);
  const aliases = [
    "room/floor.bin",
    "room/walls.bin",
    "room/prop.bin",
    "room/land.bin",
    "room/light.bin",
    "caustic_plane.bin",
    "bush.bin/caustic_plane.bin",
    "room/extensionless",
  ];
  const baseUIL = Object.fromEntries(
    aliases.map((src, i) => [`test_${i}_geometry`, { src }]),
  );
  const missing = await inventoryResources({
    root: f.root,
    template: { baseUIL },
    manifest: [],
  });
  for (const [i, alias] of aliases.entries()) {
    const slot = `uil:test_${i}_geometry`;
    assert.ok(missing.report.missingRequired.includes(slot));
    assert.equal(missing.legacyMap[alias], slot);
    const file = `assets/geometry/${alias}${alias.includes(".") ? "" : ".json"}`;
    fs.mkdirSync(path.dirname(path.join(f.root, file)), { recursive: true });
    fs.writeFileSync(path.join(f.root, file), "geometry");
  }
  const present = await inventoryResources({
    root: f.root,
    template: { baseUIL },
    manifest: [],
  });
  assert.deepEqual(present.report.missingRequired, []);
  for (const [i, alias] of aliases.entries()) {
    const slot = `uil:test_${i}_geometry`;
    assert.equal(present.assets[slot].url, alias);
    assert.equal(present.legacyMap[alias], slot);
    assert.equal(
      present.resources.find((r) => r.id === present.assets[slot].resourceId)
        .status,
      "ready",
    );
  }
});

test("unsupported required media slots cannot silently disappear", async (t) => {
  const f = contentFixture(t);
  const result = await inventoryResources({
    root: f.root,
    manifest: [
      {
        owner: "engine",
        slot: "unsupported",
        url: "unknown.png",
        required: true,
      },
    ],
  });
  assert.ok(result.report.missingRequired.includes("unsupported"));
});

test("UIL engine relative-file fallback is used while builtins and unset fields are not media", async (t) => {
  const f = contentFixture(t);
  const baseUIL = {
    builtin_geometry: { src: "", relative: "World.SPHERE" },
    fallback_geometry: { src: "", relative: "tree_room/walls.bin" },
    alias_geometry: { src: "bush.bin/caustic_plane.bin", relative: "bush.bin" },
    unset_geometry: { src: "", relative: "assets/geometry/room" },
    config_initialPositions: { src: "", relative: "null" },
  };
  fs.mkdirSync(path.join(f.root, "assets/geometry/tree_room"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(f.root, "assets/geometry/tree_room/walls.bin"),
    "geometry",
  );
  const result = await inventoryResources({
    root: f.root,
    template: { baseUIL },
    manifest: [],
  });
  assert.deepEqual(result.report.missingRequired, ["uil:alias_geometry"]);
  assert.equal(
    result.resources.find(
      (r) => r.id === result.assets["uil:fallback_geometry"].resourceId,
    ).status,
    "ready",
  );
  assert.equal(
    result.resources.find(
      (r) => r.id === result.assets["uil:alias_geometry"].resourceId,
    ).path,
    "assets/geometry/bush.bin",
  );
  assert.equal(
    result.legacyMap["bush.bin/caustic_plane.bin"],
    "uil:alias_geometry",
  );
  assert.equal(result.assets["uil:builtin_geometry"], undefined);
  assert.equal(result.assets["uil:unset_geometry"], undefined);
});

test("disk fallback is limited to absent files and other read failures are safe conflicts", (t) => {
  const f = contentFixture(t);
  const { read } = require("../admin-server/importers/disk");
  assert.equal(read(f.root, "absent", "fallback"), "fallback");
  assert.throws(() => read(f.root, "assets", "fallback"), {
    status: 409,
    message: "Import source could not be read",
  });
});

test("check CLI decrypts storage using canonical SITE_MASTER_KEY without exposing credentials", (t) => {
  const f = importFixture(t);
  const env = { ...process.env, SITE_MASTER_KEY: f.masterKey };
  delete env.STORAGE_MASTER_KEY;
  const result = spawnSync(
    process.execPath,
    [
      path.join(__dirname, "../scripts/import-site.js"),
      "--check",
      "--root",
      f.root,
      "--legacy",
      f.legacyPath,
      "--data-dir",
      f.dataDir,
    ],
    { encoding: "utf8", env },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).credentialsUnavailable, []);
  assert.doesNotMatch(
    result.stdout,
    /private-access|private-secret|preserved-password-hash/,
  );
});

test("legacy import preserves IDs, account, history, ciphertext, audit and source bytes", async (t) => {
  const f = importFixture(t);
  const b = await readLegacy({
    root: f.root,
    legacyPath: f.legacyPath,
    dataDir: f.dataDir,
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
      dataDir: f.dataDir,
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
      dataDir: f.dataDir,
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
  assert.equal(b.draft.config.site.language, "en");
  assert.equal(b.schema.site.language, "en");
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
      "--data-dir",
      f.dataDir,
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
  const b = await readLegacy(f);
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
    dataDir: f.dataDir,
    masterKey: f.masterKey,
  });
  await store.transaction((tx) => contentRepository(tx).importBundle(b));
  const repo = contentRepository(store);
  assert.equal((await repo.getDraft()).revision, 7);
  assert.deepEqual(
    (await repo.listVersions()).map((v) => v.id),
    [42, 41],
  );
  assert.deepEqual((await store.query('SELECT version_id,mode,artifact_digest,generation FROM personal_site.delivery_bindings ORDER BY version_id')).rows,[
    {version_id:'41',mode:'legacy',artifact_digest:null,generation:0},
    {version_id:'42',mode:'legacy',artifact_digest:null,generation:0},
  ]);
  const rows = (
    await store.query(
      "SELECT credentials FROM personal_site.storages WHERE id=$1",
      ["cloud"],
    )
  ).rows;
  assert.deepEqual(JSON.parse(rows[0].credentials), f.credentials);
  assert.equal(hash(f.legacyPath), f.sourceHash);
});

test('legacy import and old-version restore preserve temporary source bytes and historical JSONB', async t=>{
  const f=importFixture(t), {store}=await postgresFixture(t);
  const before=sourceHashes(f.root);
  const bundle=await readLegacy({...f,masterKey:f.masterKey});
  await store.transaction(tx=>contentRepository(tx).importBundle(bundle));
  const historySql='SELECT id,snapshot::text AS snapshot FROM personal_site.versions ORDER BY id';
  const history=(await store.query(historySql)).rows;
  assert.equal(history.length,2);
  const repo=contentRepository(store);
  await require('../admin-server/config').restore(store,41,(await repo.getDraft()).revision);
  const draft=await repo.getDraft();
  assert.equal(draft.config.site.description,'');
  assert.equal(draft.config.site.language,'en');
  assert.equal(draft.config.site.socialImage,'');
  assert.deepEqual((await store.query(historySql)).rows,history);
  assert.equal(hash(f.legacyPath),f.sourceHash);
  assert.deepEqual(sourceHashes(f.root),before);
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
  const b = await readLegacy(f);
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

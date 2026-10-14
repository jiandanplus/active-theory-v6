const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
test("plain titles and navigation do not publish unused inventory IDs", () => {
  const s = {
    config: {
      site: { title: "unused", labUrl: "unused.png" },
      projects: [],
      scenes: [],
      songs: [],
    },
    template: {
      baseUIL: {},
      contact: {},
      metadata: {},
      fontCoverage: {},
      readiness: {},
    },
    assets: { unused: { resourceId: "unused", fileName: "unused.png" } },
    legacyMap: {},
  };
  assert.deepEqual(collectReferences(s), []);
});
test("managed URLs still expand registered font companions", () => {
  const s = {
    config: {
      site: {},
      projects: [],
      scenes: [],
      songs: [{ title: "Example", src: "/media/font" }],
    },
    template: {
      baseUIL: {},
      contact: {},
      metadata: {},
      fontCoverage: {},
      readiness: {},
    },
    assets: {
      font: {
        resourceId: "font",
        fileName: "font.json",
        companions: ["atlas"],
      },
      atlas: { resourceId: "atlas", fileName: "atlas.png" },
    },
    legacyMap: {},
  };
  assert.ok(collectReferences(s).some((r) => r.resourceId === "atlas"));
});
test("resource ID companions expand slot dependencies with canonical cycle protection", () => {
  const s = composeSnapshot({
    config: { site: {}, projects: [], scenes: [], songs: [] },
    template: { baseUIL: { font: { src: "font.json" } } },
    assets: {
      fontSlot: {
        resourceId: "font-id",
        fileName: "font.json",
        companions: ["atlas-id"],
      },
      atlasSlot: { resourceId: "atlas-id", dependencies: ["coverageSlot"] },
      coverageSlot: {
        resourceId: "coverage-id",
        companions: ["atlasSlot", "font-id"],
      },
    },
  });
  assert.deepEqual(
    [...new Set(collectReferences(s).map((r) => r.resourceId))].sort(),
    ["atlas-id", "coverage-id", "font-id"],
  );
});
test("typed text and number overrides do not publish inventory aliases", () => {
  for (const value of ["unused.png", "unused-id"]) {
    const s = composeSnapshot({
      config: {
        site: {},
        projects: [],
        songs: [],
        scenes: [
          {
            id: "Home",
            fields: [
              { key: "copy", type: "text", value },
              { key: "count", type: "number", value },
              { key: "hero", type: "resource", value: "/media/real" },
            ],
          },
        ],
      },
      template: {
        baseUIL: { copy: { src: "unused.png" }, font: { src: "font.json" } },
      },
      assets: {
        unusedSlot: { resourceId: "unused-id", fileName: "unused.png" },
        font: {
          resourceId: "font",
          fileName: "font.json",
          companions: ["atlas"],
        },
        atlas: { resourceId: "atlas" },
      },
    });
    assert.deepEqual(
      [...new Set(collectReferences(s).map((r) => r.resourceId))].sort(),
      ["atlas", "font", "real"],
    );
  }
});
const { postgresFixture } = require("./helpers/postgres");
const { contentFixture } = require("./helpers/content");
const { contentRepository } = require("../admin-server/repositories/content");
const {
  resourceRepository,
} = require("../admin-server/repositories/resources");
const { storageRepository } = require("../admin-server/repositories/storages");
const { authRepository } = require("../admin-server/repositories/auth");
const { auditRepository } = require("../admin-server/repositories/audit");
const {
  composeSnapshot,
  collectReferences,
  publicSnapshot,
} = require("../admin-server/snapshots");
async function setup(t) {
  const { store } = await postgresFixture(t);
  const { bundle } = contentFixture(t);
  await store.transaction((tx) => contentRepository(tx).importBundle(bundle));
  return { store, bundle };
}
test("independent concurrent inserts do not lose resources", async (t) => {
  const { store } = await setup(t);
  await Promise.all(
    ["a", "b"].map((id) =>
      resourceRepository(store).insert({
        id,
        source: "external",
        url: `https://example.test/${id}`,
        name: id,
        kind: "image",
        status: "linked",
      }),
    ),
  );
  assert.equal((await resourceRepository(store).list()).length, 6);
});
test("draft CAS accepts exactly one writer and preserves sorted lists", async (t) => {
  const { store } = await setup(t);
  const { config, revision } = await contentRepository(store).getDraft();
  const outcomes = await Promise.allSettled(
    ["A", "B"].map((title) =>
      store.transaction(async (tx) => {
        const next = structuredClone(config);
        next.site.title = title;
        return contentRepository(tx).writeDraft(next, revision);
      }),
    ),
  );
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(
    outcomes.find((x) => x.status === "rejected").reason.status,
    409,
  );
  assert.deepEqual(
    (await contentRepository(store).getDraft()).config.songs,
    config.songs,
  );
});
test("JSONB key order does not prevent saving unchanged schema", async (t) => {
  const { store } = await setup(t);
  const { config, revision } = await contentRepository(store).getDraft();
  config.site = { email: config.site.email, title: config.site.title };
  await store.transaction((tx) =>
    contentRepository(tx).writeDraft(config, revision),
  );
  assert.equal(
    (await contentRepository(store).getDraft()).revision,
    revision + 1,
  );
});
test("snapshot clones template and references only used registered assets", () => {
  const template = {
    baseUIL: { font: { src: "font.png" } },
    contact: {},
    metadata: {},
    fontCoverage: {},
    readiness: {},
  };
  const s = composeSnapshot({
    config: {
      site: { title: "Test", credentials: "secret" },
      projects: [],
      scenes: [],
      songs: [],
    },
    template,
    assets: {
      font: { resourceId: "f", fileName: "font.png" },
      unused: { resourceId: "u", fileName: "unused.png" },
    },
    legacyMap: {},
  });
  s.template.baseUIL.font.src = "changed";
  assert.equal(template.baseUIL.font.src, "font.png");
  s.template.baseUIL.font.src = "font.png";
  assert.deepEqual(collectReferences(s), [
    { resourceId: "f", slot: "template.baseUIL.font.src" },
  ]);
  const pub = publicSnapshot(s, 1);
  assert.deepEqual(Object.keys(pub).sort(), [
    "projects",
    "scenes",
    "site",
    "songs",
  ]);
  assert.equal(pub.site.credentials, undefined);
});
test("references enforce owners, foreign keys and trash protection", async (t) => {
  const { store } = await setup(t);
  await assert.rejects(
    store.transaction((tx) =>
      resourceRepository(tx).replaceReferences({
        ownerType: "version",
        ownerId: "42",
        references: [{ resourceId: "missing", slot: "bad" }],
      }),
    ),
    /resource/i,
  );
  await assert.rejects(
    store.transaction((tx) =>
      resourceRepository(tx).replaceReferences({
        ownerType: "preview",
        ownerId: "missing",
        references: [],
      }),
    ),
    (e) => e.status === 404,
  );
  await assert.rejects(
    store.transaction((tx) => resourceRepository(tx).setTrashed("image", true)),
    (e) => e.status === 409,
  );
  assert.equal(await resourceRepository(store).isPublished("image"), true);
  assert.equal(await resourceRepository(store).isPublished("unused"), false);
});
test("mid-list write failure rolls back the draft CAS and all records", async (t) => {
  const { store } = await setup(t);
  const before = await contentRepository(store).getDraft();
  const config = structuredClone(before.config);
  config.projects.push({ ...config.projects[0], id: "other" });
  await assert.rejects(
    store.transaction((tx) =>
      contentRepository(tx).writeDraft(config, before.revision),
    ),
  );
  assert.deepEqual(await contentRepository(store).getDraft(), before);
});
test("storages roundtrip encrypted object and reject relocating referenced storage", async (t) => {
  const { store } = await setup(t);
  const repo = storageRepository(store);
  const value = {
    id: "s3",
    type: "s3",
    name: "S3",
    bucket: "one",
    credentials: { iv: "iv", tag: "tag", data: "cipher" },
  };
  await repo.upsert(value);
  assert.deepEqual((await repo.get("s3")).credentials, value.credentials);
  await repo.setDefault("s3");
  assert.equal(await repo.getDefault(), "s3");
  await resourceRepository(store).insert({
    id: "cloud",
    source: "s3",
    storageId: "s3",
    key: "x",
    url: "/media/cloud",
    name: "cloud",
    kind: "image",
    status: "uploaded",
  });
  await assert.rejects(
    repo.upsert({ ...value, bucket: "two" }),
    (e) => e.status === 409,
  );
  await assert.rejects(repo.setDefault("missing"));
});
test("auth sessions contain digest identifiers, expiry and atomic attempt reservations", async (t) => {
  const { store } = await setup(t);
  const repo = authRepository(store);
  const id = "a".repeat(64);
  await repo.putSession({
    id,
    username: "admin",
    csrf: "csrf",
    created: 100,
    touched: 100,
  });
  assert.equal((await repo.getSession(id)).created, 100);
  await assert.rejects(
    repo.putSession({
      id: "raw-token",
      username: "admin",
      csrf: "csrf",
      created: 100,
      touched: 100,
    }),
  );
  await repo.touchSession(id, 200);
  assert.equal((await repo.getSession(id)).touched, 200);
  const outcomes = await Promise.allSettled(
    Array.from({ length: 5 }, () =>
      store.transaction((tx) =>
        authRepository(tx).reserveAttempt(["key"], 1000, 2),
      ),
    ),
  );
  assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 2);
  await repo.clearAttempts(["key"]);
  await repo.reserveAttempt(["key"], 1000, 2);
  await repo.pruneSessions(8 * 24 * 60 * 60 * 1000);
  assert.equal(await repo.getSession(id), null);
  await repo.replaceAdmin({ username: "newadmin", hash: "newhash" });
  assert.equal((await repo.getAdmin()).username, "newadmin");
});
test("versions advance identity and previews clean references on expiry", async (t) => {
  const { store, bundle } = await setup(t);
  await store.transaction(async (tx) => {
    const repo = contentRepository(tx);
    const v = await repo.insertVersion(bundle.draft);
    assert.ok(v.id > 42);
    await repo.setPublished(v.id);
    await repo.insertPreview({
      id: "preview",
      owner: "admin",
      expires: "2026-01-02T00:00:00Z",
      snapshot: bundle.draft,
      references: collectReferences(bundle.draft),
    });
  });
  const repo = contentRepository(store);
  assert.equal(
    (await repo.getPreview("preview", "admin", "2026-01-01")).id,
    "preview",
  );
  assert.equal(await repo.getPreview("preview", "other", "2026-01-01"), null);
  await store.transaction((tx) =>
    contentRepository(tx).prunePreviews("2026-01-03"),
  );
  assert.equal(
    (
      await store.query(
        "SELECT * FROM personal_site.resource_references WHERE owner_type='preview'",
      )
    ).rowCount,
    0,
  );
  assert.equal((await repo.listVersions()).length, 2);
  await auditRepository(store).append("test", "admin");
  assert.equal((await auditRepository(store).recent())[0].action, "test");
});
test("publishing and trashing compete under the same site/resource locks", async (t) => {
  const { store, bundle } = await setup(t);
  const s = structuredClone(bundle.draft);
  s.config.songs.push({ title: "new", src: "/media/unused" });
  const results = await Promise.allSettled([
    store.transaction(async (tx) => {
      const v = await contentRepository(tx).insertVersion(s);
      await contentRepository(tx).setPublished(v.id);
    }),
    store.transaction((tx) =>
      resourceRepository(tx).setTrashed("unused", true),
    ),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.status, 409);
  const trashed = (await resourceRepository(store).get("unused")).trashed;
  assert.notEqual(
    trashed,
    await resourceRepository(store).isPublished("unused"),
  );
});
test("resetting admin cleans preview reference owners before cascade", async (t) => {
  const { store, bundle } = await setup(t);
  await store.transaction((tx) =>
    contentRepository(tx).insertPreview({
      id: "old",
      owner: "admin",
      expires: "2099-01-01",
      snapshot: bundle.draft,
      references: collectReferences(bundle.draft),
    }),
  );
  await store.transaction((tx) =>
    authRepository(tx).replaceAdmin({ username: "newadmin", hash: "newhash" }),
  );
  assert.equal(
    (
      await store.query(
        "SELECT * FROM personal_site.resource_references WHERE owner_type='preview'",
      )
    ).rowCount,
    0,
  );
});
test("reference resolver replaces overridden UIL media and includes transitive font companions", () => {
  const s = composeSnapshot({
    config: {
      site: {},
      projects: [],
      songs: [],
      scenes: [
        {
          id: "Home",
          fields: [{ key: "hero", type: "resource", value: "/media/new" }],
        },
      ],
    },
    template: {
      baseUIL: { hero: { src: "old.png" }, font: { src: "font.json" } },
      contact: {},
      metadata: {},
      fontCoverage: {},
      readiness: {},
    },
    assets: {
      old: { resourceId: "old", fileName: "old.png" },
      font: {
        resourceId: "font",
        fileName: "font.json",
        companions: ["atlas"],
      },
      atlas: {
        resourceId: "atlas",
        fileName: "atlas.png",
        dependencies: ["coverage"],
      },
      coverage: { resourceId: "coverage", fileName: "coverage.json" },
    },
    legacyMap: {},
  });
  assert.deepEqual(
    [...new Set(collectReferences(s).map((r) => r.resourceId))].sort(),
    ["atlas", "coverage", "font", "new"],
  );
});
test("public media projection pins known slots but does not rewrite navigation", () => {
  const url = "assets/image.png";
  const s = composeSnapshot({
    config: {
      site: { title: "Test", labUrl: url, password: "secret" },
      projects: [
        {
          slug: "x",
          name: "X",
          projectURL: url,
          video: { url, thumbnail: url, key: "private" },
        },
      ],
      scenes: [
        {
          id: "Home",
          fields: [
            { key: "hero", type: "resource", value: url },
            { key: "copy", type: "text", value: url },
          ],
        },
      ],
      songs: [{ title: "Song", src: url }],
    },
    template: {
      baseUIL: {},
      contact: {},
      metadata: {},
      fontCoverage: {},
      readiness: {},
    },
    assets: {
      image: { resourceId: "image", fileName: "image.png", key: "private" },
    },
    legacyMap: { [url]: "image" },
  });
  const p = publicSnapshot(s, 42);
  assert.equal(p.site.labUrl, url);
  assert.equal(p.projects[0].projectURL, url);
  assert.equal(p.scenes[0].fields[1].value, url);
  assert.equal(
    p.projects[0].video.url,
    "/api/site/42/resources/image/image.png",
  );
  assert.equal(p.songs[0].src, p.projects[0].video.url);
  assert.equal(p.projects[0].video.key, undefined);
  assert.equal(p.site.password, undefined);
});
test("content fixture contains real legacy database and tiny source assets", (t) => {
  const f = contentFixture(t);
  assert.ok(fs.existsSync(f.legacyPath));
  const db = new DatabaseSync(f.legacyPath, { readOnly: true });
  try {
    assert.equal(db.prepare("SELECT id FROM versions").get().id, 42);
  } finally {
    db.close();
  }
  assert.ok(fs.existsSync(`${f.root}/assets/data/uil.fixture.json`));
  assert.ok(fs.existsSync(`${f.root}/assets/images/font.png`));
});
test("resource inserts reject dangling storage and protect conversion originals", async (t) => {
  const { store } = await setup(t);
  await assert.rejects(
    resourceRepository(store).insert({
      id: "dangling",
      source: "local",
      storageId: "missing",
      url: "/media/dangling",
      name: "bad",
      kind: "image",
      status: "uploaded",
    }),
    (e) => e.code === "23503",
  );
  await store.transaction((tx) =>
    resourceRepository(tx).insert({
      id: "converted",
      source: "local",
      storageId: "local",
      originalId: "unused",
      url: "/media/converted",
      name: "converted",
      kind: "model",
      status: "ready",
    }),
  );
  await assert.rejects(
    store.transaction((tx) =>
      resourceRepository(tx).setTrashed("unused", true),
    ),
    (e) => e.status === 409,
  );
});
test("bundle imports preserve historical audit timestamps", async (t) => {
  const { store } = await postgresFixture(t);
  const { bundle } = contentFixture(t);
  bundle.audit[0].created = "2020-01-01T00:00:00.000Z";
  await store.transaction((tx) => contentRepository(tx).importBundle(bundle));
  assert.equal(
    (await auditRepository(store).recent())[0].created,
    bundle.audit[0].created,
  );
});
test("bundle imports conversion dependencies independently of array ordering", async (t) => {
  const { store } = await postgresFixture(t);
  const { bundle } = contentFixture(t);
  bundle.resources.unshift({
    id: "converted",
    source: "local",
    storageId: "local",
    originalId: "unused",
    url: "/media/converted",
    name: "converted",
    kind: "model",
    status: "ready",
  });
  await store.transaction((tx) => contentRepository(tx).importBundle(bundle));
  assert.equal(
    (await resourceRepository(store).get("converted")).originalId,
    "unused",
  );
});
test("converted model aliases resolve direct references and pinned public media", () => {
  for (const url of ["/models/model.bin", "/assets/geometry/admin/model.bin"]) {
    const s = composeSnapshot({
      config: {
        site: {},
        projects: [],
        songs: [],
        scenes: [
          {
            id: "Home",
            fields: [{ key: "geometry", type: "geometry", value: url }],
          },
        ],
      },
      template: {
        baseUIL: {},
        contact: {},
        metadata: {},
        fontCoverage: {},
        readiness: {},
      },
      assets: { geometry: { resourceId: "model", fileName: "model.bin" } },
      legacyMap: {},
    });
    assert.ok(collectReferences(s).some((r) => r.resourceId === "model"));
    assert.equal(
      publicSnapshot(s, 42).scenes[0].fields[0].value,
      "/api/site/42/resources/model/model.bin",
    );
  }
});
test("draft read remains coherent if a writer commits immediately after its settings query", async (t) => {
  const { store } = await setup(t);
  const before = await contentRepository(store).getDraft();
  const next = structuredClone(before.config);
  next.site.title = "Updated";
  next.projects[0].name = "Updated";
  let fired = false;
  const reader = {
    async query(sql, values) {
      const result = await store.query(sql, values);
      if (!fired && sql.includes("site_settings")) {
        fired = true;
        await store.transaction((tx) =>
          contentRepository(tx).writeDraft(next, before.revision),
        );
      }
      return result;
    },
  };
  const result = await contentRepository(reader).getDraft();
  assert.equal(result.config.site.title, before.config.site.title);
  assert.equal(result.config.projects[0].name, before.config.projects[0].name);
});
test("locked draft read takes its coherent snapshot after waiting for the writer", async (t) => {
  const { store } = await setup(t);
  const before = await contentRepository(store).getDraft();
  const next = structuredClone(before.config);
  next.site.title = "All new";
  next.projects[0].name = "All new";
  next.scenes[0].label = "All new";
  next.songs[0].title = "All new";
  let releaseWriter;
  const release = new Promise((resolve) => {
    releaseWriter = resolve;
  });
  let writerLocked;
  const locked = new Promise((resolve) => {
    writerLocked = resolve;
  });
  let readerStarted;
  const started = new Promise((resolve) => {
    readerStarted = resolve;
  });
  const writer = store.transaction(async (tx) => {
    const pid = (await tx.query("SELECT pg_catalog.pg_backend_pid() AS pid"))
      .rows[0].pid;
    await tx.query(
      "SELECT id FROM personal_site.site_settings WHERE id=true FOR UPDATE",
    );
    writerLocked(pid);
    await release;
    await contentRepository(tx).writeDraft(next, before.revision);
  });
  const writerPid = await locked;
  const reader = store.transaction(async (tx) => {
    readerStarted(
      (await tx.query("SELECT pg_catalog.pg_backend_pid() AS pid")).rows[0].pid,
    );
    return contentRepository(tx).getDraft({ lock: true });
  });
  const readerPid = await started;
  try {
    const deadline = Date.now() + 3000;
    let blocked = false;
    while (Date.now() < deadline) {
      blocked = (
        await store.query(
          "SELECT $1::integer = ANY(pg_catalog.pg_blocking_pids($2::integer)) AS blocked",
          [writerPid, readerPid],
        )
      ).rows[0].blocked;
      if (blocked) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(
      blocked,
      true,
      "reader must demonstrably wait on writer's real row lock",
    );
  } finally {
    releaseWriter();
  }
  await writer;
  const result = await reader;
  assert.equal(result.revision, before.revision + 1);
  assert.equal(result.config.site.title, "All new");
  assert.equal(result.config.projects[0].name, "All new");
  assert.equal(result.config.scenes[0].label, "All new");
  assert.equal(result.config.songs[0].title, "All new");
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { postgresFixture } = require("./helpers/postgres");
const { contentFixture } = require("./helpers/content");
const { contentRepository } = require("../admin-server/repositories/content");

test("content and resource orchestration keep SQL exclusively in repositories", () => {
  for (const name of ["content", "resources"]) {
    const source = fs.readFileSync(path.join(__dirname, "../admin-server/services", `${name}.js`), "utf8");
    assert.doesNotMatch(source, /\b(?:tx|store)\.query\s*\(/, name);
  }
});

test("template media updates use the supplied transaction and preserve schema with rollback", async (t) => {
  const { store } = await postgresFixture(t);
  const { bundle } = contentFixture(t);
  await store.transaction((tx) => contentRepository(tx).importBundle(bundle));
  const before = await contentRepository(store).getTemplate();
  const media = { template: before.template, assets: {}, legacyMap: {} };
  await assert.rejects(store.transaction(async (tx) => {
    const repo = contentRepository(tx);
    assert.equal(typeof repo.lockSite, "function");
    assert.equal(typeof repo.updateTemplateMedia, "function");
    await repo.lockSite();
    await repo.updateTemplateMedia(media);
    const updated = await repo.getTemplate();
    assert.deepEqual(updated, { schema: before.schema, ...media });
    throw new Error("intentional rollback");
  }), /intentional rollback/);
  assert.deepEqual(await contentRepository(store).getTemplate(), before);
});

test("repository site lock waits on the same real site row before allowing media writes", async (t) => {
  const { store } = await postgresFixture(t);
  const { bundle } = contentFixture(t);
  await store.transaction((tx) => contentRepository(tx).importBundle(bundle));
  assert.equal(typeof contentRepository(store).lockSite, "function");
  let releaseWriter, writerReady, readerReady;
  const release = new Promise((resolve) => { releaseWriter = resolve; });
  const locked = new Promise((resolve) => { writerReady = resolve; });
  const started = new Promise((resolve) => { readerReady = resolve; });
  const writer = store.transaction(async (tx) => {
    await contentRepository(tx).lockSite();
    writerReady((await tx.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    await release;
  });
  const writerPid = await locked;
  const reader = store.transaction(async (tx) => {
    readerReady((await tx.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    await contentRepository(tx).lockSite();
  });
  const readerPid = await started;
  try {
    const deadline = Date.now() + 3000;
    let blocked = false;
    while (Date.now() < deadline) {
      blocked = (await store.query("SELECT $1::integer = ANY(pg_blocking_pids($2::integer)) AS blocked", [writerPid, readerPid])).rows[0].blocked;
      if (blocked) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(blocked, true, "the repository must acquire the existing site row lock");
  } finally {
    releaseWriter();
    await Promise.all([writer, reader]);
  }
});

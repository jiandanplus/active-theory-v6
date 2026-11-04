const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { deliveryFixture } = require("./helpers/delivery");

// SQL statements per request after warm-up. Budgets are ceilings; lower is fine.
// Lower a budget when an optimization lands so regressions fail loudly.
// Before the read-path work: page 17, endpoint/runtime 16, asset 10,
// resource/media 8, and the version list cost 7 SQL per version.
const BUDGET = {
  page: 6,
  endpoint: 6,
  runtime: 6,
  asset: 6,
  resource: 6,
  media: 6,
  versions: 9,
};

function counter(store) {
  const log = [];
  const query = store.query.bind(store),
    transaction = store.transaction.bind(store);
  store.query = (text, values) => {
    log.push(text);
    return query(text, values);
  };
  store.transaction = (fn) =>
    transaction((tx) =>
      fn({
        query: (text, values) => {
          log.push(text);
          return tx.query(text, values);
        },
      }),
    );
  return log;
}
async function cost(f, log, route, init) {
  await (await f.request(route, { redirect: "manual", ...init })).arrayBuffer();
  log.length = 0;
  const response = await f.request(route, { redirect: "manual", ...init });
  await response.arrayBuffer();
  return { status: response.status, queries: log.length };
}

test(
  "public and admin requests stay within SQL budgets",
  { timeout: 120000 },
  async (t) => {
    const f = await deliveryFixture(t, { publish: true });
    fs.mkdirSync(f.root + "/data/uploads", { recursive: true });
    fs.writeFileSync(f.root + "/data/uploads/font.png", Buffer.from("font"));
    fs.writeFileSync(f.root + "/data/uploads/image.png", Buffer.from("image"));
    for (const id of ["image", "font"])
      await f.store.query(
        "UPDATE personal_site.resources SET source='local',storage_id='local',object_key=$1 WHERE id=$2",
        [id + ".png", id],
      );
    const log = counter(f.store);
    const v = f.published;
    const measured = {
      page: await cost(f, log, "/"),
      endpoint: await cost(f, log, `/api/site/${v}/identity.js`),
      runtime: await cost(f, log, `/api/site/${v}/runtime/app`),
      asset: await cost(f, log, "/assets/font.png"),
      resource: await cost(f, log, `/api/site/${v}/resources/image/image.png`),
      media: await cost(f, log, "/media/image"),
    };
    for (const [name, { status, queries }] of Object.entries(measured)) {
      assert.equal(status, 200, name);
      assert.ok(
        queries <= BUDGET[name],
        `${name}: ${queries} SQL > budget ${BUDGET[name]}`,
      );
    }
    // A logged-in admin browsing the public site costs no session lookup.
    log.length = 0;
    await (
      await f.request("/", { headers: { Cookie: f.headers.Cookie } })
    ).arrayBuffer();
    assert.equal(
      log.filter((text) => /personal_site\.sessions/.test(text)).length,
      0,
    );
    // The admin version list is constant in the number of versions.
    const sizes = [];
    for (const extra of [0, 6]) {
      for (let i = 0; i < extra; i++)
        await f.service.publish({ revision: 3, actor: f.actor });
      const list = await cost(f, log, "/api/admin/versions", {
        headers: { Cookie: f.headers.Cookie },
      });
      assert.equal(list.status, 200);
      sizes.push(list.queries);
      assert.ok(
        list.queries <= BUDGET.versions,
        `versions: ${list.queries} SQL > budget ${BUDGET.versions}`,
      );
    }
    assert.equal(sizes[0], sizes[1], "version list SQL must not grow");
    t.diagnostic(JSON.stringify({ ...measured, versions: sizes }));
  },
);

test("saving a 16-project draft batches list writes and round-trips exactly", async (t) => {
  const { httpFixture } = require("./helpers/http");
  const { contentRepository } = require("../admin-server/repositories/content");
  const f = await httpFixture(t);
  const draft = await contentRepository(f.store).getDraft();
  const config = structuredClone(draft.config);
  const base = config.projects[0];
  config.projects = Array.from({ length: 16 }, (_, i) => ({
    ...structuredClone(base),
    id: `p${i}`,
    slug: `project-${i}`,
    name: `Project ${i} "quoted" \\ back`,
  }));
  config.songs = [
    { title: "A", src: "/media/audio" },
    { title: "B, with comma", src: "/media/audio" },
  ];
  const log = [];
  await f.store.transaction(async (tx) => {
    const counted = {
      query: (text, values) => {
        if (/personal_site\.(scenes|projects|songs)\b/.test(text))
          log.push(text);
        return tx.query(text, values);
      },
    };
    await contentRepository(counted).writeDraft(config, draft.revision);
  });
  assert.ok(log.length <= 8, `list statements ${log.length}`);
  const saved = (await contentRepository(f.store).getDraft()).config;
  assert.deepEqual(
    saved.projects.map(({ id, slug, name }) => ({ id, slug, name })),
    config.projects.map(({ id, slug, name }) => ({ id, slug, name })),
  );
  assert.deepEqual(saved.projects[3], config.projects[3]);
  assert.deepEqual(
    saved.songs.map(({ title, src }) => ({ title, src })),
    config.songs,
  );
  assert.deepEqual(saved.scenes, config.scenes);
});

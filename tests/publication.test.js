const { test } = require("node:test");
const assert = require("node:assert/strict");
const { httpFixture } = require("./helpers/http");
const { contentRepository } = require("../admin-server/repositories/content");
const { validatePublication } = require("../admin-server/publication");
test('site image publication grants survive clear and restore without rewriting history', async t => {
  const f = await require('./helpers/delivery').deliveryFixture(t), repo = contentRepository(f.store);
  const {saveDraft,publish,restore} = require('../admin-server/config');
  await f.store.query("UPDATE personal_site.resources SET details=$1 WHERE id='unused'",[{path:'assets/images/image.png'}]);
  const history = (await f.store.query('SELECT snapshot::text AS snapshot FROM personal_site.versions WHERE id=42')).rows;
  const draft = await repo.getDraft();
  draft.config.site.socialImage='/media/unused';
  draft.config.site.description='中文描述';
  draft.config.site.language='zh-CN';
  const revision=await saveDraft(f.store,draft.config,draft.revision);
  assert.equal((await f.request('/api/site/42/resources/unused/unused.png')).status,404);
  const version=await publish(f.store,revision,{root:f.root,dataDir:f.root+'/data'},f.actor,{deliveryService:f.service});
  const config=await (await f.request(`/api/site/${version}/config`)).json();
  assert.match(config.site.socialImage,new RegExp(`^/api/site/${version}/resources/unused/`));
  assert.equal(config.site.description,'中文描述');
  assert.equal(config.site.language,'zh-CN');
  assert.equal((await f.request(config.site.socialImage)).status,200);
  const next=await repo.getDraft(); next.config.site.socialImage='';
  await saveDraft(f.store,next.config,next.revision);
  assert.equal((await f.request(config.site.socialImage)).status,200);
  await restore(f.store,42,(await repo.getDraft()).revision);
  assert.equal((await repo.getDraft()).config.site.language,'en');
  assert.deepEqual((await f.store.query('SELECT snapshot::text AS snapshot FROM personal_site.versions WHERE id=42')).rows,history);
});
for (const patch of [{status:'disabled'},{status:'missing'},{status:'failed'},{trashed:true},{kind:'audio'}])
  test(`site image publication rejects ${JSON.stringify(patch)}`,async t=>{
    const f=await require('./helpers/delivery').deliveryFixture(t), repo=contentRepository(f.store);
    const {saveDraft,publish}=require('../admin-server/config');
    const draft=await repo.getDraft(); draft.config.site.socialImage='/media/unused';
    const revision=await saveDraft(f.store,draft.config,draft.revision);
    await f.store.query('UPDATE personal_site.resources SET status=$1,trashed=$2,kind=$3 WHERE id=$4',[patch.status||'ready',patch.trashed||false,patch.kind||'image','unused']);
    await assert.rejects(publish(f.store,revision,{root:f.root,dataDir:f.root+'/data'},f.actor,{deliveryService:f.service}),{status:422});
  });
test('site image rejects known audio identities when saving',async t=>{
  const f=await httpFixture(t), draft=await contentRepository(f.store).getDraft();
  draft.config.site.socialImage='/media/audio';
  await assert.rejects(require('../admin-server/config').saveDraft(f.store,draft.config,draft.revision),/图片/);
});
test('site image rejects registered external audio without changing its kind',async t=>{
  const f=await httpFixture(t), repo=contentRepository(f.store), {saveDraft}=require('../admin-server/config');
  const url='https://external.invalid/song.mp3', first=await repo.getDraft();
  first.config.songs.push({id:'external',title:'External',src:url});
  await saveDraft(f.store,first.config,first.revision);
  const next=await repo.getDraft(); next.config.site.socialImage=url;
  await assert.rejects(saveDraft(f.store,next.config,next.revision),/图片/);
  assert.equal((await f.store.query('SELECT kind FROM personal_site.resources WHERE url=$1',[url])).rows[0].kind,'audio');
});
test('site text does not create incidental media grants',()=>{
  const {collectReferences}=require('../admin-server/snapshots');
  const snapshot={config:{site:{title:'/media/private',description:'/media/private',socialImage:''},projects:[],scenes:[],songs:[]},template:{baseUIL:{}},assets:{},legacyMap:{}};
  assert.deepEqual(collectReferences(snapshot),[]);
  snapshot.config.site.socialImage='/media/image';
  assert.deepEqual(collectReferences(snapshot),[{resourceId:'image',slot:'config.site.socialImage'}]);
});
test("publication rejects missing managed resources and uses database font coverage", async (t) => {
  const { store, root } = await httpFixture(t);
  const draft = (await contentRepository(store).getDraft()).snapshot;
  draft.config.scenes[0].fields[0].value = "/media/missing";
  await assert.rejects(validatePublication(store, { root }, draft), /不存在/);
  draft.config.scenes[0].fields = [
    { key: "demo_text", label: "Text", type: "text", value: "中" },
  ];
  draft.template.baseUIL.demo_text = "A";
  draft.template.baseUIL.demo_fontStyle = "font: Demo";
  draft.assets.demoFont = {
    resourceId: "font",
    fileName: "assets/fonts/Demo.json",
  };
  draft.legacyMap["assets/fonts/Demo.json"] = "demoFont";
  draft.template.fontCoverage.font = "ABC";
  await assert.rejects(validatePublication(store, { root }, draft), /字形/);
  draft.config.scenes[0].fields[0].value = "B";
  await validatePublication(store, { root }, draft);
  draft.config.scenes[0].fields = [
    { key: "geometry", type: "geometry", value: "/media/image" },
  ];
  await store.query(
    "UPDATE personal_site.resources SET status='uploaded' WHERE id='image'",
  );
  await assert.rejects(validatePublication(store, { root }, draft), /转换/);
  draft.config.scenes[0].fields[0].value = "/models/image.bin";
  await assert.rejects(validatePublication(store, { root }, draft), /转换/);
});

test("unregistered local media cannot bypass publication and external media is warned without fetching", async (t) => {
  const f = await httpFixture(t),
    snapshot = (await contentRepository(f.store).getDraft()).snapshot;
  snapshot.config.scenes[0].fields[0].value = "assets/absent.png";
  await assert.rejects(
    validatePublication(f.store, { root: f.root }, snapshot),
    /不存在/,
  );
  snapshot.config.scenes[0].fields[0].value =
    "https://external.invalid/file.png";
  assert.equal(
    (await validatePublication(f.store, { root: f.root }, snapshot)).length,
    1,
  );
});
test("preview is owned, expires after thirty minutes, prunes references and keeps five", async (t) => {
  const f = await require('./helpers/delivery').deliveryFixture(t);
  const headers = f.headers;
  let url;
  for (let i = 0; i < 6; i++) {
    const response = await f.request("/api/admin/preview", {
      method: "POST",
      headers,
      body: JSON.stringify({ revision: 3 }),
    });
    assert.equal(response.status, 200);
    url = (await response.json()).url;
  }
  const rows = (
    await f.store.query("SELECT * FROM personal_site.previews ORDER BY expires")
  ).rows;
  assert.equal(rows.length, 5);
  assert.ok(
    Math.abs(rows[0].expires.getTime() - Date.now() - 30 * 60000) < 5000,
  );
  assert.equal((await f.request(url)).status, 401);
  assert.equal((await f.request(url, { headers })).status, 200);
  await f.store.query(
    "UPDATE personal_site.previews SET expires=now()-interval '1 second'",
  );
  assert.equal((await f.request(url)).status, 401);
  assert.equal((await f.request(url, { headers })).status, 404);
  assert.equal(
    (
      await f.store.query(
        "SELECT * FROM personal_site.resource_references WHERE owner_type='preview'",
      )
    ).rowCount,
    0,
  );
});
test("publication rechecks resource/storage state inside transaction and awaits audit rollback", async (t) => {
  const f = await require('./helpers/delivery').deliveryFixture(t),
    { publish } = require("../admin-server/config");
  await f.store.query(
    "UPDATE personal_site.resources SET storage_id='local' WHERE id='image'",
  );
  const raced = {
    query: f.store.query,
    transaction: async (fn) => {
      await f.store.query(
        "UPDATE personal_site.storages SET available=false WHERE id='local'",
      );
      return f.store.transaction(fn);
    },
  };
  const service=require('../admin-server/delivery/service').createDeliveryService({store:raced,options:{root:f.root,dataDir:f.root+'/data'},registry:f.runtime.registry});
  await assert.rejects(publish(raced, 3, { root: f.root }, f.actor, {deliveryService:service}), /存储/);
  assert.equal((await contentRepository(f.store).getDraft()).published, 42);
  await f.store.query("UPDATE personal_site.storages SET available=true");
  await f.store.query(
    "CREATE FUNCTION personal_site.fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit rejected'; END; $$",
  );
  await f.store.query(
    "CREATE TRIGGER reject_audit BEFORE INSERT ON personal_site.audit_events FOR EACH ROW EXECUTE FUNCTION personal_site.fail_audit()",
  );
  await assert.rejects(publish(f.store, 3, { root: f.root }, f.actor, {deliveryService:f.service}), /audit rejected/);
  assert.equal((await contentRepository(f.store).getDraft()).published, 42);
  assert.equal((await contentRepository(f.store).listVersions()).length, 1);
  assert.equal(
    (
      await f.store.query(
        "SELECT * FROM personal_site.resource_references WHERE owner_type='version' AND owner_id!='42'",
      )
    ).rowCount,
    0,
  );
});
test("concurrent save/publication cannot publish a mixed revision", async (t) => {
  const f = await require('./helpers/delivery').deliveryFixture(t),
    { saveDraft, publish } = require("../admin-server/config"),
    repo = contentRepository(f.store);
  const original = (await repo.getDraft()).config,
    changed = structuredClone(original);
  changed.site.title = "Changed";
  changed.projects[0].name = "Changed project";
  const outcomes = await Promise.allSettled([
    publish(f.store, 3, { root: f.root }, f.actor, {deliveryService:f.service}),
    saveDraft(f.store, changed, 3),
  ]);
  assert.equal(outcomes[1].status, "fulfilled");
  if (outcomes[0].status === "fulfilled") {
    const snap = (await repo.getVersion(outcomes[0].value)).snapshot;
    assert.deepEqual(snap.config, original);
  } else assert.equal(outcomes[0].reason.status, 409);
  assert.equal((await repo.getDraft()).config.site.title, "Changed");
});

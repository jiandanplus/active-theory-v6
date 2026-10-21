const { test } = require("node:test"),
  assert = require("node:assert/strict");
const path = require("node:path");
const { createApp } = require("../admin-server/app");
const { glb } = require("./fixtures/model");
test("HTTP workflow keeps drafts private and publishes uploaded converted models through engine aliases", async (t) => {
  const { httpFixture } = require("./helpers/http");
  const runtime=require('./helpers/runtime').testRuntime(t);
  // This integration covers scene geometry overrides as well as package bytes.
  // Its explicit test profile must project those fields into the built UIL.
  const registry={get:id=>({...runtime.registry.get(id),transformUIL:snapshot=>({data:require('../admin-server/config').buildUIL(snapshot),report:[]})})};
  const serviceFactory=({store,options})=>require('../admin-server/delivery/service').createDeliveryService({store,options,registry});
  const f = await httpFixture(t, { installed: false, serviceFactory });
  const bundle = structuredClone(f.bundle);
  bundle.admin = null;
  const geometryKey = "INPUT_Config_8_ParticleTest_geometry";
  for (const config of [bundle.schema, bundle.draft.config, ...bundle.versions.map(v => v.snapshot.config)]) {
    config.scenes[0].fields.push({key:geometryKey, type:"geometry", value:"/media/image"});
  }
  await f.store.transaction(async (tx) => {
    await require("../admin-server/repositories/content")
      .contentRepository(tx)
      .importBundle(bundle);
    await tx.query(
      "INSERT INTO personal_site.installation(id,source,schema_version) VALUES(true,'fixture',$1)",
      [require('../admin-server/migrations').currentSchemaVersion],
    );
  });
  await f.createAdmin();
  const root = f.root,
    base = f.base,
    headers = await f.login();
  const actor=(await f.store.query('SELECT id,username FROM personal_site.sessions')).rows[0];
  const service=f.app.locals.deliveryService;
  const registered=await service.register({root:runtime.root,manifest:runtime.manifest,actor});
  await service.select({digest:registered.digest,expectedGeneration:0,actor});
  await service.legacy({versionId:42,expectedGeneration:0,actor});
  const api = async (url, body, method = "POST") => {
    const response = await fetch(base + "/api/admin" + url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    assert(response.ok, JSON.stringify(data));
    return data;
  };
  const form = new FormData();
  form.append("file", new Blob([glb()]), "triangle.glb");
  const uploadHeaders = { ...headers };
  delete uploadHeaders["Content-Type"];
  const uploaded = await fetch(base + "/api/admin/resources/upload", {
    method: "POST",
    headers: uploadHeaders,
    body: form,
  });
  assert.equal(uploaded.status, 201);
  const source = (await uploaded.json()).resource;
  const secondApp = createApp({
    root,
    dataDir: path.join(root, "data"),
    origin: "http://localhost:3000",
    store: f.store,
  }, {deliveryService:service});
  const secondServer = secondApp.listen(0, "127.0.0.1");
  await new Promise((resolve) => secondServer.once("listening", resolve));
  t.after(() => new Promise((resolve) => secondServer.close(resolve)));
  const secondBase = `http://127.0.0.1:${secondServer.address().port}`;
  const [firstConversion, secondConversion] = await Promise.all([
    fetch(base + "/api/admin/resources/" + source.id + "/convert", {
      method: "POST",
      headers,
      body: '{"size":0.8}',
    }),
    fetch(secondBase + "/api/admin/resources/" + source.id + "/convert", {
      method: "POST",
      headers,
      body: '{"size":1.2}',
    }),
  ]);
  assert.equal(firstConversion.status, 201);
  assert.equal(secondConversion.status, 201);
  const { resource } = await firstConversion.json();
  assert.equal(resource.status, "ready");
  const { resource: second } = await secondConversion.json();
  assert.notEqual(second.id, resource.id);
  assert.equal(second.originalId, source.id);
  const persisted =
    require("../admin-server/repositories/resources").resourceRepository(
      f.store,
    );
  assert.equal((await persisted.get(source.id)).status, "uploaded");
  assert.equal(resource.originalId, source.id);
  assert.equal(
    (
      await fetch(base + "/api/admin/resources/" + source.id, {
        method: "PATCH",
        headers,
        body: '{"trashed":true}',
      })
    ).status,
    409,
  );
  assert.equal((await fetch(base + resource.url)).status, 404);
  const { config, revision } = await api("/config", undefined, "GET");
  const forbidden = structuredClone(config);
  forbidden.scenes[0].fields[0].value = resource.url;
  const rejected = await fetch(base + "/api/admin/config", {
    method:"PUT", headers, body:JSON.stringify({config:forbidden, revision}),
  });
  assert.equal(rejected.status,400);
  assert.match((await rejected.json()).error,/固定视觉参数不可修改/);
  config.site.title = "Published title";
  config.scenes[0].fields.find(field => field.key===geometryKey).value = resource.url;
  const saved = await api("/config", { config, revision }, "PUT");
  assert.match(
    await (await fetch(base + "/")).text(),
    /<title>Fixture<\/title>/,
  );
  const preview = await api("/preview", { revision: saved.revision });
  assert.equal((await fetch(base + preview.url)).status, 401);
  const published = await api("/publish", { revision: saved.revision });
  assert.match(
    await (await fetch(base + "/")).text(),
    /<title>Published title<\/title>/,
  );
  const uil = await (
    await fetch(base + `/api/site/${published.version}/uil.json`)
  ).json();
  const url = uil[geometryKey].src;
  assert.match(
    url,
    new RegExp(
      `^/api/site/${published.version}/resources/${resource.id}/.*\\.bin$`,
    ),
  );
  const model = await fetch(base + url);
  assert.equal(model.status, 200);
  assert((await model.arrayBuffer()).byteLength > 90);
  assert.equal((await fetch(base + resource.url)).status, 200);
  assert.equal(
    (
      await fetch(base + "/api/admin/resources/" + resource.id, {
        method: "PATCH",
        headers,
        body: '{"trashed":true}',
      })
    ).status,
    409,
  );
  const beforeReset = headers.Cookie;
  await api("/password", {
    currentPassword: "a-valid-long-password-2026",
    newPassword: "a-new-test-password-2026",
  });
  assert.equal(
    (
      await fetch(base + "/api/admin/config", {
        headers: { Cookie: beforeReset },
      })
    ).status,
    401,
  );
});

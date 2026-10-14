const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

async function fixture(t) {
  return require("./helpers/http").httpFixture(t);
}

test("private routes and legacy write endpoints are protected", async (t) => {
  const { request } = await fixture(t);
  assert.equal((await request("/api/admin/config")).status, 401);
  for (const name of [
    "/server.js",
    "/data/site.db",
    "/.env",
    "/cms/projects-dev.json.bak",
    "/package.json",
  ]) {
    assert.equal((await request(name)).status, 404, name);
  }
  for (const name of ["/api/projects", "/api/build"])
    assert.equal((await request(name, { method: "POST" })).status, 401);
});

test("login, CSRF, origin rejection, logout and old session invalidation", async (t) => {
  const { app, request } = await fixture(t);
  const { createAccount } = require("../admin-server/security");
  await createAccount(app.locals.store, "owner", "a-valid-long-password-2026");
  const json = {
    "Content-Type": "application/json",
    Origin: "http://localhost:3000",
  };
  const bad = await request("/api/admin/login", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ username: "owner", password: "wrong" }),
  });
  assert.equal(bad.status, 401);
  const login = await request("/api/admin/login", {
    method: "POST",
    headers: json,
    body: JSON.stringify({
      username: "owner",
      password: "a-valid-long-password-2026",
    }),
  });
  assert.equal(login.status, 200);
  assert.match(login.headers.get("set-cookie"), /HttpOnly/);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const { csrfToken } = await login.json();
  const headers = { ...json, Cookie: cookie, "X-CSRF-Token": csrfToken };
  assert.equal((await request("/api/admin/config", { headers })).status, 200);
  assert.equal(
    (
      await request("/api/admin/logout", {
        method: "POST",
        headers: { Cookie: cookie },
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await request("/api/admin/logout", {
        method: "POST",
        headers: { ...headers, Origin: "https://evil.example" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request("/api/admin/logout", { method: "POST", headers })).status,
    200,
  );
  assert.equal((await request("/api/admin/config", { headers })).status, 401);
});

test("initialization cannot replace account without explicit local reset", async (t) => {
  const { app } = await fixture(t);
  const { createAccount } = require("../admin-server/security");
  await assert.rejects(createAccount(app.locals.store, "owner", "short"), /12/);
  await createAccount(app.locals.store, "owner", "a-valid-long-password-2026");
  await assert.rejects(
    createAccount(app.locals.store, "owner", "another-long-password"),
    /存在/,
  );
  assert(
    !JSON.stringify(
      (await app.locals.store.query("SELECT * FROM personal_site.admins")).rows,
    ).includes("a-valid-long-password"),
  );
});

module.exports = { fixture };
test('admin identity contract is self-hosted and read-only',async t=>{
  const f=await fixture(t);
  const script=await f.request('/admin/site-identity.js');
  assert.equal(script.status,200);
  assert.equal(script.headers.get('cache-control'),'private, no-store');
  assert.match(script.headers.get('x-robots-tag'),/noindex/);
  const html=await (await f.request('/admin/')).text();
  assert(html.indexOf('/admin/site-identity.js')<html.indexOf('/admin/admin.js'));
  assert.equal((await f.request('/shared/site-identity.js')).status,404);
});
test('identity fields save in one draft revision and change public config only on publication',async t=>{
  const f=await require('./helpers/delivery').deliveryFixture(t,{publish:true}); const headers=f.headers;
  const draft=await (await f.request('/api/admin/config',{headers})).json();
  const publicURL=`/api/site/${draft.published}/config`;
  const before=await (await f.request(publicURL)).json();
  const identity={description:'网站介绍',language:'zh-CN',socialImage:'https://example.test/share.png'};
  Object.assign(draft.config.site,identity);
  const saved=await f.request('/api/admin/config',{method:'PUT',headers,body:JSON.stringify({config:draft.config,revision:draft.revision})});
  assert.equal(saved.status,200);
  const {revision}=await saved.json(); assert.equal(revision,draft.revision+1);
  const next=await (await f.request('/api/admin/config',{headers})).json();
  for(const [key,value] of Object.entries(identity)) assert.equal(next.config.site[key],value);
  assert.deepEqual(await (await f.request(publicURL)).json(),before);
  const published=await f.request('/api/admin/publish',{method:'POST',headers,body:JSON.stringify({revision})});
  assert.equal(published.status,200);
  const after=await (await f.request('/api/admin/config',{headers})).json();
  const publicConfig=await (await f.request(`/api/site/${after.published}/config`)).json();
  assert.equal(publicConfig.site.description,identity.description);
  assert.equal(publicConfig.site.language,identity.language);
  assert.match(publicConfig.site.socialImage,new RegExp(`^/api/site/${after.published}/resources/external-[a-f0-9]+/share\\.png$`));
});
test("sessions are hashed, idle/absolute expiry and password change invalidate sessions", async (t) => {
  const f = await fixture(t);
  await f.createAdmin();
  let headers = await f.login();
  const raw = headers.Cookie.split("=")[1];
  const sessions = (await f.store.query("SELECT * FROM personal_site.sessions"))
    .rows;
  assert.notEqual(sessions[0].id, raw);
  assert.equal(
    sessions[0].id,
    require("node:crypto").createHash("sha256").update(raw).digest("hex"),
  );
  await f.store.query("UPDATE personal_site.sessions SET touched=$1", [
    Date.now() - 12 * 60 * 60000,
  ]);
  assert.equal((await f.request("/api/admin/config", { headers })).status, 401);
  headers = await f.login();
  await f.store.query("UPDATE personal_site.sessions SET created=$1", [
    Date.now() - 7 * 24 * 60 * 60000,
  ]);
  assert.equal((await f.request("/api/admin/config", { headers })).status, 401);
  headers = await f.login();
  const second = await f.login();
  assert.equal(
    (
      await f.request("/api/admin/password", {
        method: "POST",
        headers,
        body: JSON.stringify({
          currentPassword: "a-valid-long-password-2026",
          newPassword: "a-brand-new-long-password",
        }),
      })
    ).status,
    200,
  );
  assert.equal(
    (await f.request("/api/admin/config", { headers: second })).status,
    401,
  );
  assert.equal(
    (await f.store.query("SELECT * FROM personal_site.sessions")).rowCount,
    0,
  );
});
test('pinned preview access rejects logged-out/reset sessions and reset cascades its binding',async t=>{
  const f=await require('./helpers/delivery').deliveryFixture(t);
  const response=await f.request('/api/admin/preview',{method:'POST',headers:f.headers,body:JSON.stringify({revision:3})});
  assert.equal(response.status,200);
  const url=(await response.json()).url,id=url.split('=')[1];
  const {deliveryRepository}=require('../admin-server/repositories/deliveries');
  const binding=await deliveryRepository(f.store).getBinding({type:'preview',id});
  const artifact=await deliveryRepository(f.store).getArtifact(binding.artifactDigest);
  assert.equal((await f.request(url,{headers:f.headers})).status,200);
  assert.equal((await f.request('/api/admin/logout',{method:'POST',headers:f.headers})).status,200);
  const denied=await f.request(url,{headers:f.headers});
  assert.equal(denied.status,401);
  assert.equal(denied.headers.get('cache-control'),'private, no-store');
  const headers=await f.login();
  await require('../admin-server/security').createAccount(f.store,'owner','a-valid-long-password-2026',{reset:true});
  assert.equal((await f.request(url,{headers})).status,401);
  assert.equal(await deliveryRepository(f.store).getBinding({type:'preview',id}),null);
  assert.equal((await f.store.query("SELECT id FROM personal_site.previews WHERE id=$1",[id])).rowCount,0);
  assert.equal((await f.store.query("SELECT * FROM personal_site.resource_references WHERE owner_type='preview' AND owner_id=$1",[id])).rowCount,0);
  // Reset revokes authorization, not shared content-addressed bytes.
  for(const file of artifact.manifest.files)assert.equal((await f.cas.read(file)).length,file.size);
});
test("login attempts persist across restart and database errors are maintenance errors", async (t) => {
  const f = await fixture(t);
  await f.createAdmin();
  for (let i = 0; i < 10; i++)
    assert.equal(
      (
        await f.request("/api/admin/login", {
          method: "POST",
          headers: f.json,
          body: JSON.stringify({ username: "owner", password: "wrong" }),
        })
      ).status,
      401,
    );
  await f.restart();
  assert.equal(
    (
      await f.request("/api/admin/login", {
        method: "POST",
        headers: f.json,
        body: JSON.stringify({ username: "owner", password: "wrong" }),
      })
    ).status,
    429,
  );
  await f.store.query(
    "ALTER TABLE personal_site.admins RENAME TO unavailable_admins",
  );
  try {
    const session = await f.request("/api/admin/session");
    assert.equal(session.status, 503);
    assert.equal((await session.json()).initialized, undefined);
    await f.store.query("DELETE FROM personal_site.login_attempts");
    const login = await f.request("/api/admin/login", {
      method: "POST",
      headers: f.json,
      body: JSON.stringify({ username: "owner", password: "wrong" }),
    });
    assert.equal(login.status, 503);
    assert.doesNotMatch((await login.json()).error, /密码不正确/);
  } finally {
    await f.store.query(
      "ALTER TABLE personal_site.unavailable_admins RENAME TO admins",
    );
  }
});
test("reset cannot initialize uninstalled content and account audit failures roll back", async (t) => {
  const f = await fixture(t);
  await f.createAdmin();
  const before = (await f.store.query("SELECT * FROM personal_site.admins"))
    .rows[0];
  await f.store.query("DELETE FROM personal_site.installation");
  await assert.rejects(
    require("../admin-server/security").createAccount(
      f.store,
      "newowner",
      "new-long-valid-password",
      { reset: true },
    ),
    /安装/,
  );
  assert.deepEqual(
    (await f.store.query("SELECT * FROM personal_site.admins")).rows[0],
    before,
  );
  await f.store.query(
    "INSERT INTO personal_site.installation(id,source,schema_version) VALUES(true,'fixture',$1)",
    [require('../admin-server/migrations').currentSchemaVersion],
  );
  const headers = await f.login();
  await f.store.query(
    "CREATE FUNCTION personal_site.fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit rejected'; END; $$",
  );
  await f.store.query(
    "CREATE TRIGGER reject_audit BEFORE INSERT ON personal_site.audit_events FOR EACH ROW EXECUTE FUNCTION personal_site.fail_audit()",
  );
  await assert.rejects(
    require("../admin-server/security").createAccount(
      f.store,
      "newowner",
      "new-long-valid-password",
      { reset: true },
    ),
    /audit rejected/,
  );
  assert.deepEqual(
    (await f.store.query("SELECT * FROM personal_site.admins")).rows[0],
    before,
  );
  assert.equal((await f.request("/api/admin/config", { headers })).status, 200);
});
test("rejects public private-data directories and malformed origins before initialization", () => {
  const { createApp } = require("../admin-server/app");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "site-options-test-"));
  try {
    assert.throws(
      () => createApp({ root, dataDir: path.join(root, "assets/private") }),
      /数据目录/,
    );
    assert.throws(
      () => createApp({ root, origin: "https://example.com/path" }),
      /SITE_ORIGIN/,
    );
    assert.throws(
      () => createApp({ root, production: true, origin: "http://example.com" }),
      /HTTPS/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

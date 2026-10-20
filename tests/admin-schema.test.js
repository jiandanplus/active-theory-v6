const test = require('node:test');
const assert = require('node:assert/strict');

test('canonical schema is authenticated, read-only without CSRF, distinct from draft, and never changes config response shape', async t => {
  const f = await require('./helpers/http').httpFixture(t);
  assert.equal((await f.request('/api/admin/config/schema')).status, 401);
  await f.createAdmin();
  const headers = await f.login();
  const repo = require('../admin-server/repositories/content').contentRepository(f.store);
  const schema = (await repo.getTemplate()).schema;
  const draft = await (await f.request('/api/admin/config', {headers})).json();
  assert.deepEqual(Object.keys(draft).sort(), ['config', 'published', 'revision']);
  draft.config.site.title = 'Different current draft';
  const saved = await f.request('/api/admin/config', {method: 'PUT', headers, body: JSON.stringify({config: draft.config, revision: draft.revision})});
  assert.equal(saved.status, 200);
  const response = await f.request('/api/admin/config/schema', {headers: {Cookie: headers.Cookie}});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), {schema});
  assert.notEqual(schema.site.title, draft.config.site.title);
  assert.deepEqual(Object.keys(await (await f.request('/api/admin/config', {headers})).json()).sort(), ['config', 'published', 'revision']);
  assert.equal((await f.request('/api/admin/config/schema', {method: 'PUT', headers: {Cookie: headers.Cookie, 'Content-Type': 'application/json'}, body: '{}'})).status, 403);
  await f.request('/api/admin/logout', {method: 'POST', headers});
  assert.equal((await f.request('/api/admin/config/schema', {headers})).status, 401);
});

test('canonical legacy HTTP survives HTTPS draft restore and unrelated save but never grants a new HTTP URL', async t => {
  const f = await require('./helpers/http').httpFixture(t);
  await f.createAdmin();
  const headers = await f.login();
  const repo = require('../admin-server/repositories/content').contentRepository(f.store);
  const schema = (await repo.getTemplate()).schema;
  schema.projects[0].projectURL = 'http://legacy.invalid';
  const historic = (await repo.getVersion(42)).snapshot;
  historic.config.projects[0].projectURL = 'http://legacy.invalid';
  await f.store.query('UPDATE personal_site.templates SET schema_config=$1 WHERE id=(SELECT template_id FROM personal_site.site_settings WHERE id=true)', [schema]);
  await f.store.query('UPDATE personal_site.versions SET snapshot=$1 WHERE id=42', [historic]);
  let draft = await (await f.request('/api/admin/config', {headers})).json();
  draft.config.projects[0].projectURL = 'https://new.invalid';
  async function save() {
    return f.request('/api/admin/config', {method: 'PUT', headers, body: JSON.stringify({config: draft.config, revision: draft.revision})});
  }
  const saved = await save(); assert.equal(saved.status, 200);
  const revision = (await saved.json()).revision;
  const canonical = await (await f.request('/api/admin/config/schema', {headers})).json();
  assert.equal(canonical.schema.projects[0].projectURL, 'http://legacy.invalid');
  const restored = await f.request('/api/admin/versions/42/restore', {method: 'POST', headers, body: JSON.stringify({revision})});
  assert.equal(restored.status, 200);
  draft = await (await f.request('/api/admin/config', {headers})).json();
  assert.equal(draft.config.projects[0].projectURL, 'http://legacy.invalid');
  draft.config.site.title = 'An unrelated edit';
  require('../shared/content-contract').validateConfig(draft.config, canonical.schema);
  const resaved = await save(); assert.equal(resaved.status, 200);
  draft.revision = (await resaved.json()).revision;
  draft.config.projects[0].projectURL = 'http://unknown.invalid';
  assert.throws(() => require('../shared/content-contract').validateConfig(draft.config, canonical.schema), /HTTPS/);
  const denied = await save(); assert.equal(denied.status, 400);
  assert.match((await denied.json()).error, /HTTPS/);
});

const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {postgresFixture} = require('./helpers/postgres');
const {httpFixture} = require('./helpers/http');
const {currentSchemaVersion,signatureQuery:query,schemaSignature:expected} = require('../admin-server/migrations');

test('PG18 catalog fingerprint reproduces from untouched 001 SQL in two fresh isolated databases', async t => {
  const digest = value => require('node:crypto').createHash('sha256').update(value).digest('hex');
  const sql = readFileSync('admin-server/migrations/001-initial.sql','utf8');
  for (let i=0;i<2;i++) {
    const {store} = await postgresFixture(t, {migrated:false});
    await store.transaction(async tx => {
      await tx.query(sql);
      await tx.query('INSERT INTO personal_site.schema_migrations(version,checksum) VALUES($1,$2)',[1,digest(sql)]);
    });
    assert.equal(digest(JSON.stringify((await store.query(query)).rows)), expected);
    assert.deepEqual(await require('../admin-server/migrations').inspectInstallation(store), {state:'uninstalled',schemaVersion:1});
    await store.transaction(require('../admin-server/migrations').migrate);
    assert.equal(digest(JSON.stringify((await store.query(query)).rows)), expected);
    assert.deepEqual(await require('../admin-server/migrations').inspectInstallation(store), {state:'uninstalled',schemaVersion:currentSchemaVersion});
  }
});

test('explicit upgrade rejects fresh database without creating schema', async t => {
  const {store} = await postgresFixture(t, {migrated:false});
  await assert.rejects(require('../scripts/db-migrate').upgradeInstalled(store), /installed/);
  assert.equal((await store.query("SELECT to_regnamespace('personal_site') AS schema")).rows[0].schema, null);
});

test('explicit upgrade is idempotent and preserves administrator and versions', async t => {
  const {store} = await postgresFixture(t);
  const f = await httpFixture(t, {store});
  await f.createAdmin();
  const before = (await store.query('SELECT username,hash FROM personal_site.admins')).rows;
  const versions = (await store.query('SELECT id,snapshot FROM personal_site.versions ORDER BY id')).rows;
  assert.deepEqual(await require('../scripts/db-migrate').upgradeInstalled(store), {schemaVersion:currentSchemaVersion,previousSchemaVersion:currentSchemaVersion,upgraded:false});
  assert.deepEqual((await store.query('SELECT username,hash FROM personal_site.admins')).rows, before);
  assert.deepEqual((await store.query('SELECT id,snapshot FROM personal_site.versions ORDER BY id')).rows, versions);
  assert.equal((await f.request('/api/setup/status')).status, 200);
});

test('explicit upgrade rejects checksum drift and does not repair it', async t => {
  const {store} = await postgresFixture(t);
  await httpFixture(t, {store});
  await store.query("UPDATE personal_site.schema_migrations SET checksum='tampered'");
  await assert.rejects(require('../scripts/db-migrate').upgradeInstalled(store), /incompatible/);
  assert.equal((await store.query('SELECT checksum FROM personal_site.schema_migrations')).rows[0].checksum, 'tampered');
});

test('deployment includes non-superuser init, PG18 parent volume and all installer resources', () => {
  const compose = readFileSync('compose.yaml','utf8');
  assert.match(compose, /postgres:18/);
  assert.match(compose, /pg-data:\/var\/lib\/postgresql\s/);
  assert.match(compose, /DATABASE_URL:/);
  assert.match(compose, /service_healthy/);
  const init = readFileSync('docker/postgres-init.sh','utf8');
  assert.match(init, /NOSUPERUSER/);
  assert.match(init, /format\(/);
  assert.doesNotMatch(init, /CREATE SCHEMA/);
  const docker = readFileSync('Dockerfile','utf8');
  assert.match(docker, /node:24-bookworm-slim/);
  assert.match(docker, /USER node/);
  assert.match(docker, /COPY admin-server/);
  assert.match(docker, /COPY admin-ui/);
  assert.match(docker, /COPY shared/);
  const external = readFileSync('compose.external.yaml','utf8');
  assert.doesNotMatch(external, /POSTGRES_PASSWORD|depends_on|\n  db:/);
  const scripts = JSON.parse(readFileSync('package.json')).scripts;
  assert.equal(scripts['db:migrate'], 'node scripts/db-migrate.js');
  assert.equal(scripts['import:check'], 'node scripts/import-site.js --check');
  assert.equal(scripts['test:postgres'], 'node scripts/test-postgres.js');
});

test('same-app model conversion rejects concurrent request and releases slot after failure', async t => {
  const f = await httpFixture(t);
  await f.createAdmin();
  const headers = await f.login();
  const uploadHeaders = {...headers};
  delete uploadHeaders['Content-Type'];
  const body = new FormData();
  body.append('file', new Blob([require('./fixtures/model').glb()]), 'triangle.glb');
  const uploaded = await f.request('/api/admin/resources/upload', {method:'POST',headers:uploadHeaders,body});
  assert.equal(uploaded.status, 201);
  const {resource} = await uploaded.json();
  let entered, release;
  const atQuery = new Promise(resolve => {entered = resolve;});
  const held = new Promise(resolve => {release = resolve;});
  const query = f.store.query.bind(f.store);
  let hold = true;
  f.store.query = async (sql, values) => {
    if (hold && sql === 'SELECT * FROM personal_site.resources WHERE id=$1' && values[0] === resource.id) {
      hold = false;
      entered();
      await held;
    }
    return query(sql, values);
  };
  t.after(() => release());
  const convert = size => f.request('/api/admin/resources/'+resource.id+'/convert', {method:'POST',headers,body:JSON.stringify({size})});
  const first = convert(99);
  await atQuery;
  assert.equal((await convert(0.8)).status, 429);
  release();
  assert.equal((await first).status, 400);
  assert.equal((await convert(0.8)).status, 201);
  // Corrupt only this test fixture's uploaded bytes to exercise worker failure,
  // then restore those fixture bytes and verify the same app can convert again.
  const file = require('node:path').join(f.root, 'data', 'uploads', resource.key);
  require('node:fs').writeFileSync(file, Buffer.from('invalid GLB fixture'));
  assert.equal((await convert(0.8)).status, 422);
  require('node:fs').writeFileSync(file, require('./fixtures/model').glb());
  assert.equal((await convert(0.8)).status, 201);
});

test('bundled admin media is authenticated, status-gated and confined to the owned root', async t => {
  const f = await httpFixture(t);
  await f.createAdmin();
  const headers = await f.login();
  const repo = require('../admin-server/repositories/resources').resourceRepository(f.store);
  const resource = {id:'private-bundle',source:'bundled',url:'assets/images/image.png',path:'assets/images/image.png',name:'image.png',kind:'image',mime:'image/png',status:'ready'};
  await f.store.transaction(tx => require('../admin-server/repositories/resources').resourceRepository(tx).insert(resource));
  assert.equal((await f.request('/media/private-bundle')).status,404);
  const response = await f.request('/media/private-bundle',{headers});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()),readFileSync(require('node:path').join(f.root,resource.path)));
  assert.equal((await f.request('/media/private-bundle',{headers:{...headers,Range:'bytes=0-3'}})).status,206);
  await f.store.query("UPDATE personal_site.resources SET status='missing' WHERE id=$1",[resource.id]);
  assert.equal((await f.request('/media/private-bundle',{headers})).status,404);
  await f.store.query("UPDATE personal_site.resources SET status='ready',trashed=true WHERE id=$1",[resource.id]);
  assert.equal((await f.request('/media/private-bundle',{headers})).status,404);
  await f.store.query("UPDATE personal_site.resources SET trashed=false WHERE id=$1",[resource.id]);
  await f.store.transaction(tx => require('../admin-server/repositories/resources').resourceRepository(tx).replaceReferences({ownerType:'version',ownerId:'42',references:[{resourceId:resource.id,slot:'private-image'}]}));
  assert.equal((await f.request('/media/private-bundle')).status,200);
  const fs = require('node:fs'), path = require('node:path');
  const outside = fs.mkdtempSync(path.join(require('node:os').tmpdir(),'site-test-outside-'));
  t.after(()=>fs.rmSync(outside,{recursive:true,force:true}));
  fs.writeFileSync(path.join(outside,'hidden.png'),'outside');
  fs.symlinkSync(path.join(outside,'hidden.png'),path.join(f.root,'assets/images/escape.png'));
  await f.store.query("UPDATE personal_site.resources SET details=$2 WHERE id=$1",[resource.id,{path:'assets/images/escape.png'}]);
  assert.equal((await f.request('/media/private-bundle',{headers})).status,404);
  assert.equal((await f.request('/assets/images/image.png',{headers})).status,404);
});

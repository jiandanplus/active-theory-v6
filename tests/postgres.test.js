const {test} = require('node:test');
const assert = require('node:assert/strict');
const {postgresFixture} = require('./helpers/postgres');
const {openPostgres, toSafeInteger} = require('../admin-server/postgres');
const {migrate, inspectInstallation, currentSchemaVersion} = require('../admin-server/migrations');

test('transaction rollback releases a single-client pool and leaves no event', async t => {
  let single;
  t.after(() => single?.close());
  const {store, databaseUrl} = await postgresFixture(t);
  single = openPostgres({databaseUrl, max: 1});
  await assert.rejects(single.transaction(async tx => {
    await tx.query('INSERT INTO personal_site.audit_events(action,actor) VALUES($1,$2)', ['rollback-test','test']);
    throw Error('rollback-marker');
  }), /rollback-marker/);
  assert.equal((await store.query('SELECT count(*)::int AS n FROM personal_site.audit_events')).rows[0].n, 0);
  assert.equal((await single.query('SELECT 1 AS ok')).rows[0].ok, 1);
});
test('concurrent transactions each stay on their own connection', async t => {
  const {store} = await postgresFixture(t);
  let resolve; const both = new Promise(r => { resolve = r; }); let count = 0;
  const pids = await Promise.all([1,2].map(() => store.transaction(async tx => {
    const pid = (await tx.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    if (++count === 2) resolve();
    await both;
    assert.equal((await tx.query('SELECT pg_backend_pid() AS pid')).rows[0].pid, pid);
    assert.deepEqual(Object.keys(tx), ['query']);
    return pid;
  })));
  assert.notEqual(pids[0], pids[1]);
});
test('migration repeats safely and installation record is authoritative', async t => {
  const {store} = await postgresFixture(t);
  assert.deepEqual(await inspectInstallation(store), {state:'uninstalled', schemaVersion:currentSchemaVersion});
  await store.transaction(migrate);
  assert.equal((await store.query('SELECT count(*)::int AS n FROM personal_site.schema_migrations')).rows[0].n, currentSchemaVersion);
  assert.equal(currentSchemaVersion,3);
  assert.deepEqual((await store.query('SELECT id,runtime_digest,generation FROM personal_site.runtime_selection')).rows,[{id:true,runtime_digest:null,generation:0}]);
  for(const table of ['runtime_bundles','delivery_artifacts','delivery_bindings']) assert.equal((await store.query(`SELECT count(*)::int AS n FROM personal_site.${table}`)).rows[0].n,0);
  await store.query("INSERT INTO personal_site.installation(source,schema_version) VALUES('test',$1)",[currentSchemaVersion]);
  assert.deepEqual(await inspectInstallation(store), {state:'installed', schemaVersion:currentSchemaVersion});
});
test('absent schema alone is uninstalled', async t => {
  const {store} = await postgresFixture(t, {migrated:false});
  assert.deepEqual(await inspectInstallation(store), {state:'uninstalled', schemaVersion:null});
});
test('concurrent migrations serialize and create each migration record only once', async t => {
  const {store} = await postgresFixture(t, {migrated:false});
  await Promise.all([store.transaction(migrate), store.transaction(migrate)]);
  assert.equal((await store.query('SELECT count(*)::int AS n FROM personal_site.schema_migrations')).rows[0].n, currentSchemaVersion);
});
test('Pool enforces catalog search path even when URL requests application schema', async t => {
  let alternate;
  t.after(() => alternate?.close());
  const {databaseUrl} = await postgresFixture(t);
  const url = new URL(databaseUrl);
  url.searchParams.set('options', '-c search_path=personal_site,public');
  alternate = openPostgres({databaseUrl:url.href});
  assert.equal((await alternate.query('SHOW search_path')).rows[0].search_path, 'pg_catalog');
  assert.equal((await inspectInstallation(alternate)).schemaVersion, currentSchemaVersion);
});
test('limited non-superuser can migrate and inspect its owned application schema', async t => {
  const {store,databaseUrl} = await postgresFixture(t, {migrated:false});
  const role = new URL(databaseUrl).pathname.slice(1);
  assert.match(role, /^site_test_[a-f0-9]{32}$/);
  await assert.rejects(store.transaction(async tx => {
    await tx.query(`CREATE ROLE "${role}" NOSUPERUSER NOCREATEDB NOCREATEROLE NOLOGIN`);
    await tx.query(`GRANT CREATE ON DATABASE "${role}" TO "${role}"`);
    await tx.query(`SET LOCAL ROLE "${role}"`);
    await migrate(tx);
    assert.deepEqual(await inspectInstallation(tx), {state:'uninstalled',schemaVersion:currentSchemaVersion});
    await migrate(tx);
    throw Error('cleanup-limited-role');
  }), /cleanup-limited-role/);
  assert.deepEqual(await inspectInstallation(store), {state:'uninstalled',schemaVersion:null});
});
test('server-side statement timeout cancels work and releases the client', async t => {
  const {store} = await postgresFixture(t);
  await assert.rejects(store.transaction(tx => tx.query('SELECT pg_sleep(11)')), error => error.code === '57014');
  assert.equal((await store.query('SELECT 1 AS ok')).rows[0].ok, 1);
});
for (const [name, sql] of [
  ['checksum tampering', "UPDATE personal_site.schema_migrations SET checksum='corrupt'"],
  ['future migration', `INSERT INTO personal_site.schema_migrations(version,checksum) VALUES(${currentSchemaVersion+1},'future')`],
  ['missing table', 'DROP TABLE personal_site.audit_events'],
  ['missing column', 'ALTER TABLE personal_site.audit_events DROP COLUMN actor'],
  ['unknown table', 'CREATE TABLE personal_site.unknown(id int)'],
  ['missing constraint', 'ALTER TABLE personal_site.login_attempts DROP CONSTRAINT login_attempts_count_check'],
  ['changed column type', 'ALTER TABLE personal_site.audit_events ALTER COLUMN actor TYPE varchar(30)'],
  ['missing index', 'DROP INDEX personal_site.sessions_expiry'],
  ['unknown function', "CREATE FUNCTION personal_site.unknown() RETURNS int LANGUAGE sql AS 'SELECT 1'"],
  ['unknown type', "CREATE TYPE personal_site.unknown AS ENUM ('test')"],
  ['row security drift', 'ALTER TABLE personal_site.audit_events ENABLE ROW LEVEL SECURITY'],
]) test(`rejects ${name} without overwriting schema`, async t => {
  const {store} = await postgresFixture(t);
  await store.query(sql);
  assert.equal((await inspectInstallation(store)).state, 'incompatible');
  await assert.rejects(store.transaction(migrate), /incompatible/i);
});
test('unknown partial schema cannot be migrated', async t => {
  const {store} = await postgresFixture(t, {migrated:false});
  await store.query('CREATE SCHEMA personal_site');
  assert.equal((await inspectInstallation(store)).state, 'incompatible');
  await assert.rejects(store.transaction(migrate), /incompatible/i);
});
test('connection failure is not uninstalled', async () => {
  const store = openPostgres({databaseUrl:'postgresql://site_test:local-test-only@127.0.0.1:1/site_test_control'});
  try { await assert.rejects(inspectInstallation(store)); } finally { await store.close(); }
});
test('bigint conversion checks safe range and integer syntax', () => {
  assert.equal(toSafeInteger('9007199254740991'), Number.MAX_SAFE_INTEGER);
  assert.equal(toSafeInteger('-9007199254740991'), Number.MIN_SAFE_INTEGER);
  for (const value of ['9007199254740992','1.5','',null,Number.MAX_SAFE_INTEGER+1]) assert.throws(() => toSafeInteger(value), /integer/i);
});

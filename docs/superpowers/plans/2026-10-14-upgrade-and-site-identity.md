# Safe Upgrades and Site Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改写历史内容和不改变 3D 视觉的前提下，提供安全的 schema 1 → 2 升级，以及完整受控的站点元信息编辑、发布与展示。

**Architecture:** 保持模块化单体；将迁移清单/检查、站点字段契约和页面元信息分别独立。网站描述、语言、分享图进入现有草稿/发布/资源链路，服务器 HTML 与旧引擎导航使用同一页面元信息投影。

**Tech Stack:** Node.js >=24、CommonJS、原生浏览器 JavaScript、Express、node-postgres、PostgreSQL 18、node:test、现有本地/S3 资源适配；不新增运行时依赖。

## Global Constraints

- 批准规格：`docs/superpowers/specs/2026-10-13-upgrade-and-site-identity-design.md`（2026-10-14 用户确认）。
- 保留当前 Node.js >=24、PostgreSQL 18、单站点、单管理员和现有安装/认证/发布/资源保护。
- 不更换框架，不重写 3D 引擎，不改变 Logo、黑洞和场景参数。
- 不在本阶段实施长缓存、发布产物库、完整静态降级页或后台全量模块拆分。
- 保持 `001-initial.sql` 原字节不变；基线 SHA-256：`bba88a72df8e7166646fdc56e6485c36078bf7e7fe4077125fdd7ebc682d2a15`。
- schema 2 不改写 versions/previews 的 snapshot；数据库 schema 版本与 snapshot format 2 不混用。
- description 默认 `""`，最长 500；language 默认 `"en"`，允许 `zh-CN`/`zh-TW`/`en`；socialImage 默认 `""`。
- canonical 只来自部署端 `SITE_ORIGIN` 和已验证的公开路由。
- 当前业务库的正式备份、迁移和切换是单独操作，须先报告精确目标并获得授权。
- 真实数据库、uploads、S3 对象、主密钥和当前运行中的网站均不作为测试夹具。
- 不读取真实 `.env`、不打开实际 `data/site.db`、不重启当前 3000 服务、不自动推送或部署。
- 所有 shell 命令使用 `rtk`；本地修改用 apply_patch。保留用户已有的 `.gitignore`、模型/粒子脚本和未跟踪文件。

---

## 执行顺序、文件边界与验证环境

基线设计提交：`2f303d8`。任务顺序为 **1 → 2 → 3 → 4 → 5 → 6 → 7**；任务之间完成测试与审查再继续。不要让多个实施者同时修改 config.js/frontend.js 等共享文件。

| 文件 | 唯一职责 |
| --- | --- |
| `shared/site-identity.js`（新增） | Node/浏览器共享的字段默认值、语言枚举、兼容投影和页面元信息计算 |
| `admin-server/migration-registry.js`（新增） | 受信迁移版本、SQL、checksum 与结构签名 |
| `admin-server/migrations/002-site-identity.sql`（新增） | 仅改变当前草稿和模板 schema 的新字段及 revision |
| `admin-server/migrations.js` | 严格/轻量检查与事务内迁移执行；保留现有 catalog 查询 |
| `admin-server/page-metadata.js`（新增） | 服务器安全 HTML head 生成与替换，不访问数据库 |
| `admin-server/frontend.js` | 已授权快照传入元信息模块，版本化脚本和旧导航接入 |
| `admin-server/config.js` / `snapshots.js` / `publication.js` | 新字段校验、恢复、选择资源、引用、发布和公开投影 |
| `admin-server/importers/*` / `resource-catalog.js` / `repositories/content.js` | 新草稿/模板默认值与历史分享图库存，历史内容不被归一化改写 |
| `admin-ui/admin.js` / `index.html` / `setup.js` | 元信息表单、共享契约加载和升级维护提示 |
| `tests/helpers/v1.js`（新增） | 仅用于真实隔离 PG 的原始 schema 1 夹具 |
| `tests/site-identity.test.js` / `schema-upgrade.test.js` / `metadata.test.js` / `metadata-http.test.js`（新增） | 纯函数、升级、HTML 和 HTTP/权限验收 |

### 首次执行前（属于任务 1 的环境准备，不是迁移真实站点）

- [x] 读取 using-git-worktrees 技能，检查当前 task 已附着 worktree 后确定是否使用隔离检出；不得复制 `.env`、data 或全部未跟踪文件。若隔离检出没有授权 assets，纯测试/集成测试仍可执行，完整引擎测试需另行只读使用明确的授权包，不强行提交素材。
- [x] 记录 `rtk git status --short`、`rtk git rev-parse HEAD`，确认只有本任务文件进入后续提交。
- [x] 只读检查依赖与专用测试实例；端口被其他服务占用时不停止它：

```sh
rtk proxy node --version
rtk proxy npm ls --depth=0
rtk proxy docker ps --format '{{.Names}} {{.Ports}}'
rtk proxy lsof -nP -iTCP:55432 -sTCP:LISTEN
```

- [x] 若 55432 空闲，启动已定义的临时测试库；若已存在本项目专用测试实例，核对 Compose labels 后复用并记录非本次所有。不得把 DATABASE_URL 传入测试：

```sh
rtk proxy docker compose -p site-pg-test -f compose.test.yaml up -d --wait
rtk proxy node scripts/test-postgres.js
```

默认测试入口只连接回环 55432 的 `site_test_control`，每个 fixture 建 UUID 测试库并清理。若显式 TEST_DATABASE_URL 已存在，必须先确认它是隔离目标，不能默认为安全。基线失败先记录并定位，不用业务库“验证一下”。

## Task 1: 共享站点字段契约与纯兼容投影

**Files:**
- Create: `shared/site-identity.js`
- Create: `tests/site-identity.test.js`

**Interfaces:**
- Produces: `DEFAULTS`, `LANGUAGES`, `normalizeSite(site)`, `normalizeConfig(config)`, `validateIdentity(site)`；浏览器全局为 `SiteIdentity`，Node 为 module.exports。
- `normalize*` 返回新对象、只补缺失的新字段，不读当前草稿、不删除未知键、不把显式空值替换成其他历史内容。
- `validateIdentity` 只校验新字段的基础类型/枚举/描述；已有 URL 安全规则继续由 config.safeURL 执行。

- [x] **Step 1: 写纯函数失败测试。**

```js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeConfig, normalizeSite, validateIdentity } = require('../shared/site-identity');
test('legacy projection adds defaults without mutating history', () => {
  const old = {site:{title:'Old'}, projects:[], scenes:[], songs:[]};
  const before = JSON.stringify(old);
  const next = normalizeConfig(old);
  assert.deepEqual(next.site, {description:'',language:'en',socialImage:'',title:'Old'});
  assert.equal(JSON.stringify(old), before);
  assert.notEqual(next, old);
  assert.equal(normalizeSite({description:'',language:'zh-CN',socialImage:''}).language, 'zh-CN');
});
test('new identity values are explicit, not coerced', () => {
  const valid = normalizeSite({title:'Example'});
  assert.doesNotThrow(() => validateIdentity(valid));
  for (const patch of [{description:'x'.repeat(501)},{description:'<img src=x>'},
    {language:''},{language:'xx'},{socialImage:null}]) {
    assert.throws(() => validateIdentity({...valid,...patch}), {status:400});
  }
  assert.equal(normalizeSite({socialImage:undefined}).socialImage, undefined);
});
```

- [x] **Step 2: 运行红灯。** `rtk proxy node --test tests/site-identity.test.js`；预期缺模块而失败，不需要数据库。
- [x] **Step 3: 新增共享模块。**

```js
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SiteIdentity = api;
})(globalThis, function () {
  'use strict';
  const DEFAULTS = Object.freeze({description:'',language:'en',socialImage:''});
  const LANGUAGES = Object.freeze(['zh-CN','zh-TW','en']);
  const bad = message => Object.assign(new Error(message), {status:400});
  function normalizeSite(site = {}) {
    if (!site || typeof site !== 'object' || Array.isArray(site)) throw bad('网站配置字段无效');
    return {...DEFAULTS,...structuredClone(site)};
  }
  function normalizeConfig(config) {
    const copy = structuredClone(config);
    copy.site = normalizeSite(copy.site);
    return copy;
  }
  function validateIdentity(site) {
    if (typeof site.description !== 'string' || site.description.length > 500 ||
        /<\/?[a-z!]|\x00/i.test(site.description)) throw bad('网站描述须为不超过 500 字符的纯文本');
    if (!LANGUAGES.includes(site.language)) throw bad('网站语言无效');
    if (typeof site.socialImage !== 'string') throw bad('分享图片地址必须是文本');
    return site;
  }
  return {DEFAULTS,LANGUAGES,normalizeSite,normalizeConfig,validateIdentity};
});
```

- [x] **Step 4: 绿灯并验证浏览器分支不访问 DOM。** 在同一测试文件追加：

```js
test('same contract runs as a browser script without DOM globals', () => {
  const vm = require('node:vm');
  const context = {structuredClone};
  vm.runInNewContext(require('node:fs').readFileSync('shared/site-identity.js','utf8'), context);
  assert.equal(context.SiteIdentity.normalizeSite({}).language,'en');
  assert.deepEqual(Array.from(context.SiteIdentity.LANGUAGES),['zh-CN','zh-TW','en']);
});
```

Run: `rtk proxy node --test tests/site-identity.test.js`；全部通过后 review。
- [x] **Step 5: 提交且只含该任务文件。**

```sh
rtk proxy git add -- shared/site-identity.js tests/site-identity.test.js
rtk proxy git diff --cached --check
rtk proxy git commit -m "feat: define shared site identity contract"
```

## Task 2: schema 2、有序升级与安装状态闭环

**Files:**
- Create: `admin-server/migration-registry.js`, `admin-server/migrations/002-site-identity.sql`, `tests/helpers/v1.js`, `tests/schema-upgrade.test.js`
- Modify: `admin-server/migrations.js`, `admin-server/installation.js`, `admin-server/app.js`, `scripts/db-migrate.js`, `admin-ui/setup.js`
- Modify: `admin-server/importers/disk.js`, `admin-server/importers/bundle.js`, `admin-server/repositories/content.js`, `admin-server/config.js`
- Modify: `tests/helpers/http.js`, `tests/postgres.test.js`, `tests/deployment.test.js`, `tests/installation.test.js`, `tests/setup-ui.test.js`, `tests/importers.test.js`, `tests/config.test.js`

**Interfaces:**
- Consumes Task 1 的 `normalizeConfig/normalizeSite`。
- Produces: registry `{migrations,currentSchemaVersion,checksum,schemaSignature}`；`inspectInstallation(store,{verifyStructure=true}={})`；`migrate(tx)`；`upgradeInstalled(store) -> {schemaVersion,previousSchemaVersion,upgraded}`。
- 状态固定为 unconfigured/uninstalled/installed/upgrade_required/incompatible；数据库错误继续抛给已有 unavailable 处理。

- [x] **Step 1: 建真实 V1 测试夹具，不调用新版默认迁移。**

```js
// tests/helpers/v1.js
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {createHash} = require('node:crypto');
const {postgresFixture} = require('./postgres');
const {contentFixture} = require('./content');
const {contentRepository} = require('../../admin-server/repositories/content');
async function v1Fixture(t) {
  const fixture = await postgresFixture(t,{migrated:false});
  const content = contentFixture(t);
  const bundle = structuredClone(content.bundle);
  bundle.versions.push({...structuredClone(bundle.versions[0]),id:43});
  for(const config of [bundle.draft.config,bundle.schema,...bundle.versions.map(v=>v.snapshot.config)])
    for(const key of ['description','language','socialImage']) delete config.site[key];
  bundle.storages.push({id:'fixture-cloud',type:'s3',name:'Fake credentials preservation',
    credentials:{iv:'fixture-not-a-key',tag:'fixture-not-a-key',ciphertext:'fixture-not-a-key'}});
  const sql = readFileSync(join(__dirname,'../../admin-server/migrations/001-initial.sql'),'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  await fixture.store.transaction(async tx => {
    await tx.query(sql);
    await tx.query('INSERT INTO personal_site.schema_migrations(version,checksum) VALUES(1,$1)',[checksum]);
    await contentRepository(tx).importBundle(bundle);
    await contentRepository(tx).putPreview({id:'preview-fixture-upgrade',owner:'admin',
      expires:new Date('2099-01-01T00:00:00Z'),snapshot:bundle.draft});
    await tx.query("INSERT INTO personal_site.sessions(id,username,csrf,created,touched) VALUES('fixture-session','admin','fixture-csrf',1,1)");
    // importBundle will normalize NEW drafts after this task; strip only fixture data
    // so this fixture still represents the genuine legacy contract.
    await tx.query("UPDATE personal_site.site_settings SET site=site-ARRAY['description','language','socialImage']::text[]");
    await tx.query("UPDATE personal_site.templates SET schema_config=jsonb_set(schema_config,'{site}',(schema_config->'site')-ARRAY['description','language','socialImage']::text[])");
    await tx.query("INSERT INTO personal_site.installation(source,schema_version) VALUES('fixture',1)");
  });
  return {...fixture,...content,bundle};
}
module.exports = {v1Fixture};
```

- [x] **Step 2: 写升级、重复、并发和事务失败测试，先运行红灯。**

```js
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {v1Fixture} = require('./helpers/v1');
const {upgradeInstalled} = require('../scripts/db-migrate');
const {inspectInstallation} = require('../admin-server/migrations');
async function preserved(store) {
  const tables = ['admins','sessions','storages','resources','projects','songs','scenes','versions','previews','resource_references','audit_events'];
  const data = {};
  for (const table of tables) {
    const rows = (await store.query(`SELECT row_to_json(t) AS row FROM personal_site.${table} t`)).rows;
    data[table] = rows.map(row=>JSON.stringify(row.row)).sort();
  }
  data.installation = (await store.query('SELECT source,completed_at FROM personal_site.installation')).rows;
  data.published = (await store.query('SELECT published FROM personal_site.site_settings')).rows;
  return data;
}
test('V1 upgrades once, preserves history and serializes competitors', async t => {
  const {store} = await v1Fixture(t);
  const before = await preserved(store);
  const revision = (await store.query('SELECT revision FROM personal_site.site_settings')).rows[0].revision;
  assert.deepEqual(await inspectInstallation(store),{state:'upgrade_required',schemaVersion:1});
  const results = await Promise.all([upgradeInstalled(store),upgradeInstalled(store)]);
  assert.equal(results.filter(r=>r.upgraded).length,1);
  assert.deepEqual(await inspectInstallation(store),{state:'installed',schemaVersion:2});
  assert.deepEqual(await preserved(store),before);
  const row = (await store.query('SELECT site,revision FROM personal_site.site_settings')).rows[0];
  assert.equal(row.revision,revision+1);
  assert.equal(row.site.language,'en');
  assert.equal((await upgradeInstalled(store)).upgraded,false);
  assert.equal((await store.query('SELECT revision FROM personal_site.site_settings')).rows[0].revision,revision+1);
});
test('failure after 002 SQL rolls back data and migration records', async t => {
  const {store} = await v1Fixture(t);
  const before = await preserved(store);
  const settings = (await store.query('SELECT * FROM personal_site.site_settings')).rows;
  const schemas = (await store.query('SELECT id,schema_config::text AS schema FROM personal_site.templates')).rows;
  const broken = {transaction:fn=>store.transaction(tx=>fn({query:async(sql,args=[])=>{
    const result=await tx.query(sql,args);
    if (/INSERT INTO personal_site\.schema_migrations/.test(sql) && args[0]===2) throw Error('injected');
    return result;
  }}))};
  await assert.rejects(upgradeInstalled(broken),/injected/);
  assert.deepEqual(await preserved(store),before);
  assert.deepEqual((await store.query('SELECT * FROM personal_site.site_settings')).rows,settings);
  assert.deepEqual((await store.query('SELECT id,schema_config::text AS schema FROM personal_site.templates')).rows,schemas);
  assert.deepEqual((await store.query('SELECT version FROM personal_site.schema_migrations')).rows,[{version:1}]);
});
```

Run: `rtk proxy node scripts/test-postgres.js tests/schema-upgrade.test.js`；预期当前代码无 schema2/upgrade_required，断言失败。

- [x] **Step 3: 新增仅数据变换的 SQL 002。**

```sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM personal_site.site_settings WHERE jsonb_typeof(site) IS DISTINCT FROM 'object')
     OR EXISTS (SELECT 1 FROM personal_site.templates WHERE jsonb_typeof(schema_config->'site') IS DISTINCT FROM 'object') THEN
    RAISE EXCEPTION 'Invalid site identity document';
  END IF;
END $$;
UPDATE personal_site.site_settings
SET site='{"description":"","language":"en","socialImage":""}'::jsonb || site,
    revision=revision+1;
UPDATE personal_site.templates
SET schema_config=jsonb_set(schema_config,'{site}',
    '{"description":"","language":"en","socialImage":""}'::jsonb || (schema_config->'site'));
```

该 SQL 不更新 versions/previews、installation、账号或资源；安装版本由 runner 同事务更新。新装时没有 site/template 行，导入边界必须执行 Step 6。

- [x] **Step 4: 新增明确清单；001 指纹与 catalog 查询保留。**

```js
// admin-server/migration-registry.js
const {readFileSync} = require('node:fs');
const {join} = require('node:path');
const {createHash} = require('node:crypto');
const schemaSignature = 'd707b879563d88ac731f0e95982187542f1d260bec0ad866110bc3f155f90534';
const files = ['001-initial.sql','002-site-identity.sql'];
const migrations = Object.freeze(files.map((file,index)=>{
  const sql = readFileSync(join(__dirname,'migrations',file),'utf8');
  return Object.freeze({version:index+1,file,sql,
    checksum:createHash('sha256').update(sql).digest('hex'),schemaSignature});
}));
if (migrations[0].checksum !== 'bba88a72df8e7166646fdc56e6485c36078bf7e7fe4077125fdd7ebc682d2a15')
  throw Error('Initial migration must not change');
module.exports = {migrations,currentSchemaVersion:migrations.at(-1).version,
  checksum:migrations[0].checksum,schemaSignature};
```

在 migrations.js 保留原 `digest`、`signatureQuery` 完整内容与 `supportedPostgresVersion`；删除旧 sql/checksum/schemaSignature 定义，由 registry 导入替代，避免重复声明。替换检查和 runner：

```js
const {migrations,currentSchemaVersion,checksum,schemaSignature} = require('./migration-registry');
const {validateIdentity} = require('../shared/site-identity');
function knownPrefix(rows) {
  return rows.length > 0 && rows.length <= migrations.length && rows.every((row,index)=>
    row.version===migrations[index].version && row.checksum===migrations[index].checksum);
}
async function inspectInstallation(store,{verifyStructure=true}={}) {
  if (store.configured===false) return {state:'unconfigured',schemaVersion:null};
  if (!(await supportedPostgresVersion(store))) return {state:'incompatible',schemaVersion:null};
  const present = (await store.query("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='personal_site') AS present")).rows[0].present;
  if (!present) return {state:'uninstalled',schemaVersion:null};
  const versions = (await store.query('SELECT version,checksum FROM personal_site.schema_migrations ORDER BY version')).rows;
  if (!knownPrefix(versions)) return {state:'incompatible',schemaVersion:null};
  const schemaVersion = versions.at(-1).version;
  if (verifyStructure && digest(JSON.stringify((await store.query(signatureQuery)).rows))!==migrations[schemaVersion-1].schemaSignature)
    return {state:'incompatible',schemaVersion:null};
  const installed = (await store.query('SELECT schema_version FROM personal_site.installation')).rows;
  if (installed.length>1 || installed.some(row=>row.schema_version!==schemaVersion))
    return {state:'incompatible',schemaVersion};
  return {state:!installed.length?'uninstalled':schemaVersion<currentSchemaVersion?'upgrade_required':'installed',schemaVersion};
}
async function migrate(tx) {
  await tx.query('SELECT pg_advisory_xact_lock($1)',[734216901]);
  const before = await inspectInstallation(tx);
  if (!['uninstalled','upgrade_required','installed'].includes(before.state)) throw Error('Incompatible personal_site schema');
  for (const migration of migrations.filter(m=>m.version>(before.schemaVersion||0))) {
    await tx.query(migration.sql);
    await tx.query('INSERT INTO personal_site.schema_migrations(version,checksum) VALUES($1,$2)',[migration.version,migration.checksum]);
    await tx.query('UPDATE personal_site.installation SET schema_version=$1',[migration.version]);
    const after = await inspectInstallation(tx);
    if (after.state==='incompatible' || after.schemaVersion!==migration.version) throw Error('Migration validation failed');
  }
  // A catalog fingerprint does not validate JSONB content. This runs only in
  // explicit migration/installation, never in the lightweight request guard.
  const identities=(await tx.query("SELECT site FROM personal_site.site_settings UNION ALL SELECT schema_config->'site' AS site FROM personal_site.templates")).rows;
  for(const row of identities) validateIdentity(row.site);
}
module.exports = {migrate,inspectInstallation,checksum,supportedPostgresVersion,currentSchemaVersion,signatureQuery,schemaSignature};
```

不要把一个指纹看作唯一数据库版本：002 无 DDL，两个版本指纹相同。指纹测试从导出读取，不继续用源文件正则提取变量。

- [x] **Step 5: 连接轻量状态、CLI、网页安装。**

```js
// installation.js: replace only installationStatus; retain import preflight.
async function installationStatus(store) {
  return inspectInstallation(store,{verifyStructure:false});
}
// installSite INSERT installation parameters:
[mode, currentSchemaVersion]
// notInstalled body (only explicit uninstalled may proceed):
const state = await installationStatus(store);
if (state.state !== 'uninstalled')
  throw fail(state.state==='installed'?409:503,
    state.state==='upgrade_required'?'站点需要由服务器管理员显式升级':'站点不可初始化或暂时不可用');
// /status response status:
res.status(['incompatible','upgrade_required'].includes(state.state)?503:200).json(state);
```

导入 `currentSchemaVersion`；不要放松 installSite 锁内的 `state === 'uninstalled'` 判断。setup.js maintenance reasons 增加：

```js
upgrade_required: '网站数据库需要升级。请由服务器管理员备份后在维护窗口运行 npm run db:migrate；这里不会重新安装或创建管理员。',
```

app.js 已有非 installed 总闸门保持不变；公开维护页在 upgrade_required 时使用固定文案“网站需要维护升级，请由管理员在服务器备份后运行数据库升级命令”，不要称为“尚未安装”。API 保留 state 字段和 503，不增加自动升级调用。

CLI 替换 upgradeInstalled；main 成功输出按 upgraded 分支区别校验/升级，catch 保持脱敏并退出 1：

```js
async function upgradeInstalled(store) {
  return store.transaction(async tx=>{
    await tx.query('SELECT pg_advisory_xact_lock($1)',[734216901]);
    const before = await inspectInstallation(tx);
    if (!['installed','upgrade_required'].includes(before.state))
      throw Object.assign(Error(before.state==='incompatible'?'Database schema is incompatible':'An installed instance is required; use the web installer first'),
        {code:before.state==='incompatible'?'SCHEMA_INCOMPATIBLE':'NOT_INSTALLED'});
    await migrate(tx);
    const after = await inspectInstallation(tx);
    if (after.state!=='installed' || after.schemaVersion!==currentSchemaVersion)
      throw Object.assign(Error('Database upgrade verification failed'),{code:'SCHEMA_VERIFICATION_FAILED'});
    return {schemaVersion:after.schemaVersion,previousSchemaVersion:before.schemaVersion,
      upgraded:after.schemaVersion!==before.schemaVersion};
  });
}
// main: preserve an explicitly supplied TLS option as well as URL; never print URL.
const store = openPostgres({databaseUrl:options.databaseUrl,ssl:options.databaseSSL});
console.log(result.upgraded
  ? `Installed schema upgraded from ${result.previousSchemaVersion} to ${result.schemaVersion}; no administrator was created.`
  : `Installed schema verified at version ${result.schemaVersion}; no administrator was created.`);
```

main 的 catch 按固定 code 输出固定消息；不得打印 error.message、连接串或迁移 SQL：

```js
const messages={NOT_INSTALLED:'An installed instance is required; use the web installer first.',
  SCHEMA_INCOMPATIBLE:'Database schema is incompatible; inspect the backup and migration checksums.',
  SCHEMA_VERIFICATION_FAILED:'Database upgrade verification failed; transaction was not accepted.'};
const connectionFailure=['ECONNREFUSED','ENOTFOUND','ETIMEDOUT','ECONNRESET','28P01','3D000'].includes(error.code);
console.error(messages[error.code]||(connectionFailure
  ?'Database connection failed; check PostgreSQL 18, credentials and network.'
  :'Database upgrade failed; inspect the isolated diagnostics before retrying.'));
process.exitCode=1;
```

- [x] **Step 6: 归一化仅位于新草稿/schema/恢复入口，绝不放进 composeSnapshot。**

各文件导入 shared/site-identity 对应函数，替换点如下：

```js
// importers/disk.js initialConfig returned object: replace site with
site: normalizeSite(site),
// importers/bundle.js complete: before stableIDs
config = stableIDs(normalizeConfig(config));
schema = stableIDs(normalizeConfig(schema));
// emptyConfig: after its site clearing loop
copy.site.language = 'en';
// repositories/content.js importBundle: before composeSnapshot(bundle.draft)
const draft = {...bundle.draft,config:normalizeConfig(bundle.draft.config)};
const schema = normalizeConfig(bundle.schema);
const snapshot = composeSnapshot(draft);
// INSERT templates parameter uses schema, not bundle.schema. History loop untouched.
// config.js restore: final call
return saveDraft(store, normalizeConfig(row.snapshot.config), revision, actor);
```

新字段严格业务校验在 Task 3；此任务仍保留 config 现有精确键集合校验。历史 importer 用 stableIDs 保持原行为，不给每个旧 snapshot.config 塞新字段。

- [x] **Step 7: 更新隔离 fixture 和失败边界测试，完整绿灯。**

`tests/helpers/http.js` 安装 INSERT 改参数化 currentSchemaVersion；只有专门 V1 测试仍写 1。用导出 currentSchemaVersion 替换 latest-fixture 断言；future migration 使用 currentSchemaVersion+1，不能把真实 002 当“未来”。保留纯 001 指纹测试并补 schema2 相同签名断言。

```js
test('V1 maintenance never permits setup overwrite', async t=>{
  const {store} = await v1Fixture(t);
  const f = await require('./helpers/http').httpFixture(t,{store,installed:false});
  const before = await preserved(store);
  const status = await f.request('/api/setup/status');
  assert.equal(status.status,503);
  assert.equal((await status.json()).state,'upgrade_required');
  const headers = await f.setupSession();
  assert.equal((await f.request('/api/setup/database',{headers})).status,503);
  for (const path of ['/api/setup/preflight','/api/setup/install']) {
    const response = await f.request(path,{method:'POST',headers,body:JSON.stringify({mode:'empty'})});
    assert.equal(response.status,503);
  }
  assert.deepEqual(await preserved(store),before);
});
for (const [name,sql] of [
  ['checksum',"UPDATE personal_site.schema_migrations SET checksum='corrupt' WHERE version=1"],
  ['gap',"DELETE FROM personal_site.schema_migrations WHERE version=1"],
  ['future',"INSERT INTO personal_site.schema_migrations(version,checksum) VALUES(99,'future')"],
  ['structure',"ALTER TABLE personal_site.site_settings ADD COLUMN unexpected text"]
]) test(`upgrade refuses ${name}`,async t=>{
  const {store} = await v1Fixture(t);
  await store.query(sql);
  await assert.rejects(upgradeInstalled(store));
  assert.equal((await store.query('SELECT count(*)::int AS n FROM personal_site.admins')).rows[0].n,1);
});
```

Run:

```sh
rtk proxy node scripts/test-postgres.js tests/schema-upgrade.test.js tests/postgres.test.js tests/deployment.test.js tests/installation.test.js tests/setup-ui.test.js tests/importers.test.js tests/config.test.js
rtk proxy node scripts/test-postgres.js
rtk proxy shasum -a 256 admin-server/migrations/001-initial.sql
```

预期全部新增/已有后端测试通过，001 checksum 与 Global Constraints 一致；缺授权包的 skip 独立记录。
- [x] **Step 8: 审查后显式暂存 Files 列表中的本任务文件，提交 `feat: add safe incremental schema upgrades`。** 不运行 `git add .`；不用更改测试期望掩盖真实安装/兼容行为回归。

## Task 3: 新字段校验与分享图的完整资源链路

**Files:**
- Modify: `admin-server/config.js`, `admin-server/snapshots.js`, `admin-server/publication.js`
- Modify: `admin-server/resource-catalog.js`, `admin-server/importers/bundle.js`, `admin-server/importers/sqlite.js`
- Modify: `tests/config.test.js`, `tests/database-content.test.js`, `tests/importers.test.js`, `tests/publication.test.js`

**Interfaces:**
- Consumes normalizeSite/normalizeConfig/validateIdentity 和现有 resourceAsset/mapResourceURL。
- Produces 明确引用槽 `config.site.socialImage`；publicSnapshot 的 site 含新字段，socialImage 为版本化受控 URL。
- inventoryResources 增加可选 `siteImages=[]` 参数，收集当前和历史的分享图；不递归扫描 site。

- [x] **Step 1: 新增资源发布与恢复的失败测试。**

```js
test('site image uses publication grants, clear preserves historical references',async t=>{
  const f = await httpFixture(t);
  const {saveDraft,publish,restore} = require('../admin-server/config');
  const repo = contentRepository(f.store);
  await f.store.query("UPDATE personal_site.resources SET details=$1 WHERE id='unused'",[{path:'assets/images/image.png'}]);
  const draft = await repo.getDraft();
  const history = (await f.store.query('SELECT id,snapshot::text AS snapshot FROM personal_site.versions ORDER BY id')).rows;
  draft.config.site.socialImage = '/media/unused';
  const revision = await saveDraft(f.store,draft.config,draft.revision);
  assert.equal((await f.request('/api/site/42/resources/unused/unused.png')).status,404);
  const options = {root:f.root,dataDir:require('node:path').join(f.root,'data')};
  const version = await publish(f.store,revision,options);
  const config = await (await f.request(`/api/site/${version}/config`)).json();
  assert.match(config.site.socialImage,new RegExp(`^/api/site/${version}/resources/unused/`));
  assert.equal((await f.request(config.site.socialImage)).status,200);
  const next = await repo.getDraft();
  next.config.site.socialImage = '';
  await saveDraft(f.store,next.config,next.revision);
  assert.equal((await f.request(config.site.socialImage)).status,200);
  const current = await repo.getDraft();
  await restore(f.store,42,current.revision);
  assert.equal((await repo.getDraft()).config.site.language,'en');
  assert.deepEqual((await f.store.query('SELECT id,snapshot::text AS snapshot FROM personal_site.versions WHERE id=42')).rows,history);
});
test('site image rejects non-image resource identity on the server',async t=>{
  const f = await httpFixture(t);
  const draft = await contentRepository(f.store).getDraft();
  draft.config.site.socialImage = '/media/audio';
  await assert.rejects(require('../admin-server/config').saveDraft(f.store,draft.config,draft.revision),/图片/);
});
```

Run: `rtk proxy node scripts/test-postgres.js tests/database-content.test.js tests/config.test.js`；确认新增失败来自字段/引用尚未接入。

- [x] **Step 2: 按字段职责分派校验与保存。**

config.js 使用 Task 1 的 validateIdentity。在原 site 循环前调用；替换统一 plain 循环：

```js
validateIdentity(config.site);
for (const [key,value] of Object.entries(config.site)) {
  if (key==='description' || key==='language') continue;
  if (key==='socialImage') { safeURL(value); continue; }
  plain(value,1000);
  if (key==='labUrl') safeURL(value);
}
```

在 saveDraft 的 urls 数组开头加入 `config.site.socialImage`；原资源冻结循环完成后、更新 templates 前加入：

```js
if (config.site.socialImage) {
  const asset = resourceAsset(savedTemplate,config.site.socialImage);
  const image = rows.find(row=>row.id===asset?.resourceId);
  if (!image || image.kind!=='image') throw fail(400,'分享图片必须引用已登记的图片资源');
}
```

现有 HTTPS 登记逻辑默认推断 image，但若同一 URL 已作为 audio/video 登记，必须拒绝而不是更改其类型。不要在 `resourceAsset` 提前 continue 处跳过最终图片类型检查。

- [x] **Step 3: 增加明确引用、公共映射和锁内检查。**

```js
// snapshots.js: SITE_KEYS append description/language/socialImage.
// collectReferences: after resolve is defined, before return
if (snapshot.config.site?.socialImage)
  resolve(snapshot.config.site.socialImage,'config.site.socialImage');
// publicSnapshot: site projection
site: pick(normalizeSite(config.site),SITE_KEYS),
// after media helper definition
publicConfig.site.socialImage = media(publicConfig.site.socialImage);
// publication.js validatePublication: initial media list
const media = [snapshot.config.site?.socialImage].filter(Boolean);
// checkPublicationState: after collecting rows, before returning them
if (snapshot.config.site?.socialImage) {
  const id = resourceId(snapshot,snapshot.config.site.socialImage);
  if (!rows.some(row=>row.id===id && row.kind==='image'))
    throw fail(422,'分享图片必须引用可用的图片资源');
}
```

其他资源状态、存储可用性、文件检查仍按原逻辑执行；description 和 language 不参加 3D 字形检查。

- [x] **Step 4: 覆盖新旧导入和历史独有分享图。**

```js
// inventoryResources signature adds siteImages = [];
// after manifest registration:
for (const url of new Set([config.site?.socialImage,...siteImages].filter(Boolean)))
  await register({owner:'site',slot:`site:socialImage:${digest(url).slice(0,24)}`,
    url,type:'image',required:false});
// complete inventoryResources arguments:
siteImages: allConfigs.map(config=>config.site?.socialImage).filter(Boolean),
// sqlite.js validate: at start of try, before exact site-key checks
config = normalizeConfig(config);
schema = normalizeConfig(schema);
```

SQLite validate 只改局部变量，不改 settings/versions 源对象；临时 source 文件摘要仍应不变。增加 importer 测试：在临时 legacy fixture 的历史 config 中放一个独有 HTTPS 分享图，当前 draft 分享图留空；预检须登记该图、对应历史 config 保留值、当前草稿不能因此引用它。

```js
test('site text does not create incidental media grants',()=>{
  const {collectReferences} = require('../admin-server/snapshots');
  const snapshot = {config:{site:{title:'/media/private',description:'/media/private',socialImage:''},projects:[],scenes:[],songs:[]},template:{baseUIL:{}},assets:{},legacyMap:{}};
  assert.deepEqual(collectReferences(snapshot),[]);
  snapshot.config.site.socialImage='/media/image';
  assert.deepEqual(collectReferences(snapshot),[{resourceId:'image',slot:'config.site.socialImage'}]);
});
```

- [x] **Step 5: 参数化验证发布拒绝状态，绿灯后提交。**

```js
for (const patch of [{status:'disabled'},{status:'missing'},{status:'failed'},{trashed:true}])
  test(`site image publish rejects ${JSON.stringify(patch)}`,async t=>{
    const f=await httpFixture(t);
    const repo=contentRepository(f.store), draft=await repo.getDraft();
    draft.config.site.socialImage='/media/unused';
    const revision=await require('../admin-server/config').saveDraft(f.store,draft.config,draft.revision);
    await f.store.query('UPDATE personal_site.resources SET status=$1,trashed=$2 WHERE id=$3',
      [patch.status||'ready',patch.trashed||false,'unused']);
    await assert.rejects(require('../admin-server/config').publish(f.store,revision,{root:f.root,dataDir:f.root+'/data'}),{status:422});
  });
```

Run: `rtk proxy node scripts/test-postgres.js tests/config.test.js tests/database-content.test.js tests/importers.test.js tests/publication.test.js`。
Review 后显式暂存本任务文件，提交 `feat: publish site identity with protected image references`。

## Task 4: 同一元信息投影、正确首个 HTML 与私有预览

**Files:**
- Modify: `shared/site-identity.js`, `admin-server/frontend.js`, `admin-server/frontend-resources.js`, `admin-server/installation.js`, `admin-server/app.js`
- Create: `admin-server/page-metadata.js`, `tests/metadata.test.js`, `tests/metadata-http.test.js`
- Modify: `tests/helpers/content.js`, `tests/database-content.test.js`

**Interfaces:**
- Produces: shared `publicPathForState(state)`, `pageMetadata(publicConfig,origin,pathname) -> {status,title,description,language,image,url,siteTitle}`、`headEntries(meta,{preview=false}={}) -> {tag,attributes,text?}[]`。
- Produces: server `renderPageMetadata(html,meta,{preview=false}={})` 与 `ownedMeta(key)`。
- 输入是已做资源 URL 映射的 publicSnapshot；metadata.json 旧引擎接口不改。

- [x] **Step 1: 写页面投影和 SSR 失败测试。**

```js
const {test}=require('node:test');
const assert=require('node:assert/strict');
const identity=require('../shared/site-identity');
const config={site:{title:'A $& ` \\',navWork:'Works',description:'Site & more',language:'zh-CN',socialImage:'/api/site/8/resources/i/share.png'},projects:[{slug:'one',name:'One',description:'Project',image:{url:'/api/site/8/resources/p/one.png'}}]};
test('route projection uses trusted origin and real project data',()=>{
  const detail=identity.pageMetadata(config,'https://owner.example','/work/one?preview=x');
  assert.equal(detail.title,'One · A $& ` \\');
  assert.equal(detail.url,'https://owner.example/work/one');
  assert.equal(detail.image,'https://owner.example/api/site/8/resources/p/one.png');
  assert.equal(identity.pageMetadata(config,'https://owner.example','/work/nope').status,404);
  for(const state of ['','home','about','tree','contact','footer']) assert.equal(identity.publicPathForState(state),'/');
  assert.equal(identity.publicPathForState('work/one'),'/work/one');
  assert.equal(identity.publicPathForState('unknown'),null);
});
test('SSR removes duplicate original metadata, escapes and preserves program scripts',()=>{
  const {renderPageMetadata}=require('../admin-server/page-metadata');
  const html='<html lang="en"><head><title>Old</title><meta property="twitter:image" content="old"><meta name="twitter:image" content="old2"><link rel="canonical" href="https://activetheory.net"><script src="keep.js"></script></head><body></body></html>';
  const meta=identity.pageMetadata(config,'https://owner.example','/');
  const result=renderPageMetadata(html,meta);
  assert.match(result,/lang="zh-CN"/);
  assert.equal((result.match(/rel="canonical"/g)||[]).length,1);
  assert.equal((result.match(/(?:name|property)="twitter:image"/g)||[]).length,1);
  assert.match(result,/Site &amp; more/);
  assert.match(result,/<script src="keep.js"><\/script>/);
  assert.doesNotMatch(result,/activetheory\.net|content="old/);
});
```

Run: `rtk proxy node --test tests/site-identity.test.js tests/metadata.test.js`；缺接口红灯。

- [x] **Step 2: 在共享 factory 中追加纯投影与 head 描述符，并导出。**

```js
function publicPathForState(state) {
  const value=String(state??'').replace(/^\//,'').replace(/\/$/,'');
  if (['','home','about','tree','contact','footer'].includes(value)) return '/';
  if (value==='work') return '/work';
  return /^work\/[a-z0-9][a-z0-9-]{0,100}$/.test(value)?'/'+value:null;
}
function pageMetadata(config,origin,pathname) {
  const base=new URL(origin);
  if (!['http:','https:'].includes(base.protocol) || base.origin!==origin.replace(/\/$/,''))
    throw bad('SITE_ORIGIN 无效');
  let path;
  try { path=decodeURIComponent(String(pathname).split(/[?#]/)[0]); } catch { path=''; }
  if (path.length>1) path=path.replace(/\/$/,'');
  const site=normalizeSite(config.site), title=String(site.title||'');
  const meta={status:200,title,siteTitle:title,description:site.description,
    language:LANGUAGES.includes(site.language)?site.language:'en',image:'',url:''};
  let image=site.socialImage;
  if (path==='/work') meta.title=site.navWork?`${site.navWork} · ${title}`:title;
  else if (path!=='/') {
    const match=/^\/work\/([a-z0-9][a-z0-9-]{0,100})$/.exec(path);
    const project=match&&(config.projects||[]).find(p=>p.slug===match[1]);
    if (!project) return {...meta,status:404,title:'页面不存在',description:'',image:'',url:''};
    meta.title=project.name?`${project.name} · ${title}`:title;
    meta.description=project.description||site.description;
    image=project.image?.url||site.socialImage;
  }
  meta.url=new URL(path,base.origin).href;
  // Only mapped, authorized resource-entry paths become share images.
  // An unresolved legacy optional image is omitted, never exposed as a raw URL.
  if (typeof image==='string' && /^\/api\/site\/(?:[1-9]\d*|preview-[\w-]+)\/resources\/[^/?#]+\/[^/?#]+(?:[?#].*)?$/.test(image))
    meta.image=new URL(image,base.origin).href;
  return meta;
}
function headEntries(meta,{preview=false}={}) {
  const out=[{tag:'title',attributes:{},text:meta.title},
    {tag:'meta',attributes:{name:'apple-mobile-web-app-title',content:meta.siteTitle}}];
  const add=(key,content,property=false)=>{
    if(content) out.push({tag:'meta',attributes:{[property?'property':'name']:key,content}});
  };
  add('description',meta.description);
  if(meta.url) out.push({tag:'link',attributes:{rel:'canonical',href:meta.url}});
  add('og:type','website',true); add('og:title',meta.title,true);
  add('og:description',meta.description,true); add('og:url',meta.url,true); add('og:image',meta.image,true);
  add('twitter:card',meta.image?'summary_large_image':'summary');
  add('twitter:title',meta.title); add('twitter:description',meta.description);
  add('twitter:url',meta.url); add('twitter:image',meta.image);
  if(preview||meta.status===404) add('robots','noindex, nofollow');
  return out;
}
// Factory return now includes the existing five exports and these three functions.
```

用户标题不拼入引擎模板字面量；这里保留美元符号/反引号/反斜线，由 HTML/DOM 边界安全编码。

- [x] **Step 3: 服务器渲染器只处理受控模板中的 head 身份标签。**

```js
// admin-server/page-metadata.js
const {headEntries}=require('../shared/site-identity');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function ownedMeta(key) {
  key=String(key||'').toLowerCase();
  return ['description','robots','apple-mobile-web-app-title'].includes(key)||key.startsWith('og:')||key.startsWith('twitter:');
}
function attribute(tag,name) {
  const match=new RegExp('(?:^|\\s)'+name+'\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))','i').exec(tag);
  return match?.[1]??match?.[2]??match?.[3]??'';
}
function renderPageMetadata(html,meta,{preview=false}={}) {
  const entries=headEntries(meta,{preview}).map(entry=>{
    const attrs=Object.entries(entry.attributes).map(([k,v])=>` ${k}="${escape(v)}"`).join('');
    return entry.tag==='title'?`<title>${escape(entry.text)}</title>`:`<${entry.tag}${attrs}>`;
  }).join('\n');
  if(!/<head\b/i.test(html)) throw Error('HTML template requires a head');
  html=html.replace(/<head\b([^>]*)>([\s\S]*?)<\/head\s*>/i,(_,attrs,body)=>{
    body=body.replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi,'')
      .replace(/<meta\b[^>]*>/gi,tag=>ownedMeta(attribute(tag,'name')||attribute(tag,'property'))?'':tag)
      .replace(/<link\b[^>]*>/gi,tag=>attribute(tag,'rel').toLowerCase().split(/\s+/).includes('canonical')?'':tag);
    return `<head${attrs}>${entries}\n${body}</head>`;
  });
  return html.replace(/<html\b([^>]*)>/i,(_,attrs)=>
    `<html${attrs.replace(/\s+lang\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'')} lang="${escape(meta.language)}">`);
}
module.exports={renderPageMetadata,ownedMeta};
```

模板是部署代码，不是用户可上传的任意 HTML。测试要覆盖单双引号、属性顺序、大小写和 twitter 的 name/property 两种旧写法；不把正则清理当成不可信 HTML sanitizer。

- [x] **Step 4: 接入路由、真实 404 和私有响应头。**

在 HTML 路由拿到 `{id,config,snapshot}` 后先解析页面；不存在作品直接返回固定 404 页面，不加载引擎：

```js
const meta=pageMetadata(config,options.origin,req.path);
if(meta.status===404) return res.status(404).set('X-Robots-Tag','noindex, nofollow')
  .type('html').send('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow"><title>页面不存在</title></head><body><h1>页面不存在</h1><a href="/">返回首页</a></body></html>');
```

原 title 替换改为 `html=renderPageMetadata(html,meta,{preview:String(id).startsWith('preview-')})`；后面的字体/图标/脚本映射保留。

在 app.js 安全头中间件中添加（位于安装状态和授权检查之前，使失败响应也私有）：

```js
const privateResponse=req.path.startsWith('/admin')||req.path.startsWith('/api/admin')||
  req.path.startsWith('/api/setup')||/^\/api\/site\/preview-[^/]+\//.test(req.path)||
  Object.hasOwn(req.query,'preview');
if(privateResponse) res.set('Cache-Control','private, no-store').set('X-Robots-Tag','noindex, nofollow');
```

在 frontend.js、frontend-resources.js 和 installation.js 的后续 `no-store` 设置处保留已有 private 头：

```js
if (!res.get('Cache-Control')) res.set('Cache-Control','no-store');
```

sendResource 仍设置 nosniff，不能因已有 cache 头跳过它。HTML 最终响应不再无条件覆盖 private；后台静态文件设置 cacheControl:false，防止 express.static 默认头覆盖。现有测试若断言精确 no-store，对公开响应保留原断言，对 admin/preview 改为明确 private, no-store。

将 contentFixture 的最小 index.html 写成真正的 `<html><head><title>Fixture</title></head><body></body></html>`，不能让新测试绕开 renderer。

- [x] **Step 5: HTTP 安全验收。**

```js
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {httpFixture}=require('./helpers/http');
test('server identity ignores hostile host/query and unknown projects are 404',async t=>{
  const f=await httpFixture(t);
  const response=await f.request('/work/one?source=https://evil.example',{headers:{Host:'evil.example'}});
  assert.equal(response.status,200);
  const html=await response.text();
  assert.match(html,/href="http:\/\/localhost:3000\/work\/one"/);
  assert.doesNotMatch(html,/evil\.example|activetheory\.net/);
  const missing=await f.request('/work/not-present');
  assert.equal(missing.status,404);
  assert.match(missing.headers.get('x-robots-tag'),/noindex/);
});
test('preview dependencies remain owner-authenticated and private',async t=>{
  const f=await httpFixture(t); await f.createAdmin(); const headers=await f.login();
  const draft=await require('../admin-server/repositories/content').contentRepository(f.store).getDraft();
  const id=await require('../admin-server/config').createPreview(f.store,draft.revision,{root:f.root,dataDir:f.root+'/data'},'owner');
  for(const path of [`/?preview=${id}`,`/api/site/${id}/config`,`/api/site/${id}/bridge.js`]) {
    const response=await f.request(path,{headers});
    assert.equal(response.status,200);
    assert.equal(response.headers.get('cache-control'),'private, no-store');
    assert.match(response.headers.get('x-robots-tag'),/noindex/);
  }
  assert.equal((await f.request(`/api/site/${id}/config`)).status,401);
});
```

Task 5 添加 identity.js/client 导航后，将其加入相同矩阵；同时覆盖 app.js、compiled.vs 和 preview 资源响应。对 fixture 缺 shader 的情况只在临时 root 创建小型 shader 测试文件，不绕过 endpoint。

Run: `rtk proxy node --test tests/site-identity.test.js tests/metadata.test.js` 与 `rtk proxy node scripts/test-postgres.js tests/metadata-http.test.js tests/database-content.test.js tests/admin.test.js tests/installation.test.js`。
- [x] **Step 6: 审查后提交 `feat: render trusted route metadata and private previews`。** 包含 frontend-resources.js/installation.js 的响应头小改动，不包含任何真实 assets。

## Task 5: 浏览器导航共用投影，移除旧引擎的标题覆盖

**Files:**
- Create: `shared/page-metadata-dom.js`
- Modify: `shared/site-identity.js`, `admin-server/page-metadata.js`, `admin-server/frontend.js`, `tests/frontend.test.js`, `tests/metadata.test.js`, `tests/metadata-http.test.js`, `Dockerfile`, `tests/deployment.test.js`

**Interfaces:**
- Consumes shared.pageMetadata/headEntries/ownedMeta；DOM adapter 显式接收 document，不修改业务状态。
- Produces `SiteMetadataDOM.applyPageMetadata(document,meta,{preview=false}={})`，Node 同名导出。
- 新可信程序入口 `/api/site/:version/identity.js` 只拼接两份受版本控制的 shared 源码，不读取/返回上传脚本。
- bridgeSource 增加第四个参数 `origin`；mountFrontend 一律传 options.origin，现有直接调用测试同步提供测试 origin。
- 浏览器全局 `__SITE_UPDATE_IDENTITY__(state?)`；state 缺省读取 location.pathname，否则归一化已知 Router/state 字符串。

- [x] **Step 1: DOM adapter 的失败测试。** 在 metadata.test.js 增加独立假 DOM，不依赖任何数据库或原站引擎：

```js
function fakeDocument() {
  const items=[];
  const doc={title:'',documentElement:{lang:''}};
  doc.createElement=tag=>({tagName:tag.toUpperCase(),attributes:{},textContent:'',
    setAttribute(k,v){this.attributes[k]=String(v);},getAttribute(k){return this.attributes[k]??null;},
    remove(){const index=items.indexOf(this);if(index>=0)items.splice(index,1);}});
  doc.head={querySelectorAll(){return [...items];},appendChild(item){items.push(item);}};
  doc.items=items;
  return doc;
}
test('DOM updates clear old image/description and do not inject HTML',()=>{
  const {applyPageMetadata}=require('../shared/page-metadata-dom');
  const doc=fakeDocument();
  const viewport=doc.createElement('meta');viewport.setAttribute('name','viewport');doc.head.appendChild(viewport);
  applyPageMetadata(doc,identity.pageMetadata(config,'https://owner.example','/work/one'));
  assert.equal(doc.title,'One · A $& ` \\');
  const blank={...config,site:{...config.site,description:'',socialImage:''},projects:[]};
  applyPageMetadata(doc,identity.pageMetadata(blank,'https://owner.example','/'),{preview:true});
  assert.equal(doc.documentElement.lang,'zh-CN');
  assert.equal(doc.items.filter(n=>n.getAttribute('name')==='viewport').length,1);
  assert.equal(doc.items.filter(n=>/image$/.test(n.getAttribute('name')||n.getAttribute('property')||'')).length,0);
  assert.equal(doc.items.filter(n=>n.tagName==='TITLE').length,1);
  assert.equal(doc.items.find(n=>n.getAttribute('name')==='robots').getAttribute('content'),'noindex, nofollow');
});
```

Run: `rtk proxy node --test tests/metadata.test.js`；预期缺模块失败。

- [x] **Step 2: DOM adapter 实现。** ownedMeta 是 Task 4 的纯键识别器，将其定义收进 shared factory 并导出，服务器从 shared 导入，不复制第二套名单。

shared factory 的最终返回列表应为：

```js
return {DEFAULTS,LANGUAGES,normalizeSite,normalizeConfig,validateIdentity,
  publicPathForState,pageMetadata,headEntries,ownedMeta};
```

```js
(function(root,factory){
  if(typeof module==='object'&&module.exports) module.exports=factory(require('./site-identity'));
  else root.SiteMetadataDOM=factory(root.SiteIdentity);
})(globalThis,function(identity){
  'use strict';
  function applyPageMetadata(document,meta,{preview=false}={}) {
    document.title=meta.title;
    document.documentElement.lang=meta.language;
    for(const node of document.head.querySelectorAll('title,meta[name],meta[property],link[rel]')) {
      const tag=node.tagName.toLowerCase();
      if(tag==='title'||(tag==='meta'&&identity.ownedMeta(node.getAttribute('name')||node.getAttribute('property')))||
        (tag==='link'&&String(node.getAttribute('rel')).toLowerCase().split(/\s+/).includes('canonical'))) node.remove();
    }
    for(const entry of identity.headEntries(meta,{preview})) {
      const node=document.createElement(entry.tag);
      for(const [key,value] of Object.entries(entry.attributes))node.setAttribute(key,value);
      if(entry.text!==undefined)node.textContent=entry.text;
      document.head.appendChild(node);
    }
  }
  return {applyPageMetadata};
});
```

- [x] **Step 3: 版本化程序路由与加载顺序。** 在已调用 versionConfig 的 switch 中新增固定文件 case；不新增宽泛 static/shared 路由：

```js
case 'identity.js':
  return res.type('js').send(['site-identity.js','page-metadata-dom.js']
    .map(name=>fs.readFileSync(path.join(__dirname,'../shared',name),'utf8')).join('\n;\n'));
```

HTML head 注入按 identity → bridge → 既有引擎启动脚本的顺序，均为同源外部脚本。替换原 bridge 注入表达式：

```js
html=html.replace(/<head\b[^>]*>/i,head=>head+
  `<script src="/api/site/${id}/identity.js"></script><script src="/api/site/${id}/bridge.js"></script>`);
```

Dockerfile 在 COPY admin-ui 后添加 `COPY shared ./shared`。deployment.test.js 加断言 `/COPY shared/`，不改基础镜像或存储挂载。

- [x] **Step 4: bridge 安装单一更新函数，移除 document.title 的旧赋值。**

```js
function identityBridgeSource(config,origin,preview) {
  return `const identityConfig=${quote(config)},identityOrigin=${quote(origin)};
    window.__SITE_UPDATE_IDENTITY__=function(state){
      if(!window.SiteIdentity||!window.SiteMetadataDOM)return;
      const path=state===undefined?location.pathname:window.SiteIdentity.publicPathForState(state);
      const meta=window.SiteIdentity.pageMetadata(identityConfig,identityOrigin,path||'/__not-found');
      window.SiteMetadataDOM.applyPageMetadata(document,meta,{preview:${JSON.stringify(preview)}});
    };
    window.__SITE_UPDATE_IDENTITY__();`;
}
```

在 bridgeSource 现有返回字符串中保留 `window.__SITE_VERSION__`，把紧随其后的 `document.title=...` 替换为上面函数生成的源码；参数 preview 由 `String(version).startsWith('preview-')` 得出。保留所有原 fetch/XHR/Worker 资源路径映射。

- [x] **Step 5: ViewController 唯一锚点接入，不编辑原 assets。** 用以下内容替换现有 ViewController 的 title 字符串补丁块：

```js
source=replaceClass(source,'ViewController',code=>{
  const anchor='_this.bind("navigate", (path => _this.navigate(path))), document.title = "AGI旅行者· AGI Voyager", _this.bind("Work/project", (data => { document.title = data ? `${data.title} · Active Theory` : "AGI旅行者· AGI Voyager" }));';
  if(code.split(anchor).length!==2) throw fail(503,'前台导航与当前运行包不兼容');
  return code.replace(anchor,()=>
    '_this.bind("navigate", (path => _this.navigate(path))), _this.bind("Router/state", (state => window.__SITE_UPDATE_IDENTITY__?.(state))), window.__SITE_UPDATE_IDENTITY__?.();');
});
```

锚点已由本地授权包实际读取确认。不存在 ViewController 的最小测试包按 replaceClass 原语义跳过；有该类但锚点不匹配时明确报不兼容，不能静默残留旧标题 writer。只处理这个已触及的导航边界，不扩张成本阶段全引擎兼容注册表。

已确认 Router/state 是字符串，正常 history 模式在 pushState/replaceState 之后触发；内部滚动场景先 replaceState("") 再设置 about/contact 等私有状态。Work/project 的数据是 reshaped title/perma，不把它当原始 name/slug 再复制一套元信息逻辑。

- [x] **Step 6: 验证状态序列、真实源码锚点和私有脚本响应。**

在 frontend.test.js 使用已有 runtimeTest/runtimeClass：

```js
runtimeTest('ViewController metadata hook replaces both legacy title writers',()=>{
  const patched=require('../admin-server/frontend').patchAppSource(runtimeSource(),{site:{title:'Name'},songs:[]});
  const view=runtimeClass(patched,'ViewController');
  assert.match(view,/__SITE_UPDATE_IDENTITY__/);
  assert.doesNotMatch(view,/document\.title\s*=/);
  assert.doesNotMatch(view,/data\.title\} · Active Theory/);
});
```

原两项合成 ViewController 测试必须改用完整已知锚点，断言“调用统一 handler、合法字符经 shared resolver 保留”，不再要求用户标题出现在补丁源码中。没有授权运行包时保留明确 skip 原因。

在 metadata.test.js 使用 fakeDocument，并通过 bridgeSource 实际运行 handler：

```js
test('bridge uses same projection for detail/list/internal home transitions',()=>{
  const vm=require('node:vm'), document=fakeDocument();
  const window={SiteIdentity:identity,SiteMetadataDOM:require('../shared/page-metadata-dom'),fetch:async()=>{}};
  function XHR(){} XHR.prototype.open=function(){};
  const location={origin:'https://owner.example',pathname:'/work/one'};
  const script=require('../admin-server/frontend').bridgeSource(8,config,{assets:{},legacyMap:{}},location.origin);
  vm.runInNewContext(script,{window,document,location,URL,Request,XMLHttpRequest:XHR});
  for(const state of ['work/one','work','about','contact','work/one']) {
    window.__SITE_UPDATE_IDENTITY__(state);
    assert.equal(document.title,identity.pageMetadata(config,location.origin,identity.publicPathForState(state)).title);
  }
});
```

元信息脚本 `/api/site/preview-*/identity.js` 加入 Task 4 私有矩阵，同时验证匿名 401、owner/过期检查仍有效。HTML 验证 identity.js 位于 bridge.js 之前，内容不包含存储凭证/部署路径。

Run: `rtk proxy node --test tests/metadata.test.js tests/frontend.test.js`；`rtk proxy node scripts/test-postgres.js tests/metadata-http.test.js tests/database-content.test.js tests/deployment.test.js`。
- [x] **Step 7: 审查后提交 `feat: synchronize metadata with legacy navigation`。**

## Task 6: 管理端描述、语言、分享图编辑

**Files:**
- Modify: `admin-server/app.js`, `admin-ui/index.html`, `admin-ui/admin.js`, `tests/admin-ui.test.js`, `tests/setup-ui.test.js`, `tests/admin.test.js`

**Interfaces:**
- Consumes 共享 SiteIdentity.LANGUAGES 与现有 field/picker/dirty/save/preview/publish。
- 固定 `/admin/site-identity.js` 返回 shared/site-identity.js；无需登录可读取程序源码，与已有 admin shell 一致，不返回用户内容或数据。
- 不增加第二个配置 API；新字段与现有网站设置同一次保存、同一个 revision。

- [x] **Step 1: 在已有 admin-ui VM/假 DOM 测试中增加失败断言。** 扩展 field harness 的 fake Node 支持 `append` 和 `tagName`，直接调用从实际源码提取的 field：

```js
const selected=[];
const input=field(parent,'页面语言','en',v=>selected.push(v),{
  choices:[{value:'zh-CN',label:'简体中文'},{value:'en',label:'English'}]
});
assert.equal(input.tagName,'SELECT');
assert.equal(input.value,'en');
input.value='zh-CN'; input.listeners.change();
assert.deepEqual(selected,['zh-CN']);
const description=field(parent,'网站描述','',()=>{},{multiline:true,maxLength:500});
assert.equal(description.tagName,'TEXTAREA');
assert.equal(description.maxLength,500);
```

沿用 tests/admin-ui.test.js 已有 source slice + VM 的测试风格，不能用“源码含 select 字符串”代替上述行为断言。
Run: `rtk proxy node --test tests/admin-ui.test.js`；应因尚未支持 choices/maxLength 失败。

- [x] **Step 2: 固定 shared 路由和加载顺序。** app.js 在 `/admin` static 之前注册：

```js
app.get('/admin/site-identity.js',(req,res)=>res.type('js').sendFile(
  path.join(__dirname,'../shared/site-identity.js'),{cacheControl:false}));
```

admin-ui/index.html 在 setup.js 前添加：

```html
<script defer src="/admin/site-identity.js"></script>
```

不得公开整个 shared/仓库目录；既有 CSP 无需放宽。

- [x] **Step 3: field 增加受控选项和字数限制。** 替换创建 input 的三行，并在 value 设置之前填选项；复用后面的标签/id/help：

```js
const input=node(options.choices?'select':options.multiline?'textarea':'input');
input.id=id;
if(!options.choices&&!options.multiline)input.type=options.type||'text';
if(options.choices)for(const choice of options.choices){
  const option=node('option',choice.label);option.value=choice.value;input.append(option);
}
if(options.maxLength!==undefined)input.maxLength=options.maxLength;
// existing input.value assignment follows here unchanged.
input.addEventListener(options.choices?'change':'input',()=>
  onChange(options.type==='number'?Number(input.value):input.value));
```

删除原来的 input listener，避免同一变更触发两次；资源选择器分支保持原样。

- [x] **Step 4: siteView 将新字段放入“搜索与分享”面板，保留原基本信息和音乐。** 原基本信息遍历增加过滤：

```js
for(const [key,value] of Object.entries(state.config.site).filter(([key])=>
  !['description','language','socialImage'].includes(key))) {
  field(grid,labels[key]||key,value,v=>{state.config.site[key]=v;dirty();},{
    help:key==='labUrl'?'使用 HTTPS 链接':key==='emailLink'?'只填写邮箱地址，不需要 mailto:':undefined
  });
}
const identity=panel(content,'搜索与分享');
const update=(key,value)=>{state.config.site[key]=value;dirty();};
field(identity,'网站描述',state.config.site.description,v=>update('description',v),{
  multiline:true,maxLength:500,help:'最多 500 字符。用于搜索和分享介绍，不改变 3D 场景文字。'
});
const languageLabels={'zh-CN':'简体中文','zh-TW':'繁體中文',en:'English'};
field(identity,'页面语言',state.config.site.language,v=>update('language',v),{
  choices:window.SiteIdentity.LANGUAGES.map(value=>({value,label:languageLabels[value]})),
  help:'声明页面内容的语言，不会自动翻译网站。'
});
const social=field(identity,'分享图片',state.config.site.socialImage,v=>update('socialImage',v),{
  pick:'image',help:'选择图片资源或填写 HTTPS 图片地址；留空则不使用默认分享图。'
});
identity.append(button('清空分享图片',()=>{social.value='';update('socialImage','');}));
identity.append(node('p','网站域名来自服务器 SITE_ORIGIN。修改先保存为草稿，发布后才影响公开页面。','muted'));
```

不改默认存储、不自动上传文件，不把输入值写 localStorage。复用已有保存时 dirty 状态保护。

- [x] **Step 5: UI 与 HTTP 回归。** 增加脚本顺序断言与伪输入交互断言，再通过真实 HTTP 保存三字段并确认匿名已发布 config 在发布前不变：

```js
test('admin identity contract is self-hosted and read-only',async t=>{
  const f=await require('./helpers/http').httpFixture(t);
  const script=await f.request('/admin/site-identity.js');
  assert.equal(script.status,200);
  assert.equal(script.headers.get('cache-control'),'private, no-store');
  assert.match(script.headers.get('x-robots-tag'),/noindex/);
  const html=await (await f.request('/admin/')).text();
  assert(html.indexOf('/admin/site-identity.js')<html.indexOf('/admin/admin.js'));
  assert.equal((await f.request('/shared/site-identity.js')).status,404);
});
```

Run: `rtk proxy node --test tests/admin-ui.test.js tests/setup-ui.test.js` 与 `rtk proxy node scripts/test-postgres.js tests/admin.test.js tests/metadata-http.test.js`。
- [x] **Step 6: 审查后提交 `feat: edit published site description language and share image`。**

## Task 7: 跨边界回归、实际浏览器验收与交付文档

**Files:**
- Modify: `tests/schema-upgrade.test.js`, `tests/importers.test.js`, `tests/metadata-http.test.js`, `tests/deployment.test.js`
- Modify: `README.md`, `docs/ADMIN.md`, `docs/POSTGRESQL-MIGRATION.md`
- Create: `docs/verification/site-identity-upgrade.md`

**Interfaces:**
- 消费前六个任务，不再新增生产行为。实际验证记录必须区分通过、失败、跳过和未验证，不能使用上一轮 199 项结果证明新代码。

- [x] **Step 1: 封闭跨任务验收缺口。** 在测试中加入以下实际断言，不只检查返回 200：

```js
// In the V1 upgrade test, include stable textual JSONB checks around upgrade:
const beforeHistory=(await store.query('SELECT id,created,snapshot::text AS snapshot FROM personal_site.versions ORDER BY id')).rows;
const beforePreviews=(await store.query('SELECT id,owner,expires,snapshot::text AS snapshot FROM personal_site.previews ORDER BY id')).rows;
const beforeCredentials=(await store.query('SELECT id,credentials FROM personal_site.storages ORDER BY id')).rows;
await upgradeInstalled(store);
assert.deepEqual((await store.query('SELECT id,created,snapshot::text AS snapshot FROM personal_site.versions ORDER BY id')).rows,beforeHistory);
assert.deepEqual((await store.query('SELECT id,owner,expires,snapshot::text AS snapshot FROM personal_site.previews ORDER BY id')).rows,beforePreviews);
assert.deepEqual((await store.query('SELECT id,credentials FROM personal_site.storages ORDER BY id')).rows,beforeCredentials);
// Current draft/schema get defaults; old historical config is still missing them:
assert.equal((await store.query("SELECT site->>'language' AS language FROM personal_site.site_settings")).rows[0].language,'en');
assert.equal((await store.query("SELECT snapshot->'config'->'site' ? 'language' AS present FROM personal_site.versions WHERE id=42")).rows[0].present,false);
```

Task 2 的 V1 helper 已种入第二个历史版本、一个预览、一条会话和假 S3 credentials；这些测试不得退化为空数组比较。只使用测试固定假值，不生成/读取实际云密钥。迁移测试还要验证 installation.source/completed_at 保留，revision 仅增加一次，失败后的 schema_config 原样回滚。

旧 SQLite 预检/导入/恢复测试比较临时源 SHA-256 前后相同，不能使用用户实际 SQLite。当前草稿与历史分别检查分享图，拒绝错资源种类，删除/清空不删除旧版本引用。

- [x] **Step 2: 完整自动化验证与容器打包检查。**

```sh
rtk proxy node --test tests/site-identity.test.js tests/metadata.test.js tests/admin-ui.test.js tests/setup-ui.test.js
rtk proxy node scripts/test-postgres.js
rtk proxy npm audit
rtk proxy git diff --check
rtk proxy shasum -a 256 admin-server/migrations/001-initial.sql
rtk proxy docker compose -f compose.test.yaml -p site-pg-test config --quiet
```

生产 compose 模板只使用测试占位环境做 config 检查，不加载仓库真实 .env；可用 `--env-file` 指向临时无秘密 fixture 文件。新增 shared/ 文件必须在 Docker build 的应用镜像内，不能只在宿主机工作。通过临时标签构建镜像后，只启动绑定回环随机端口的测试实例，不对当前服务执行 compose up。

若依赖/平台 API 需要查当前文档，遵守项目 ctx7 规则（先 library 再 docs，最多三条命令）；本计划基于现有源码接口，不要求更换依赖版本。

- [x] **Step 3: 在隔离实例做实际浏览器验收。** 执行前读取合适的 browse/playwright 技能与其必要引用；不把现有 `localhost:3000/admin/` 当测试目标。实例必须使用明确的临时 root/dataDir、测试 store、回环测试端口和固定的假管理员；不调用 loadOptions 读取实际 .env。

逐项记录实际结果：

1. 全新安装 schema2 → 登录 → 网站设置出现 textarea、语言 select、图片选择器与清空按钮。
2. 输入包含 `&`、美元符号、反引号的标题、中文描述；保存草稿后匿名公开内容不变。
3. 私有预览 HTML、identity/bridge/app/shader 和资源请求带 private/no-store/noindex，退出登录后预览不能访问。
4. 发布后直接打开首页、作品列表、作品 A/B，检查 head 标签唯一、canonical origin 正确；不依赖爬虫执行 JS。
5. 在 3D 导航内按 首页 → Work → A → B → 列表 → About/Contact → 浏览器后退/前进，检查标题、描述、图片和 canonical；无全局轮询。
6. 分享图清空并发布后移除旧 image 标签；直接访问未知 slug 得到真实 404。
7. 用同一个授权运行包、同一组隔离内容，在基线与候选版本比较 Logo、黑洞轮廓/粒子、作品和联系场景。不得拷贝真实数据库/私有 uploads 作为测试数据；无法获得等价素材时准确标记该视觉项未验证。
8. 查看浏览器脚本错误与网络失败；没有实际 S3/CDN 凭证时，真实公网对象可读性和 CORS 保留未验证，不能用本地重定向测试代替。

此步骤的服务必须有已记录所有者、PID/容器名和清理方式。结束时只关闭本次创建的实例；若复用了别人已运行的专用测试库，不关闭它。

- [x] **Step 4: 更新用户文档，使用以下已确定的文案。** 在对应章节合并，不重复矛盾说明：

```markdown
### 网站描述、语言与分享图片

“网站设置 → 搜索与分享”可以配置描述、页面语言和默认分享图片。修改仍需先保存草稿，再预览和发布。语言设置不会自动翻译内容；描述不受 3D 字体字形限制。作品详情优先使用该作品的描述和 image 图片，缺省时使用网站设置。

canonical 与分享 URL 的域名来自服务器 SITE_ORIGIN，不能在浏览器里填写另一个域名。分享图必须是已登记的图片或经登记的 HTTPS 外链；清空只影响新草稿/新发布版本，不删除历史版本使用的资源。

### 从数据库结构 1 升级到 2

新安装直接创建当前结构。已有实例不会在启动、登录或访问时自动升级；新程序检测到结构 1 时进入维护状态，不重新开放安装。

先在维护窗口停止旧应用写入，完成并验证 PostgreSQL、媒体和独立密钥备份，再在已确认的目标环境显式执行 npm run db:migrate。升级只补充当前站点字段和模板字段、增加一次草稿修订号；保留账号、资源 ID、安装来源和时间、发布指针及历史版本快照。无需再次创建管理员。

升级失败时数据库事务回滚；不要删除 schema 或重复初始化。结构 2 不能直接用旧程序回退运行；需要恢复时使用维护窗口内验证过的备份，不提供破坏性自动降级。升级前打开的后台编辑器应刷新后再编辑。

旧版本恢复只改变草稿，并以空描述、en 语言、空分享图补齐缺失字段。既有历史快照不被改写；旧引擎 metadata.json 接口保持原语义。
```

README 将“只有校验的迁移命令”解释更新为已实际支持 1→2，注明实际测试日期/范围；不宣称阶段 B/C/D 已完成。

- [x] **Step 5: 写验证记录并独立审查整段 diff。** `docs/verification/site-identity-upgrade.md` 记录：执行提交、Node/PG 版本、隔离目标、实际命令、通过/失败/skip 数、浏览器路径与截图位置、原始 001 摘要、历史快照保持证明、未验证外部项和清理结果。未执行项目写“未验证”，不预填成功。
- [x] **Step 6: 完整通过后提交 `docs: document schema 2 upgrade and site identity verification`。** 最终报告仅声称第一阶段完成；真实站点升级和 GitHub 推送仍需另行授权。

## 规格覆盖与计划自审

| 规格要求 | 任务与验证 |
| --- | --- |
| 不变 001、连续迁移、checksum、指纹、升级锁和回滚 | Task 2 / schema-upgrade、postgres、deployment |
| 新安装/旧安装/故障状态隔离、禁止重建管理员 | Task 2 / installation、setup-ui、维护 HTTP |
| 新字段、默认值、JSONB schema、revision、旧版本恢复 | Tasks 1–3 / site-identity、config、importers |
| 原始账号/资源/凭证/历史/安装信息不变 | Tasks 2、7 / 持久化 SQL 前后比较 |
| 分享图明确引用、种类、缺失/回收/禁用、历史图库存 | Task 3 / publication、database-content、importers |
| 可信 origin、三种路由、SSR、404、转义、标签去重 | Task 4 / metadata、metadata-http |
| 原站模板接口保留、导航一致、无 DOM 轮询 | Task 5 / frontend runtime + VM + 实际浏览器 |
| 管理/预览私有头、owner/expiry、脚本和资源权限 | Tasks 4–6 / HTTP 矩阵 + 浏览器网络 |
| 中文后台控件、保存/发布流程、Docker shared 打包 | Tasks 5–6 / admin-ui、deployment |
| 完整回归、真实视觉边界、文档与真实数据保护 | Task 7 |

- 本计划代码块是实施输入，不表示已经应用或测试通过；遇到源事实与计划不一致，先记录并在不扩大范围的前提下修订，不照抄损坏现有保护。
- 计划自审由主代理执行：接口名统一为 normalizeSite/normalizeConfig/validateIdentity/pageMetadata/headEntries；schemaVersion 返回字段与 CLI upgraded 字段一致；不得引用尚未定义的业务函数。
- 每个任务独立 review；前序测试不通过不继续堆叠下一任务。不将 B/C/D 阶段工作夹带进来。

## 执行方式选择

1. **子代理逐项实施（推荐）**：当前会话中为每项任务分配实施者，依次做规格符合性和代码质量审查；主代理负责集成与最终真实验证。
2. **当前代理顺序实施**：使用 executing-plans 技能在当前会话分批执行，同样保留红绿测试、检查点与独立审查。

状态：已按用户选择的子代理逐项方式完成第一阶段 A，包括逐任务审查、242 项隔离回归、实际浏览器验收及整分支最终独立审查（2026-10-14）。同日按用户选择本地合并回 `feat/authenticated-resource-admin`，合并后再次通过 242 项测试；测试服务已清理、临时工作区已可恢复归档。详见[验证记录](../../verification/site-identity-upgrade.md)。B/C/D 未实施，没有真实数据库升级、GitHub 推送或部署。

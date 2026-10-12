# PostgreSQL 与网页安装向导 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有单站点后台迁移到 PostgreSQL，让全部业务配置与资源引用由数据库提供，并支持受保护的首次网页安装和旧数据迁移。

**Architecture:** 保留 Node.js/Express 与静态管理 UI；使用 `pg` 连接池、显式仓储和事务。导入器一次性读取旧配置及 SQLite；正常请求只使用数据库中的完整配置快照，媒体字节仍由本地/S3 提供。安装壳不依赖数据库可用，数据库初始化与管理员创建在同一受锁事务中完成。

**Tech Stack:** Node.js >=24.0.0、Express 4、node-postgres (`pg`)、PostgreSQL 18、node:test、原有 S3 SDK、原生浏览器 JavaScript、Docker Compose。

## Global Constraints

- 正式版本使用 PostgreSQL 保存全部业务数据、资源记录与引用关系；媒体文件本体仍放本地磁盘或通用 S3。
- SQLite 仅保留为旧版数据迁移的只读来源。
- 单站点、单管理员；不提供公开注册、多数据库运行时回退、任意代码上传或全站媒体自动迁移。
- 数据库不可达、查询报错或版本不兼容返回不可用/维护状态，绝不能被当作“新站未安装”。
- 已安装后，设置新的 SETUP_TOKEN 也不能再次初始化；安装完成记录是权威依据。
- 不在安装事务中进行 S3 网络请求、大文件复制或模型转换。
- 迁移不会自动把本地资源上传到云端，也不删除原文件，不把资产加入 Git。
- 隔离测试通过后才切换用户的本地实例；不自动推送 GitHub 或公开部署。
- 保留现有 Logo、黑洞、素材和非本次改动；不修改工作区已有的 `.gitignore`、生成模型脚本及未跟踪效果脚本。
- 所有 shell 命令以 `rtk` 开头；编辑用 apply_patch。本文命令中的测试口令仅用于隔离测试，不能进入生产环境。
- 本文是实施计划，不是功能已完成的声明。任务勾选必须对应实际验证结果。

---

## 基线、环境和顺序

设计：`docs/superpowers/specs/2026-10-12-postgresql-installation-design.md`，用户已确认。现有实现基线 `bd7ef11`；设计提交 `f5de03e`。当前分支 `feat/authenticated-resource-admin` 有用户未提交修改，不用 `git add .`。

2026-10-12 只读检查：Node v24.14.0；Docker CLI 已安装，但 Docker daemon 不可达；PATH 中没有 psql/postgres/pg_ctl。实施者先确认可用的隔离 PostgreSQL；不能把环境缺失算作测试通过，也不自动安装系统服务。规划期间不启动容器、不更改当前 3000 端口服务。

任务依赖：1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9。数据层、安装和前台高度耦合，因此保留一份计划；各任务各自拥有测试和审阅门槛。若选择子代理执行，也按此顺序交付，不能同时改同一业务文件。

新增 PostgreSQL 模块在任务 6 接线前不替换运行中的 SQLite 入口；测试直接导入新模块。任务 6 起运行时只走 PostgreSQL。任务 4/5 的路由改造保留在同一实施批次，禁止将中间不兼容版本当作可部署版本。

## 文件职责

| 文件 | 责任 |
| --- | --- |
| `admin-server/postgres.js` | pg Pool、固定连接事务、连接/查询超时、关闭 |
| `admin-server/migrations.js`、`admin-server/migrations/001-initial.sql` | 固定应用 schema `personal_site`、迁移校验和与版本 |
| `admin-server/repositories/{auth,content,resources,storages,audit}.js` | 参数化 SQL 与结构化持久化；不包含 HTTP 或磁盘导入 |
| `admin-server/importers/{bundle,sqlite}.js` | 受控一次性内容包/旧库导入；禁止运行期回源 |
| `admin-server/resource-catalog.js`、`admin-server/engine-assets.json` | 资源分类、依赖关系、显式引擎槽位清单 |
| `admin-server/snapshots.js` | 完整快照、资源映射、引用与公开字段投影 |
| `admin-server/installation.js`、`admin-server/setup-auth.js` | 安装状态、令牌会话、预检、原子安装 |
| `admin-server/http.js` | Express 4 异步错误转发；公开安全错误映射 |
| `admin-ui/setup.js`、`admin-ui/setup.css` | 中文安装向导；与现有工作台分离 |
| `scripts/db-migrate.js`、`scripts/import-site.js` | 显式升级、只读迁移报告；不打印凭证 |
| `tests/helpers/{postgres,http,content}.js` | 独立测试数据库/HTTP 服务/小型素材 fixture |
| `tests/fixtures/model.js` | 从 model.test.js 提取 GLB fixture，避免重复注册测试 |
| `compose.test.yaml`、`scripts/test-postgres.js` | 隔离 PostgreSQL 集成测试入口 |
| `docker/postgres-init.sh` | 内置数据库首启时创建非超级用户应用角色，只授予专用数据库权限 |
| 原有 app/security/config/resources/models/frontend、server、admin UI | 异步接线、保持现有 API 与视觉效果 |

### 统一接口与数据形状

所有 SQL 值使用 `$1` 参数；业务 SQL 使用 `personal_site.` 限定表名，不接受请求提供的 schema/table。以下是任务之间的接口契约，所有 Promise 必须等待。

```js
// postgres.js
// openPostgres({ databaseUrl, ssl, max = 8 }): Store
// Store.query(text, values = []): Promise<{ rows, rowCount }>
// Store.transaction(async tx => result): Promise<result>
// tx 只暴露 query；仓储可绑定 Store 或 tx；不支持嵌套 transaction。
// Store.close(): Promise<void>

// migrations.js
// inspectInstallation(store): Promise<
//   { state: 'uninstalled' | 'installed' | 'incompatible', schemaVersion: number|null }
// >；连接/权限错误抛出，不返回 uninstalled。
// migrate(tx): Promise<void>；调用方持有全局事务锁。

// snapshots.js — 业务 config 保持现有 {site, projects, scenes, songs}。
// Snapshot = {
//   format: 2, config,
//   template: { baseUIL, contact, metadata, fontCoverage, readiness },
//   assets: { [slot]: { resourceId, fileName } },
//   legacyMap: { [canonicalURL]: slot }
// }
// ImportBundle = {
//   draft: Snapshot, schema: config, versions: [{id, created, snapshot}],
//   published: number|null, revision: number,
//   resources: Resource[], storages: Storage[], defaultStorage: string,
//   admin: {username, hash}|null, audit: Audit[], report: ImportReport
// }
// ImportReport = { counts, missingRequired: string[], warnings: string[],
//   credentialsUnavailable: string[], hasAdmin: boolean, digest: string }
// 公开投影绝不包含 storages.credentials、key、本机路径、admin、audit。

// tests/helpers/postgres.js
// postgresFixture(t, {migrated = true} = {}): Promise<{store, databaseUrl}>
// 唯一 site_test_<32位hex> 数据库；仅允许 TEST_DATABASE_URL 指向专用测试服务。
// fixture(t) 结束时只清理由自身创建且名称严格匹配的数据库。
// 无 TEST_DATABASE_URL 直接失败并给出启动指引，不能 silently skip。

// tests/helpers/content.js
// contentFixture(t): {root, bundle, legacyPath, sourceHash}
// 仅临时目录；生成一个小型 UIL/CMS、字体图集、小图片和历史 SQLite 样本。
// bundle 来源与 importer 输出遵循 ImportBundle；不用真实用户素材写测试。

// tests/helpers/http.js
// httpFixture(t, {store, options, installed=false}):
// Promise<{request(path, init), base, root, setupSession(), login(), restart()}>
// setupSession() 返回含 Cookie/Origin/X-CSRF-Token 的 headers；只用测试令牌。
// login() 使用 fixture 创建的测试管理员；restart() 关闭连接并新建应用实例。
// installed=true 的 fixture 先通过仓储导入小样本、创建测试账号并写安装记录；
// 不依赖 task 6 的安装 API。app 在测试中通过服务端 options.store 注入该 store。
// restart() 保持同一隔离 databaseUrl/root；request() 读取更新后的 server/base。
```

### Task 1: PostgreSQL 连接、schema 与真实测试环境

**Files:** 创建 postgres.js、migrations.js、migrations/001-initial.sql、tests/helpers/postgres.js、tests/postgres.test.js、scripts/test-postgres.js、compose.test.yaml；修改 package.json/package-lock.json。

**Interfaces:** 产出 Store、migrate(tx)、inspectInstallation(store)、postgresFixture(t)，定义见上。

- [ ] **1. 写失败测试**，覆盖回滚、同连接与池释放。

```js
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {postgresFixture} = require('./helpers/postgres');
test('transaction rollback leaves no audit event and releases client', async t => {
  const {store} = await postgresFixture(t);
  await assert.rejects(store.transaction(async tx => {
    await tx.query("INSERT INTO personal_site.audit_events(action,actor) VALUES($1,$2)", ['rollback-test','test']);
    throw Error('rollback-marker');
  }), /rollback-marker/);
  assert.equal((await store.query('SELECT count(*)::int AS n FROM personal_site.audit_events')).rows[0].n, 0);
  assert.equal((await store.query('SELECT 1 AS ok')).rows[0].ok, 1);
});
```

- [ ] **2. 启动专用测试环境并运行红灯测试**。Docker 可用后使用 `rtk proxy docker compose -f compose.test.yaml -p site-pg-test up -d --wait`。test compose 仅绑定 `127.0.0.1:55432:5432`，容器命名隔离，不挂载真实 data、不用生产数据库；若端口占用先修改测试端口。执行 `rtk proxy node scripts/test-postgres.js tests/postgres.test.js`，初始应因缺少新模块失败，不应因误连真实数据库失败。

```yaml
# compose.test.yaml — 测试密码只适用于这个不映射公网的临时实例。
services:
  db:
    image: postgres:18
    environment:
      POSTGRES_USER: site_test
      POSTGRES_PASSWORD: local-test-only
      POSTGRES_DB: site_test_control
    ports:
      - "127.0.0.1:55432:5432"
    tmpfs:
      - /var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U site_test -d site_test_control"]
      interval: 2s
      timeout: 3s
      retries: 30
```

test-postgres.js 仅为该测试入口设置默认 TEST_DATABASE_URL 为 `postgresql://site_test:local-test-only@127.0.0.1:55432/site_test_control`，显式环境覆盖必须由实施者确认是测试库。创建数据库名称取randomUUID并移除短横线，严格 `/^site_test_[a-f0-9]{32}$/` 后才作为SQL标识符；收尾先close所有连接，再仅drop这次创建的名称。不要使用生产DATABASE_URL做回退。
- [ ] **3. 安装 pg 并实现连接层**：`rtk proxy npm install pg`；锁定实际解析版本到 lockfile。连接与普通查询设有限超时；不记录 connectionString；Pool 的 error 监听只输出错误码。事务核心按官方同 client 模式：

```js
async function transaction(pool, fn) {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL lock_timeout = '5s'");
    const result = await fn({query: (sql, values = []) => client.query(sql, values)});
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { broken = true; }
    throw error;
  } finally { client.release(broken); }
}
```

- [ ] **4. 建完整 schema**。migration 为事务内静态 SQL，不使用 CONCURRENTLY；schema 名固定 personal_site。关键约束与表结构如下，其余 JSONB 只承载记录的扩展属性，不藏全量列表：

```sql
CREATE SCHEMA personal_site;
CREATE TABLE personal_site.schema_migrations (version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE personal_site.installation (id boolean PRIMARY KEY DEFAULT true CHECK (id), completed_at timestamptz NOT NULL DEFAULT now(), source text NOT NULL, schema_version integer NOT NULL);
CREATE TABLE personal_site.admins (id boolean PRIMARY KEY DEFAULT true CHECK (id), username text UNIQUE NOT NULL, hash text NOT NULL);
CREATE TABLE personal_site.sessions (id text PRIMARY KEY, username text NOT NULL REFERENCES personal_site.admins(username) ON UPDATE CASCADE ON DELETE CASCADE, csrf text NOT NULL, created bigint NOT NULL, touched bigint NOT NULL);
CREATE TABLE personal_site.login_attempts (key text PRIMARY KEY, count integer NOT NULL CHECK(count >= 0), expires bigint NOT NULL);
CREATE TABLE personal_site.templates (id text PRIMARY KEY, schema_config jsonb NOT NULL, content jsonb NOT NULL);
CREATE TABLE personal_site.versions (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, created timestamptz NOT NULL DEFAULT now(), snapshot jsonb NOT NULL);
CREATE TABLE personal_site.storages (id text PRIMARY KEY, type text NOT NULL CHECK(type IN ('local','s3')), config jsonb NOT NULL, credentials text, available boolean NOT NULL DEFAULT true);
CREATE TABLE personal_site.site_settings (id boolean PRIMARY KEY DEFAULT true CHECK(id), site jsonb NOT NULL, revision integer NOT NULL DEFAULT 0, published bigint REFERENCES personal_site.versions(id), template_id text NOT NULL REFERENCES personal_site.templates(id), default_storage text NOT NULL REFERENCES personal_site.storages(id));
CREATE TABLE personal_site.scenes (id text PRIMARY KEY, ordinal integer UNIQUE NOT NULL, label text NOT NULL, fields jsonb NOT NULL);
CREATE TABLE personal_site.projects (id text PRIMARY KEY, slug text UNIQUE NOT NULL, ordinal integer UNIQUE NOT NULL, content jsonb NOT NULL);
CREATE TABLE personal_site.songs (id text PRIMARY KEY, ordinal integer UNIQUE NOT NULL, title text NOT NULL, src text NOT NULL);
CREATE TABLE personal_site.resources (id text PRIMARY KEY, source text NOT NULL CHECK(source IN ('bundled','local','s3','external')), storage_id text REFERENCES personal_site.storages(id), object_key text, url text NOT NULL, name text NOT NULL, kind text NOT NULL, mime text, size bigint, checksum text, status text NOT NULL, original_id text REFERENCES personal_site.resources(id) DEFERRABLE INITIALLY DEFERRED, trashed boolean NOT NULL DEFAULT false, created timestamptz NOT NULL DEFAULT now(), details jsonb NOT NULL DEFAULT '{}');
CREATE TABLE personal_site.previews (id text PRIMARY KEY, owner text NOT NULL REFERENCES personal_site.admins(username) ON DELETE CASCADE, expires timestamptz NOT NULL, snapshot jsonb NOT NULL);
CREATE TABLE personal_site.resource_references (resource_id text NOT NULL REFERENCES personal_site.resources(id), owner_type text NOT NULL CHECK(owner_type IN ('draft','version','preview','resource')), owner_id text NOT NULL, slot text NOT NULL, PRIMARY KEY(resource_id,owner_type,owner_id,slot));
CREATE TABLE personal_site.audit_events (id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, created timestamptz NOT NULL DEFAULT now(), action text NOT NULL, actor text);
CREATE INDEX sessions_expiry ON personal_site.sessions(touched,created);
CREATE INDEX resource_owners ON personal_site.resource_references(owner_type,owner_id);
CREATE INDEX preview_expiry ON personal_site.previews(expires);
```

迁移器先 `pg_advisory_xact_lock(734216901)`，校验已应用 SQL 的 SHA256，不接受篡改/高于程序支持的版本。没有 schema 为 uninstalled；存在不完整/未知 schema 为 incompatible，不能直接覆盖。001 执行后存入 checksum；安装记录由任务 6 写，不由迁移器写。仅全新 schema 执行上述 CREATE，重复应用通过迁移记录判定。
- [ ] **5. 扩充并通过测试**：重复迁移无副作用、checksum 不符拒绝、未知 schema 拒绝、两个 pool PID 在同一事务始终相同、连接失败不判未安装、bigint 转安全数字前检查范围。测试工具内置 URL 仅连接测试端口；环境覆盖必须显式标识测试用途。
- [ ] **6. 提交此任务文件**：`rtk git commit -m "feat: add PostgreSQL foundation and isolated integration tests"`；先逐个 git add 本任务文件，记录测试结果。

### Task 2: 结构化仓储与完整版本快照

**Files:** 创建 repositories/{auth,content,resources,storages,audit}.js、snapshots.js、tests/repositories.test.js、tests/helpers/content.js。

**Interfaces:** 工厂 `authRepository(db)`、`contentRepository(db)`、`resourceRepository(db)`、`storageRepository(db)`、`auditRepository(db)`；db 为 Store 或 tx。仓储不自开事务；组合事务归服务所有。

```js
// auth: getAdmin(), getSession(id), putSession(row), touchSession(id, now),
// deleteSession(id), clearSessions(), pruneSessions(now), replaceAdmin({username,hash}),
// reserveAttempt(keys, now, limit), clearAttempts(keys)
// content: getDraft({lock=false}={}), writeDraft(config, expectedRevision),
// getTemplate(), importBundle(bundle), getVersion(id), listVersions(),
// insertVersion(snapshot, {id,created}={}), setPublished(id),
// putPreview({id,owner,expires,snapshot}), getPreview(id, owner, now), prunePreviews(now)
// resource: list(), get(id), insert(resource), setTrashed(id, trashed),
// replaceReferences({ownerType,ownerId,references}), references(id), isPublished(id)
// storage: list(), get(id), upsert(storage), getDefault(), setDefault(id)
// audit: append(action,actor), recent(limit=10)
// snapshots: composeSnapshot({config,template,assets,legacyMap}),
// collectReferences(snapshot), publicSnapshot(snapshot, versionId)
```

- [ ] **1. 写失败测试**：并发独立资源插入不丢记录、配置 CAS 只有一个成功、外键拒绝悬空资源、快照深拷贝不污染模板。使用 task 1 的真实 PG fixture。

```js
test('two writers cannot silently replace the same draft', async t => {
  const {store} = await postgresFixture(t);
  const {bundle} = contentFixture(t);
  await store.transaction(tx => contentRepository(tx).importBundle(bundle));
  const {config: original, revision} = await contentRepository(store).getDraft();
  const outcomes = await Promise.allSettled(['A','B'].map(title =>
    store.transaction(async tx => {
      const repo = contentRepository(tx);
      const config = structuredClone(original);
      config.site.title = title;
      return repo.writeDraft(config, revision);
    })));
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(outcomes.find(r => r.status === 'rejected').reason.status, 409);
});
```

- [ ] **2. 运行红灯**：`rtk proxy node scripts/test-postgres.js tests/repositories.test.js`，应失败于缺少仓储。
- [ ] **3. 实现 CAS、行锁和资源独立记录**。配置 CAS 后在同一 tx 更新 scenes/projects/songs；稳定 ID 用导入原 ID 或生成后持久化的 UUID。不能每次读取重新分配 ID。CAS 关键 SQL：

```js
const result = await db.query(
  'UPDATE personal_site.site_settings SET site=$1, revision=revision+1 WHERE id=true AND revision=$2 RETURNING revision',
  [config.site, expectedRevision]
);
if (!result.rowCount) throw Object.assign(Error('配置版本冲突，请刷新后重新编辑'), {status:409});
```

锁顺序固定为 site_settings → 按 ID 排序的 resources → references。发布与回收均遵守该顺序，不能在检查引用后释放锁再回收。认证限流计数采用原子 upsert，不能读计数后整体覆盖。库值 JSONB 由 pg 解析，禁止再次 JSON.parse。所有 row mapper 显式 snake_case → 原 API camelCase，timestamps 输出 ISO，旧版本 ID 保留并推进 identity sequence。
- [ ] **4. 实现 Snapshot**：模板包含完整 UIL/contact/metadata/字体字符表及 readiness；公开配置只投影 config 和安全资源入口，原业务 API 保持四个根字段，不让管理端提交 template/legacyMap/SQL。collectReferences 生成 `{resourceId, slot}`，每个被页面使用的已登记媒体（包括字体伴随文件）都必须建立引用；未使用的inventory条目不假装已发布。无悬空 owner，删除 preview 时同事务清其引用。
- [ ] **5. 通过测试**：CAS、发布引用与回收竞争、排序 roundtrip、默认存储引用限制、session 散列存储、事务中途错误整个列表写入回滚。新增键顺序不同但值相同的 JSONB 配置测试。
- [ ] **6. 提交**：`rtk git commit -m "feat: add structured repositories and complete site snapshots"`。

### Task 3: 只读导入、资源目录和旧库迁移

**Files:** 创建 importers/bundle.js、importers/sqlite.js、resource-catalog.js、engine-assets.json、scripts/import-site.js、tests/importers.test.js；从 config.js 抽出磁盘导入函数，保留旧入口直到 task 6。

**Interfaces:** `readBundle({root,mode}) → Promise<ImportBundle>`，mode 是 empty/bundle；`readLegacy({root,legacyPath,masterKey}) → Promise<ImportBundle>`；`inventoryResources({root,config,template,manifest}) → Promise<{resources,assets,legacyMap,report}>`。

- [ ] **1. 写失败测试**：临时 SQLite 源有草稿、两个版本、local/S3 记录、源模型/派生模型、管理员/会话，导入必须保留 ID/hash，不含会话；迁移前后原文件 SHA256 相等。

```js
test('legacy import preserves account and IDs without writing the source', async t => {
  const f = contentFixture(t);
  const bundle = await readLegacy({root:f.root, legacyPath:f.legacyPath});
  assert.equal(bundle.admin.username, 'legacy_owner');
  assert.equal(bundle.versions.length, 2);
  assert.equal(bundle.resources.find(r => r.id === 'derived-logo').originalId, 'source-logo');
  assert.equal(Object.hasOwn(bundle, 'sessions'), false);
  const after = require('node:crypto').createHash('sha256')
    .update(require('node:fs').readFileSync(f.legacyPath)).digest('hex');
  assert.equal(after, f.sourceHash);
});
```

- [ ] **2. 红灯**：`rtk proxy node scripts/test-postgres.js tests/importers.test.js`。
- [ ] **3. 实现 importers**。SQLite 仅 `new DatabaseSync(legacyPath,{readOnly:true})`，不执行 PRAGMA journal_mode、不补表、不写源；操作前要求旧实例停止写入，读事务保持一致快照，finally 关闭。解析 settings 显式 key 白名单：schema/draft/revision/published/resources/storages/defaultStorage；读取 versions/admins/audit；旧 previews/attempts/sessions 丢弃。非法格式或多管理员报迁移冲突，不随机选择。

```js
const {DatabaseSync} = require('node:sqlite');
const db = new DatabaseSync(legacyPath, {readOnly:true});
try {
  db.exec('BEGIN');
  const rows = db.prepare('SELECT key,value FROM settings').all();
  const settings = Object.fromEntries(rows.map(r => [r.key, JSON.parse(r.value)]));
  // 后续 reads 在该快照内完成，返回前进行 schema/引用校验。
  db.exec('COMMIT');
} catch (error) {
  try { db.exec('ROLLBACK'); } catch {}
  throw error;
} finally { db.close(); }
```

- [ ] **4. 登记所有已使用媒体**。先从 UIL/CMS/SONGS/HTML favicon/manifest/引擎显式清单提取，再扫描资源目录作未引用条目的 inventory；JS/CSS/WASM/着色器是程序资源，不当上传素材。engine-assets.json 记录每个动态引用的 owner、slot、原始 URL、type、required、依赖组。不可仅凭任意字符串扩展名替换，不能将 labUrl/邮箱链接当媒体。file checksum 使用流计算；realpath 校验白名单并拒绝越界 symlink；bundled 路径仅储存相对路径。大小、缺失状态、禁用占位单独记录；不自动下载原站。
- [ ] **5. 保留旧模板和秘密边界**。导入时完整补齐各历史 snapshot 的原 baseline，报告历史未独立保存模板的限制；S3 credentials 维持原密文结构，数据库 text 中 JSON 序列化一次。密钥缺失/无法解密时 available=false，报告只列 storage ID，后续可重新配置。empty 模式移除作品、音乐、作者文本/链接/contact/metadata 中个人内容，但保留合法模板结构；缺授权运行包 readiness=false，前台显示说明页。
- [ ] **6. 绿灯和只读报告**：覆盖必需缺失阻止模板可用、可选缺失警告、字体 JSON/PNG 依赖、%20 文件名不双解码、GLB派生关系、旧版序列、新部署无资产、source 路径只取服务端 options。`scripts/import-site.js --check` 只输出 counts/warnings/digest，不写数据库或打印完整 bundle。
- [ ] **7. 提交**：`rtk git commit -m "feat: import legacy site and catalog resources without source writes"`。

### Task 4: 异步认证、草稿、发布与预览

**Files:** 修改 security.js、config.js、publication.js、app.js、scripts/admin-account.js；创建 http.js；修改 tests/admin.test.js、config.test.js、publication.test.js、tests/helpers/http.js。

**Interfaces:** 保留 createAccount/mountAuth/saveDraft/publish/restore 名称，全部数据库操作为 async；`buildUIL(snapshot)` 为纯函数；`validatePublication(store,options,snapshot)` 只用数据库模板与受控媒体读取。

- [ ] **1. 将现有测试切到 postgresFixture 并写回归**：用户名/密码验证、散列 session、Origin/CSRF、闲置/绝对过期、改密清会话、登录限流；版本冲突、预览过期、恢复只改草稿。原 fixture 不得依靠 createApp 自动安装。

```js
test('JSONB object key order does not invalidate site config', () => {
  const config = structuredClone(schemaFixture);
  config.site = Object.fromEntries(Object.entries(config.site).reverse());
  assert.doesNotThrow(() => validateConfig(config, schemaFixture));
});
// schemaFixture 使用 tests/helpers/content.js 的 bundle.schema。
```

- [ ] **2. 红灯**：`rtk proxy node scripts/test-postgres.js tests/admin.test.js tests/config.test.js tests/publication.test.js`。
- [ ] **3. 实现异步安全边界**。所有 Express 4 async handler 用统一 route wrapper；公共 session 查询遇数据库故障交给维护错误，不默认为匿名可安装。hash 在事务前计算，replaceAdmin 与清 session/audit 同事务。hash/verify 算法不变。admin:reset 只处理已安装站点，不重新初始化。

```js
const route = fn => (req,res,next) => Promise.resolve().then(() => fn(req,res,next)).catch(next);
module.exports = {route};
```

配置校验用 key 集合而非 Object.keys().join；scene/field 按 id/key 找模板、同时拒绝重复和缺失，排序独立校验。发布先读快照验证文件，事务内锁站点并再次核对 revision；同事务插版本、引用、更新指针和 audit。存储/资源状态变更也在锁内复核；网络与字体大文件读取不持锁。预览有效期固定 30 分钟，绑定创建管理员，仅保留最近 5 个，过期同时清引用；URL 本身不提供访问权限。
- [ ] **4. 发布测试**：两个并发发布/保存不混版本；查询出错不报登录信息错误；无 await 的事务 regression；预览过期后匿名仍 401、授权返回404；模板字体覆盖从 DB 判断，不再从 root/fonts JSON 读取业务校验配置。
- [ ] **5. 绿灯并提交**：上述三组测试通过；`rtk git commit -m "refactor: migrate authentication and publication to async repositories"`。

### Task 5: 资源、S3 与模型转换改为逐条事务写入

**Files:** 修改 resources.js、models.js、storage.js、tests/storage.test.js、tests/integration.test.js；创建 tests/fixtures/model.js，修改 model.test.js 的 fixture 引用。

**Interfaces:** 原上传/外链/转换/回收 HTTP 路由不变；resourceRepository 接管持久化，storage adapter 的 put/get/test/close 契约不变。

- [ ] **1. 写红灯测试**：并发上传各得独立记录；一个失败不覆盖另一个；转换保留源；已发布/草稿/未过期preview/派生依赖引用禁止回收；两个转换进程不得误复用源状态。

```js
test('invalid external media never creates a resource', async t => {
  const f = await httpFixture(t, {store: (await postgresFixture(t)).store, installed:true});
  const headers = await f.login();
  const response = await f.request('/api/admin/resources/link', {
    method:'POST', headers:{...headers,'Content-Type':'application/json'},
    body:JSON.stringify({kind:'image',url:'javascript:alert(1)'})
  });
  assert.equal(response.status,400);
});
```

另用以下触发器在隔离测试库拒绝 INSERT，使用有效HTTPS外链或合法PNG上传断言HTTP500、资源记录数未增加，验证真实写入失败，不能只测 URL 校验当作持久化失败。trigger 仅测试 fixture 内创建，结束清理。

```sql
CREATE FUNCTION personal_site.reject_resource_test() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'test-write-failure'; END $$;
CREATE TRIGGER reject_resource_test BEFORE INSERT ON personal_site.resources
FOR EACH ROW EXECUTE FUNCTION personal_site.reject_resource_test();
```
- [ ] **2. 执行失败测试**：`rtk proxy node scripts/test-postgres.js tests/storage.test.js tests/integration.test.js`。
- [ ] **3. 改造写入流程**。校验→读取明确存储行→adapter.put（无长 DB事务）→短事务 insert resource+audit；DB失败不回成功。S3/local 写成功但 DB失败的对象视为 orphan，记录仅该 key 的安全错误供后续核查，不能删除原资源/整桶，也不将对象暴露为已登记资源。保持 multipart 限制/临时文件 finally 清理、范围请求、symlink与SSRF限制。

```js
await store.transaction(async tx => {
  await resourceRepository(tx).insert(resource);
  await auditRepository(tx).append('resource.upload', req.adminSession.username);
});
res.status(201).json({resource});
```

转换仍走限时限内存子进程；源/目标存储记录由仓储读取，结果记录 originalId。保持现有单实例转换并发上限，不以 PostgreSQL 引入为由宣称支持多机本地文件共享。回收在固定锁顺序下确认引用，bundled 只读，存储已有关联对象禁止更改位置。保留 credential masking 和不可用凭证重新配置路径。
- [ ] **4. 扩充绿灯**：真实本地流的200/206/416、未发布404、旧/models及geometry/admin别名可用、S3隔离HTTP服务SDK测试、原加密解密兼容；真实云CORS标明未验证。拆 GLBfixture 后避免 integration require model.test 导致重复计数。
- [ ] **5. 提交**：`rtk git commit -m "refactor: persist media storage and model resources in PostgreSQL"`。

### Task 6: 不依赖初始化的启动与安全安装 API

**Files:** 创建 installation.js、setup-auth.js、tests/installation.test.js；修改 app.js、database.js、options.js、server.js、.env.example、scripts/admin-account.js。

**Interfaces:** `installationStatus(store)`；`preflight(options,mode)` 返回服务器端 ImportBundle；`installSite(store,{bundle,account,expectedDigest,mode})`；`mountInstallation(app,{store,options})`。

HTTP契约：

| 路由 | 访问与结果 |
| --- | --- |
| GET /api/setup/status | 无秘密；state=unconfigured/unavailable/uninstalled/installed/incompatible；故障503，未配置可展示壳 |
| POST /api/setup/authorize | 校验 Origin+令牌，短时 HttpOnly cookie+csrfToken；不含连接信息 |
| GET /api/setup/database | 安装会话必需；仅脱敏 host/database 与权限检查结果 |
| POST /api/setup/preflight | 安装会话+CSRF；mode=empty/bundle/legacy；返回公开 report/digest |
| POST /api/setup/install | 安装会话+CSRF；mode/digest/新账号(仅无旧管理员时)；成功201，重复409，失败保持未安装 |

- [ ] **1. 先写并发和回滚测试**：两个独立 openPostgres pool 同时初始化，只有一次成功；故障注入点在 createAccount 后、installation记录前，回滚 schema/账号，重试可成功。

```js
test('one installation wins across independent database clients', async t => {
  const {store,databaseUrl} = await postgresFixture(t, {migrated:false});
  const other = openPostgres({databaseUrl});
  t.after(() => other.close());
  const {bundle} = contentFixture(t);
  const input = {bundle, mode:'bundle', expectedDigest:bundle.report.digest,
    account:{username:'owner',password:'test-only-password-2026'}};
  const results = await Promise.allSettled([installSite(store,input),installSite(other,input)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length,1);
  assert.equal((await store.query('SELECT count(*)::int AS n FROM personal_site.admins')).rows[0].n,1);
});
```

- [ ] **2. 红灯**：`rtk proxy node scripts/test-postgres.js tests/installation.test.js`。
- [ ] **3. 实现安装授权**。SETUP_TOKEN 最少32随机字节的hex，由部署者生成，不写入仓库；对输入先限长、hash后constant-time比较。短时安装会话用 HMAC 签名 cookie，密钥由 token 的独立用途派生，包含nonce/expiry（15分钟），CSRF另作签名用途派生；所有节点同token才能验证，禁URL/localStorage传令牌。每次安装写入仍查 DB 已完成状态；token轮换让旧安装会话失效。Origin/请求体64KiB限制/每IP每15分钟10次授权尝试，内存limiter有总条目上限并定期过期，部署文档要求边缘全局限流；这不冒充跨实例全局限流。安装成功清cookie；不自动创建admin会话。
- [ ] **4. 实现原子安装**。预检与hash在事务外；POST install 重做只读预检并核对 digest（不信任前端发回的bundle），旧数据发生变化要求重新预检。digest是稳定排序内容及资源校验和的摘要，不把密码/密文作为响应字段；不能因随机ID或生成时间导致未变内容每次digest不同。事务获取固定advisory锁，锁内读状态再 migrate → importBundle → 仅在无迁移admin时创建管理员 → installation insert → audit → commit。已存在任何未知schema不能覆盖；不以查询异常解释未安装。

```js
await store.transaction(async tx => {
  await tx.query('SELECT pg_advisory_xact_lock($1)', [734216901]);
  const state = await inspectInstallation(tx);
  if (state.state !== 'uninstalled') throw Object.assign(Error('站点不可重复初始化'), {status:409});
  await migrate(tx);
  await contentRepository(tx).importBundle(bundle);
  if (!bundle.admin) await authRepository(tx).replaceAdmin(prehashedAccount);
  await tx.query('INSERT INTO personal_site.installation(source,schema_version) VALUES($1,$2)', [mode,1]);
  await auditRepository(tx).append('installation.complete', bundle.admin?.username || prehashedAccount.username);
});
```

若 migrate 自带同一个事务锁可重入，但不要开始另一事务。mode 由已验证请求控制，只允许三个值；prehashedAccount由验证用户名和hashPassword产生。迁移带管理员时拒绝提交替代新账号。
- [ ] **5. 启动接线**。createApp 保持同步创建Express，但 openPostgres只建惰性pool，不触发建表/导入；无DATABASE_URL时安装壳可达，其他业务503。安装状态路由和admin静态壳置于DB认证中间件之前；业务路由有 installed guard；服务结束 await store.close。database.js 仅 re-export postgres入口；所有 node:sqlite 引用限制在 importer和迁移fixture。admin:init 提示使用网页，不再可创建绕过installation的账号。
- [ ] **6. 绿灯**：未配置/断网/权限不足/未知schema/未安装/已安装区分；缺令牌/错令牌/超时cookie/CSRF/Origin失败、重复提交、锁超时返回可重试错误、日志及响应不含密码；重新设置token不可覆盖已安装。`rtk proxy node scripts/test-postgres.js` 跑当前整套回归。
- [ ] **7. 提交**：`rtk git commit -m "feat: add protected atomic web installation"`。

### Task 7: 中文安装向导与管理员首登

**Files:** 创建 admin-ui/setup.js、setup.css、tests/setup-ui.test.js；修改 admin-ui/index.html、admin.js。

**Interfaces:** setup.js 对浏览器暴露 `window.SiteSetup.mount({root,onInstalled})`；纯状态函数 `setupView(status,authorized)` 可 CommonJS 导出供测试。不持久化token/password，不使用innerHTML展示服务端文本。

- [ ] **1. 写状态测试**。

```js
test('database outage never renders account creation', () => {
  assert.equal(setupView('unavailable',true),'maintenance');
  assert.equal(setupView('installed',false),'login');
  assert.equal(setupView('uninstalled',false),'authorize');
  assert.equal(setupView('uninstalled',true),'database');
});
```

- [ ] **2. 红灯**：`rtk proxy node --test tests/setup-ui.test.js`。
- [ ] **3. 实现分步表单**：授权 → 数据库检测 → 内容来源/预检报告 → 管理员 → 完成。连接检测页只展示脱敏目标，不输入任意host；旧站已有账号展示“保留原管理员”，不要求替换密码。报告的missingRequired/warnings/credentialsUnavailable逐项展示，空白站点无运行包明确说明；没有成功preflight不能提交。

```js
function setupView(status, authorized) {
  if (status === 'installed') return 'login';
  if (status !== 'uninstalled') return 'maintenance';
  return authorized ? 'database' : 'authorize';
}
```

post使用same-origin credentials、独立setupCSRF；401回授权，409重新查状态，不自动重放安装；503保留非敏感选择并显示重试，清密码/token。提交禁双击并有aria-live状态、label、焦点移动、显示/隐藏密码；完成后onInstalled进入现有login。去掉现有未初始化页“npm run admin:init”指引。
- [ ] **4. 绿灯和浏览器验收**：键盘完成安装；密码不一致阻止提交；刷新已安装只能登录；数据库掉线不出现创建账号。运行 `rtk proxy node --test tests/setup-ui.test.js tests/admin-ui.test.js`；浏览器走真实隔离API，不用截屏替代状态断言。测试账户和截图只保存在隔离环境，不包含token/密码。
- [ ] **5. 提交**：`rtk git commit -m "feat: add Chinese first-run installation wizard"`。

### Task 8: 前台完全由数据库快照与资源映射驱动

**Files:** 修改 frontend.js、config.js、publication.js、resource-catalog.js、engine-assets.json、tests/frontend.test.js、tests/integration.test.js；创建 tests/database-content.test.js。

**Interfaces:** `resolveVersion(store,{version,preview,admin}) → Promise<{id,snapshot}>`；`resolvePublishedResource(store,{version,id,admin}) → Promise<Resource>`；纯 `buildUIL(snapshot)`；兼容 public资源路径 `/api/site/:version/resources/:id/:fileName`，保留老 /media、/models路径作为数据库解析别名。

- [ ] **1. 写移除旧配置、重启测试**。fixture保留JS/WASM/媒体，仅将原UIL/CMS配置移出读取位置，关闭旧server/store，新建pool/app请求公开JSON。测试名明确不能只验证内存缓存。

```js
test('after restart the published UIL needs no source JSON', async t => {
  const {store} = await postgresFixture(t);
  const f = await httpFixture(t,{store,installed:true});
  const headers = await f.login();
  const before = await (await f.request('/api/admin/config',{headers})).json();
  const root = f.root; // helper 返回 content fixture 的 root，且只指向临时目录。
  require('node:fs').renameSync(require('node:path').join(root,'assets/data'), require('node:path').join(root,'retired-data'));
  require('node:fs').renameSync(require('node:path').join(root,'cms'), require('node:path').join(root,'retired-cms'));
  await f.restart();
  const response = await f.request(`/api/site/${before.published}/uil.json`);
  assert.equal(response.status,200);
  assert.ok(Object.keys(await response.json()).length > 0);
});
```

- [ ] **2. 红灯**：`rtk proxy node scripts/test-postgres.js tests/database-content.test.js tests/frontend.test.js`。
- [ ] **3. 移除普通请求的业务磁盘读取**。buildUIL深拷贝snapshot.template.baseUIL；metadata/contact从相同snapshot返回；字体覆盖从template读取；app.js/shader代码仍可读取受版本控制运行包。config公开响应不包含template中可执行程序段或私密字段；明确选择API输出。首页未安装/无运行包用简洁说明页，不能给残缺3D运行包然后声称成功。
- [ ] **4. 实现精确资源兼容映射**。按版本读取 legacyMap，将UIL、作品、歌曲、HTMLfavicon/manifest及引擎显式槽位改为同版本数据库资源URL，保留扩展名满足解码器/字体路径推导。引擎引用的动态路径必须由engine-assets.json列出并测试：Texture/视频 loader、字体 .json/.png、geometry/Worker请求；生成引擎脚本时在真实loader入口改写，不只改window.fetch。Worker入口接收同版映射或已经转换的绝对URL；不全局改写第三方非媒体导航。主线程桥接保留fetch Request对象/headers与XHR签名；程序包/wasm不会被当成素材改写。

```js
function versionResourceURL(version, resource, fileName) {
  return `/api/site/${encodeURIComponent(version)}/resources/${encodeURIComponent(resource.id)}/${encodeURIComponent(fileName)}`;
}
```

后端以版本快照引用授权，忽略fileName作为磁盘寻址依据，避免路径穿越；资源元数据含本地key但只在服务器使用。资源URL变更必须通过保存草稿→新snapshot发布，老snapshot保持原resource ID；原文件字节变更不承诺恢复。bundled媒体旧路由改为查已发布映射再服务，未登记的媒体不由静态目录直出；JS/CSS/WASM有单独静态白名单。
- [ ] **5. 绿灯与视觉回归**：UIL/contact/metadata/所有媒体类别、%20路径、querystring、不触碰外站导航、image/video/Worker实际请求、草稿404、过期preview、不同版本固定映射。隔离前台使用当前授权素材的只读副本/挂载，确认原Logo和罐内黑洞不变；网络请求清单与engine-assets逐一核对，未覆盖的路径必须补测试，不能仅以首页200验收。
- [ ] **6. 提交**：`rtk git commit -m "feat: render site content and resource mappings from PostgreSQL"`。

### Task 9: 部署、显式升级、备份恢复与最终回归

**Files:** 修改 compose.yaml、Dockerfile、.env.example、package.json、docs/ADMIN.md；创建 docker/postgres-init.sh、scripts/db-migrate.js、docs/POSTGRESQL-MIGRATION.md、docs/verification/postgresql-installation.md；不修改真实.env。

**Interfaces:** `npm run db:migrate`仅升级已安装实例，维护窗口运行；`npm run import:check`只读报告；`npm run test:postgres`用隔离测试数据库；安装令牌使用本地生成值，日志不打印。

- [ ] **1. 增加部署验收测试/清单**：缺DATABASE_URL后台壳可达；Docker首次启动不自动创建管理员；初始化后重建site容器不丢账号/上传/版本；备份恢复到独立新库后原账号可登录。容器测试不连生产端口/库。
- [ ] **2. 更新Compose配置**：独立PostgreSQL服务+pg-data卷，数据库不映射公网端口；pg_isready健康检查，site依赖健康但运行时断连仍返回维护。生产应用不使用POSTGRES_USER超级用户；数据库连接通过环境传入，外部数据库部署不强制内置服务。Docker继续Node24非root；复制新SQL/JSON/installer资源；旧cms仅安装内容包使用。保留site-data独立媒体卷和assets只读挂载。PostgreSQL 18镜像的数据库卷挂载位置在实施时按官方镜像说明核对，不能沿用旧主版本的路径而未经验证。
- [ ] **3. 明确 schema 预置约定**：避免empty schema与未知schema混淆，统一部署权限采用“应用角色拥有专用数据库的CREATE权限，安装时创建personal_site”，不预建应用schema、不使用超级用户连接。docker/postgres-init.sh只创建独立app角色并授权专用数据库CONNECT/CREATE；以psql变量引用或format安全转义密码，不用shell拼接SQL。应用schema由001创建。外部数据库亦需同等权限或按文档提供经校验的完整迁移schema，不将任意已有空schema自动当作可覆盖。
- [ ] **4. 实现显式升级与文档命令**。升级先备份/维护，获取与安装同一锁，校验checksum，再逐版本迁移；不调用首次创建管理员。备份包括PG dump、本地uploads、授权bundled资源、独立主密钥、S3对象策略。恢复在隔离库使用pg_restore并记录行数与登录；不能用“恢复旧SQLite”覆盖PG上线后的新写入。测试命令与实际输出写 verification文档，未完成项明确“未验证”。

```json
{
  "db:migrate": "node scripts/db-migrate.js",
  "import:check": "node scripts/import-site.js --check",
  "test:postgres": "node scripts/test-postgres.js"
}
```

- [ ] **5. 全量验证**：`rtk proxy node scripts/test-postgres.js`、`rtk proxy npm audit`、`rtk proxy git diff --check`，逐一node --check改动JS；只读搜索确认运行期无node:sqlite/store.db.prepare/store.get列表。Docker config校验不可输出真实凭证到对话日志；用测试env执行。浏览器完成“新安装→登录→上传→保存→预览→发布→退出→匿名页面”，再验证导入旧站；真实S3/CDN无凭证则明确未验证，不据此扩大云权限。
- [ ] **6. 停机迁移与切换门槛**：此前只使用隔离端口和测试库。将结果交用户审阅，确认数据库部署目标和维护时间后再停止真实旧服务，备份并迁移；绝不根据测试成功擅自覆盖当前data。执行有明确目标的旧进程停止，不kill所有Node，不删data，不自动push。
- [ ] **7. 提交**：`rtk git commit -m "docs: ship PostgreSQL deployment migration and verification guide"`。最终交付逐项列出实际通过、未验证和运行入口，不能把计划勾选替代测试证据。

## 自审与交接记录

- Spec 1–3：任务1/2/4，覆盖PG唯一权威、结构化行、版本原子性、异步接口与完整快照。
- Spec 4：任务3/8，覆盖媒体全量登记、伴随依赖、Worker、空白站点、程序包与媒体边界。
- Spec 5–6：任务6/7，覆盖安装授权、数据库故障状态、事务并发、无默认密码、安装后关闭、升级与恢复。
- Spec 7：任务3/9，覆盖只读SQLite、原账号/ID/密文保留、会话失效、数据切换和备份。
- Spec 8–9：全部任务先红后绿；任务9最终实际PG/Compose/浏览器验证，不以模拟库或静态代码通过冒充集成成功。
- 当前环境待具备：Docker daemon或另一个明确的隔离PG；并不阻止代码规划，但真实数据库测试必须满足后才能报告通过。
- 旧脏文件排除已记录；没有为此计划启动新服务、更改云存储或修改当前网站运行逻辑。

## 文档依据

本次使用ctx7查询 node-postgres 官方资料，确认事务必须在同一Pool client执行BEGIN/COMMIT/ROLLBACK，并在finally释放；不能在事务中混用pool.query。

- https://node-postgres.com/features/transactions
- https://node-postgres.com/apis/pool
- 已批准设计：`../specs/2026-10-12-postgresql-installation-design.md`

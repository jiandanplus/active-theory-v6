# Engine Contracts and Traceable Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让新发布和认证预览绑定经严格验证的运行包与完整生成文件，历史交付不再读取当前目录程序，同时保留现有视觉、资源撤回和管理认证。

**Architecture:** 采用模块化单体：受控引擎适配器负责纯转换，私有 CAS 保存不可变字节，PostgreSQL 保存包清单、选择和交付绑定。构建在写锁之外完成，最终短事务复检并原子发布；请求只验证和交付完成品。

**Tech Stack:** Node.js >=24、PostgreSQL 18、CommonJS、Express、node-postgres、node:test、原生管理 UI；继续使用现有本地/S3 存储，不新增运行时依赖。

## Global Constraints

- 批准规格：[阶段 B 详细设计](../specs/2026-10-14-engine-contract-and-traceable-publishing-design.md)，用户于 2026-10-14 确认。本计划基线 `267efd2`，分支 `feat/authenticated-resource-admin`。
- 保留 Node.js >=24、PostgreSQL 18、CommonJS、现有原生管理界面及单站点/单管理员/单应用实例模式。
- 保持 Logo、黑洞形状、粒子效果及场景参数语义。移动或规范化现有补丁不等于重新设计视觉；不覆盖用户的实验脚本和未提交素材。
- 保留草稿 revision、认证预览、发布历史、资源引用保护、审计、CSRF/Origin、HTTPS 与凭据加密。
- PostgreSQL 是内容和授权的权威；业务媒体仍在本地/S3/外链，不自动下载外部资源。
- 数据库 schema 3、内容 snapshot format 2、manifestVersion 1 分开处理；不把运行身份塞进 composeSnapshot 的白名单。
- 001 SHA-256 固定为 `bba88a72df8e7166646fdc56e6485c36078bf7e7fe4077125fdd7ebc682d2a15`；002 固定为 `98fca286a9790bff1b10a74719c820f15e3d66b5054c459f87057b34151c7533`。
- 登记限额：单个程序输入不超过 32 MiB，包总字节不超过 128 MiB，最多 512 个清单项。
- 单次生成交付总字节不超过 256 MiB、最多 4096 项；越界失败，不生成部分可发布结果。
- 新预览维持现有 30 分钟和每人最多五个预览的规则；有效期从最终提交时起算。
- 第一版明确不开启长期 immutable 缓存；程序缓存须回源验证，数据库不可用时失败关闭。
- 真实 `.env`、业务库、`data/site.db`、uploads、S3 对象和当前 3000 服务不作为实现测试对象。正式升级、服务切换、推送与部署均需独立授权。
- 详细实施继续使用独立工作区、明确的隔离 PostgreSQL 和临时资源目录；不把授权尚未明确的运行包文件提交到 Git。
- 所有 shell 命令前缀 `rtk`；编辑使用 apply_patch。不得把用户现有 `.gitignore`、模型/粒子脚本或未跟踪文件带入提交。
- 不增加队列、多实例协调、云产物库、自动垃圾回收、旧 schema 运行兼容层、完整静态降级站或管理端全量拆分。

---

## 执行与文件地图

这是一个有共同发布不变量的子项目，B1/B2/B3 是依赖批次，不是三个可独立部署的半成品。未完成 Task 14 的整体验收前，不合并或切换现有网站。

顺序：`1 → 2 → 3`（B1），`4 → 5 → 6 → 7 → 8 → 9 → 10 → 11`（B2），`12 → 13 → 14`（B3）。Task 4 的旧 schema 种子核对和 Task 5 的独立 CAS 单元可在 Task 1 后并行，集成仍按上述顺序；其他共享文件串行编辑。每任务完成红绿测试、规格审查、质量审查和显式文件提交后再前进。

| 新建/修改路径 | 职责、唯一所有者任务 |
| --- | --- |
| `admin-server/delivery/contracts.js` | 确定性 JSON、摘要、ID/路径/清单数据校验（1） |
| `admin-server/engine/patches.js`、`legacy-adapter.js` | 精确补丁基元与原 app/shader/UIL 转换（2） |
| `admin-server/engine/profiles/legacy-six-scenes-v1.js`、`registry.js`、`program-paths.js` | 生产契约、有限依赖图和主窗口/worker 寻址（3） |
| `admin-server/engine/render.js` | 从原 frontend 提取 HTML、bridge、identity、UIL 的纯生成（2、3、7） |
| `admin-server/migrations/003-engine-delivery.sql`、`migration-registry.js` | schema 3、逐版本签名与旧记录 legacy 回填（4） |
| `admin-server/delivery/cas.js`、`registration.js` | 私有文件读写及显式登记（5、6） |
| `admin-server/repositories/runtime.js`、`deliveries.js` | 包选择、清单和绑定 SQL（6、8） |
| `admin-server/delivery/projection.js`、`builder.js` | 冻结引用、确定性构建和全部产物（7） |
| `admin-server/delivery/service.js`、`candidates.js` | 受信依赖组装、候选捕获/复检（9） |
| `admin-server/delivery/publish.js`、`preview.js`、`legacy.js` | 正常发布、预览和旧内容首次绑定（9、10、11） |
| `admin-server/delivery/reader.js`、`response.js`、`admin-routes.js` | 只读交付、缓存和小型管理 API（12、13） |
| `admin-server/repositories/content.js`、`resources.js`、`auth.js` | 最小新增保留 ID/固定引用/会话锁能力（4、8、9、10） |
| `admin-server/config.js`、`publication.js`、`snapshots.js` | 保留内容校验，显式传入 profile 引用规则，发布委托（2、7、9、10） |
| `admin-server/frontend.js`、`frontend-resources.js`、`resources.js`、`models.js`、`app.js` | 切断当前文件程序旁路，保留所有资源授权入口（12、13） |
| `scripts/runtime-bundle.js`、`scripts/delivery-audit.js` | 明确的服务器端登记与只读占用诊断（6、14） |
| `admin-ui/admin.js` | 运行包状态/选择、版本兼容动作、构建期间防重复（13） |
| `tests/helpers/legacy-content-repository.js`、`v2.js`、`runtime.js`、`delivery.js` | 固定旧 schema 种子与纯测试 profile/交付夹具（4、3、9） |
| `tests/delivery-*.test.js`、`tests/runtime-*.test.js` | 各任务独立测试；已有测试迁移而非删除断言 |
| `docs/ENGINE-RUNTIME.md`、`docs/verification/engine-delivery.md` | 操作说明与真实验收证据（14） |

### 执行前环境检查（Task 1 的准备步骤）

- [ ] 读取 using-git-worktrees 技能，先检查当前任务附着工作区，使用原生工作区工具创建/复用独立检出；基于包含本计划的当前提交。不得复制 `.env`、data、uploads 或全部未跟踪文件。
- [ ] 记录基线和用户未提交文件清单，只读核对授权程序来源；真实包缺失不妨碍纯测试，但完整引擎验收必须标记未验证。
- [ ] 读取 TDD 技能；按以下命令核对运行环境，不停止占用端口的陌生服务：

```sh
rtk proxy git status --short
rtk proxy git rev-parse HEAD
rtk proxy node --version
rtk proxy npm ls --depth=0
rtk proxy docker ps --format '{{.Names}} {{.Ports}}'
rtk proxy lsof -nP -iTCP:55432 -sTCP:LISTEN
```

- [ ] 55432 空闲时，用 `rtk proxy docker compose -p site-pg-test -f compose.test.yaml up -d --wait` 创建专用测试库；已有实例仅在核对 labels 与目标后复用。不打印环境中的连接串，不读取真实 `.env`。显式 TEST_DATABASE_URL 需核对为专用目标；不把 DATABASE_URL 传入测试。
- [ ] 执行 `rtk proxy node scripts/test-postgres.js` 记录本次基线，不能借用 A 的 242 项通过结果。每个 PG fixture 继续创建并清理精确的 `site_test_<uuid>` 库。

## 共享接口契约

下列是本计划定义的新接口，不代表基线已有实现。Task 1 把类型写成 JSDoc；每个任务消费相同字段。`db` 沿用 `{query(text, values)}`，`store` 另有 `transaction(fn)`。

```js
/** @typedef {{type:'version'|'preview', id:string}} Target */
/** @typedef {{resourceId:string, slot:string}} Reference */
/** @typedef {{key:string, role:string, mime:string, size:number, sha256:string}} FileEntry */
/** @typedef {{id:string, username:string}} Actor */
/** @typedef {{digest:string|null, generation:number}} Selection */
/** @typedef {{id:string, templateId:string, policy:{inactiveLayouts:string[]},
 * patches:Array, programs:Array}} Profile */
/** @typedef {{patches:Array, files:number, totalBytes:number}} Report */
/** @typedef {{manifestVersion:1, profileId:string, templateId:string, entryKey:string,
 * files:Array<FileEntry & {path:string}>,
 * dependencies:Array<{from:string,to:string,via:string}>}} RuntimeManifest */
/** @typedef {{manifestVersion:1, kind:'pinned'|'legacy-render', target:Target,
 * runtimeDigest:string, profileId:string, templateId:string, selectionGeneration:number, sourceSnapshotDigest:string,
 * projectionDigest:string, referencesDigest:string, adapterDigest:string,
 * origin:string, files:FileEntry[], routes:Object<string,string>,
 * endpoints:Object<string,string>, runtime:Object<string,string>,
 * documents:Object<string,string>, references:Reference[], patchReport:Array}} ArtifactManifest */
```

- `RuntimeManifest` 摘要不包括登记时间/绝对路径。文件 `path` 只用于登记读取；CAS 和公开 URL 只用受限逻辑键/摘要。
- `ArtifactManifest` 摘要不包含自身 digest、生成时间、临时目录或随机值；最终目标 ID、origin 和选择 generation 是输入。清单里的文件摘要不引用清单摘要，避免哈希循环。
- profileId 第一版为 `legacy-six-scenes-v1`。它包含固定的 `inactiveLayouts`、补丁规则和可达程序依赖图；其源码与 builder/shared 来源一同进入 adapterDigest。
- 固定端点名：`config`、`identity.js`、`bridge.js`、`app.js`、`uil.json`、`projects.json`、`compiled.vs`、`metadata.json`、`contact.json`、`unsupported.html`。辅助程序 URL 为 `/api/site/:target/runtime/:key`；key 不含 `/`，不接受磁盘路径。
- 文件角色限于 `html`、`program`、`stylesheet`、`wasm`、`shader`、`data`、`resource-document`。runtime 映射只允许 program/stylesheet/wasm；resource-document 只能通过资源 ID 授权端点访问。
- `createDeliveryService({store, options, registry})` 是受信构造器，生产默认使用源码 registry。`createApp(options, {deliveryService}={})` 的第二参数只允许测试进程注入服务；HTTP body、环境变量、运行包清单都不能替换 registry。
- `Actor` 只来自服务器已验证的 req.adminSession；不接受请求体用户名/sessionId，也不允许生产发布省略 Actor。

## Task 1：确定性身份与路径/数据契约

**Files:** Create `admin-server/delivery/contracts.js`, `tests/delivery-contracts.test.js`。

**Interfaces:** Produces `canonicalJSON(value):string`, `sha256(bytes):string`, `digestJSON(value):string`, `logicalKey(value):string`, `sourcePath(value):string`, `normalizeReferences(refs):Reference[]`, `assertRuntimeManifest(value)`, `assertArtifactManifest(value)`；断言失败使用 `fail(422,'运行包或交付清单无效')`，不回显原路径。

- [ ] **Step 1：写确定性及拒绝输入测试。**

```js
const {test}=require('node:test');
const assert=require('node:assert/strict');
const c=require('../admin-server/delivery/contracts');
test('identity sorts object keys but preserves array order',()=>{
  assert.equal(c.digestJSON({b:2,a:[1,2]}),c.digestJSON({a:[1,2],b:2}));
  assert.notEqual(c.digestJSON([1,2]),c.digestJSON([2,1]));
  for(const value of [undefined,NaN,Infinity,new Date(),{a:undefined}])
    assert.throws(()=>c.canonicalJSON(value),{status:422});
});
test('keys cannot become filesystem or encoded paths',()=>{
  for(const key of ['../x','/x','a/b','%2e%2e','a\\b',''])
    assert.throws(()=>c.logicalKey(key),{status:422});
  for(const file of ['../a.js','a/../b.js','/a.js','a//b.js','a/%2e%2e/b','a\\b'])
    assert.throws(()=>c.sourcePath(file),{status:422});
  assert.equal(c.sourcePath('assets/js/app.js'),'assets/js/app.js');
});
```

- [ ] **Step 2：红灯。** `rtk proxy node --test tests/delivery-contracts.test.js`；预期缺少新模块而失败。
- [ ] **Step 3：实现身份基元及清单白名单。**

```js
const {createHash}=require('node:crypto');
const {fail}=require('../security');
const bad=()=>fail(422,'运行包或交付清单无效');
function canonicalJSON(value) {
  const ancestors=new Set();
  function visit(v) {
    if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
    if(typeof v==='number'&&Number.isFinite(v))return JSON.stringify(v);
    if(!v||typeof v!=='object'||ancestors.has(v)||Object.getOwnPropertySymbols(v).length)throw bad();
    const array=Array.isArray(v);
    if(!array&&Object.getPrototypeOf(v)!==Object.prototype&&Object.getPrototypeOf(v)!==null)throw bad();
    ancestors.add(v);
    let result;
    if(array){
      if(Object.keys(v).length!==v.length)throw bad();
      result='['+Array.from(v,visit).join(',')+']';
    } else result='{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+visit(v[k])).join(',')+'}';
    ancestors.delete(v);return result;
  }
  return visit(value);
}
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const digestJSON=value=>sha256(canonicalJSON(value));
function logicalKey(value){
  if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)||value.includes('..'))throw bad();
  return value;
}
function sourcePath(value){
  if(typeof value!=='string'||value.length>1024||/[\\%?#\x00-\x1f]/.test(value)||
    value.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.'))||/^[A-Za-z]:/.test(value))throw bad();
  return value;
}
function normalizeReferences(refs){
  const found=new Map();
  for(const ref of refs){
    if(!ref||typeof ref.resourceId!=='string'||!ref.resourceId||typeof ref.slot!=='string'||!ref.slot||
      ref.resourceId.includes('\0')||ref.slot.includes('\0'))throw bad();
    found.set(ref.resourceId+'\0'+ref.slot,{resourceId:ref.resourceId,slot:ref.slot});
  }
  return [...found].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,v])=>v);
}
```

清单断言逐层只允许共享契约字段；所有 digest 匹配 `/^[a-f0-9]{64}$/`；size/generation 为非负安全整数；version target 为正安全整数的标准十进制字符串，preview target 匹配 `preview-` UUID。role→MIME 是源码常量表（HTML text/html；JS text/javascript；CSS text/css；WASM application/wasm；shader text/plain；data application/json；资源文档 application/manifest+json）。检查重复 key/path、dangling dependency、入口角色、配额及 routes/endpoints/runtime/documents 指向存在且角色正确的文件；referencesDigest 必须等于规范化引用摘要。JSON canonical validator 同时拒绝循环、稀疏数组、非 JSON 值和额外符号键，不调用对象自定义 toJSON。

- [ ] **Step 4：加表驱动清单负例后绿灯。** 对每个字段分别缺失/改类型；role 伪装、重复 key、文件数513、输入32MiB+1、总量128MiB+1、输出4097项、输出256MiB+1 均拒绝。将合法最小清单直接写在测试中，不从生产磁盘学习期望值。
- [ ] **Step 5：审查并提交。** `rtk proxy node --test tests/delivery-contracts.test.js` 全部通过，`rtk proxy git diff --check` 无输出；显式 add 上述两个文件，提交 `feat: define deterministic runtime delivery contracts`。

## Task 2：提取旧引擎转换并建立精确补丁报告

**Files:** Create `admin-server/engine/patches.js`, `legacy-adapter.js`, `render.js`, `tests/runtime-patches.test.js`；Modify `admin-server/frontend.js`, `config.js`, `tests/frontend.test.js`, `tests/metadata.test.js`。

**Interfaces:** `patches.exactReplace(source,{id,find,replace,count}):{source,report}`；`patches.classBody(source,name,transform)` 要求类唯一；`legacy-adapter.applyAppPatch(id,source,config)` 为单条补丁单元入口，`patchAppSource(source,config,contract)` / `patchShaders(source,config,contract)` 返回 `{source,report}`。`render` 导出 `bridgeSource(version,config,snapshot,origin,references,programs)`、`identityBridgeSource`、`versionedUIL(snapshot,id)`、`renderHTML({html,snapshot,target,origin,programs})`。`buildUIL(snapshot)` 原行为迁到 adapter，由 config 暂作兼容导出。

- [ ] **Step 1：写精确补丁红灯测试。**

```js
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {exactReplace,classBody}=require('../admin-server/engine/patches');
test('required anchor count is exact and replacement is literal',()=>{
  const rule={id:'example',find:'OLD',replace:'$& $1',count:1};
  assert.equal(exactReplace('a OLD b',rule).source,'a $& $1 b');
  for(const value of ['none','OLD OLD'])assert.throws(()=>exactReplace(value,rule),{status:422});
  assert.throws(()=>classBody('','ViewController',x=>x),{status:422});
});
```

- [ ] **Step 2：红灯。** `rtk proxy node --test tests/runtime-patches.test.js`；缺模块或缺函数时失败。
- [ ] **Step 3：加入基元，逐函数搬移而不改视觉公式。**

```js
function exactReplace(source,{id,find,replace,count}) {
  const matches=typeof find==='string'?source.split(find).length-1:
    [...source.matchAll(new RegExp(find.source,find.flags.includes('g')?find.flags:find.flags+'g'))].length;
  if(matches!==count)throw Object.assign(new Error('运行包补丁不兼容'),{status:422,patchId:id});
  const replacement=typeof replace==='function'?replace:()=>replace;
  const pattern=typeof find==='string'?find:new RegExp(find.source,find.flags.includes('g')?find.flags:find.flags+'g');
  const output=typeof pattern==='string'?source.replaceAll(pattern,replacement):source.replace(pattern,replacement);
  return {source:output,report:{id,status:'applied',matches,expected:count}};
}
```

`classBody` 使用现有 `Class((function NAME(` 分段，但先统计完整标记恰好一次，然后按下一个 Class 边界切片；不存在或重复均报422。不要对任意 JS 做通用解析器。

按基线符号搬移 `patchAppSource`、`patchShaders`、`identityBridgeSource`、`bridgeSource`、`versionedUIL` 和 config.buildUIL：每个替换变为 exactReplace，保留原 replacement 回调和原转义。不得调整粒子公式、大小、亮度或 Logo 资源。生产完整契约在 Task 3 接入，低层测试只调用某条补丁，不保留宽松生产入口。

原replacement字符串中的捕获引用必须转换成函数：例如ContactUI loaded规则使用 `(match,ref)=>'await _this.'+ref+'.loaded()'`，不能把原 `$1` 当字面量输出。新基元仅把用户文案replacement视为字面量，以保持美元符号安全。

固定补丁族包括：CMSData 空作品；Text3D/GLTextThread/GLText 空文字与 local buffer；setText；absolutePath/getPath；AssetLoader；GeomThread/InstanceMesh/ParticleDistributor；ViewController；NavUI/NavUIItem；ContactUI 的单字、loaded、文本/ref、邮箱、无 lab 外链/MobileSync；CleanRoom；歌曲与空歌曲；LogoParticleShader；UIL 黑洞代码；HTML app/unsupported 启动映射。

条件分支只有 `songs.length===0`、`!emailLink`、`!labUrl` 等经过 validateConfig 的值可产生 `{id,status:'not-applicable'}`。必需类/段缺失不能被归为 not-applicable；每条应用补丁的输出标记、旧 writer/路径残留也需要后置断言。

- [ ] **Step 4：迁移最小字符串测试并保留实际行为断言。** 旧 tests/frontend.test.js 中仅包含单类/一条歌曲的字符串改为调用对应低层补丁；真实包测试调用完整 adapter。将原 frontend 的导出改为明确的薄兼容引用，B3 删除请求侧构建使用：

```js
const {patchAppSource,patchShaders}=require('./engine/legacy-adapter');
const {bridgeSource,versionedUIL}=require('./engine/render');
```

所有调用处显式消费 `.source`；不能靠返回类型混用让失败测试绕过 contract。`bridgeSource` 的 allowed 集合从传入 references 得到，不再内调 collectReferences；补一个当前 inactiveLayouts 改变而 bridge映射不变的测试。

- [ ] **Step 5：绿灯和提交。** `rtk proxy node --test tests/runtime-patches.test.js tests/frontend.test.js tests/metadata.test.js`；必要实际包 skip 必须显示原因。提交 `refactor: isolate legacy engine transformations`，只 add 本任务文件。

## Task 3：生产 profile 与主窗口/Worker 程序闭包

**Files:** Create `admin-server/engine/profiles/legacy-six-scenes-v1.js`, `registry.js`, `program-paths.js`, `tests/runtime-profile.test.js`, `tests/runtime-paths.test.js`, `tests/helpers/runtime.js`；Modify Task 2 adapter/render。

**Interfaces:** `registry.get(profileId):Profile` 未知即422；`validateRuntime(manifest,files,profile):Report` 输入 Map(key,Buffer)，不执行文件；`runtimeURL(target,key):string`；`programMappings(manifest,target):Object<string,string>`；`rewritePrograms(files,mappings,profile):Map`；`testRuntime(t)` 仅在 tests/helpers/runtime.js 导出 `{root,manifest,registry}`。

- [ ] **Step 1：先测主窗口和 Worker 的独立映射。**

```js
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runtimeURL,programMappings}=require('../admin-server/engine/program-paths');
test('program URLs belong to the final target, never current assets',()=>{
  assert.equal(runtimeURL({type:'version',id:'43'},'basis-wasm'),'/api/site/43/runtime/basis-wasm');
  const manifest={files:[{key:'basis-wasm',path:'assets/js/lib/basis_transcoder.wasm',role:'wasm'}]};
  assert.equal(programMappings(manifest,{type:'version',id:'43'})['assets/js/lib/basis_transcoder.wasm'],
    '/api/site/43/runtime/basis-wasm');
});
```

- [ ] **Step 2：红灯。** `rtk proxy node --test tests/runtime-profile.test.js tests/runtime-paths.test.js`。
- [ ] **Step 3：固定生产 profile，不从待验证包自学预期。** profile 包括六场景模板约束、源码固定 inactiveLayouts、Task 2 补丁 ID/次数/后置断言以及以下程序角色闭包：

| key | 当前登记源相对路径 | role |
| --- | --- | --- |
| index | index.html | html |
| unsupported | unsupported.html | html |
| app | assets/js/app.1778129964370.js | program |
| modules | assets/js/modules.1778129964370.js | program |
| hydra-thread | assets/js/hydra/hydra-thread.js | program |
| basis-js | assets/js/lib/basis_transcoder.js | program |
| basis-wasm | assets/js/lib/basis_transcoder.wasm | wasm |
| draco-js | assets/js/lib/_draco/draco_wasm_wrapper.js | program |
| draco-wasm | assets/js/lib/_draco/draco_decoder.wasm | wasm |
| qrious | assets/js/lib/qrious.js | program |
| compiled-shaders | assets/shaders/compiled.vs | shader |

路径是已核对当前包的登记输入示例，不是扫描“最大文件名”的规则。manifest 明确提供实际入口；不同源码布局必须匹配受支持 profile，否则失败。qrious 可以始终保留在运行包，配置不用时不加载。媒体 `assets/shaders/reel.mp4` 不进入此表。当前无 CSS；若输入 HTML/程序实际引用 CSS 而 profile未声明，拒绝登记。

第一版能力边界明确要求 WebAssembly、Worker 和现有主引擎所需 WebGL。当前没有 ES5 worker、纯 JS Draco decoder；使用早于 modules/app 启动的受控 capability guard 跳到本版本 unsupported，不能进入缺依赖的 ES5/no-WASM 分支。保留原 unsupported 文案与页面，新增绑定路径而非返回静态原文件。

- [ ] **Step 4：实现有限程序映射与 worker 独立入口。**

```js
const {logicalKey}=require('../delivery/contracts');
function runtimeURL(target,key){return '/api/site/'+encodeURIComponent(target.id)+'/runtime/'+logicalKey(key);}
function programMappings(manifest,target){
  return Object.fromEntries(manifest.files.filter(f=>['program','stylesheet','wasm'].includes(f.role))
    .map(f=>[f.path,runtimeURL(target,f.key)]));
}
```

主窗口 bridge 增加明确程序表，与媒体表分开。adapter 对 `_THREAD_PATH_`、modules/cache 拼接、Basis/Draco/qrious 请求以及 `_UNSUPPORTED_PAGE_` 使用精确补丁；不要只覆盖 window.fetch。hydra-thread 生成前缀独立包装 importScripts、fetch/XHR：解析 `~`/根相对/受控源路径到固定映射，已版本化 URL仅允许相同 target；未知程序请求抛错。Thread.importCode 仅接受已从映射取得的受控 wrapper，不允许导入目录的代码在 Node 执行。

测试使用两个分离 VM：主窗口带 window，worker只带 self/importScripts/fetch，没有主窗口 __SITE_RESOURCE_URL__；断言所有程序请求 target一致，未知JS/WASM失败，媒体请求保持 resource路径。另测实际wrapper的相对WASM分支、query suffix、波浪线、origin端口、预览ID与unsupported路径。对每个必需类/段做缺失、重复和锚点计数偏差负例；class missing 必须失败。

- [ ] **Step 5：测试 profile 明确隔离。** `testRuntime(t)` 在临时目录写自有最小 HTML/app/worker/WASM（使用固定8字节空WASM模块），用只有测试模块可构造的 registry；它同样验证字段、依赖、哈希、配额和补丁。生产 registry 只 export legacy profile，不识别测试ID。生产入口没有 `strict:false`、skipMissing、fixture 或环境绕过。
- [ ] **Step 6：绿灯和提交。** 上述两个测试 + runtime-patches + frontend；登记根目录中多一个 app 不改变选择，缺必需文件不成功。提交 `feat: validate explicit runtime profiles and program closure`。

### 已知包的补丁计数基线（Tasks 2–3 使用）

以下来自 2026-10-14 只读字符串核对，不是运行时通过证明。主 app SHA-256 为 `1081e211f6301554d2311ca40205f5025a91102759eaa5f0a80dc5870e1ed689`，shader 为 `e2cf6406b30f86ab838b000cc3313e4de520e60484b1eb6402ba0016c09c8f98`。执行时来源不同则重新审查 profile，不自动学习新的期望次数。

| 规则 | 预期 |
| --- | --- |
| CMSData、Text3D、GLTextThread、GLText 两条、Hydra.absolutePath、Assets.getPath、ViewController、NavUI 两条、NavUIItem、CleanRoom、SONGS | 各1 |
| AssetLoader.fetch(path)、GeomThread 几何前缀 | 各2 |
| InstanceMesh、ParticleDistributor 几何前缀 | 各1 |
| GLUIText.setText | ES6 `class GLUIText` 内1次，不能当作 Class 工厂类 |
| ContactUI 单字函数、MobileSync 删除、contact 事件插入点 | 各1 |
| ContactUI loaded 等待 | 10 |
| ContactUI 六个外链 interact | 6；每个 ref 各1 |
| contact/lax/nyc/ams/email 的 innerText/setText/a11y | 每种各1 |
| 无 labUrl 时 subscribe/privacy/careers 的三种文本 | 每种各1 |
| 无 labUrl 时 sync | 只有 innerText 1次；不声明不存在的 setText/a11y补丁 |
| mailto | emailLink非空1次；空时先删除唯一interact，后续mailto替换明确不适用 |
| LogoParticleShader.glsl 段 | 唯一；time=6、2.16=2、0.54=1、emission=1、color=1 |
| index HTML/head/闭合head、app启动锚点、unsupported锚点 | 各1 |

只要求受控目标唯一。非目标 AbstractUserInput、luma.fs、GazeSelector.glsl 在此包有重复，不能用全局重复检查错误拒绝。当前 index 有一个 `<link href="undefined" rel="stylesheet">`，用精确计数1的补丁移除并检查不残留。unsupported 页有一个已知外部 gtag script 及配套内联初始化；严格移除这两个已知埋点块，保留页面视觉，其他未知外部程序一律拒绝。unsupported 的 `./assets/` 字体/背景按媒体表映射并检查已有引用；若历史引用未涵盖背景，legacy不得扩权，需新发布。

## Task 4：schema 3 与冻结的旧 schema 种子

**Files:** Create `admin-server/migrations/003-engine-delivery.sql`, `tests/helpers/legacy-content-repository.js`, `tests/helpers/v2.js`, `tests/delivery-schema.test.js`；Modify `migration-registry.js`, `tests/helpers/v1.js`, `tests/schema-upgrade.test.js`, `tests/installation.test.js`, `tests/postgres.test.js`, `repositories/content.js` 的 importBundle。

**Interfaces:** currentSchemaVersion=3；保留 migrations 每版本 `{version,file,sql,checksum,schemaSignature}`；历史种子只供测试，生产不探测旧schema后跳过新SQL。

- [ ] **Step 1：先冻结旧 seed 再写迁移失败测试。** 从 `267efd2:admin-server/repositories/content.js` 搬移完整历史仓储到 tests/helpers/legacy-content-repository.js，用 `createRequire` 对齐其原依赖基址，命名导出 `legacyContentRepository`。v1Fixture 只调用此固定版本的 importBundle/putPreview；不得用当前生产仓储。v2Fixture 调用 v1Fixture，然后只执行不可变002、插入其checksum并更新installation=2。

```js
// tests/helpers/v2.js
const {v1Fixture}=require('./v1');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {createHash}=require('node:crypto');
async function v2Fixture(t){
  const f=await v1Fixture(t);
  const sql=readFileSync(join(__dirname,'../../admin-server/migrations/002-site-identity.sql'),'utf8');
  await f.store.transaction(async tx=>{
    await tx.query(sql);
    await tx.query('INSERT INTO personal_site.schema_migrations(version,checksum) VALUES(2,$1)',[createHash('sha256').update(sql).digest('hex')]);
    await tx.query('UPDATE personal_site.installation SET schema_version=2');
  });
  return f;
}
module.exports={v2Fixture};
```

```js
const {test}=require('node:test');
const assert=require('node:assert/strict');
test('V2 adds explicit legacy bindings without changing revision or history',async t=>{
  const {store}=await require('./helpers/v2').v2Fixture(t);
  const settings=(await store.query('SELECT revision,published FROM personal_site.site_settings')).rows;
  const history=(await store.query('SELECT id,created,snapshot::text FROM personal_site.versions ORDER BY id')).rows;
  await require('../scripts/db-migrate').upgradeInstalled(store);
  assert.equal((await require('../admin-server/migrations').inspectInstallation(store)).schemaVersion,3);
  assert.deepEqual((await store.query('SELECT revision,published FROM personal_site.site_settings')).rows,settings);
  assert.deepEqual((await store.query('SELECT id,created,snapshot::text FROM personal_site.versions ORDER BY id')).rows,history);
  const bindings=(await store.query('SELECT mode,artifact_digest FROM personal_site.delivery_bindings')).rows;
  assert.equal(bindings.length,3);
  assert(bindings.every(b=>b.mode==='legacy'&&b.artifact_digest===null));
});
```

- [ ] **Step 2：红灯。** `rtk proxy node scripts/test-postgres.js tests/delivery-schema.test.js`；预期仍为schema2/缺delivery表，不是连接失败。
- [ ] **Step 3：新增003，不改001/002。**

```sql
CREATE TABLE personal_site.runtime_bundles (
  digest text PRIMARY KEY CHECK (digest ~ '^[a-f0-9]{64}$'),
  profile_id text NOT NULL,
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest)='object' AND (manifest->>'manifestVersion') IS NOT DISTINCT FROM '1'),
  registered_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE personal_site.runtime_selection (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  runtime_digest text REFERENCES personal_site.runtime_bundles(digest),
  generation integer NOT NULL DEFAULT 0 CHECK (generation>=0)
);
INSERT INTO personal_site.runtime_selection(id) VALUES(true);
CREATE TABLE personal_site.delivery_artifacts (
  digest text PRIMARY KEY CHECK (digest ~ '^[a-f0-9]{64}$'),
  runtime_digest text NOT NULL REFERENCES personal_site.runtime_bundles(digest),
  kind text NOT NULL CHECK (kind IN ('pinned','legacy-render')),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest)='object' AND (manifest->>'manifestVersion') IS NOT DISTINCT FROM '1'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE personal_site.delivery_bindings (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  version_id bigint UNIQUE REFERENCES personal_site.versions(id),
  preview_id text UNIQUE REFERENCES personal_site.previews(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('pinned','legacy')),
  artifact_digest text REFERENCES personal_site.delivery_artifacts(digest),
  generation integer NOT NULL DEFAULT 0 CHECK (generation>=0),
  CHECK ((version_id IS NULL) <> (preview_id IS NULL)),
  CHECK (mode<>'pinned' OR artifact_digest IS NOT NULL)
);
INSERT INTO personal_site.delivery_bindings(version_id,mode) SELECT id,'legacy' FROM personal_site.versions;
INSERT INTO personal_site.delivery_bindings(preview_id,mode) SELECT id,'legacy' FROM personal_site.previews;
```

不加“任意version INSERT自动legacy”的触发器。当前 importBundle 插入每个历史version后显式插入legacy；后续正常publish必须写pinned。现有低层 insertVersion/putPreview 暂保留，但最终 Task 8 改为受控历史/正常入口，无默认假legacy。

- [ ] **Step 4：按真实隔离PG结果固定003结构签名。** 保留001/002旧signature `d707b879563d88ac731f0e95982187542f1d260bec0ad866110bc3f155f90534`。在专用fixture手工执行001、002、003（仅临时库），使用现有 signatureQuery 的 rows 经 SHA-256 得到新签名，记录输出后用 apply_patch 写入registry逐版本条目。不能将运行时观测值直接当可信期望，也不能为了过测试把三个版本指向相同签名。registry增加002原checksum硬校验。

```js
const rows=(await tx.query(require('../admin-server/migrations').signatureQuery)).rows;
const signature=require('node:crypto').createHash('sha256').update(JSON.stringify(rows)).digest('hex');
assert.match(signature,/^[a-f0-9]{64}$/);
// 将此隔离查询的实际输出固定在 registry 的第3项；不是启动时动态生成。
```

- [ ] **Step 5：绿灯覆盖迁移边界。** V1→3仅002增加一次revision；V2→3不改revision；新安装空selection；并发升级一次成功；003中途故障回滚新表/记录；历史JSONB、账号/会话、云凭据、资源/引用、审计、安装来源/时间不变。更新 inspectorWithSignatures 为三项，旧schema测试仍用明确1/2。`rtk proxy node scripts/test-postgres.js tests/delivery-schema.test.js tests/schema-upgrade.test.js tests/installation.test.js tests/postgres.test.js tests/importers.test.js`。
- [ ] **Step 6：提交。** 显式add本任务文件，`feat: migrate to explicit runtime delivery bindings`。

## Task 5：私有CAS与不可覆盖文件固化

**Files:** Create `admin-server/delivery/cas.js`, `tests/delivery-cas.test.js`。

**Interfaces:** `createCAS(dataDir)` 返回 `put(bytes):Promise<{sha256,size}>`、`read(entry):Promise<Buffer>`、`inspect():Promise<{objects:Array<{sha256:string,size:number}>,bytes:number}>`；路径固定 `dataDir/delivery/objects/<sha256>` 与 `dataDir/delivery/staging/<唯一名>`。模块另导出 `readSource(root,relative,maxBytes):Promise<Buffer>` 供登记使用，拒绝各路径层级符号链接；不导出任意公开下载入口。

- [ ] **Step 1：写真实临时文件系统失败测试。**

```js
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {createCAS}=require('../admin-server/delivery/cas');
test('CAS rechecks existing bytes and never repairs corruption in place',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'delivery-cas-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const cas=createCAS(dir),entry=await cas.put(Buffer.from('original'));
  assert.equal((await cas.read(entry)).toString(),'original');
  const object=path.join(dir,'delivery/objects',entry.sha256);
  await fs.writeFile(object,'damaged');
  await assert.rejects(cas.read(entry));
  await assert.rejects(cas.put(Buffer.from('original')));
  assert.equal(await fs.readFile(object,'utf8'),'damaged');
});
```

- [ ] **Step 2：红灯。** `rtk proxy node --test tests/delivery-cas.test.js`。
- [ ] **Step 3：实现不覆盖的固化算法。** 校验dataDir及新目录每层为真实目录，mode0700；source逐层lstat拒绝symlink并校验realpath在root内，文件用O_NOFOLLOW打开、fstat确认普通文件与上限；读取已打开fd，校验前后stat/realpath一致，变化则拒绝，不读取攻击者替换路径。CAS对象同样检查父目录/文件无symlink，读出Buffer后算hash与size，返回这份Buffer，不验证后再sendFile另读一次。

```js
// put 内：tmp 是本调用 mkdtemp 创建的专用目录，destination 仅由已验证摘要派生。
await fs.writeFile(path.join(tmp,'object'),bytes,{flag:'wx',mode:0o600});
const handle=await fs.open(path.join(tmp,'object'),'r');
try{await handle.sync();}finally{await handle.close();}
try{await fs.link(path.join(tmp,'object'),destination);}
catch(error){if(error.code!=='EEXIST')throw error;}
await read({sha256:digest,size:bytes.length});
// finally 只清理 tmp；绝不 unlink destination。跨文件系统 link 失败即拒绝，暂存必须同目录树。
```

实现中不能把 `fs.rename` 默认覆盖行为当no-clobber。完成对象仍是私有文件；对相同hash并发put只有一个创建，另一个核验同字节成功。磁盘写入/同步失败不建立DB资格，允许留下未引用对象。

- [ ] **Step 4：扩展绿灯矩阵。** 临时目录内测试输入/父目录symlink、越界、编码路径、目录伪文件、读取过程中变化、错size/hash、并发相同对象、EACCES/ENOSPC注入、孤立对象诊断；仅删测试自建目录。全部通过后提交 `feat: persist verified private content-addressed objects`。

## Task 6：显式登记、运行包仓储和选择

**Files:** Create `admin-server/repositories/runtime.js`, `admin-server/delivery/registration.js`, `scripts/runtime-bundle.js`, `tests/runtime-registration.test.js`；Modify `package.json`（脚本，不更新依赖）。

**Interfaces:** `runtimeRepository(db)` 提供 `insertBundle({digest,manifest})`、`getBundle(digest)`、`listBundles()`、`getSelection({lock=false}={})`、`select({digest,expectedGeneration})`。`registerRuntime({store,cas,root,manifest,registry,actor})` 返回 `{digest,profileId,files,bytes}`；登记不选择。`selectRuntime({store,cas,registry,digest,expectedGeneration,actor})` 在验证CAS后短事务选择；actor此处为服务器审计用户名，HTTP层另做认证。

- [ ] **Step 1：写登记与选择分离的PG测试。**

```js
const {test}=require('node:test');
const assert=require('node:assert/strict');
test('registration never selects and equal selection is a no-op',async t=>{
  const {store}=await require('./helpers/postgres').postgresFixture(t);
  const content=require('./helpers/content').contentFixture(t);
  await store.transaction(tx=>require('../admin-server/repositories/content').contentRepository(tx).importBundle(content.bundle));
  const fixture=await require('./helpers/runtime').testRuntime(t);
  const cas=require('../admin-server/delivery/cas').createCAS(fixture.root+'/data');
  const {registerRuntime,selectRuntime}=require('../admin-server/delivery/registration');
  const result=await registerRuntime({store,cas,...fixture,actor:'admin'});
  const repo=require('../admin-server/repositories/runtime').runtimeRepository(store);
  assert.deepEqual(await repo.getSelection(),{digest:null,generation:0});
  const input={store,cas,registry:fixture.registry,digest:result.digest,expectedGeneration:0,actor:'admin'};
  assert.equal((await selectRuntime(input)).generation,1);
  assert.equal((await selectRuntime({...input,expectedGeneration:1})).generation,1);
  await assert.rejects(selectRuntime(input),{status:409});
});
```

- [ ] **Step 2：红灯。** `rtk proxy node scripts/test-postgres.js tests/runtime-registration.test.js`。
- [ ] **Step 3：实现仓储与登记流程。** `registerRuntime` 依次执行 Task1清单结构→registry/profile检查→readSource逐项真实字节/size/hash→完整闭包/patch预检→cas.put全部输入→事务insert-or-compare→audit。重复登记相同digest须比较canonical清单，不更新旧记录；生成时间不参与digest。SQL插入使用 `ON CONFLICT(digest) DO NOTHING RETURNING digest`，随后读取并比较manifest，不用upsert覆盖。

```js
// runtimeRepository.select 的事务调用者已持站点锁；接口还核对generation。
const current=await repo.getSelection({lock:true});
if(current.generation!==expectedGeneration)throw fail(409,'运行包选择已变化，请刷新');
if(current.digest===digest)return current;
const result=await db.query(`UPDATE personal_site.runtime_selection
  SET runtime_digest=$1,generation=generation+1 WHERE id=true AND generation=$2
  RETURNING runtime_digest AS digest,generation`,[digest,expectedGeneration]);
if(!result.rowCount)throw fail(409,'运行包选择已变化，请刷新');
return result.rows[0];
```

`selectRuntime` 先验证指定bundle完整性和registry支持；进入事务先锁site_settings，再selection，写审计仅在改变时发生。digest/null/数字输入不合法400，不允许任意路径或URL。选包不更改草稿revision、历史binding或published。

- [ ] **Step 4：服务器CLI只登记。** package脚本 `runtime:register` 指向 `node scripts/runtime-bundle.js`；CLI接受 `--root`、`--manifest`、`--profile` 三个明确参数，无scan/latest/download/execute选项。`main(argv,{loadOptions,openPostgres,registry}={})` 可在测试注入临时环境；生产默认读取自身部署配置，要求installed/schema3，不调用migrate。CLI从manifest文件读取受限JSON，校验profile参数与清单相符，finally关闭pool。控制台只打印digest/profile/文件数/大小，不打印绝对路径、连接串或源码。错误用受控中文摘要及非零exitCode。

```json
{"scripts":{"runtime:register":"node scripts/runtime-bundle.js"}}
```

此JSON是合并字段而非覆盖现有scripts。使用临时目录测试CLI，无数据库配置时拒绝；import脚本带顶层副作用时确保从未执行，HTTP端不存在登记root API。

- [ ] **Step 5：绿灯/提交。** 同目录mtime变化digest不变，任一字节改变新digest；登记失败selection/published不变；缺文件/错hash/同digest不同manifest拒绝。提交 `feat: register and explicitly select verified runtime bundles`。

## Task 7：冻结投影与确定性完整构建

**Files:** Create `admin-server/delivery/projection.js`, `builder.js`, `tests/delivery-builder.test.js`；Modify `snapshots.js`, `publication.js`, engine/render/adapter。

**Interfaces:** `projectSnapshot(source,target,profile,{runtimeFiles})` 返回 `{snapshot,config,references,geometryIds}`；runtimeFiles为已验证运行包Map(key,Buffer)，用于发现声明HTML/CSS的实际媒体引用，source保持原JSON不变。`buildArtifact({cas,bundle,source,target,origin,selection,profile,kind,referenceCeiling})` 返回 `{digest,manifest,references}`，不访问DB，媒体warnings由候选预检取得。`checkPublicationState(store,snapshot,{references,geometryIds,policy})` / `validatePublication(store,options,snapshot,context)` 可显式使用冻结规则；无context只供既有草稿/导入检查。

- [ ] **Step 1：写确定性与源快照不变测试。**

```js
const {test}=require('node:test');
const assert=require('node:assert/strict');
test('projection does not rewrite source and explicitly freezes layout policy',t=>{
  const {bundle}=require('./helpers/content').contentFixture(t);
  const source=bundle.versions[0].snapshot,before=JSON.stringify(source);
  const {projectSnapshot}=require('../admin-server/delivery/projection');
  const profile={id:'test-v1',templateId:'test-template',policy:{inactiveLayouts:[]},programs:[]};
  const next=projectSnapshot(source,{type:'version',id:'43'},profile,{runtimeFiles:new Map()});
  assert.equal(JSON.stringify(source),before);
  assert.equal(next.config.site.language,'en');
  assert(next.references.some(r=>r.resourceId==='image'));
});
```

- [ ] **Step 2：红灯。** `rtk proxy node --test tests/delivery-builder.test.js`。
- [ ] **Step 3：显式注入引用规则，冻结集合。** snapshots.inactiveUIL/collectReferences新增policy参数；默认只保留旧草稿调用，构建必须传profile.policy。遍历算法沿用现有实现，所有递归调用使用同一policy，最终排序用normalizeReferences。legacy的referenceCeiling为DB既有集合：构建所需引用必须是该集合子集，清单/授权摘要仍记录完整既有集合，不新增/删除历史授权。

```js
function inactiveUIL(template,key,policy={inactiveLayouts:require('./engine-assets.json').inactiveLayouts||[]}){
  const match=/(?:Config|Element)_(\d+)_([A-Za-z][A-Za-z0-9]*)/.exec(key);
  return !!match&&(template.baseUIL?.['sl_'+match[2]+'_'+match[1]+'_deleted']===true||policy.inactiveLayouts.includes(match[2]));
}
```

`projectSnapshot` structuredClone原始source后补站点身份，publicSnapshot继续白名单映射；构建投影摘要包括所用policy及规范化snapshot。sourceSnapshotDigest始终由未经投影的source计算，最终保存同一source JSON。普通构建的引用集合含runtimeFiles中声明HTML实际使用的字体/icon/manifest、unsupported背景及它们的dependencies；这些在候选准备时已纳入，不能直到builder才新增导致授权摘要漂移。已知HTML的 `./assets/` 按输入页面相对路径解析为受限根相对路径，再经snapshot.assets/legacyMap映射；不对任意远程HTML取资源。现有resource-catalog的inventory已登记未使用媒体，正常发布可按实际模板新增对应引用；legacy只可使用旧refs集合，不能借inventory条目扩权。站内路径仍无法映射时失败，不能绕过resourceID。若同一resourceId出现不一致的document定义，失败而非任选一个。

- [ ] **Step 4：生成所有输出并固化。** builder只从cas读bundle文件，不读登记root或当前assets。固定adapterDigest来源清单是所有engine/delivery构建模块、snapshots、page-metadata、shared/site-identity和page-metadata-dom；按相对源码路径排序并逐字节hash，记录明确来源，不用mtime或Git脏状态代替。使用Task2/3生成函数产生下列文件并写CAS：

```js
const fixedData={
  config:config,
  'uil.json':versionedUIL(snapshot,target.id),
  'projects.json':config.projects,
  'metadata.json':mapResourceTree(snapshot,target.id,snapshot.template.metadata||{}),
  'contact.json':mapResourceTree(snapshot,target.id,snapshot.template.contact||{})
};
const publicPaths=['/','/work',...config.projects.map(p=>'/work/'+p.slug)];
```

另生成app、shader、identity/shared串接、bridge、全部辅助program/worker/WASM、每条publicPath的HTML与unsupportedHTML。每份HTML使用A的pageMetadata/renderPageMetadata，head唯一、escaped canonical、identity在bridge前、bridge在app/modules前。derived document通过mapResourceTree生成并放manifest.documents[resourceId]，不放runtime/endpoints公共表。全部JSON使用canonicalJSON，文件列表按key排序。验证输出无未知可执行路径、无空入口、无secret字段，patch报告完整，再cas.put；上限按实际Buffer计。

- [ ] **Step 5：完整绿灯矩阵。** 同inputs两次manifest/digest/所有字节相同；target/origin/source/runtime任一变化身份不同；生成失败无部分成功返回；删除原登记root后仍可build；旧rawsource缺新字段不被改写；未知slug没有生成路由；Web App Manifest只在documents；HTML与worker所有程序URL同target。用 testRuntime 的实际构建输出比较，不只mock函数调用。
- [ ] **Step 6：提交。** `rtk proxy node --test tests/delivery-builder.test.js tests/runtime-patches.test.js tests/runtime-paths.test.js tests/metadata.test.js tests/site-identity.test.js`；提交 `feat: build deterministic version-bound delivery artifacts`。

## Task 8：交付仓储、保留ID插入与不可替换绑定

**Files:** Create `admin-server/repositories/deliveries.js`, `tests/delivery-repository.test.js`；Modify `repositories/content.js`, `repositories/resources.js`, 对应repositories/importers测试。

**Interfaces:** `deliveryRepository(db)` 提供 `getBinding(target,{lock=false})`、`getArtifact(digest)`、`putArtifact({digest,manifest})`、`bindPinned(target,digest)`、`bindLegacyOnce(target,digest,expectedGeneration)`、`references(target)`、`summaries(versionIds)`。getBinding返回null或 `{target,mode,artifactDigest,generation}`；getArtifact返回null或 `{digest,manifest,runtimeDigest,kind,createdAt}`，所有SQL列在出口转camelCase。contentRepository新增 `reserveVersionId()`、`insertReservedVersion({id,snapshot,references})`、`insertPreview({id,owner,expires,snapshot,references})`；新写入不compose、不重算refs、不setval、不upsert。

- [ ] **Step 1：写反序提交/一次绑定红灯测试。**

```js
const {test}=require('node:test');
const assert=require('node:assert/strict');
test('reserved ids are never rewound by out-of-order insertion',async t=>{
  const {store}=await require('./helpers/postgres').postgresFixture(t);
  const {bundle}=require('./helpers/content').contentFixture(t);
  const make=tx=>require('../admin-server/repositories/content').contentRepository(tx);
  await store.transaction(tx=>make(tx).importBundle(bundle));
  const repo=make(store),a=await repo.reserveVersionId(),b=await repo.reserveVersionId();
  const references=require('../admin-server/snapshots').collectReferences(bundle.draft);
  await store.transaction(tx=>make(tx).insertReservedVersion({id:b,snapshot:bundle.draft,references}));
  await store.transaction(tx=>make(tx).insertReservedVersion({id:a,snapshot:bundle.draft,references}));
  assert((await repo.reserveVersionId())>b);
});
```

- [ ] **Step 2：红灯。** `rtk proxy node scripts/test-postgres.js tests/delivery-repository.test.js`。
- [ ] **Step 3：加入明确仓储入口。**

```js
async function reserveVersionId(){
  const r=await db.query("SELECT nextval(pg_get_serial_sequence('personal_site.versions','id')) AS id");
  return toSafeInteger(r.rows[0].id);
}
async function insertReservedVersion({id,snapshot,references}){
  if(!Number.isSafeInteger(id)||id<1)throw fail(400,'版本编号无效');
  await db.query('SELECT id FROM personal_site.site_settings WHERE id=true FOR UPDATE');
  const r=await db.query('INSERT INTO personal_site.versions(id,snapshot) VALUES($1,$2) RETURNING *',[id,snapshot]);
  await resources.replaceReferences({ownerType:'version',ownerId:id,references});
  return version(r.rows[0]);
}
```

普通publish在Task9只用这两个方法；历史importBundle保留首次导入后一次setval。移除旧insertVersion显式id的setval分支，旧测试若构造历史应使用明确import fixture。此任务新增只INSERT的insertPreview，不提前删除config.createPreview仍调用的旧putPreview；旧方法及其UPSERT在Task10与全部预览调用一起移除，未完成整段B不得部署。底层仓储可在同一事务短暂先version再binding，但新版用例成功返回前必须完整绑定；不要为漏绑自动建legacy。

putArtifact必须assertArtifactManifest、复算digest、验证runtime外键与kind，重复insert-or-compare不可覆盖。bindPinned核对数据库可验证的target/sourceSnapshotDigest/referencesDigest/runtime外键和artifact.kind后INSERT；可信origin、所选包及构建器与候选是否一致由Task9的assertArtifactMatchesCandidate检查，仓储不读取环境或伪称拥有可信origin。bindLegacyOnce仅支持version，条件更新如下并检查rowCount=1：

```sql
UPDATE personal_site.delivery_bindings
SET artifact_digest=$1,generation=generation+1
WHERE version_id=$2 AND mode='legacy' AND artifact_digest IS NULL AND generation=$3
RETURNING id;
```

读取references按owner_type/id获取固定集合，normalizeReferences后算摘要；不调用collectReferences。artifact与绑定嵌套身份读取时也检查，不能只依赖JSON或FK存在。

- [ ] **Step 4：绿灯/提交。** 新增XOR/唯一/FK/空pinned约束、错误目标、preview/public互借、相同digest不同manifest、preview删除级联、已绑定legacy拒绝替换、首次import仍legacy测试。提交 `feat: persist immutable delivery bindings and reserved versions`。

## Task 9：候选、会话复检与原子正常发布

**Files:** Create `admin-server/delivery/service.js`, `candidates.js`, `publish.js`, `tests/delivery-publish.test.js`, `tests/helpers/delivery.js`；Modify `config.js`, `publication.js`, `repositories/auth.js`, `app.js`, `tests/helpers/http.js`。

**Interfaces:** `createDeliveryService({store,options,registry,build=buildArtifact})` 返回 `{publish,preview,legacy,register,select,read,cas}`，未接入的方法在对应任务完成前不挂HTTP；没有宽松fallback。`prepareDraftCandidate({store,options,registry,cas,revision,actor,targetType})` 返回 `{target,source,draftRevision,selection,bundle,profile,origin,references,geometryIds,projectionDigest,adapterDigest,warnings}`。`assertArtifactMatchesCandidate(artifact,candidate,kind)` 在任何数据库写入前核对产物与候选；`recheckCandidate(tx,candidate,actor,options)` 检查后不写版本。`authRepository(tx).lockValidSession(actor,now)` 返回当前会话或401。`service.publish({revision,actor,withWarnings=false})` 返回原数字或 `{version,warnings}`。

- [ ] **Step 1：建立显式delivery夹具并写失败场景。** tests/helpers/http.js第二参数选项对象增加serviceFactory，start时先调用 `serviceFactory({store,options:resolvedOptions})`，把结果作为createApp第二参数 `{deliveryService}`；不并入HTTP/环境options。tests/helpers/delivery.js的 `deliveryFixture(t,{publish=false,build}={})` 完整步骤为：先testRuntime→构造闭包捕获测试registry/build的serviceFactory→httpFixture→createAdmin→login→读取测试session的id/username→真实register/select；可选真实publish并返回headers/actor/published及runtimeAppPath。service/cas/app/store/base用getter转发，不能用对象展开把原fixture的getter变成旧值；restart用新store重新执行serviceFactory。默认不生成artifact，避免legacy测试被偷偷升级。CAS始终用httpFixture的临时dataDir，登记root只指测试runtime根。

```js
const {test}=require('node:test');
const assert=require('node:assert/strict');
test('failed build does not change published or create a version',async t=>{
  const f=await require('./helpers/delivery').deliveryFixture(t,{build:async()=>{throw Error('injected build failure');}});
  const repo=require('../admin-server/repositories/content').contentRepository(f.store);
  const before=await repo.getDraft(),versions=await repo.listVersions();
  await assert.rejects(f.service.publish({revision:before.revision,actor:f.actor}),/injected/);
  assert.equal((await repo.getDraft()).published,before.published);
  assert.deepEqual(await repo.listVersions(),versions);
});
```

- [ ] **Step 2：红灯。** `rtk proxy node scripts/test-postgres.js tests/delivery-publish.test.js`。
- [ ] **Step 3：实现短捕获与锁外构建。** 在store.transaction的首个数据查询前执行 `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`，读取draft、template、selection、runtime并验证revision；不要持站点写锁构建。退出后预留version ID，复制origin、profile/source/selection，在锁外读取并验证CAS输入、调用带runtimeFiles的projectSnapshot，冻结含HTML媒体的引用及投影摘要。validateConfig与媒体/字体预检使用Task7固定policy。buildArtifact读CAS并生成完成品，任何失败不写versions/published。

```js
async function lockValidSession(actor,now){
  if(!actor||!/^[a-f0-9]{64}$/.test(actor.id)||typeof actor.username!=='string')throw fail(401,'登录已失效');
  const r=await db.query(`SELECT s.id,s.username,s.created,s.touched
    FROM personal_site.sessions s JOIN personal_site.admins a ON a.username=s.username
    WHERE s.id=$1 AND s.username=$2 FOR UPDATE OF s`,[actor.id,actor.username]);
  const row=r.rows[0];
  if(!row||now-Number(row.touched)>=12*60*60*1000||now-Number(row.created)>=7*24*60*60*1000||
    Number(row.touched)>now||Number(row.created)>now)throw fail(401,'登录已失效');
  return row;
}
```

此锁只在最终事务站点锁之后获取。logout的DELETE与session行锁产生明确提交顺序：logout先完成则候选401；发布先锁定并提交则logout随后生效。账号reset已有站点锁和删除会话/预览顺序保持，不增加反序管理员锁。

- [ ] **Step 4：实现最终事务和原返回契约。**

```js
const artifact=await build({...candidate,cas,kind:'pinned'});
assertArtifactMatchesCandidate(artifact,candidate,'pinned');
const warnings=candidate.warnings;
const id=await store.transaction(async tx=>{
  await recheckCandidate(tx,candidate,actor,options);
  const repo=contentRepository(tx),deliveries=deliveryRepository(tx);
  const version=await repo.insertReservedVersion({id:Number(candidate.target.id),
    snapshot:candidate.source,references:artifact.references});
  await deliveries.putArtifact(artifact);
  await deliveries.bindPinned(candidate.target,artifact.digest);
  await repo.setPublished(version.id);
  await auditRepository(tx).append('config.publish',actor.username);
  return version.id;
});
return withWarnings?{version:id,warnings}:id;
```

在candidates.js实现完整候选比对；projectionDigest由Task7投影的snapshot、profileId/templateId/policy确定性JSON生成，adapterDigest由同一固定构建器来源清单生成。两者在候选捕获时确定，builder必须得到相同值，不把builder任意返回值视为可信：

```js
function assertArtifactMatchesCandidate(artifact,candidate,kind){
  assertArtifactManifest(artifact.manifest);
  const m=artifact.manifest,expected={
    kind,target:candidate.target,origin:candidate.origin,
    runtimeDigest:candidate.selection.digest,selectionGeneration:candidate.selection.generation,
    profileId:candidate.profile.id,templateId:candidate.profile.templateId,
    sourceSnapshotDigest:digestJSON(candidate.source),projectionDigest:candidate.projectionDigest,
    adapterDigest:candidate.adapterDigest,referencesDigest:digestJSON(normalizeReferences(candidate.references))
  };
  for(const [key,value] of Object.entries(expected))
    if(canonicalJSON(m[key])!==canonicalJSON(value))throw fail(422,'交付与构建候选不一致');
  if(digestJSON(m)!==artifact.digest||digestJSON(normalizeReferences(artifact.references))!==expected.referencesDigest)
    throw fail(422,'交付摘要不一致');
}
```

preview和legacy在首次写入前复用同一函数，legacy candidate.references为固定旧授权全集而非新算子集。增加“合法结构但另一runtime/origin/target/refs”的注入build负例，必须在version INSERT前拒绝。

recheckCandidate严格顺序：getDraft({lock:true})单独锁后再读→revision/source身份→selection generation/digest→按resourceId排序FOR UPDATE资源→固定引用的状态/存储可用性/必要本地文件仍存在→lockValidSession→构建origin等于服务初始化origin。最终事务不重新compose、不重算活动槽位、不从Host推origin；读取CAS不进入站点锁的长构建部分。

config.publish保留位置作薄委托但actor参数改成Actor对象，签名为 `publish(store,revision,options,actor,{withWarnings=false,deliveryService}={})`；createPreview同理增加可选 `{deliveryService}` 构造依赖。未传service时通过默认registry构造，测试及app显式传单例；所有调用明确迁移，不能接受旧字符串并假设合法。app只传 `{id:req.adminSession.id,username:req.adminSession.username}`；body仍只接受revision。service在createApp只构造一次并记录到app.locals.deliveryService，测试registry不会暴露给客户端。

- [ ] **Step 5：并发/故障绿灯。** 用两段Promise屏障暂停真实build：期间改草稿、切包、禁用资源/存储、logout、reset，再释放，分别409/422/401且旧published不变。测试两个候选逆序完成、写artifact/binding/audit失败的事务回滚、版本sequence空洞及后续递增。检测build期间另一连接能取得站点锁，不能靠提高timeout通过。
- [ ] **Step 6：迁移现有发布测试后提交。** tests/config/publication/admin/integration/database-content等正常publish调用提供测试profile和真实Actor；仅内容导入测试保留legacy。本任务门禁为 `rtk proxy node scripts/test-postgres.js tests/delivery-publish.test.js` 及其中已迁移的发布专项用例；含预览的publication/admin混合回归在Task10迁移完后整体运行，不提前声称这些文件全绿。提交 `feat: publish verified candidates with atomic bindings`。

## Task 10：固定预览与提交时开始的有效期

**Files:** Create `admin-server/delivery/preview.js`, `tests/delivery-preview.test.js`；Modify `config.js`, `app.js`, `repositories/content.js`, `tests/publication.test.js`, `tests/metadata-http.test.js`, `tests/admin.test.js`。

**Interfaces:** `service.preview({revision,actor}):Promise<string>`，最终返回 `preview-UUID`。共享prepareDraftCandidate与recheckCandidate，targetType='preview'；owner=actor.username，不能客户端指定。

- [ ] **Step 1：红灯测试不会覆盖已有预览。**

```js
const {test}=require('node:test');
const assert=require('node:assert/strict');
test('preview is a new pinned target and does not publish',async t=>{
  const f=await require('./helpers/delivery').deliveryFixture(t);
  const repo=require('../admin-server/repositories/content').contentRepository(f.store),draft=await repo.getDraft();
  const id=await f.service.preview({revision:draft.revision,actor:f.actor});
  assert.match(id,/^preview-/);
  assert.equal((await repo.getDraft()).published,draft.published);
  const row=await repo.getPreview(id,f.actor.username,new Date());
  assert(Date.parse(row.expires)>Date.now()+29*60000);
  const binding=await require('../admin-server/repositories/deliveries').deliveryRepository(f.store).getBinding({type:'preview',id});
  assert.equal(binding.mode,'pinned');
  assert(binding.artifactDigest);
});
```

- [ ] **Step 2：运行红灯。** `rtk proxy node scripts/test-postgres.js tests/delivery-preview.test.js`。
- [ ] **Step 3：实现预览提交，不借用publish后撤回。** 在build前生成UUID；build返回先assertArtifactMatchesCandidate，然后最终事务复检后才计算now，prune过期，再insertPreview、putArtifact、bindPinned、audit。使用原按owner/expires排序OFFSET5逻辑删除多余preview及references；binding由FK级联。删除旧putPreview及UPSERT，所有预览调用改新入口；禁止update已存在ID，禁止把preview artifact直接转public。

```js
const now=Date.now();
await repo.prunePreviews(new Date(now));
await repo.insertPreview({id:candidate.target.id,owner:actor.username,
  expires:new Date(now+30*60000),snapshot:candidate.source,references:artifact.references});
await deliveries.putArtifact(artifact);
await deliveries.bindPinned(candidate.target,artifact.digest);
await auditRepository(tx).append('config.preview',actor.username);
```

config.createPreview的owner参数改为Actor并委托service；HTTP仍返回 `{url:'/?preview='+id}`。所有preview脚本、程序、WASM、资源、错误必须沿用app私有header中间件；读取授权在Task12补齐。

- [ ] **Step 4：绿灯/提交。** 测长构建后expiry、连续6条只保留5条、不同owner不得读取、已删除preview没有binding但CAS字节仍在、logout/reset/过期全部失效；失败不占用有效preview记录。此时运行 `rtk proxy node scripts/test-postgres.js tests/delivery-publish.test.js tests/delivery-preview.test.js tests/config.test.js tests/publication.test.js tests/admin.test.js`，修复混合调用的测试profile/Actor依赖，不恢复旧无绑定fallback。提交 `feat: bind authenticated previews to immutable artifacts`。

## Task 11：旧版本的首次兼容交付

**Files:** Create `admin-server/delivery/legacy.js`, `tests/delivery-legacy.test.js`；Modify `delivery/service.js`，不修改历史snapshot或restore业务语义。

**Interfaces:** `service.legacy({versionId,expectedGeneration,actor}):Promise<{version,artifactDigest}>`。只用全站selection；不接受runtime/path/origin参数。已有artifact、pinned、preview目标均409/400；无包/不兼容422或503受控提示。

- [ ] **Step 1：写首次生成不可替换的测试。**

```js
const {test}=require('node:test');
const assert=require('node:assert/strict');
test('legacy rendering preserves history and cannot be replaced',async t=>{
  const f=await require('./helpers/delivery').deliveryFixture(t);
  const sql='SELECT id,created,snapshot::text FROM personal_site.versions WHERE id=42';
  const before=(await f.store.query(sql)).rows;
  const settings=(await f.store.query('SELECT revision,published FROM personal_site.site_settings')).rows;
  await f.service.legacy({versionId:42,expectedGeneration:0,actor:f.actor});
  assert.deepEqual((await f.store.query(sql)).rows,before);
  assert.deepEqual((await f.store.query('SELECT revision,published FROM personal_site.site_settings')).rows,settings);
  await assert.rejects(f.service.legacy({versionId:42,expectedGeneration:1,actor:f.actor}),{status:409});
});
```

- [ ] **Step 2：红灯。** `rtk proxy node scripts/test-postgres.js tests/delivery-legacy.test.js`。
- [ ] **Step 3：独立用例实现。** 短一致性读取原始version snapshot、未绑定legacy generation、DB既有refs、全站selection；Task7构建kind='legacy-render'并传referenceCeiling，模板所需引用超出既有集合时422。调用assertArtifactMatchesCandidate核对原source、固定refs和当次选定包/origin后，最终事务锁site→binding/selection复检→原始source/ref摘要→有序资源/存储状态→有效session→putArtifact→bindLegacyOnce→audit `delivery.legacy`。不调用setPublished/writeDraft/insertVersion；并发两个初次构建只有一个更新成功。

```js
const changed=await tx.query(`UPDATE personal_site.delivery_bindings
  SET artifact_digest=$1,generation=generation+1
  WHERE version_id=$2 AND mode='legacy' AND artifact_digest IS NULL AND generation=$3
  RETURNING id`,[artifact.digest,versionId,expectedGeneration]);
if(changed.rowCount!==1)throw fail(409,'此版本已生成交付或状态已变化');
```

上面的SQL封装在Task8.bindLegacyOnce，不能在用例复制第二份仓储逻辑。legacy使用当次选定profile和origin，如实标记生成时间；不能把生成结果改标pinned或假造历史runtime。

- [ ] **Step 4：绿灯/提交。** 加入不同版本artifact互借失败、legacy未知字段source摘要、引用扩权拒绝、已有legacy换包/域名拒绝、恢复只改草稿、旧preview不生成、并发首次绑定及audit失败回滚测试。提交 `feat: generate explicit one-time legacy deliveries`。

## Task 12：只读前台交付、固定授权和缓存边界

**Files:** Create `admin-server/delivery/reader.js`, `response.js`, `tests/delivery-http.test.js`；Modify `frontend.js`, `frontend-resources.js`, `resources.js`, `models.js`, `app.js`, `tests/frontend.test.js`, `tests/metadata-http.test.js`, `tests/database-content.test.js`。

**Interfaces:** `resolveDelivery({store,cas,options,version,preview,admin})` 返回 `{target,snapshot,binding,manifest}`；`readDeliveryFile(resolved,{endpoint,runtimeKey,pagePath,resourceId},cas)` 一次只能指定一种查找方式，返回 `{entry,bytes,cacheKind}`；`sendDelivery(req,res,result)` 不访问DB。只有resourceId查找可返回resource-document，但调用方必须先执行资源实时状态授权。

- [ ] **Step 1：HTTP红灯测试固定程序不回源。**

```js
const {test}=require('node:test');
const assert=require('node:assert/strict');
test('pinned app survives source deletion and old static route is closed',async t=>{
  const f=await require('./helpers/delivery').deliveryFixture(t,{publish:true});
  const route='/api/site/'+f.published+'/app.js';
  const before=await (await f.request(route)).text();
  await require('node:fs/promises').unlink(f.runtimeAppPath);
  await f.restart();
  assert.equal(await (await f.request(route)).text(),before);
  assert.equal((await f.request('/assets/js/app.fixture.js')).status,404);
  const response=await f.request(route);
  assert.equal(response.headers.get('cache-control'),'public, no-cache, must-revalidate');
  const cached=await f.request(route,{headers:{'If-None-Match':response.headers.get('etag')}});
  assert.equal(cached.status,304);
});
```

Task9 helper补充返回 `runtimeAppPath`，指向其自建测试包app，不是用户原目录。restart保持同一临时CAS，并用同一serviceFactory重新组装服务与新store，沿用原pool cleanup逻辑。

- [ ] **Step 2：红灯。** `rtk proxy node scripts/test-postgres.js tests/delivery-http.test.js tests/metadata-http.test.js`。
- [ ] **Step 3：实现统一只读解析。** 流程严格为：installed/schema3→resolveVersion及preview owner/session/expiry→明确binding→manifest结构/hash/target/source/reference集合匹配→当前origin一致→CAS读取size/hash→响应。历史读取不调用当前profile、adapter、collectReferences/publicSnapshot，不需要原builder仍在registry；未知manifest版本503。缺binding/缺artifact/损坏/旧origin均503，不回退当前目录，错误no-store/noindex。

frontend.js变为路由组装：固定逻辑endpoint读取manifest.endpoints，runtime路由读取manifest.runtime且严格role；首页/work/slug读取manifest.routes。不存在slug真实404/noindex且不启动引擎；不能用任意请求路径构造文件路径。删除safeStatic程序挂载与当前文件读取；顶层unsupported解析当前公开或认证preview后读取该target对应文件。

```js
app.get('/api/site/:version/runtime/:key',route(async(req,res)=>{
  const resolved=await resolveDelivery({store,cas,options,version:req.params.version,admin:req.adminSession});
  const result=await readDeliveryFile(resolved,{runtimeKey:req.params.key},cas);
  sendDelivery(req,res,result);
}));
```

frontend-resources.resolvePublishedResource用deliveryRepository.references验证固定owner授权，再检查当前resource.trashed/status及存储状态。普通媒体仍走现有范围请求/外链redirect；派生document通过resolveDelivery读取manifest.documents，不再现场mapResourceTree。`/media/:id`、`/models/:id.bin`、`/assets/geometry/admin/:id.bin` 注册早于frontend，必须一并补no-store并检查其公开历史授权语义不变；不能把“任何历史version引用即可访问”悄改成只有当前published。媒体旧路径映射不需要公开任意程序。

- [ ] **Step 4：缓存只在所有验证之后判断。**

```js
function sendDelivery(req,res,{entry,bytes,cacheKind}){
  const privateResponse=String(res.get('Cache-Control')||'').startsWith('private');
  const revalidate=!privateResponse&&cacheKind==='pinned-program';
  res.type(entry.mime).set('X-Content-Type-Options','nosniff');
  res.set('Cache-Control',privateResponse?'private, no-store':revalidate?'public, no-cache, must-revalidate':'no-store');
  if(revalidate){
    const etag='"'+entry.sha256+'"';res.set('ETag',etag);
    const match=String(req.get('if-none-match')||'').split(',').some(v=>v.trim()==='*'||v.trim().replace(/^W\//,'')===etag);
    if(match&&(req.method==='GET'||req.method==='HEAD'))return res.status(304).end();
  }
  res.set('Content-Length',String(bytes.length));
  return req.method==='HEAD'?res.end():res.end(bytes);
}
```

cacheKind仅pinned且角色program/stylesheet/wasm/shader可用；HTML/JSON/document/legacy全no-store，preview优先private。不用res.send自动fresh逻辑绕过检查。全局错误/维护/404路径清掉任何预设ETag，保留private或设no-store/noindex；公开DB故障也不能304。

- [ ] **Step 5：绿灯矩阵逐端点展开。** 固定九个端点、runtime worker/WASM、unsupported、三种页面、deriveddocument及所有媒体别名分别测：匿名/owner/另一owner/expiry/logout/reset、资源禁用/回收、origin变更、伪Host/query、错ETag/正确ETag、CAS缺失/篡改、DB故障。preview带If-None-Match仍private并授权；runtime key伪装document/媒体拒绝；无程序静态入口；版本A页面加载后发布B，A worker仍A。
- [ ] **Step 6：迁移旧测试并提交。** 删掉“旧static app返回200”的过时期待，替换为404+绑定runtime200；原元信息/资源行为断言保留。`rtk proxy node scripts/test-postgres.js tests/delivery-http.test.js tests/metadata-http.test.js tests/database-content.test.js tests/admin.test.js`，另跑纯frontend/metadata。提交 `feat: serve only authorized version-bound delivery files`。

## Task 13：管理状态、显式选包和兼容交付动作

**Files:** Create `admin-server/delivery/admin-routes.js`, `tests/delivery-admin.test.js`；Modify `app.js`, `admin-ui/admin.js`, `tests/admin-ui.test.js`。

**Interfaces:** `mountDeliveryAdmin({admin,store,service})` 挂现有已认证/CSRF的admin router。`GET /runtime` 返回 `{selection,bundles}`，bundle只含digest/profileId/files/bytes/registeredAt；`PUT /runtime/selection` body仅 `{digest,generation}`；`POST /versions/:id/delivery` body仅 `{generation}`；versions列表追加 `{mode,generation,artifactDigest,status}`安全摘要，不返回manifest/私有路径。

- [ ] **Step 1：HTTP红灯认证与输入矩阵。**

```js
const {test}=require('node:test');
const assert=require('node:assert/strict');
test('runtime selection cannot register local paths or override origin',async t=>{
  const f=await require('./helpers/delivery').deliveryFixture(t);
  assert.equal((await f.request('/api/admin/runtime')).status,401);
  const response=await f.request('/api/admin/runtime/selection',{method:'PUT',headers:f.headers,
    body:JSON.stringify({digest:'a'.repeat(64),generation:0,root:'/tmp/forbidden',origin:'https://other.invalid'})});
  assert.equal(response.status,400);
});
```

- [ ] **Step 2：红灯。** `rtk proxy node scripts/test-postgres.js tests/delivery-admin.test.js`；纯UI `rtk proxy node --test tests/admin-ui.test.js`。
- [ ] **Step 3：挂小型API，不重组整个管理端。**

```js
admin.post('/versions/:id/delivery',route(async(req,res)=>{
  if(Object.keys(req.body||{}).some(k=>k!=='generation')||!Number.isSafeInteger(req.body?.generation))throw fail(400,'交付参数无效');
  res.json(await service.legacy({versionId:Number(req.params.id),expectedGeneration:req.body.generation,
    actor:{id:req.adminSession.id,username:req.adminSession.username}}));
}));
```

选择路由同样严格body白名单，GET不写状态。status为未选包、legacy待生成、已固定、origin不匹配、缺失/损坏、不支持；不要把CAS所有文件逐次全量hash塞进普通versions列表，列表显示已知绑定状态与明确的最近操作错误，详细完整性按实际校验接口/请求报告，不伪称实时健康。

- [ ] **Step 4：管理UI增加运行包面板与全程busy保护。** 使用既有node/field/button/panel，选择显示digest短摘要+profile+大小；提示“选择只影响之后的预览与发布”。legacy无artifact行才显示“生成兼容交付”，确认说明不改历史内容；已有artifact没有替换按钮。未选包时仍可配置内容与账号，发布/预览显示服务器登记说明，不自动选择包。

```js
async function building(action){
  if(state.busy)throw new Error('正在处理，请稍后');
  state.busy=true;updateStatus();
  try{return await action();}
  finally{state.busy=false;updateStatus();}
}
```

preview/publish先完成原save和dirty复检，再把整个网络构建请求包进building；保存、选包、兼容按钮检查同一busy状态，退出登录仍可执行并由服务器取消陈旧候选。失败保留未保存编辑；网络结果不明提示刷新版本/审计，不自动重发POST。不要在building内部调用拒绝busy的save造成自锁。维持键盘焦点、确认框、中文反馈及失败后按钮恢复。

- [ ] **Step 5：行为测试绿灯/提交。** VM fake DOM实际点击/选择和pending promise：请求挂起时第二次publish/preview/selection不再发出；失败恢复按钮；改变包不改draftrevision；legacy按钮受mode/artifact约束；未知状态不显示成功。HTTP覆盖401/403、CSRF/Origin、409generation、无越权body字段。提交 `feat: manage runtime selection and delivery status`。

## Task 14：整段回归、容器/浏览器验收和运维文档

**Files:** Create `scripts/delivery-audit.js`, `tests/delivery-audit.test.js`, `docs/ENGINE-RUNTIME.md`, `docs/verification/engine-delivery.md`；Modify `README.md`, `docs/ADMIN.md`, `docs/POSTGRESQL-MIGRATION.md`, `Dockerfile`, `tests/deployment.test.js`, `package.json`。只有确有容器路径缺失时修改compose；不复制私有授权包进镜像或Git。

**Interfaces:** `auditDelivery({store,cas})` 返回 `{objectCount,totalBytes,referencedObjectCount,unreferencedObjectCount,missingObjects,invalidObjects}`，无文件内容/绝对路径/密钥；纯只读，不删除任何对象。CLI `delivery:audit` 需要已安装schema3，finally关闭pool，不迁移/构建/清理。记录格式每项包含命令、退出码、实际通过/失败/skip、来源身份和未验证原因。

- [ ] **Step 1：只读诊断的红绿测试。** 在临时CAS写一个登记引用对象、一个未引用对象，记录两者hash与mtime，调用auditDelivery并断言计数及调用前后字节/mtime不变；篡改/缺失引用对象分别列出摘要，不能静默回源。诊断以DB中全部已登记包和artifact manifest为保留集合，列出无binding artifact但不擅自判可删；并发运行的结果注明瞬时观测，不提供在线删除按钮。

```js
const {test}=require('node:test');
const assert=require('node:assert/strict');
test('audit never deletes unreferenced objects',async t=>{
  const f=await require('./helpers/delivery').deliveryFixture(t,{publish:true});
  const orphan=await f.cas.put(Buffer.from('unreferenced test object'));
  const report=await require('../scripts/delivery-audit').auditDelivery({store:f.store,cas:f.cas});
  assert(report.unreferencedObjectCount>=1);
  assert.equal((await f.cas.read(orphan)).toString(),'unreferenced test object');
});
```

Run `rtk proxy node scripts/test-postgres.js tests/delivery-audit.test.js`；先缺模块红灯，再实现只读清单扫描/集合比对并绿灯。package添加 `delivery:audit`，不添加gc/delete命令。

- [ ] **Step 2：全量自动测试与不可变迁移复核。**

```sh
rtk proxy node --test tests/delivery-contracts.test.js tests/delivery-cas.test.js tests/runtime-patches.test.js tests/runtime-profile.test.js tests/runtime-paths.test.js tests/delivery-builder.test.js tests/admin-ui.test.js tests/metadata.test.js tests/site-identity.test.js
rtk proxy node scripts/test-postgres.js
rtk proxy shasum -a 256 admin-server/migrations/001-initial.sql admin-server/migrations/002-site-identity.sql
rtk proxy git diff --check
rtk proxy docker compose -p site-pg-test -f compose.test.yaml config --quiet
```

故障注入必须覆盖：输入缺失、profile失败、CAS写失败/损坏、revision/选择冲突、资源禁用/存储关闭、session撤销、artifact/binding/audit SQL失败、并发首次legacy、sequence逆序、未知manifest、旧origin、conditional GET断库。不能靠跳过PG/worker测试得到全绿。基础合成fixture通过与真实六场景兼容分开记录。

- [ ] **Step 3：容器构建和重启持久性。** 读取测试环境Docker/Compose配置，不加载真实.env。Docker现有COPY admin-server/shared/scripts已涵盖新模块，增加deployment测试断言路径与003实际存在；运行包在部署后显式登记，不能COPY宿主assets绕过许可。

```sh
rtk proxy docker build -t personal-site-phase-b-test .
```

只启动具有已记录名字、回环端口和临时data挂载的测试容器，连接专用测试库；options全部来自测试env-file。新安装无包可建账号但发布拒绝；登记/选择/发布后重建应用容器，同一DB和私有data仍交付相同字节。直接访问delivery/objects、staging、manifest本地路径404；程序、shader、worker无任何宿主源码fallback。结束只清理本次创建容器/卷，复用的专用PG不擅自关闭。

- [ ] **Step 4：隔离真实浏览器验收。** 执行时读取适用的browse/playwright技能及必要引用。不能用当前localhost:3000测试；启动单独回环端口，明示临时root/dataDir/专用DB/固定假管理员，不调用真实仓库loadOptions。

1. 从新安装登录，未登记包有清晰提示；在服务器登记后列表出现但未自动选择，选择后才能预览/发布。
2. 使用已明确授权的实际11项候选输入及明确manifest跑完整生产profile，记录所有输入hash和profile身份。`unsupported.html`当前是用户未跟踪文件，只读用于隔离验收，不提交它。缺包或无授权时该项标未验证，不以合成fixture替代。
3. 发布A，保存A主程序/worker/WASM/shader响应hash；登记或选择B、修改草稿并发布B后，A后续依赖仍交付A字节，B取得B字节。
4. 首页→Work→作品A/B→列表→About/Contact→后退/前进：标题/描述/canonical及原场景正确；空文案/空作品/空歌曲不出现假内容或启动死锁。
5. 同一授权包、同一隔离内容对比基线与候选的Logo、黑洞轮廓、粒子尺寸/反射与流动；截图和网络错误检查均记录，HTTP200不能替代视觉。
6. 实际Worker独立请求、Basis/Draco加载及unsupported降级均指向同版本；浏览器禁用WASM/不支持能力时转绑定unsupported，不请求缺失ES5/JSdecoder或外部gtag。
7. 预览所有依赖private/no-store/noindex；打开后退出，延迟worker/资源请求失败；另一owner、过期、账号reset分别验证。
8. 旧schema隔离副本升级后legacy无产物503；明确兼容动作后可用，按钮不可重复绑定；已绑定后换origin503，后台可读取历史，再新发布恢复可用。
9. 中途断开构建响应，后台不自动重发；刷新历史/审计能判断是否提交；双击发布不产生额外请求，错误后按钮和焦点恢复。
10. S3签名URL、外链公网可读性与CORS、真实CDN/生产服务器另列未验证，不能把本地重定向测试称为云端已通过。

- [ ] **Step 5：编写并隔离演练操作文档。** 将下面确定文案并入README/ADMIN/迁移指南，新建ENGINE-RUNTIME集中完整命令/清单示例/排错；命令在真实部署上需要独立授权，本轮只在测试环境演练。

```markdown
### 运行包与内容发布

运行包是经授权的前台程序输入，不等同于图片、视频和模型资源库。新安装可以先创建管理员并配置内容；发布和预览前必须在服务器登记完整运行包，再在后台明确选择。

服务器端登记命令为 npm run runtime:register -- --root /srv/authorized-runtime --manifest /srv/runtime-manifest.json --profile legacy-six-scenes-v1。清单逐项列出相对路径、角色、大小和SHA-256，程序不会自动扫描最新app、下载远程脚本或执行包内安装程序。登记成功不会切换当前选择或公开版本。

发布先生成并校验全部文件，再一次性切换公开版本。失败时现有发布不变；失败留下版本号空洞是正常现象。选择另一个运行包只影响之后的发布/预览，历史运行包不会被替换。

### 从结构1/2升级到3

在维护窗口停止应用写入和新构建，等待在途操作结束；先完成并验证PostgreSQL、私有data/delivery、uploads、授权bundled媒体和独立主密钥的一致备份。执行显式 npm run db:migrate，不重新初始化账号。

迁移保留历史内容和公开指针，将旧版本标记为legacy。未生成兼容交付前网页返回维护503；之后登记/选择包，在后台为当前旧版本执行“生成兼容交付”，或恢复为草稿后新发布。完成前台验证再恢复流量。数据库迁移成功不等于3D网站已经恢复可用。

兼容交付只生成一次，不代表当年原样重放。需改变包、内容或SITE_ORIGIN时发布新版本，不原地覆盖旧交付。schema3不承诺旧程序直接回滚；回退应恢复已验证的整套备份。

### 私有存储、备份与缓存

data/delivery必须持久化且不能被静态服务器或CDN直接公开。恢复时数据库、交付字节、业务媒体和主密钥必须匹配；对象缺失/损坏时从同一备份恢复，不能指向当前assets代替。

npm run delivery:audit仅输出占用和完整性诊断，不删除对象。第一版没有自动垃圾回收；注册包、历史版本和有效预览相关对象必须保留。清理属于另行确认的停机维护，不能把“不是当前公开版本”当作可删条件。

公开程序使用ETag和回源校验，不启用长期immutable缓存；后台、预览、HTML、业务媒体及错误响应不进入公共长期缓存。更换域名后，在新SITE_ORIGIN下明确新发布；旧交付不会被自动重写。
```

隔离恢复演练：维护测试实例→保存测试DB及data/media副本→恢复到另一个新建专用库/临时目录→验证对象摘要/权限/历史/预览→记录结果；不得恢复到原库或覆盖用户目录。文档中的示例root只是部署示例，实际执行必须替换为已经核对的测试目标。

- [ ] **Step 6：最终独立审查与验证记录。** 使用requesting-code-review和verification-before-completion技能审查整段diff，主代理再跑全套；记录执行提交、Node/PG版本、实际测试通过/失败/skip、包hash、浏览器证据、回滚/恢复测试、隔离目标和清理所有者。未执行项明确写“未验证”，不预填通过。只提交文档和本任务必要代码，`docs: document pinned runtime deployment and verification`。
- [ ] **Step 7：交付而非自动部署。** 展示完整变更/测试/限制，请用户选择工作区集成方式；不要自动合并、归档用户工作、推送GitHub、迁移真实库或切换3000服务。阶段C/D仍未实施。

## 规格覆盖与主代理自审

| 已批准规格 | 实施任务和验证证据 |
| --- | --- |
| 模块边界、原视觉、原内容format2 | 2、7；既有frontend/metadata及真实视觉对照 |
| 明确包来源/登记与选择分离/无包安装 | 3、6、13、14 |
| 严格补丁/程序闭包/Worker/WASM/未知依赖拒绝 | 2、3、7、12、14 |
| schema3、新旧安装、001/002不变、历史legacy标记 | 4；PG迁移和历史前后逐表比较 |
| 原始source与build projection分离、固定引用 | 1、7、8、12 |
| 私有CAS、路径安全、去重、配额、孤立对象无权公开 | 1、5、6、7、12、14 |
| 锁外构建/短事务提交/revision与selection CAS | 8、9；屏障并发测试 |
| 预留ID不setval、显式历史导入、preview不upsert | 4、8、9、10 |
| 长构建后会话锁与退出/reset竞争 | 9、10、11；实际session行锁测试 |
| legacy首次且不可替换、原始JSON/refs/published不变 | 11；竞态和引用扩权负例 |
| 页面、unsupported、generated documents全部固定 | 7、12；每入口HTTP矩阵 |
| 普通媒体授权/禁用/范围请求/S3外链仍受控 | 7、12；resources/models早注册路由回归 |
| trusted origin、缺损坏不fallback、无当前profile读依赖 | 12；改域名/改adapter/破坏CAS测试 |
| ETag授权后判定、预览private、第一版无immutable | 12；304/断库/注销矩阵 |
| 管理状态/防重复/未知网络结果不重试 | 13；VM交互和浏览器 |
| 容器私有持久化、备份恢复、无自动GC、明确未验证项 | 14 |

### 计划自审记录（设计层面，不是实现验收）

- [x] 主代理核对已批准规格全部章节与上表；未将B作为完整架构改造结束。
- [x] 运行包/交付清单、Target/Actor/Selection/Reference命名统一；SQL snake_case在仓储出口显式转camelCase。
- [x] 识别并规划旧V1测试种子冻结，未在生产加入旧schema静默绕过。
- [x] 明确测试profile只能由受信构造器注入，旧最小字符串测试改用低层patch。
- [x] 处理原始程序中的Worker能力分支、无效CSS link、unsupported外部脚本和媒体引用。
- [x] 逐入口覆盖程序、派生文档、普通媒体、早注册模型路由、ETag和错误响应。
- [x] 每个任务有文件边界、接口、失败测试、预期运行命令与提交点；所有实施步骤仍未勾选。

计划代码块是实施输入，不代表已经写入应用或运行通过。每个片段必须放入所列模块并连接已定义接口；与现场源码事实有差异时修订计划并记录原因，不能通过弱化验证使测试通过。新函数主体在对应任务中完成，已有转换按符号搬移，不复制第二套不同语义的实现。

## 执行方式选择

1. **子代理逐项实施（推荐）**：独立工作区中每个任务新实施者，完成规格符合性与代码质量两阶段审查后集成；主代理负责跨任务验证。
2. **当前代理顺序实施**：使用executing-plans分批执行，同样保留红绿测试、检查点、独立审查和工作区隔离。

状态：详细规格已由用户确认，实施计划已写出并完成主代理设计自审；尚未执行本计划、创建B实施工作区、迁移数据库或切换网站。待用户选择执行方式。

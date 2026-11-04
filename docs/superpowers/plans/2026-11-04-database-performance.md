# 数据库设计评估与性能优化方案

> **已被取代：** 请以 [项目优化方案（最新版）](2026-11-04-optimization-plan.md) 为准。本文仅保留作详细依据参考。

> 2026-11-04。前提：**公开网站的前端效果不变**。所有优化只发生在服务端，每个公开 URL 的响应字节、状态码和响应头都保持不变（唯一例外是标为「需决策」的 O8）。本文为评估与方案，尚未实施。

## 0. 结论摘要

**表结构总体合理，不需要大改。** 性能问题不在表结构，而在**读取路径**：

- 每个公开请求都把「安装状态检查」做两遍。
- 每个公开请求都重新读取、重新哈希一份**不会变化的**发布快照。
- 两个管理/媒体接口的开销随发布次数线性增长。

数据量本身很小：原站内容导入后，最大的表只有 112 kB。所以本方案以**减少重复查询、缓存不可变数据**为主，只在一处做表结构改动（O5）。

| 指标（实测） | 现状 | 优化后目标 |
|---|---|---|
| 公开页面 `/` 每次请求的 SQL 数 | 17 | ≤ 2 |
| 运行文件 / 端点每次请求的 SQL 数 | 16 | ≤ 2 |
| 旧版素材 `/assets/*` 每次请求的 SQL 数 | 9–10（读两次整份快照） | ≤ 3 |
| `/media/:id`：300 个历史版本、真实大小快照 | 22 ms，随版本数线性增长 | < 1 ms，与版本数无关 |
| 后台版本列表：100 个版本 | 709 次查询，231 ms | ≤ 5 次查询，< 30 ms |

## 1. 测量方法（可复现）

- **环境：** 本机 Docker，PostgreSQL 18；项目自带的隔离测试库（`compose.test.yaml`，tmpfs）；Node 24。
- **查询计数：** 用项目测试夹具 `tests/helpers/http.js` 搭建「安装 → 选择内置运行包 → 发布」的真实应用，包装 `store.query` 统计每个 HTTP 请求触发的 SQL。每个 URL 先预热，再连续请求 100 次取平均耗时。
- **真实数据规模：** 在本机评审实例中用原站内容包安装，统计各表和 JSON 列的大小。把真实草稿拼成快照，约 **100 KB 原文，PostgreSQL 压缩后约 34 KB**。其中 93 个资源、130 个旧路径别名、16 个作品。
- **扩展性：** 一是通过 API 实际连续发布 10/50/100 次；二是插入 300 份真实大小的快照后，用 `EXPLAIN (ANALYZE, BUFFERS)` 测量。
- 测量脚本保留在会话草稿目录，未加入仓库。实施时需要把它改写为正式的回归测试（见 §5）。

## 2. 表结构评估

### 2.1 合理之处（建议保持）

| 设计 | 评价 |
|---|---|
| 单例表用 `id boolean PRIMARY KEY DEFAULT true CHECK (id)`（installation、admins、site_settings、runtime_selection） | 数据库层面保证只有一行，比应用层判断可靠 |
| `site_settings.revision` 乐观锁，再加 `SELECT … FOR UPDATE` 串行化发布 | 防止并发编辑互相覆盖；单站点写入量很低，串行化没有性能代价 |
| 版本快照、交付制品、运行包都是不可变的（代码中没有任何 UPDATE/DELETE versions、delivery_artifacts、runtime_bundles）；摘要列都有 `CHECK (digest ~ '^[a-f0-9]{64}$')` | 可追溯、可回滚；**这也是本方案能安全缓存它们的前提** |
| `delivery_bindings` 用 `CHECK ((version_id IS NULL) <> (preview_id IS NULL))` 表达「二选一」，两列都有 UNIQUE | 约束写得严谨 |
| 应用使用非超级用户角色，`search_path=pg_catalog`，设有 `statement_timeout` / `lock_timeout` | 安全基线到位 |
| 作品、场景、音乐拆成独立表并带 `ordinal UNIQUE`，具体内容放在 jsonb | 既能保证顺序和唯一性，又不必为原站多变的字段建很多列，平衡得当 |

### 2.2 存在的问题（按影响排序）

1. **`resource_references` 是多态引用。** `owner_type` + `owner_id text` 指向 versions、previews 等不同的表，无法加外键，只能靠代码手工清理（`prunePreviews`）。这一项列为风险项，用审计脚本兜底，不建议改结构，原因见 §4。
2. **「哪些资源是文档型」没有结构化存储。** 只能在快照 JSON 里逐个展开查找，导致 O5 的全表扫描。这是唯一值得改表结构的地方。
3. **快照整份冗余存储。** 每个版本都保存完整模板（assets、legacyMap、template 约占 45 KB 原文），即使模板没有变化。100 次发布约 3.4 MB（压缩后），在个人站规模下可以接受。**不建议**为此做去重，见 §4。
4. **jsonb 不保留键的顺序。** 这已经造成了后台字段顺序错乱，即质量方案中的 A1。读取时不能依赖 jsonb 的键顺序，这是使用约束，表结构本身不用改。
5. **时间类型不统一。** `sessions.created/touched`、`login_attempts.expires` 用 bigint 毫秒，其他表用 timestamptz。只影响可读性，不影响性能，**不建议**为此做迁移。

## 3. 优化项

每一项都按以下结构写：**现实依据 → 原因 → 修改方案 → 前端不变的保证 → 验收标准**。

### O1. 安装状态在每个请求里被检查两次

- **依据（实测）：** `/` 的 17 条 SQL 中，以下 4 条**原样出现两次**：
  ```
  SELECT current_setting('server_version_num')
  SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='personal_site')
  SELECT version,checksum FROM personal_site.schema_migrations ORDER BY version
  SELECT schema_version FROM personal_site.installation
  ```
  第一次来自 [app.js](../../../admin-server/app.js) 的全局中间件 `installationStatus(store)`，第二次来自 [delivery/reader.js:10](../../../admin-server/delivery/reader.js) 的 `resolveDelivery`。`/assets/*` 和 `/media/:id` 也各有 4 条。
- **原因：** 安装状态只会在两种情况下变化：一是网页安装器完成安装（在同一个进程内发生）；二是运行 `npm run db:migrate` 升级。按文档，升级需要停服备份后在服务器上执行，执行后会重启应用。所以「已安装」状态在进程生命周期内是稳定的，每个请求都查 8 次是浪费。
- **修改：**
  1. 在 `installation.js` 中加入进程级缓存：**只缓存 `installed` 这一种状态**。其他状态（未安装、需升级、不兼容）每次都重新检查，保证安装过程和故障提示依旧实时。
  2. 安装成功（`installSite` 提交后）以及 `migrate` 执行后清空缓存。
  3. 缓存设 60 秒 TTL 作为兜底，以防有人在应用运行时手动改了库。
  4. 全局中间件把状态挂到 `req`，`resolveDelivery` 直接复用，不再查第二次。
  5. `/health/ready` **不走缓存**，保持真实探测。
- **前端不变：** 只改变查询次数，所有响应路径的分支和输出都不变。
- **验收：**
  - [ ] 回归测试：已安装站点的 `/` 不再出现上述 4 条查询；60 秒内连续请求时，这 4 条查询为 0 次。
  - [ ] 未安装和需升级状态下的 503 页面和文案，与现在逐字节一致（现有的 `tests/installation.test.js`、`tests/schema-upgrade.test.js` 通过）。
  - [ ] `/health/ready` 每次请求都会执行数据库检查（加计数断言）。

### O2. `/assets/*` 把同一份快照读两次

- **依据（实测）：** 一次 `/assets/font.png` 请求触发 9 条 SQL，其中 `SELECT * FROM personal_site.versions WHERE id=$1` **连续出现两次**。原站真实快照约 100 KB，原站一次完整访问要加载 **93 个**素材。
- **原因：** [frontend.js](../../../admin-server/frontend.js) 先调用 `resolveVersion` 拿到快照、解析别名，再调用 `resource()` → `resolvePublishedResource()`，后者又调用一次 `resolveVersion(version=id)`。按真实数据估算，原站首屏要从数据库搬运约 93 × 2 × 100 KB ≈ **18 MB** 的 JSON 并解析。
- **修改：** `resolvePublishedResource` 增加可选参数 `resolved`，传入已经取到的 `{id, snapshot}` 时直接复用，不再查询；`/api/site/:version/resources/...` 的现有调用方式不变。O3 完成后，快照本身会走缓存，这一步主要是去掉重复调用。
- **前端不变：** 别名解析、引用校验、资源状态检查的逻辑和顺序都不变。
- **验收：**
  - [ ] 回归测试：一次 `/assets/*` 请求中，`SELECT … FROM personal_site.versions` 出现次数 ≤ 1（O3 完成后为 0）。
  - [ ] `tests/frontend.test.js` 中所有 `/assets` 用例通过，响应体、状态码、响应头都一致。

### O3. 每个请求都重新读取并哈希不可变的发布数据

- **依据（实测）：** 页面请求在 O1 之外还有 9 条 SQL：
  ```
  published → versions(整份快照) → delivery_bindings → delivery_artifacts → runtime_bundles
  → versions(再读一次快照，checkTarget) → resource_references → delivery_artifacts → runtime_bundles
  ```
  每个请求还要对快照做 2 次规范化 JSON + SHA-256（`resolveDelivery` 一次，`checkTarget` 一次）。用真实大小的快照实测，**每次 0.64 ms，每个请求约 1.3 ms CPU**，另外还要对 manifest 和引用列表各算一次哈希。页面、运行时程序、端点请求（`/api/site/:version/*`）都走这条路径。
- **原因：**
  - 版本快照、交付制品（以摘要为主键）、运行包（以摘要为主键）在代码中**从不更新、从不删除**。
  - 版本的交付绑定也只会从「待生成（artifact_digest 为空）」变为「已固定」一次（`bindLegacyOnce` 带 generation 条件）。
  - 因此，给定一个版本号，校验通过的结果在进程内是确定的。每个请求重新读取并重新哈希，只是为了防止数据库被人篡改；这个目的用「首次加载时校验 + 定期重新校验」就能达到。
- **修改：**
  1. 新增 `delivery/cache.js`：按 `version id` 缓存 `{snapshot, binding, manifest, references}`，**只在全部校验通过、并且绑定已固定（artifact_digest 非空）时才写入缓存**。
  2. 用 LRU 限制容量（默认 16 个版本）。每个缓存项设 TTL（默认 5 分钟），过期后走完整校验路径。这样仍然保留定期发现数据库被篡改的能力。
  3. 每个请求仍然查一次 `SELECT published FROM site_settings`（主键查找，约 0.01 ms）。这样多实例部署时发布切换依旧即时，不依赖进程间通知。
  4. **预览（`preview-*`）不缓存**：预览是私有的，并且绑定到具体所有者，保持现有的每次校验。
  5. 运行包选择变化时，不需要清除版本缓存，因为已发布版本绑定的是自己的制品摘要，与当前选择的运行包无关，这和现有语义一致。
- **前端不变：** 缓存保存的就是现有路径读出来、并已校验过的同一份数据；响应体由同样的 `readDeliveryFile` / CAS 生成。
- **验收：**
  - [ ] 回归测试：缓存预热后，`/` 和端点请求的 SQL ≤ 2 条（published，以及必要时的 session）；请求路径中不再调用 `digestJSON`（用计数桩断言）。
  - [ ] 篡改测试：直接用 SQL 修改 `versions.snapshot`，TTL 过期后请求返回 503，与现在篡改后的行为一致；TTL 内的行为在文档中写明。
  - [ ] 发布新版本后，下一个请求立刻返回新版本的内容（无需等待 TTL）。
  - [ ] 「黄金对比」测试：对一组固定 URL（页面、运行时程序、端点、资源），记录优化前后的状态码、响应头和 SHA-256(body)，结果完全一致。
  - [ ] 连续请求 `/` 100 次，平均耗时比基线 6.1 ms 下降 ≥ 50%（同机、同测试库）。

### O4. 素材请求的资源检查合并为一条查询

- **依据（代码 + 实测）：** O1–O3 完成后，`/assets/*` 还剩 `resource_references`（缓存可以覆盖）、`resources WHERE id`、`storages WHERE id`（S3 或本地资源）三条查询。
- **原因：** 资源会被放入回收站、存储可能被禁用，这两项状态必须实时检查，**不能缓存**；但可以合并成一次查询。
- **修改：** 在 `resourceRepository` 中新增 `getLive(id)`：
  ```sql
  SELECT r.*, s.available AS storage_available
  FROM personal_site.resources r
  LEFT JOIN personal_site.storages s ON s.id = r.storage_id
  WHERE r.id = $1
  ```
  `assertLiveResource` 改用这个结果判断。引用检查改用 O3 缓存中的引用列表。
- **前端不变：** 判断条件逐项不变（回收站、missing/disabled/failed、存储不可用都返回 404）。
- **验收：**
  - [ ] `/assets/*` 每次请求的 SQL ≤ 3 条（published、getLive，以及有 Cookie 时的 session）。
  - [ ] 资源放入回收站、存储设为不可用后，下一个请求立即返回 404（现有测试通过，并新增一个「缓存预热后放入回收站」的用例）。

### O5. `/media/:id` 每次请求都扫描所有历史快照（唯一的表结构改动）

- **依据（实测）：** [frontend-resources.js](../../../admin-server/frontend-resources.js) 中的 `rejectTargetlessDocument` 会对所有 versions 和 previews 执行 `CROSS JOIN LATERAL jsonb_each(snapshot->'assets')`。
  - 用真实大小的快照（压缩后约 34 KB），300 个版本：执行 **22.0 ms**，读取 **2102 个缓冲页**（需要把每份快照从 TOAST 中解压出来），执行计划为 `Seq Scan` + 300 次 `Function Scan on jsonb_each`。
  - 耗时与版本数成正比。这个函数在**公开的** `/media/:id` 每次请求中都会执行（[routes/media.js:23](../../../admin-server/routes/media.js)），也在模型接口中执行（[models.js:151](../../../admin-server/models.js)）。
- **原因：** 「资源 X 是否在某个版本或预览中被当作文档使用」这个信息只存在于 JSON 内部，数据库无法用索引查找。由于快照不可变，这个信息可以在**写入快照时**算好，结构化地存下来。
- **修改：**
  1. 新增迁移 `004-document-references.sql`：
     ```sql
     ALTER TABLE personal_site.resource_references
       ADD COLUMN document boolean NOT NULL DEFAULT false;
     -- 回填：从现有快照中标记文档型引用
     UPDATE personal_site.resource_references r SET document = true
     FROM (
       SELECT 'version' AS owner_type, v.id::text AS owner_id, a.value->>'resourceId' AS resource_id
       FROM personal_site.versions v, jsonb_each(v.snapshot->'assets') a WHERE a.value ? 'document'
       UNION
       SELECT 'preview', p.id, a.value->>'resourceId'
       FROM personal_site.previews p, jsonb_each(p.snapshot->'assets') a WHERE a.value ? 'document'
     ) d
     WHERE r.owner_type = d.owner_type AND r.owner_id = d.owner_id AND r.resource_id = d.resource_id;
     CREATE INDEX resource_document_refs ON personal_site.resource_references(resource_id)
       WHERE document AND owner_type IN ('version','preview');
     ```
     回填只在迁移时执行一次，后续写入由代码维护。
  2. `collectReferences` 为文档型资源产生 `document: true`，`replaceReferences` 写入该列。
  3. `rejectTargetlessDocument` 改为：
     ```sql
     SELECT 1 FROM personal_site.resource_references
     WHERE resource_id = $1 AND document AND owner_type IN ('version','preview') LIMIT 1
     ```
  4. 按 [migration-registry.js](../../../admin-server/migration-registry.js) 的要求登记新的结构签名；在 `docs/POSTGRESQL-MIGRATION.md` 中说明升级步骤（备份 → 停服 → `npm run db:migrate` → 启动）。
- **为什么选择加一列，而不是新建一张表：** 判断依据就是「某个所有者引用了某个资源」，与现有引用表的粒度完全一致。加一列可以复用现有的写入和清理路径（`prunePreviews` 删除引用时会自动带走这一列），不会产生新的孤儿数据。
- **前端不变：** 判断的语义完全一致（任何版本或预览把该资源当作文档使用，就拒绝无目标访问）。
- **验收：**
  - [ ] 迁移测试：在含有文档型资源的旧库上执行迁移后，回填结果与旧 SQL 的判断**逐个资源一致**（用新旧两条查询对所有资源 id 做对比）。
  - [ ] 300 个真实大小版本下，新查询的 `EXPLAIN ANALYZE` 显示走 `resource_document_refs` 索引，执行时间 < 1 ms，并且不随版本数增长。
  - [ ] `tests/schema-upgrade.test.js` 覆盖从 003 升级到 004 的路径；`tests/delivery-legacy.test.js`、`tests/model.test.js` 通过。
  - [ ] 回滚说明：004 只是加列和索引；回滚等于恢复备份，在文档中写明。

### O6. 后台版本列表的 N+1 查询

- **依据（实测，通过 API 实际发布）：**

  | 版本数 | 查询数 | 耗时 |
  |---|---|---|
  | 10 | 79 | 37 ms |
  | 50 | 359 | 141 ms |
  | 100 | 709 | 231 ms |

  每个版本固定 7 条查询。测试夹具的快照只有 1.4 KB；换成原站 100 KB 的快照后，`listVersions` 的 `SELECT *` 加上逐版本的 `checkTarget` 会读出约 2 × 100 × 100 KB ≈ 20 MB，并计算 200 次快照哈希。
- **原因：**
  - `listVersions()` 用 `SELECT *`，读出所有快照，而列表只需要 id 和创建时间。
  - [admin-routes.js:50](../../../admin-server/delivery/admin-routes.js) 在循环里对每个版本调用 `summaries([id])`，这个函数内部又对每个版本执行完整的 `getBinding` 校验。
- **修改：**
  1. 新增 `listVersionHeaders()`：`SELECT id, created FROM personal_site.versions ORDER BY id DESC`。`listVersions()` 保留，供需要快照的调用方使用。
  2. 绑定和制品用一条查询批量取出：
     ```sql
     SELECT b.version_id, b.mode, b.generation, b.artifact_digest, a.manifest->>'origin' AS origin
     FROM personal_site.delivery_bindings b
     LEFT JOIN personal_site.delivery_artifacts a ON a.digest = b.artifact_digest
     WHERE b.version_id = ANY($1)
     ```
  3. 列表上的状态（已固定 / 待生成 / 未选包 / origin 不匹配）由这条查询计算。**完整性校验**通过 O3 的缓存复用；对没有缓存的版本，只在用户点开详情或执行恢复操作时做完整校验。
- **前端不变：** 公开站点不受影响；后台列表的字段和状态文案不变。
- **验收：**
  - [ ] 100 个版本时，`GET /api/admin/versions` 的查询数 ≤ 5、耗时 < 30 ms，并且查询数不随版本数增长。
  - [ ] 损坏的绑定（mode 非法、制品缺失）在列表中仍显示「缺失/损坏」或「不支持」（现有测试通过）。
  - [ ] 响应 JSON 的结构与现在完全一致（快照对比测试）。

### O7. 保存草稿时整表删除再逐行插入

- **依据（代码）：** [repositories/content.js](../../../admin-server/repositories/content.js) 的 `writeLists`：先读取 projects、songs，然后对 3 张表执行 `DELETE`，再逐行 `INSERT`。按原站数据量（6 个场景 + 16 个作品），一次保存约 27 条语句，每次保存还会产生约 22 个死元组。
- **原因：** 逐行插入意味着一行一次网络往返。草稿保存频率很低，所以这一项**优先级低**，但改起来简单、风险小。
- **修改：** 每张表改为一条批量插入，`ordinal` 和 id 的计算逻辑保持不变，仍然在 JS 中完成：
  ```sql
  INSERT INTO personal_site.projects(id, slug, ordinal, content)
  SELECT * FROM unnest($1::text[], $2::text[], $3::int[], $4::jsonb[])
  ```
  `DELETE` 加批量插入仍然放在同一个事务中，与现在一致。
- **前端不变：** 写入的数据完全一致。
- **验收：**
  - [ ] 保存 16 个作品的草稿时，语句数 ≤ 8。
  - [ ] 保存后 `getDraft()` 的结果与优化前逐字节一致；作品 id 和音乐 id 的保留规则不变（`tests/repositories.test.js` 通过）。

### O8.（需决策）素材的 HTTP 缓存策略

- **依据（实测）：** `/assets/*`、`/media/:id`、页面的响应头都是 `Cache-Control: no-store`。原站共 93 个素材，回访用户每次都要全部重新下载，每次也都要经过上面的数据库路径。
- **说明：** 这一项**不是数据库优化**，但它对数据库负载和前端加载速度的影响最大。它会改变「资源被放入回收站后能否立即撤回」的语义。项目现在刻意使用 `no-store`，代码注释中写着「conditional GET is reserved for CAS programs」，所以列为**需要所有者决策**，不纳入默认实施。
- **可选方案：** 只对**带版本号的**地址 `/api/site/:version/resources/:id/:fileName` 设置 `Cache-Control: public, max-age=86400`。这个地址的内容由版本号和资源 id 唯一确定。`/assets/*` 别名和 `/media/:id` 维持 `no-store`。
- **验收（如果采纳）：**
  - [ ] 只有上述路径的响应头改变，响应体字节不变。
  - [ ] 文档中说明：资源放入回收站后，浏览器中已缓存的副本最长保留 24 小时。

## 4. 评估后不建议做的事

| 提议 | 不建议的原因 |
|---|---|
| 快照按内容去重（单独建快照表，按摘要引用） | 100 次发布只占约 3.4 MB；会破坏「版本行自包含、可单独审计」的设计，还要重写发布、导入、迁移和交付校验，收益和风险不成比例 |
| 给 `resource_references` 加多态外键或拆成多张表 | 需要大迁移；现在代码已在事务中维护引用，用审计脚本兜底性价比更高（见下方「顺带项」） |
| 普遍加索引 | 除 O5 外，热点查询都是主键或唯一键查找（实测 0.01–0.02 ms）；表只有几十到几百行，额外索引只会增加写入开销 |
| 引入 Redis / 物化视图 | 单站点、单进程的场景下，进程内缓存已经足够；新增组件会增加部署复杂度 |
| bigint 时间戳统一改成 timestamptz | 纯粹为了美观，不带来性能收益，还会有迁移风险 |
| 调整连接池或 PostgreSQL 参数 | 现有的 `max=8`、超时设置与负载相符；O1–O4 完成后，查询数还会下降一个数量级 |

**顺带项（低成本，不影响性能）：** 在 `npm run delivery:audit` 中增加一项孤儿引用检查：找出 `resource_references` 中 owner 已不存在的行，只报告、不自动删除。

## 5. 实施顺序与总体验收

| 顺序 | 项 | 是否改表结构 | 风险 |
|---|---|---|---|
| 1 | 先写「黄金对比」测试和查询计数测试，固化当前输出 | 否 | 无 |
| 2 | O1、O2 | 否 | 低 |
| 3 | O3、O4 | 否 | 中（缓存失效逻辑） |
| 4 | O6、O7 | 否 | 低 |
| 5 | O5 | **是（迁移 004）** | 中（需要备份后升级） |
| 6 | O8 | 否 | 等待决策 |

**总体验收：**
- [ ] 把评审中的测量脚本改写为 `tests/db-request-cost.test.js`，用测试断言固定 §0 表格中的目标值，防止性能退化。
- [ ] 「黄金对比」测试：O1–O7 前后，所有公开 URL 的状态码、响应头和 SHA-256(body) 一致。
- [ ] `npm test` 全部通过，CI 全绿。
- [ ] 在本机 Docker 栈上用原站内容包、原站运行包复测：首屏加载正常，浏览器控制台没有错误，3D 场景和交互与优化前的截图一致。**这一步需要授权的原站素材，目前评审环境中没有**，必须由所有者执行。
- [ ] 在 `docs/verification/` 中记录优化前后的查询数和耗时，并注明测量环境。

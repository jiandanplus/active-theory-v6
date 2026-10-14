# 阶段 B：固定运行包交付验证

日期：2026-10-15（Asia/Shanghai）。执行工作区：隔离 `feat/engine-delivery`，Task 14 输入提交 `48afdb4e6bfe551bd7fe3de50cd3ec2830b99fac`。本页记录实际证据，不是生产部署证明。Task 14 提交本身以 Git 历史为准；提交后的独立任务审查、整分支审查及主代理重新全量测试尚需另记，不能预填通过。

## 范围和来源

Node 24.14.0、专用 PostgreSQL 18.4（父代理拥有 `site-pg-test-db-1`、网络 `site-pg-test_default`、回环 55432）。测试入口创建并清理自身 `site_test_<32hex>` 数据库；不回退真实 DATABASE_URL。原工作区只读授权范围：明确 11 程序文件、公开 UIL、assets 前台素材，及后续明确的 room/、bush.bin/、三个 CMS JSON 的只读检查。没有使用真实 `.env`、业务库、uploads、S3、当前 3000 服务；CMS 个人值不复制到报告/夹具。

原始程序与生产 profile 身份的 SHA-256 是受信 profile 的 11 项固定值；测试使用 `AUTHORIZED_RUNTIME_ROOT` 显式指向已授权源，未按最新文件扫描，也未把源程序/assets/unsupported.html 提交到 Git 或镜像。合成 six-scene builder 测试证明生产补丁/交付契约，不证明媒体实际解码或原视觉。

本轮再次以受限 `readSource` 读取下表各文件并计算摘要（Node 命令 exit 0）。完整 manifest digest：`022b56b790f0cb54ac8e1d7228f9506fa06e7f577220bf82727785424ca754b7`，profile `legacy-six-scenes-v1`，template `six-scenes`。

| 明确输入相对路径 | bytes | SHA-256 |
| --- | ---: | --- |
| index.html | 8016 | 77f7062badb10b5110c069d8fdab0b3b5d619fa9969cbdd471720d9209232d98 |
| unsupported.html | 1834 | 6aae50dbeb1dbcb2620575a3f26142f9cc91d37e5f6216603d69d165351b6953 |
| assets/js/app.1778129964370.js | 2025841 | 1081e211f6301554d2311ca40205f5025a91102759eaa5f0a80dc5870e1ed689 |
| assets/js/modules.1778129964370.js | 24 | e0346e49f92d5db8ad9d9b8e49c61ad52cd2b3994c28e598f4dec548a628cc3c |
| assets/js/hydra/hydra-thread.js | 13213 | c1133f09166fcb4c5e338040ef08189c60dcbca41e7057a18c5e098ecc5988cd |
| assets/js/lib/basis_transcoder.js | 62504 | dee6fa695014e9c2f0370b6c1f052ebfaf7e11a55143be20b8a77ebc33e1c127 |
| assets/js/lib/basis_transcoder.wasm | 474559 | 5e456711b9a87288a13d8baf4a0312d1ed2edd2f8f99073b07013466215e7e18 |
| assets/js/lib/_draco/draco_wasm_wrapper.js | 58916 | b93f6384147828f857456c84845f4dbceada5b7a8455991109c853e236a1f018 |
| assets/js/lib/_draco/draco_decoder.wasm | 283091 | 0103c8bff79532c2f1a496dd9ea0764ac692ed8585d9136596ef9f043873a61f |
| assets/js/lib/qrious.js | 17579 | db99dcaf40a926181bce4522477c2efc5924f6c4b29111b6a97faea477c9528b |
| assets/shaders/compiled.vs | 270305 | e2cf6406b30f86ab838b000cc3313e4de520e60484b1eb6402ba0016c09c8f98 |

## 自动化结果（本次提交的应用代码）

所有实际 shell 命令前缀 `/Users/jiandan/.cargo/bin/rtk proxy`，cwd 为隔离工作区。测试共同环境前缀如下，既清除生产/外来测试变量又固定 Node：

```sh
env -u DATABASE_URL -u TEST_DATABASE_URL -u TEST_DATABASE_CONFIRMED \
  AUTHORIZED_RUNTIME_ROOT=/Users/jiandan/Code/MyCode/active-theory-v6 \
  PATH=/Users/jiandan/.nvm/versions/node/v24.14.0/bin:$PATH
```

| 实际命令（省略上述固定前缀） | exit | pass / fail / skip | 证明范围 |
| --- | --- | --- | --- |
| `node scripts/test-postgres.js tests/delivery-audit.test.js`（RED） | 1 | 0 / 6 / 0 | 未实现模块，6 项 MODULE_NOT_FOUND；先修正一处受 SQL CHECK 拒绝的故障夹具后重新观察 RED |
| `node scripts/test-postgres.js tests/delivery-audit.test.js tests/delivery-cas.test.js`（GREEN） | 0 | 23 / 0 / 0 | 审计零写入/保留/损坏、CAS 原有安全规则 |
| `node scripts/test-postgres.js tests/delivery-audit.test.js tests/delivery-cas.test.js tests/deployment.test.js` | 0 | 33 / 0 / 0 | 扩展坏身份/大小冲突/扫描竞态、只读祖先安全、容器路径断言 |
| `node --test tests/delivery-contracts.test.js tests/delivery-cas.test.js tests/runtime-patches.test.js tests/runtime-profile.test.js tests/runtime-paths.test.js tests/delivery-builder.test.js tests/admin-ui.test.js tests/metadata.test.js tests/site-identity.test.js` | 0 | 110 / 0 / 0 | 实际授权 11 输入启用；合成 six-scene、Worker realm 与 metadata/管理 UI 回归 |
| `node scripts/test-postgres.js` | 0 | 473 / 0 / 0 | 全量（40.44 秒）；非仅纯函数，无 PG/worker 跳过 |
| `shasum -a 256 admin-server/migrations/001-initial.sql admin-server/migrations/002-site-identity.sql` | 0 | 2 个匹配 | 不可变迁移 |
| `docker compose -p site-pg-test -f compose.test.yaml config --quiet` | 0 | 配置有效 | 不代表应用已上线 |
| `git diff --check` | 0 | 无空白错误 | 执行时工作树 diff |

固定 SQL 摘要：001 `bba88a72df8e7166646fdc56e6485c36078bf7e7fe4077125fdd7ebc682d2a15`；002 `98fca286a9790bff1b10a74719c820f15e3d66b5054c459f87057b34151c7533`。

父代理独立预提交复核相同 audit/CAS/deployment 三文件测试：33 pass / 0 fail / 0 skip、exit 0、5.68 秒；这是已观察到的 focused gate，不是后续独立任务审查/全分支审查/最终全套。其确认应用文件摘要：delivery-audit.js `07b5a8f0cac67598d933ad7fe8789e2bcd59994e455b0df052aba938f07a4eea`，cas.js `449c50a2fa8e57c3756d807b316b89f85d3472790c7f560751ca63f4f88bc01a`。

运维文档的完整清单生成示例已抽取并实际执行（`node -`，相同授权 root，exit 0），得到上述 11 项/digest。唯一生成目标为 owned temporary `/private/var/folders/yk/yvtck8_x19d256zbmlrh20xc0000gn/T/task14-docmanifest-YfdOVb/manifest.json`；随后精确 unlink 文件/rmdir 目录成功，无原输入修改。

全套包括输入缺失/profile失败/CAS写失败及损坏、revision/selection竞争、资源/存储失效、会话撤销、artifact/binding/audit SQL 回滚、并发首次 legacy、sequence 逆序、未知清单、旧 Origin 与 conditional GET 断库。具体命名用例保留于 tests/；这不是实际浏览器/GPU检查的替代品。

## 只读审计验收

`auditDelivery` 的数据库扫描在 repeatable-read/read-only 事务中；保留全部 runtime 和全部 artifact，不按 binding/preview 过滤。临时真实 CAS 的对象和 staging 调用前后 bytes/hash/mtime 完全一致；data 下缺 delivery、缺 objects、缺 staging 三种情况无创建。缺对象单列摘要；存在但损坏的引用对象/孤立对象列 invalid；unsafe/未知文件/巨型孤立对象/数据库或清单错误/扫描中消失均通用安全错误，不产出误导性完整计数。CLI 必须已安装 schema 3，finally 关闭 pool，不迁移/构建/修复。

## 容器、浏览器与一致恢复

实际执行者：独立隔离验收子代理，主实现者核读证据，父代理再次抽核（不是重演整个环境）。以下均非生产 TLS 验证。

| 门禁 | 实际结果与限制 |
| --- | --- |
| 镜像构建/身份 | `docker build -t personal-site-phase-b-task14-acceptance .` exit 0；最终 image `sha256:d0a84e28b363cb614d7d102aca4dddfce355ce153a4256eb00c56ad2576ddbc2`。镜像内 audit/CAS/package/001/002 SHA 与冻结工作树相同；文档后续修改不改变应用逻辑。默认 `node` 非 root 用户。 |
| 明确 bootstrap 协议门禁 | `/acceptance/bootstrap.cjs` 调用 createApp，显式 synthetic root、private data、测试 DB、`production:false`、固定 owned origin `http://127.0.0.1:61852`；不是 server.js 默认配置路径，不读取宿主真实 `.env`。原始授权文件只读读取后复制到自有临时目录；整个临时目录通过普通可写 bind 挂载 `/acceptance`（不是原始源挂载，也未声称 mount 为 read-only）。使用自建 six-scene/空业务内容，正常 HTTP 安装预检和安装。 |
| 默认入口单独 smoke | 同一镜像 `node server.js` 默认 CMD，另一个测试 env/空私有 data/随机 DB、回环 51059，NODE_ENV=development。9 项真实请求：setup/status 与 admin 200 → authorize/preflight 200 → install 201 → login/runtime 200（包列表空）→ publish 422 → home 503。预检如实报告 12 个必需引擎资源缺失，仍可安装后台，不是可用模板/渲染器。未修改生产 HTTPS guard。 |
| 安装/登记/选择 | 浏览器正常安装与登录；无包提示和拒绝可见。实际 11 程序登记成功但不自动选择，显式 UI 选择成功。程序包 3,215,882 字节，digest 见上表。登记本身不生成模板、字体或媒体。 |
| 已知夹具修正 | 两个 manifest.json 图标未复制导致首次发布 422；补入确切授权 PNG、另建新 DB 后重走正常 HTTP 安装。没有 SQL 修改 readiness 或删除必需引用。另有 7 个缺失字体 fallback 用明确自建 SFNT/WOFF 及授权 WOFF2 同格式副本作测试字体；3 个唯一编码分别 FontFace.load 成功，不能说原字体恢复。 |
| 内容 A/B 与持久化 | 同一固定生产包发布不同内容 A/B；17 个 A endpoint 后续 hash 不变、B config hash 不同。app 内容相同可去重，worker 包含 target 因而 A/B digest 不同。生产 profile 固定全部 11 hash，本容器并没有制造不同程序包 B；跨包 A/B 是独立自动化矩阵的证据。 |
| 预览/私有路径 | 17 个预览依赖及 HTML private/no-store/noindex；退出后延迟 worker 401。直接 delivery/objects、staging、manifest 私有路径 404。 |
| 双击/未知结果 | 浏览器双击确认只发 1 次 publish POST。人为丢弃服务端已提交的响应，显示结果未知且没有自动重试；历史可见已提交 v6。**错误后焦点缺口见下节，不能称全部 UI 验收通过。** |
| 浏览器运行能力 | 实际 Basis/Draco WASM 的 WebAssembly.compile 成功；固定版本 Hydra Worker 在独立线程创建、500ms 内无 error 后 terminate。仅证明编译/加载，不是 Basis/Draco 场景解码。 |
| unsupported | 新受限 browser context 禁用 WebAssembly，跳至 `/api/site/6/unsupported.html`；6 个请求均同版本 owned origin、200，无外部 gtag、ES5 或 JS decoder 请求。 |
| 一致备份/恢复 | 停止 owned app 后 pg_dump -Fc、pg_restore --list、文件归档、恢复到另一个新 DB/新 root：全部 exit 0。dump 95,425B，SHA `3bbd0cc73cd0c0029f1727f8a89af437f52b3b82c5600ee86531dc68539a99a1`；文件 archive 9,507,090B，SHA `5058875b3cf23efea435af256ac78f176ffe38f5423443ab5452f48e317fe4b2`。126 文件 SHA/权限模式相同，包含 data/媒体，测试密钥 env 随一致备份恢复，未输出值。 |
| 重建/恢复复核 | 同 DB/data 重建与新 DB/root 恢复分别验证 34 个版本资源 hash、6 项历史、认证预览 200/匿名 401、私有路径 404。两份 38 行 HTTP 证据完全一致（200×36/401×1/404×1）；父代理独立抽核一致。源/恢复按顺序使用同一个 owned origin，不假装异域旧绑定可用。 |
| 恢复后 audit | 76 objects、6,066,245 bytes，全部 referenced，missing/invalid 均空；早期协议 checkpoint 为 64 objects、5,973,881 bytes，后续预览/发布增加对象是预期。 |

### 证据位置、操作偏差和清理

完整原始命令/exit、夹具生成代码、SHA 和结果为本地非 Git 证据：`<original-repo>/.git/worktrees/active-theory-v6/sdd/task-14-acceptance-report.md` 及同级 `task14-acceptance-evidence/`。后者包括 `backup-commands.json`、`backup-summary.json`、`backup-inventory.json`、`http-protocol.json`、`http-recreate-verify.json`、`http-restored-verify.json`、`http-default.json`、`browser-requests.log`、`image-file-sha256.log`、`cleanup.json`。保留的是无口令/会话 header 的文本与截图，实际授权媒体、test.env、数据库 dump 不入 Git。

镜像内 Node 为 24.21.0，宿主执行测试/夹具为 24.14.0，PG 工具为 18.4。`browser-requests.log` 只保存最后 unsupported 导航（CLI 导航后重置清单），不是整场累计请求日志；早期 UI 请求是现场观察加保留快照，不能称完整网络 trace。外部 harness 源码只含固定虚假测试凭据默认值，禁止整个目录直接提交。

重点证据 SHA-256：两个 recreate/restored HTTP JSON 同为 `9b036a2f1a935c72426b24d7bdb9615d0f5cd63005dc46f59c3e8e1718f7b9a9`；126-file inventory 为 `1e97f1638bb2f07d74a1a8bcebad0edb28d1ee90789665dde3bec5ecf1f74d1a`；默认 CMD HTTP JSON 为 `8514fed7f0d7bcd6474499aa01a78a65d445e0e1262b7889b9040be6bc680239`。

最初 Playwright CLI 路由限制命令用了不兼容语法，限制失败后同一组命令仍访问了 owned admin URL。该偏差保留记录，当时现场请求清单未见非 owned 请求，但初始 session 关闭后重新导出 requests 失败（exit 1），没有保留其完整日志；随后关闭旧 session、新建 named session，并在单独命令确认请求限制成功后才 goto，后续 UI 验收使用新 session。只允许确切验收 origin，未使用现有浏览器或当前 3000。另有读取 RTK 指引前的一次只读 pwd 未加前缀，执行者如实披露，无修改。

清理所有者为验收执行者，仅删除自己创建的 `task14-acceptance-61852`、`task14-restored-61852`、`task14-default-51059`（exit 0），owned 镜像/tag 及 `/tmp/task14-acceptance.8fhLWt`；移除测试密钥、session、授权副本、dump/archive，仅保留安全证据。四个 owned DB 均 DROP 成功、剩余计数 0：

```text
site_test_7df1584c865e44838de3a502887390c6
site_test_9135f9ac429a4b9586485fdb6f491ed9
site_test_e28b171344884f4d8471ef09e971ade5
site_test_04bdc7c4c66f41f28c0962abcfda1a74
```

父代理另行检查 `docker ps -a --filter name=task14-` 为空。共享 `site-pg-test-db-1`/网络/控制库未删除，仍由父代理负责最终清理。无源目录删除/覆盖，也未停止其他容器。

### 尚未通过的 UI 验收

无包的客户端拒绝快照将发布按钮标为 active；但服务器 422 和已提交响应被丢弃、显示“结果未知”后，按钮重新可用，快照却标外层 generic 为 active，操作按钮未标 active。**没有单独捕获 `document.activeElement` 测量，不据此断言 DOM 焦点必定为 body**；这里是待独立复现的焦点恢复疑点，不能写为通过。

证据目录：`output/playwright/task14-acceptance-61852/.playwright-cli/`。422：点击 f2e75、确认 f2e90，`page-2026-10-14T17-24-29-983Z.yml`；未知结果：点击 f3e97、确认 f3e153，`page-2026-10-14T17-28-57-688Z.yml`。后者下一历史画面截图为 `page-2026-10-14T17-29-05-006Z.png`，不是精确错误状态截图；未捕获的截图不能补称存在。客户端拒绝对照为 `17-23-59-927` 快照，f1e199 active。fresh fixer 应先在真实 DOM 测量确认原因。未知结果历史确有提交且未自动重试，不是提交结果判断失败。

父代理要求保持本次应用代码冻结：先提交证据，由独立 Task 14 审查评估，再派 fresh fixer 做窄修与覆盖测试。本提交不能标为“所有验收通过/最终可交付”。

## 明确未验证/阻塞

- 获准检查的原始公开 UIL/assets 输入解析到九个缺失几何路径：tree_room/{tree_leaves,tree_trunk,water}.bin、room/{floor,walls,prop,land,light}.bin、bush.bin/caustic_plane.bin；另 27 个 image-extension 文件实为 HTML。新增授权检查的原 root room/、bush.bin/ 也不存在。这里说的是本次获准输入，不是未检查的在线网站、真实 DB 或 uploads 状态。
- 27 个 HTML-as-image 中 26 个为 5,946 字节、SHA-256 `2833fe4610c80e412fcd5afcc64195a505d71ae131ed69b966e0a39f3701cdf2`；home/matcap3.jpg 为 5,952 字节、`e026e78b8db8823da1d2256fd7b011aa016b971d2bbd64e72e98f440f46626d5`。未下载替代、未改 UIL 引用/禁用 readiness、未用合成几何冒充保真。
- 因此原六场景、Logo、黑洞轮廓、粒子尺寸/反射/流动的 baseline/candidate 视觉对照仍阻塞，不能用实际 11 程序通过或 HTTP 200 代替。原歌曲和 CMS-linked 外部媒体未验证；没有搬运私有 CMS 内容。
- 真正 Basis/Draco 场景解码、浏览器 GPU表现与流畅度必须与 HTTP 请求/Worker 独立线程/WASM 编译证据分别列明，不自动推定。
- 实际浏览器 Work A/B/About/Contact/前进后退导航、原空内容引擎生命周期、旧 schema 升级后 legacy 按钮及 origin 变化、另一 owner/expiry/reset 的浏览器门禁未执行。相应自动化协议测试是另一证据层，不能称本轮浏览器都通过。
- S3 私有签名 URL、真实外链公网可读性/CORS、CDN、生产 HTTPS、目标服务器、正式迁移/回滚/切流均未执行。无合并、推送、部署、自动 GC；C/D 未实施。

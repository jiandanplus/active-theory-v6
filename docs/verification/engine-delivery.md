# 阶段 B：固定运行包交付验证

日期：2026-10-15（Asia/Shanghai）。执行工作区：隔离 `feat/engine-delivery`，Task 14 输入提交 `48afdb4e6bfe551bd7fe3de50cd3ec2830b99fac`。本页记录实际证据，不是生产部署证明。最终应用代码为 `a00cd397c61b4b8dabf2b564ebb29f62e27a1aa9`；14 项任务复核、整分支独立审查、主代理全量测试与新镜像身份检查已完成，见末节。下文按时间保留早期结果和已关闭问题；原视觉与明确未验证项仍未解除。

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

## 自动化结果（Task 14 焦点修复前的阶段记录）

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
| 双击/未知结果 | 浏览器双击确认只发 1 次 publish POST。人为丢弃服务端已提交的响应，显示结果未知且没有自动重试；历史可见已提交 v6。此轮暴露的焦点缺口已在后续窄修与复审中关闭，但仍不能称全部浏览器矩阵通过。 |
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

该轮结束时，父代理另行检查 `docker ps -a --filter name=task14-` 为空。共享 `site-pg-test-db-1`/网络/控制库当时保留，由父代理负责最后清理（最终结果见末节）。无源目录删除/覆盖，也未停止其他容器。

### 早期 UI 验收缺口（后续已修复）

无包的客户端拒绝快照将发布按钮标为 active；但服务器 422 和已提交响应被丢弃、显示“结果未知”后，按钮重新可用，快照却标外层 generic 为 active，操作按钮未标 active。**这一轮没有单独捕获 `document.activeElement` 测量，不据此断言 DOM 焦点必定为 body**；当时作为待独立复现疑点记录，后续实测、修复和复审见下文，不改写早期证据强度。

证据目录：`output/playwright/task14-acceptance-61852/.playwright-cli/`。422：点击 f2e75、确认 f2e90，`page-2026-10-14T17-24-29-983Z.yml`；未知结果：点击 f3e97、确认 f3e153，`page-2026-10-14T17-28-57-688Z.yml`。后者下一历史画面截图为 `page-2026-10-14T17-29-05-006Z.png`，不是精确错误状态截图；未捕获的截图不能补称存在。客户端拒绝对照为 `17-23-59-927` 快照，f1e199 active。fresh fixer 应先在真实 DOM 测量确认原因。未知结果历史确有提交且未自动重试，不是提交结果判断失败。

当时父代理要求冻结应用代码，先提交证据，经独立 Task 14 审查后派 fresh fixer 做窄修。该流程已完成；不能把这一问题的关闭扩大为“所有验收通过”。

## 明确未验证/阻塞

- 获准检查的原始公开 UIL/assets 输入解析到九个缺失几何路径：tree_room/{tree_leaves,tree_trunk,water}.bin、room/{floor,walls,prop,land,light}.bin、bush.bin/caustic_plane.bin；另 27 个 image-extension 文件实为 HTML。新增授权检查的原 root room/、bush.bin/ 也不存在。这里说的是本次获准输入，不是未检查的在线网站、真实 DB 或 uploads 状态。
- 27 个 HTML-as-image 中 26 个为 5,946 字节、SHA-256 `2833fe4610c80e412fcd5afcc64195a505d71ae131ed69b966e0a39f3701cdf2`；home/matcap3.jpg 为 5,952 字节、`e026e78b8db8823da1d2256fd7b011aa016b971d2bbd64e72e98f440f46626d5`。未下载替代、未改 UIL 引用/禁用 readiness、未用合成几何冒充保真。
- 因此原六场景、Logo、黑洞轮廓、粒子尺寸/反射/流动的 baseline/candidate 视觉对照仍阻塞，不能用实际 11 程序通过或 HTTP 200 代替。原歌曲和 CMS-linked 外部媒体未验证；没有搬运私有 CMS 内容。
- 真正 Basis/Draco 场景解码、浏览器 GPU表现与流畅度必须与 HTTP 请求/Worker 独立线程/WASM 编译证据分别列明，不自动推定。
- 实际浏览器 Work A/B/About/Contact/前进后退导航、原空内容引擎生命周期、旧 schema 升级后 legacy 按钮及 origin 变化、另一 owner/expiry/reset 的浏览器门禁未执行。相应自动化协议测试是另一证据层，不能称本轮浏览器都通过。
- S3 私有签名 URL、真实外链公网可读性/CORS、CDN、生产 HTTPS、目标服务器、正式迁移/回滚/切流均未执行。无合并、推送、部署、自动 GC；C/D 未实施。

## Task 14 窄焦点修复（2026-10-15）

基线 `710408937ac30cfbcb2539b1d764dad985946ed2` 的 fresh helper 浏览器复现首次直接测量 `document.activeElement`，不是对先前 accessibility snapshot 的推断。确切生产 `confirmAction/run/api/publish/building/updateStatus` 定义配最小 fixture 状态、真实 DOM 和本机延迟 HTTP；未重跑完整安装/容器/原六场景验收。

两条 RED（延迟 422、模拟提交后响应截断）的阶段相同：before `publish`/enabled；confirmation `BUTTON`/disabled；pending `BODY`/disabled/busy；settled `BODY`/enabled/notbusy。修复删除确认框关闭时的单次焦点 timer，改在 `run` 完成、按钮重新启用后恢复；仅原按钮初始有焦点、会话 epoch 未变、仍连接、未禁用、用户未主动移焦点且当前焦点为 body 时执行。focusin 观察忽略确认框内部焦点并在 finally 移除，不新增重试或改发布/未知结果语义。

GREEN 两条路径 settled 都为 `publish`/enabled/notbusy；422 保留错误消息，截断保留“结果可能已生效…不要自动重试”。用户聚焦 Other 后仍为 Other；聚焦 Other 再 blur 后仍为 BODY；sessionEpoch 改变、按钮断开后仍为 BODY；取消确认回到 publish。pending 均维持 disabled/busy。实际 helper 回归还覆盖初始无焦点、残余 busy/禁用与 observer 清理。TDD 首 RED `recover false !== true`；增加取消边界 RED `cancel false !== true`；最终 admin-ui 23/23、full test-postgres 474/474，0fail/0skip，exit0，30461.839708ms，`git diff --check` exit0。full 命令使用前文规定清除 DB env + Node24.14.0 + 获准 AUTHORIZED_RUNTIME_ROOT；共享 PG 不清理。

本地非 Git 证据 `output/playwright/focus-20261015/measurements.md`、`harness.cjs` 及 `.playwright-cli/`。仅自有 `http://127.0.0.1:55011`，fresh `focus14-safe` 在 about:blank 单独成功安装 exact-origin + blob/data 路由后才导航。过程偏差如实记录：首 session 的 route 命令语法失败后，已排队 goto 仍触达该自有 origin；立即关闭并新建 safe session。初始 session 无持久完整 requests 日志，不推断完整网络覆盖。未使用原3000/外部原站/用户 tab/私有输入。先前 runtime/image 证据仍适用于未改后台；此前 image **不是本次修复后的 UI 字节**。当时尚待父代理执行的最终镜像身份和独立复审，结果现记于末节。其余“明确未验证/阻塞”不因本修复而解除。

## 最终独立审查、主代理验证与清理

审查范围：`87b572e7117c4764fc4babe0046ea2d6b374fde7..a00cd397c61b4b8dabf2b564ebb29f62e27a1aa9`（20 个实现提交）。Task 14 焦点 Important 已经同一独立审查者复审关闭；另一位独立审查者完成整个分支的规格、代码、测试与跨模块锁/授权检查，结论为 **代码可合并、无 Critical/Important，保留一个非阻塞 Minor**。审查结论不是合并或生产部署授权，也不是视觉验收通过。

保留的 Minor：`builder.js:71/74/76/108/114`、`projection.js:32/37/81/87`、`candidates.js:57` 及 `delivery-publish.test.js:141/152/160/201` 存在密集多操作行，影响后续审查可读性。未发现顺序错误；后续可做保持语义的小范围拆行并跑相关测试，本轮不扩展为大范围格式重写。

主代理在同一最终应用提交独立执行：

| 检查 | 实际结果 |
| --- | --- |
| `node scripts/test-postgres.js tests/admin-ui.test.js tests/delivery-admin.test.js` | exit 0，28 pass / 0 fail / 0 skip，2,676.9885 ms |
| `node scripts/test-postgres.js`，使用前文规定的隔离环境及授权程序根 | exit 0，**474 pass / 0 fail / 0 skip**，32,168.617666 ms |
| 001、002、003 SQL SHA-256 | 与批准的不可变值一致；003 为 `542595564db05b045bd2f6f87e444d3a2749d9d88bcc4277903b213bd0e49d1e` |
| 最新 Docker build | exit 0；镜像 `sha256:ef56ee3e9b3dfcc25ecdc90fd7c59279718f922ffeabe5fa8f18bb2aebe7a493` |
| 新镜像与工作区字节身份 | 全部 **78 个交付应用文件**的相对路径/SHA-256 数组完全相同，包括新 UI；宿主与容器检查命令均 exit 0 |

新镜像身份检查以 `docker run --rm --network none --read-only` 执行，不映射端口、不挂载业务目录、不连接数据库。镜像 Node 24.21.0、UID 1000；宿主 Node 24.14.0。比较范围为 `admin-server/`、`admin-ui/`、`shared/`、`scripts/`、`cms/`、`server.js`、`index.html`、`package.json` 和 `package-lock.json`。新 UI SHA-256 为 `3e98c23c989ffb69f618ade802eed5b1ff0df63ec1fe95944635c27a7ff9adaa`；audit 与 CAS 摘要仍与先前恢复演练相同。这个检查补齐新 UI 的打包身份，**不声称重新执行整套容器恢复或生产 TLS 验收**。

最终清理前，专用网络仅有父代理创建的 `site-pg-test-db-1`；除 control 库外有一个较早测试遗留、0 连接的随机测试库（目录修改时间早于本次最终全套）。主代理以明确 project/config 执行 `docker compose -p site-pg-test -f compose.test.yaml down`，exit 0，移除该专用 tmpfs 数据库容器及网络；测试数据不再保留。最新检查镜像/tag 也按确切名称移除，exit 0；未执行 Docker prune。浏览器证据和独立 Git 工作区保留，原项目未提交修改保持原样。

交付状态：阶段 B 代码与上述隔离验证完成；原视觉、未覆盖的实际浏览器门禁及生产外部服务仍是明确未验证项。没有自动合并、推送、部署、正式数据库迁移或当前 3000 服务切换。阶段 C/D 尚未实施。

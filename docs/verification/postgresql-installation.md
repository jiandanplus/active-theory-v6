# PostgreSQL 安装与部署：实际验证记录

验证日期：2026-10-13（Asia/Shanghai）。这是 Task9 的实际验证记录，不是全项目已通过独立审查、生产已迁移或可以立即切换的声明。原空白站点 75% 阻断已由独立有界修复完成真实浏览器复验（见下文）；整分支独立审查仍是最终 gate。

## 测试边界

- 主机 Node.js 24.14.0；应用镜像 Node.js 24.21.0；Docker Compose v5.1.4；实际数据库 PostgreSQL 18.4。
- 既有专用集成测试服务在 `127.0.0.1:55432`，所有测试使用 UUID `site_test_<32hex>` 数据库及临时 root/dataDir，不回退生产 DATABASE_URL。
- 另建隔离部署项目 `site-pg9-ac8ddc8e`，应用回环 HTTP 后端 61166，经仅绑定本机的临时自签 TLS 代理 61506 访问；独立恢复项目后端 61167 / TLS 61507；新内容包项目后端 64177 / TLS 64178。数据库无宿主机映射端口。
- Task9 使用本地生成的测试密码、令牌、主密钥和 0600 的测试 env；Task9 没有读取/改写真实 `.env` 或真实 data，也没有改写源 assets。授权原 assets 只读复制到拥有的临时 root 后只读挂载。这一边界仅指 Task9，不能用于否认下文披露的 Task6 意外真实 SQLite 打开事故。
- TLS 仅该测试客户端显式信任本地证书，独立 Playwright context 的 `ignoreHTTPSErrors` 仅用于测试。没有安装系统信任、关闭全局 TLS 校验或放宽生产 HTTPS 约束。
- 原用户 3000 端口没有由本次工作启动/重启，没有真实数据切换、云策略修改或 push。

镜像身份：

```text
node:24-bookworm-slim
sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
postgres:18-alpine（本地实际 18.4）
postgres@sha256:1b1689b20d16a014a3d195653381cf2caa75a41a92d93b255a9d6ea29fd353aa
```

不能据此声称所有 PG18 小版本已验证；换镜像 digest 后需重新生成干净 schema 指纹并跑完整验收。

## 已实际通过的自动化命令

```sh
rtk proxy node scripts/test-postgres.js
# 183 tests / 183 pass / 0 fail / 0 skipped，约 11.98 秒
rtk proxy npm audit
# found 0 vulnerabilities
rtk proxy git diff --check
# exit 0
rtk proxy node --check scripts/db-migrate.js
rtk proxy node --check admin-server/resources.js
rtk proxy node --check admin-ui/admin.js
rtk proxy node --check tests/deployment.test.js
rtk proxy node --check tests/setup-ui.test.js
rtk proxy node --check tests/admin-ui.test.js
rtk proxy sh -n docker/postgres-init.sh
# 均 exit 0
rtk proxy rg -n 'node:sqlite|store\.db\.prepare|store\.get\(' admin-server scripts server.js
# 唯一命中 admin-server/importers/sqlite.js:1（显式只读迁移来源）
```

本次新增/补齐：已安装显式升级、空库拒绝且不建 schema、checksum 漂移拒绝且不修复、管理员/版本保留、两次从原始 001 SQL 重建 PG18.4 指纹、同应用模型并发 429、输入失败与真实 Worker 422 后槽位释放；安装 UI 的成功不自动登录、密码不一致清理、旧账号省略 account 字段、双提交只发一次。

缩略图实际 QA 缺陷也有 RED/GREEN：修复前 bundled 素材在 `/admin/` 被当相对路径请求为 `/admin/assets/...`，管理员 `/media/:id` 也因未支持 bundled 返回 404；两个新用例确实失败。修复后 focused `tests/deployment.test.js tests/admin-ui.test.js` 17/17。仅登录管理员或已发布引用可读取受控 bundled 文件，保留 status/trashed 拒绝，复用 realpath 限定服务；匿名未发布 404、管理员 200、range 206、越界 symlink 404、裸 assets 404。没有重新开放全目录静态访问。

测试脚本中的模型/UI既有行为新增覆盖是 characterization，不声称那些既有生产实现有本次 RED；升级与新发现缩略图修复分别记录了真实 RED 后实现。

## 实际 Compose 部署与恢复

临时验收包装脚本为 `.git/sdd/pg-task-9-compose-fixture.cjs`（仅本次工作区 harness，不是可移植生产工具），实际执行了：`prepare`、`build`、`up`、`tls`、`full-assets`、`inspect`、`recreate`、`restore`、修正测试恢复 env 后 `restore-verify`、`outage`、`bundle`。这些动作内部对明确测试 env/project 执行 Docker Compose；正式操作方式见 [部署指南](../POSTGRESQL-MIGRATION.md)。

- `config --quiet` 用生成测试 env 通过；外部文件单独 `-f compose.external.yaml config --services` 只列 `site`，无内置密码仍通过，未启动 db 或继承 depends_on。
- Node24 镜像实际构建成功，`npm ci --omit=dev` 0 vulnerabilities；容器 `id` 为 uid/gid 1000(node)。SQL、JSON manifest、安装 UI 均随对应目录复制。
- PG18 父目录 `/var/lib/postgresql` 命名卷实挂，首次启动只有独立应用角色，`rolsuper/rolcreatedb/rolcreaterole = false/false/false`；没有 `personal_site` schema，更没有管理员。
- 首次误用 HTTP 生产 Origin 时应用按预期拒绝启动，提示必须 HTTPS。随后用隔离 TLS 代理完成生产 secure cookie 的真实登录；没有为测试修改生产约束。
- 无 DATABASE_URL 的另一个临时镜像实例：`/admin/` 200、`/api/setup/status` 200 且 state=`unconfigured`、管理 API 503。第一次测试将 status 误断言为 503，修正为已有协议后重新实际通过；没有改生产协议来迎合测试。
- 初始化并上传后重建 site 容器，原账号登录 200、上传字节 200，admins/resources/versions 为 1/311/1，没有依赖旧容器可写层。
- 容器内实际执行 `npm run db:migrate`：`Installed schema verified at version 1; no administrator was created.` 当前 001 无后续版本，升级为受锁验证式 no-op。
- 仅停止拥有的 DB 时，admin 壳 200，管理 API 与 setup/status 503；重启该 DB 后 installed 权威状态恢复，没有被当新站初始化。
- `pg_dump -Fc` 使用测试 bootstrap 管理角色；`pg_restore --no-owner --no-acl --exit-on-error` 使用非超级用户 `site_app`，恢复到独立 `pg9_restored` 数据库，不覆盖源库。独立恢复应用以原账号实际登录 200。
- uploads 从源容器复制到拥有的临时备份目录，再复制到**新的**恢复媒体卷，不是复用原媒体卷。源卷 `site-pg9-ac8ddc8e_site-data` 与恢复卷 `site-pg9-ac8ddc8e-restore_site-data` 实际不同。恢复后读取 200，上传 PNG SHA256 与备份一致：`a0da2a70dc61dbb6b2d1c182ae4e276896de10f77008c75a529af4a8574afad7`。
- 授权 bundled 素材在源/恢复应用使用同一份已隔离的只读副本；本次未证明离机 assets 压缩包恢复。生产必须另行备份授权运行包、素材、主密钥及 S3 对象。

以下为源与恢复库**验收登录后的**实际表行数，不是假定所有表恒等。恢复验证的额外登录会增加 sessions/audit；业务行数与版本保持一致。

| 表 | 源库 | 恢复库 |
| --- | ---: | ---: |
| admins | 1 | 1 |
| audit_events | 8 | 10 |
| installation | 1 | 1 |
| login_attempts | 0 | 0 |
| previews | 1 | 1 |
| projects | 0 | 0 |
| resource_references | 1776 | 1776 |
| resources | 311 | 311 |
| scenes | 6 | 6 |
| schema_migrations | 1 | 1 |
| sessions | 3 | 5 |
| site_settings | 1 | 1 |
| songs | 0 | 0 |
| storages | 1 | 1 |
| templates | 1 | 1 |
| versions | 1 | 1 |

## 实际浏览器流程及边界

Playwright CLI 驱动真实浏览器和真实 PG/Compose API，不拦截安装/上传/保存/预览/发布接口。截图在本地 `output/playwright/task9/`，不提交含临时登录状态的 CLI artifacts。

内容包的新独立实例 `pg9_bundle`：令牌授权 → 数据库权限 → 服务器内容包预检（348资源、16作品、8歌曲，missingRequired=[]，仍有警告）→ 创建管理员 → 手动登录 → 上传 PNG → 修改普通网站标题 → 保存草稿 → 点击预览 → 实际看到原 JianDan 3D Logo → 点击发布并通过确认框。真实 UI 显示“发布成功 · 版本 1”，数据库为 1管理员/349资源/1版本、published=1；没有直接 setPublished、绕过 validatePublication 或修改源资产。预览图：`output/playwright/task9/bundle-preview.png`。

资源库修复后没有再请求 `/admin/assets/...`。内容包中仍有 8 个原始不支持或缺失媒体的 403/404（受控拒绝），以及安装前 favicon 503；不能称全网络零错误。

发布后通过普通 UI 退出，打开匿名根页面：实际标题 `Deployment Bundle Verified`、`/api/admin/me` 401，仍看到原 JianDan 3D Logo（`output/playwright/task9/bundle-anonymous.png`）。预览和匿名截图均已实际视觉检查。上传的 PNG 未选入公开内容，恢复验收通过登录管理端读取；不声称所有上传自动对匿名开放。

旧站流程另用 UUID PG 与临时 root/dataDir 的只读 SQLite 样本：选择旧站来源 → 预检 → 保留原管理员（没有新账号/密码字段）→ 安装 → 用原密码手动登录。实证 1管理员、保留版本42、40资源。临时 runner 初次漏用 tty 导致 stdin 关闭，无法从该运行取回安装前 SHA 基线；**不声称这次 UI 导入已做前后字节比对**。后来用独一生成密码/盐化 hash 严格识别拥有的测试库与临时 root，只读再次导入，前后 SHA 一致：`fbac126aa65f55d03083314e242e6f2d6bb28291ee6f13367e80227b2d4c5beb`。自动化导入用例另有自己的前后源字节验证。该临时进程、UUID 库与 root 已严格定目标清理，不触碰真实 SQLite。

### 已修复并独立复验：默认空白模式的前台

原空白预览卡在 75% 的三个独立原因是 CMSData 对空作品调用 mockData 数组、ContactUI 空串动画/真值宽度等待，以及 Text3D 跳过空文本的对象创建。生成兼容层现保留真正空 StateArray，以 loaded 生命周期替代非零尺寸等待，允许正常字体/零顶点几何/shader 初始化，并修复 nonempty→empty 的底层文本更新。原 assets 未修改，没有伪造项目、占位文字或强制 ready。缺少外链的联系页不实例化旧个人二维码/同步组件，也不启用无目标按钮；已有配置分支保留。

新临时 root/dataDir 与独立 UUID PostgreSQL（`site_test_646b170e0f074790ba1e603ad5ef327c`）实际经过普通 UI 空白安装、手动登录、仅编辑标题 `EmptyRuntimeVerified`、保存、预览、确认发布 v1。预检 310 资源/0 作品/0 歌曲、missingRequired=[]；预览 App/ViewController 与全部场景真实 ready、Global/loadFinished，加载器退出，Home/Work/Contact 可用。随后新应用进程重新打开相同独立库和 dataDir，匿名独立浏览器同样完成加载，admin/me=401。公开配置仍为 0 作品/0 歌曲，5 个场景文案和全部 8 个 UIL 文案仍为空；没有恢复旧个人/样例文案。

真实 Text3D 实例在重启后执行 empty→`After restart`→empty：position 数组长度 0→144→0，空字符串宽高/包围盒 min/max/球半径均为有限 0，shader 就绪。非空内容包另用独立 UUID/root/dataDir 回归：16 作品/8 歌曲，原 Logo、TreeScene 黑洞和已配置联系行为保持。截图 `output/playwright/pg-empty-home.png`、`pg-empty-contact-final.png`、`pg-nonempty-home.png`、`pg-nonempty-tree.png` 均实际查看。原六类空内容 TypeError 未再出现；仍保留原 stylesheet、纹理、字体和媒体告警，不能声称网络/音频全零错误。

最后代码变更后完整 `rtk proxy node scripts/test-postgres.js` 为 **190/190、0 fail、0 skipped**（约13.51秒）。新增 7 项明确命名的 authorized runtime 测试执行真实原包函数；干净 checkout 若没有授权运行包会明确 skip 这 7 项并提示引擎兼容性未验证，有原包而关键源码 anchor 缺失仍失败。PostgreSQL 集成测试不因此跳过。RED/GREEN 与浏览器明细见本地工作记录 `.git/sdd/pg-empty-fix-report.md`；初始诊断 `.git/sdd/pg-empty-diagnosis.md` 保留为历史失败证据。

### 其他未验证/原有内容问题

- 真实 S3 服务、CDN、生产域名 HTTPS 代理、Bucket 对象策略、CORS 未验证；隔离 S3 HTTP 测试不等同云账号验收。
- 实际音频播放未验证。此前 Task8 普通点击被 FXScroll overlay 截获，没有强制点击冒充；音频映射/版本冻结有单元覆盖。
- 原 CMS 的 undefined stylesheet、字面占位主机图片/视频、原字体缺少部分中文项目标题字形仍存在；源资源和所有外部作品没有全部验证，不改原资产掩盖问题。
- PostgreSQL 18.4 以外小版本、真实主版本升级、跨机器/离机完整备份恢复、S3 字节备份、多副本部署未验证。
- 未进行真实旧服务停机、备份、迁移、切换，也没有授权自动覆盖旧 data；需用户确认数据库目标与维护窗口。

## 必须保留的 Task6 事故披露

Task6 首次 RED 测试曾调用旧 `createApp({databaseUrl:undefined})`，没有显式 root/dataDir，意外打开真实 `data/site.db`。旧 openStore 会 chmod 0600、设置 WAL/FK/busy_timeout 并执行 CREATE TABLE IF NOT EXISTS；initializeConfig 读取 draft，并可能在 draft 不存在时插入初始 config/version/settings。此前 draft 是否存在及修改前字节基线未知。请求以 404 失败，finally 中 HTTP/SQLite 已关闭；当时已立即向用户说明。

因此**不能断言真实旧数据库未改变**。随后没有重新打开、删除、恢复或“修复”真实 SQLite，不做取证扩展；所有后续测试均用明确临时 root/dataDir。原 3000 服务没有重新启动。本次没有把未知状态包装为数据完整性已证明。

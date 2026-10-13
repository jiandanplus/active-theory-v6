# 安全升级与站点身份：实际验证记录

日期：2026-10-14（Asia/Shanghai）。范围仅第一阶段 A：结构 1→2、站点描述/语言/分享图及跨边界保护。B/C/D 未实施；没有执行真实数据库升级、当前 3000 服务切换、GitHub 推送或部署。

## 执行代码与隔离边界

生产代码提交 `ffe22b1`（包含实际浏览器发现的初始 head 重复修复）；本记录随后的提交仅增加回归断言与文档。宿主 Node `v24.14.0`；Docker Node `v24.21.0`；专用 PostgreSQL 实测 `18.4`。候选检出为 `/Users/jiandan/.codex/worktrees/site-identity-upgrade/active-theory-v6`。

自动测试只连接回环 `127.0.0.1:55432` 的专用 `site-pg-test-db-1`，每项创建 UUID 临时库/目录，不读取实际 `.env`、SQLite、uploads 或 S3 密钥。引擎验证使用明确授权的 `/Users/jiandan/Code/MyCode/active-theory-v6` 运行资源，不复制真实数据库或私有 uploads。

## 自动化实际命令与结果

全部 shell 经 `/Users/jiandan/.cargo/bin/rtk proxy`；下列命令中的 `NODE24` 表示 `/Users/jiandan/.nvm/versions/node/v24.14.0/bin/node`（执行时使用完整路径）。

```sh
NODE24 --test tests/site-identity.test.js tests/metadata.test.js tests/admin-ui.test.js tests/setup-ui.test.js
# 33/33，通过，失败 0，跳过 0；无需 SQLite 告警过滤。
env -u TEST_DATABASE_URL -u TEST_DATABASE_CONFIRMED AUTHORIZED_RUNTIME_ROOT=/Users/jiandan/Code/MyCode/active-theory-v6 NODE24 scripts/test-postgres.js tests/schema-upgrade.test.js tests/site-identity.test.js tests/importers.test.js tests/metadata-http.test.js tests/deployment.test.js
# 第一轮 60/60，通过，失败 0，跳过 0。
env -u TEST_DATABASE_URL -u TEST_DATABASE_CONFIRMED AUTHORIZED_RUNTIME_ROOT=/Users/jiandan/Code/MyCode/active-theory-v6 NODE24 scripts/test-postgres.js tests/importers.test.js
# 增加源文件恢复断言后 33/33，通过，失败 0，跳过 0。
env -u TEST_DATABASE_URL -u TEST_DATABASE_CONFIRMED AUTHORIZED_RUNTIME_ROOT=/Users/jiandan/Code/MyCode/active-theory-v6 NODE24 scripts/test-postgres.js
# 最终 242/242，通过，失败 0，跳过 0，取消 0（12.30 秒）；不采用此前 199 项结果。
npm audit
# 0 vulnerabilities（使用 Node24 对应 PATH）。
shasum -a 256 admin-server/migrations/001-initial.sql
```

既有安全测试入口仅使用其原有 `--disable-warning=ExperimentalWarning` 过滤 Node SQLite 实验性告警，没有新增全局告警屏蔽。`git diff --check` 实际通过（提交前再次确认）。

001 原字节 SHA-256 实测：`bba88a72df8e7166646fdc56e6485c36078bf7e7fe4077125fdd7ebc682d2a15`，与基线一致。

历史保持证据不是空数组比较：V1 fixture 包含两个版本、一条预览、一条会话和固定假云 credentials；SQL 在升级前后比较 `versions(id,created,snapshot::text)`、`previews(id,owner,expires,snapshot::text)`、`storages(id,credentials)`，并比较其他持久化表、installation.source/completed_at、published。当前草稿与模板得到 `en`，旧版本 42 的 language 键仍不存在；两个竞争升级仅一次成功且 revision 只增加一次。注入 002 后失败时 settings、schema_config、迁移记录和历史全部事务回滚。

临时 SQLite 的预检/导入/恢复前后比较 SHA-256 与完整临时源树摘要；恢复旧版本只补齐草稿身份字段，两个历史 JSONB 文本原样保留。已有 publication/resource 测试验证分享图图片种类、缺失/禁用/回收拒绝及清空后历史授权仍保留。

## Docker 打包与模板

三个 config 命令实际通过：`docker compose --env-file /dev/null -f compose.test.yaml -p site-pg-test config --quiet`，以及 `compose.yaml`、`compose.external.yaml` 对项目 `site-identity-task7-config` 的 config。后两者均显式使用假的 `SITE_ORIGIN=https://site-identity.invalid`、`DATABASE_URL=postgresql://fake:fake@db.invalid/fake`；内置模板使用假 bootstrap/app 密码，所有可选秘密字段显式为空。不加载仓库真实 .env，也未对生产模板执行 up。

实际执行 `docker build -t site-identity-task7:ffe22b1 .`，镜像摘要 `sha256:d7c2da9fab604cd7b0be803c3f51093c509d39cc8a20957d893b6f5be89e12eb`。唯一测试容器 `site-identity-task7-ffe22b1`（ID `a7160db6a69555297d7ff228c1f1ea51c9bc28ff8b399b63823de4d1aa18f277`）绑定 `127.0.0.1:49250→3000`，无宿主 assets/data bind，显式 development、空数据库/主密钥与固定假安装令牌。

容器内 `require('./shared/site-identity').normalizeSite({}).language` 返回 `en`，实际 HTTP `/admin/site-identity.js` 返回 200、`application/javascript`、`private, no-store`、`noindex, nofollow`，证明 shared 在应用镜像内且能经 HTTP 提供，不只是宿主文件存在。这是打包 smoke，不声称容器完整 3D 或生产部署已验证。

本代理已 stop/remove 上述唯一容器，remove 临时镜像标签；无持久卷、无实际绑定素材删除。父代理已清理全部浏览器 fixture（见下文）；专用 PG 服务在最终审查与新鲜验证通过后也已关闭，具体所有权核对和命令见下文。

## 实际浏览器与未验证项

父代理完成真实 Chrome/Playwright 验收（1440×900），截图位于候选检出 `output/playwright/site-identity/`，未跟踪且保留供审阅。原始过程记录在本地工作树管理目录 `sdd/browser-acceptance.md`，不包含实际账号或私有数据库副本。

- 全新向导实际完成：令牌、数据库检测、bundle 预检、假管理员、安装与手动登录；服务器状态为 installed/schemaVersion2。首次发布 v1 由 UI 确认完成，不自动发布。
- 在后台输入含 `&`、美元、反引号、反斜线的标题及多行中文描述，选择 zh-CN、打开图片选择器并选 matcap_tree_room.png。截图 `candidate-admin-identity.png` 已视觉检查；保存 revision1 后匿名 v1 仍是原始标题/en/无分享图。
- 真实新标签页预览正确显示字面标题/描述/语言；HTML、identity、bridge、app、shader、映射图片均 200 且 private/no-store/noindex。UI 退出后同一矩阵均 401，私有头保持，没有缓存授权绕过。
- UI 发布 v2 后直接请求首页、Work 列表、`adventure-time-distant-lands`、`sustainable-horizons` 原始 HTML：各恰好一个 title/canonical，正确可信回环 origin、zh-CN、转义标题、站点/作品描述和 version2 分享图。未知 slug 返回真实 404，无 canonical/image 或引擎脚本。
- UI 清空分享图、保存 revision2、发布 v3 后首页旧 OG/Twitter image 标签均为 0；固定 v2 图片 URL 仍 200，证明没有删除历史资源。
- 浏览器内首页→Work→作品 A→列表→后退/前进→作品 B→Contact 的标题/描述/canonical 跟随路由。Contact 保持原有 overlay/底层 URL 语义；首页滚动经过 about/tree 时恢复首页 URL/标题，无残留详情描述。
- 初始 head 重复缺陷曾在实际 browser reload 后得到 title2/canonical2，已由 `ffe22b1` 修复。最终在 Playwright 阻断真正 app.js（排除引擎后续清理）后 reload：预览 title/canonical/description/ogImage 各 1；v3 首页、列表、两作品各 title/canonical 为 1、旧 image 为 0。
- 视觉对照使用同一授权素材副本、隔离内容：`baseline-home/work/project/contact/blackhole.png` 与 `candidate-home/work/project-a/contact/blackhole.png` 已视觉检查。Logo、黑洞中心轮廓/流动粒子、作品卡片、联系 globe 一致；动画帧非确定，不声称像素级等价。`baseline-scroll.png` 的加载黑帧不用于对照。

浏览器未出现 metadata/identity 运行时异常。已记录的旧引擎 `/undefined` stylesheet MIME、WebSocket 503、中文字体/纹理告警在基线亦存在，不证明是本阶段回归；安装前 favicon503、预期 401/404、主动阻断 engine 请求及 QA DOMParser/base-uri CSP 消息是相应测试边界，导航/关闭时 Request aborted 在基线和候选亦观察到。

隔离所有权与清理：基线 `127.0.0.1:64853`（exec95503/PID67286）、首候选 `127.0.0.1:61023`（exec62884/PID88294）、最终向导 `127.0.0.1:64361`（TTY exec53357）均由本次 harness 创建；前两者核验精确 PID 后 SIGTERM 走自身清理，向导 stdin stop。三者均输出 CLEANED，关闭 server/store、删除各自 UUID 测试库及受守卫临时素材副本。三个命名浏览器会话分别关闭；PG 查询只余 site_test_control。原素材、真实 data、其他容器和现存 3000 服务未操作。

父代理在全部 Task7 断言后独立运行安全全套：242/242、失败 0、跳过 0、exit0（12.575 秒）；最终交付前在 `7f8305c` 再次运行同一命令，242/242、失败 0、跳过 0、取消 0、exit0（12.678 秒）。整段 `3c21926..7f8305c` 的独立代码审查已通过：无 Critical、Important 或剩余 Minor，结论为 Ready to merge。审查覆盖全部 3,190 行差异及关键调用链；浏览器和完整套件以父代理实际执行记录为依据，不冒称审查者重新执行了这些检查。此前深层克隆测试缺口、初始 head 重复均已关闭；SQLite 实验性告警属于既有行为。

最终清理前查询专用 PostgreSQL 只余 `site_test_control`。核对容器 labels 为 `project=site-pg-test`、`service=db`、配置文件为本工作树 `compose.test.yaml`，绑定 `127.0.0.1:55432` 且无宿主持久挂载后，实际执行 `docker compose --env-file /dev/null -p site-pg-test -f compose.test.yaml down`。该容器及其专用网络均已移除，再次按项目 label 查询为空；tmpfs 测试数据随容器删除，不需要保留或恢复，可按测试模板重建。没有操作其他容器或真实数据库。截图、日志和独立 Git 工作树保留；尚未合并、推送或部署。

真实 S3/CDN 公网可读性、CORS、目标服务器 HTTPS/代理、实际生产数据库迁移/备份恢复未验证；本地受控 S3 HTTP 测试不替代这些项目。

## 后续本地合并记录（2026-10-14）

以上为隔离验收结束时的记录。用户随后选择本地合并；在原目录 `/Users/jiandan/Code/MyCode/active-theory-v6` 对 `feat/authenticated-resource-admin` 执行 `git merge --ff-only feat/site-identity-upgrade`，从 `3c21926` 快进至 `7e0b46b`，没有冲突，没有拉取或推送远端。合并前检查 49 个改造文件与用户未提交文件无路径重叠；合并后校验原有 186 个未提交文件的 SHA-256 和文件模式均保持不变。

在合并后的原目录、提交 `7e0b46b` 上重新执行上述 Node 24 安全全套命令：242/242，通过，失败 0、跳过 0、取消 0，exit0，12.538 秒。测试仍使用专用回环 PostgreSQL 的 UUID 临时库与临时素材目录，没有读取真实 `.env`、SQLite 或 uploads。独立只读核查也确认从原目录运行不会改变这些隔离边界。原始 001 摘要保持不变，提交差异 `git diff --check` 通过。

此次重建的 `site-pg-test` 专用容器测试后只余控制库；核对 Compose 所有权后使用 `--env-file /dev/null` 执行 down，容器和专用网络已移除，按项目 label 查询为空。现存 3000 端口前后均为 PID63076，未重启或迁移真实数据库。

归档前将候选工作区完整 output（含被 Git 忽略的浏览器日志）和工作树管理目录中的 sdd 记录复制到原项目 `output/site-identity-upgrade-2026-10-14-7e0b46b/`，分别运行 `diff -qr` 确认一致。随后通过 Codex 原生工作区归档完成可恢复保存；附件类型已变为 archived_worktree，Git 仅保留原工作区。已安全删除完全合并的临时开发分支，其提交仍在目标分支中。后续本次收尾提交只更新文档，不修改被验证的应用代码。

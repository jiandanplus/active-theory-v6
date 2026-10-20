# C/D 与 Docker 交付验证记录

执行日期：2026-10-20，Asia/Shanghai。目标：按批准的计划完成 C/D 架构改造，支持 Docker 一键部署，在实际 Docker 中测试，并打开给用户验证。

## 交付状态与范围

C/D 主体实现、独立源码审查、完整授权回归、干净检出测试、实际 Docker 与浏览器验收已完成。应用源代码冻结于 `c2391c6a6c1b8e79759fd1d381369b2803bea8c5`；后续收尾仅更新文档。代码已本地快进合并回原项目 `feat/authenticated-resource-admin`，没有推送 GitHub，没有执行生产切流或真实业务数据库升级。

默认交付的是新增的 `portfolio-v1` 个人主页示例，与继续支持的 `legacy-six-scenes-v1` 分开。示例不包含原站字体、模型或媒体，不声称复刻原罐体、粒子和 Logo 画面。原视觉源文件保留；原素材缺失、原场景完整视觉验收、真实 S3/CDN、生产 HTTPS 与许可确认仍为独立边界，不能用本报告的示例验收代替。

工作区：`/Users/jiandan/.codex/worktrees/modular-docker-delivery/active-theory-v6`；交付目录：`/Users/jiandan/Code/MyCode/active-theory-v6`。本轮专用服务仅监听 `http://127.0.0.1:3300`，原 3000 端口未重启。

## 实现与审查索引

| 提交 | 内容 |
| --- | --- |
| `bfaedfc` | 管理后台拆为 14 个模块，保留单一状态与组合入口 |
| `4d8b573` | 后端 routes/services/repositories、共享校验、健康检查和请求关联 |
| `3994a0a` | 语义化主页、原创示例、demo 安装、普通网页与渐进 WebGL |
| `caa2576` | Docker 一键启动、CI、质量工具、部署/贡献/来源说明与历史工具入口 |
| `c04116e`、`89f5ba0` | canonical schema 基准、私有路由大小写与日志脱敏、SQL 仓储边界修复 |
| `8aa0a99`、`3432193` | 可移植授权运行包门禁、禁用危险整库归档、预览 target 与动画生命周期修复 |
| `825da36` | 异步视图/资源选择器会话隔离、unsupported 托管图片、真实首次发布按钮路径 |
| `c2391c6` | Docker CMS 输入改为明确的六文件允许清单，排除本地备份 |

各任务和整分支独立审查已经完成。最终源码意见为 **Ready to merge: Yes，0 Critical/Important**；保留一个非阻塞可读性项：delivery 中部分密集多操作行可在后续窄范围整理，必须保持派生产物字节和哈希契约。

## 最终自动化证据

在原项目最终应用源码上实际执行（仅专用临时 PostgreSQL 55432；已授权原程序固定 11 输入）：

```sh
env -u DATABASE_URL -u TEST_DATABASE_URL -u TEST_DATABASE_CONFIRMED \
  AUTHORIZED_RUNTIME_ROOT=/absolute/authorized/original-project \
  PATH=/path/to/node24/bin:$PATH \
  node scripts/test-postgres.js tests/*.test.js
```

最终保存日志的运行结果：**exit 0，543/543 pass，0 fail/skip，47,625.689083 ms**。本机日志位于 `output/cd-docker-integration-20261020/final-authorized-tests.log`。该测试使用唯一 UUID 临时数据库，不读取真实 `.env`、业务数据库或云凭据。

同一应用提交在独立干净目录经过 `git archive` 解包后，实际执行新的 `npm ci`：231 added、232 audited、0 vulnerabilities；lint、format:check、typecheck 均退出 0。完整基础 `npm test` 为 **534 tests，524 pass，10 explicit skips，0 fail，49,178.7755 ms**。九个 `authorized runtime:` 前端用例在缺少授权源时被基础运行器明确过滤，不在 534 总数内；另十个原程序相关用例明确跳过。无授权源的 `test:authorized-runtime` 实际退出 1，因此基础绿色不被冒充为原场景通过。

收尾时再次在独立工作区执行 lint、format:check、typecheck，均退出 0。原目录既有 `node_modules` 未安装新增的 eslint/prettier/tsc，直接运行这三个入口曾退出 127；没有覆盖原依赖目录，而在已安装开发依赖的工作区验证。新开发者应按 README 先运行 `npm ci`；Docker 启动不依赖宿主开发依赖。

## 实际 Docker 与镜像边界

- 原目录 `npm run docker:up` 已实际执行，多次保留相同配置与持久卷重建成功。
- Compose project：`portfolio-local-8cdaf8a01b5e`；应用与 PostgreSQL 18 均 healthy；只有应用的 `127.0.0.1:3300 → 3000` 暴露到宿主，数据库没有宿主端口。
- 默认入口为 `node server.js`，实际 Node `v24.21.0`、非 root UID 1000；数据库应用角色没有 superuser/createdb/createrole 权限。
- 最终镜像索引：`sha256:78d9a2e6453a040f1465e611c448b8a8655503b7f7375fae998d15cb66f07673`。无网络/只读检查确认 **119 个应用文件的路径、长度和 SHA-256 全部与最终源码一致**。
- 最终本机只读复查：`/health/ready` 返回 `{status:'ok'}`，首页和 `/admin/` 均 HTTP 200。

最终构建前的真实镜像身份比较曾发现，旧的广泛 `COPY cms ./cms` 把原目录一个被忽略的 `.bak` 文件带入中间镜像。未打印其内容，公开 URL 检查为 404，也没有推送镜像。`c2391c6` 改为仅复制版本控制中的 contact/metadata/projects 的 dev/latest 六文件，并增加备份后缀排除与 RED/GREEN 回归。最终 119 文件清单已不含该备份，原备份文件未修改或删除。

启动配置、安装令牌、主密钥和测试登录只在原目录 `.deployment/local/` 私有文件中，目录 700、文件 600；Git 忽略检查已确认，不写入此报告。测试登录保存在本机 `review-login.json`，不是产品默认公共密码。

## 实际浏览器业务验收

独立浏览器会话在首次导航前限制请求只访问专用 origin。通过正常 UI 完成：安装令牌授权、数据库检查、demo 预检（两个作品、两张自有 SVG，零缺失/警告）、创建测试账号和手动登录、登记并明确选择内置运行包、预览与发布。

最终内置运行包 `196df9db4017…` 为四文件/4499 bytes。实际流程包括：

1. 发布 v1；上传一张自有页面截图并登记为资源（201，147837 bytes，image/png）。没有发布引用时，匿名 `/media/...` 为 404。
2. 修改标题、选择上传图片并保存。公开页仍保持 v1；认证预览才显示草稿标题和私有图片，预览导航保持完整 target ID。
3. 发布 v2 后公开标题/分享图更新，图片匿名读取为 200。从 v1 恢复只修改草稿，公开页仍保持 v2；最终重新发布 v3。
4. 最终公开站为“我的创作空间”，两个示例作品。published/basic/unsupported 与认证预览的两张托管图片可读取，未授权预览为 401。
5. 人为延迟版本列表 GET 后切换网站设置，旧版本视图没有覆盖当前页面；人为延迟资源选择器 GET 后退出，登录页保留、旧弹窗清除、后台内容接口为 401；重新登录正常。

操作诊断期间有一次相对 URL 的只读 API 检查失败，恢复写入本身已成功；改为绝对 URL 后确认状态，没有重复恢复写入。

### 最终 v3 浏览器矩阵

| 场景 | 实际观察 |
| --- | --- |
| 桌面 1440×1000、键盘 | skip link 可见并聚焦 main；作品/详情/联系及前进后退正常，两图 decode 成功 |
| 手机 390×844、触控 | 页面 scrollWidth/viewport 均 390，无根级横向溢出，可进入作品详情 |
| 手机后台 | 登录后可切换总览/网站设置；390 宽无根级横向溢出，草稿标题与修订保留 |
| 关闭 JavaScript | 首页/作品/详情/联系可读可导航，动画按钮不暴露 |
| prefers-reduced-motion | 初始不自动播放；访客主动播放后才启动 |
| WebGL 初始化失败 | 正文/图片仍可用，普通网页无可执行脚本，无失效动画按钮 |
| 200% 内容缩放 | CSS zoom=2；根 clientWidth/scrollWidth 都为 1425，内容未越过视口，键盘可进入 main |

这些上下文没有捕获 pageerror。原生 Chrome 缩放快捷键未改变视口，所以 **CSS 内容缩放不声称原生浏览器 200% 缩放验收**。此 Chrome 的 pageshow.persisted=false，不能声称实测 BFCache 命中；另有五个 app VM 生命周期回归覆盖 persisted 分支。

收尾时已在 Codex 应用内新开并保留可见的 `http://127.0.0.1:3300/` 和 `/admin/` 标签，分别核对 DOM 与截图：前者显示实际个人主页与作品入口，后者显示后台登录表单。原有 3000 页面标签未替换，用户尚未亲自确认页面。

## 一致备份、实际恢复与重启

仅对本轮专用测试站点停写、pg_dump、自有数据卷归档，再恢复到新的专用项目、空白数据库与新数据卷。对照包含管理员登录、内容/资源/历史、已发布页面与媒体、保留认证预览及匿名拒绝，并从原入口重启原测试实例。

- 最终恢复项目：`portfolio-restore-4ad651c347`。
- 数据库 dump：52555 bytes，SHA-256 `64f35e07674757e1f60abd1650ff80c062823a299122c02623069ed412966316`。
- 数据归档：1433600 bytes，SHA-256 `d0ffc7b69e9e8be6dc35b5b0535cd0d6ee80a73d44264616e306b1582258ae43`。
- **170 个数据文件**的路径、模式、UID/GID 和哈希一致；**58 项 HTTP/状态检查**一致；三版本、三资源保留；恢复实例和原实例重启后的比较均为 true。

早先两次恢复检查在跨容器替换后的首个登录请求遇到连接重置，文件/数据库对比已通过。检查器改为关闭跨替换长连接后完整通过，没有自动重试写入，也没有据此修改应用认证逻辑或宣称已证明具体应用缺陷。

成功的私有备份已只复制到原项目 `.deployment/backups/drill-4ad651c347/` 并回读校验摘要。它含密钥，不进入 Git 或公开证据目录。恢复演练实例已停止，保留恢复卷以便追溯；当前原测试站点保持运行。临时 PostgreSQL 55432 的测试容器/网络在回归结束后停止移除，不删除站点卷。

## 本地集成、证据位置与完成核对

集成前后核对原目录 405 个已有修改/未跟踪文件：changed=[]、tracked/staged diff 与状态一致；原视觉修改未混入改造提交。没有读取真实 `.env`、原业务库、uploads 或真实云配置。管理工作区保留用于追溯，不自动清除其中的私有演练证据。

本机耐久证据统一位于 `output/cd-docker-integration-20261020/`：完整最终测试日志、原文件保护记录、reports/ 内的任务/复审/干净检出报告及镜像和恢复摘要、screenshots/ 内的桌面/手机/无 JS/缩放截图。该目录不整体提交；报告与截图不包含口令，私有备份另行隔离。

- [x] 后端与后台模块边界、共享校验、健康检查和既有安全/事务语义。
- [x] 同一发布快照的语义网页、受保护预览、无 JS 与能力降级、自有示例。
- [x] 一键 Docker、随机私有配置、非 root 运行、独立 PG、持久卷、质量工具与 CI。
- [x] 最终源码 543/543、干净检出 524 pass/10 explicit skips、质量门禁、独立源码审查。
- [x] 最终镜像身份、实际安装/登录/上传/预览/发布/历史/退出、移动与可访问路径。
- [x] 一致备份恢复、同卷重建持久化、原文件保护和本地集成。
- [x] 已测试实例保持运行，并在用户可见浏览器打开首页与后台。
- [ ] 原罐体/粒子/Logo 场景完整视觉对照；不在示例验收结论内。
- [ ] 真实 S3/CDN、生产 TLS、真实业务升级、GitHub 推送与用户最终视觉确认；未执行，不冒充已完成。

最后两项是明确分列的原视觉/外部上线边界，不是本地示例已经通过的证据。现有代码/素材的统一许可仍需项目所有者确认，见 PROVENANCE.md 与 THIRD_PARTY.md。

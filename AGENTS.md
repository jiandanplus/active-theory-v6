# AGENTS.md

写给在本仓库工作的 AI 编码代理（以及人类协作者）。动手前先读完本文，再读 `CONTRIBUTING.md`。

## 项目是什么

一个自托管的个人作品集 CMS。前台保留原 3D 网站（Logo、粒子、黑洞、六个场景），后台是中文管理界面，可以管理文案、作品、音乐、媒体和联系方式，并按「草稿 → 私有预览 → 不可变版本发布」的流程上线。

- 线上站点：`https://agi.drawbookai.cn`。部署在一台 linux/amd64 服务器上，前面是 1Panel 和 OpenResty 反向代理。
- 原站 3D 素材（`assets/`）和原站运行包**不在仓库中，也不在镜像中**，由运维人员单独提供，并以只读方式挂载。

## 技术栈与目录

- Node.js ≥ 24（CommonJS 服务端）、Express 4、PostgreSQL 18（`pg`）。可选 S3（`@aws-sdk/client-s3`）。
- `server.js`：进程入口。
- `admin-server/`：服务端代码。
  - `app.js`：组合根，只负责中间件顺序和挂载路由。
  - `middleware/`：`request-policy.js` 负责安全头、私有缓存策略和 `isPrivateRequest`；`installation-gate.js` 是安装状态门禁。
  - `admin-shell.js`：后台静态外壳。`views/`：503 维护页。`app-options.js`：选项校验。
  - `routes/` → `services/` → `repositories/`：业务分层，持久化只放在 repositories。
  - `delivery/`：发布管线，包括候选、确定性构建、内容寻址存储 CAS、不可变制品和原子绑定。
  - `engine/`：运行包档案。`legacy-six-scenes-v1` 是原站，`portfolio-v1` 是示例站。
  - `migrations/`：SQL 迁移 001–004。`migration-registry.js` 记录每个版本冻结的结构签名。
- `admin-ui/`：后台浏览器代码，**原生 ES Modules**（`admin-ui/package.json` 中设置 `"type": "module"`）。
  - `index.html` 只加载一个模块入口 `admin.js`，前面是三个共享的普通脚本。
  - 每个模块用 `export const provides = [...]` 声明它往共享 context 里加的函数，由 `modules/registry.js` 统一接线；如果声明和 `create()` 的返回值不一致，启动时就会报错。
  - `modules/router.js` 负责页面切换。纯函数放在 `modules/helpers.js`，直接 `import` 使用。
- `shared/`：浏览器和 Node 共用的 UMD 脚本，包括内容协议、页面内容策略和站点身份。
- `examples/portfolio/`：示例运行包的源文件。`cms/`：导入用的历史 CMS 数据。
- `tests/`：`node --test` 测试，依赖专用的测试 PostgreSQL。
- `scripts/`：运维和测试命令，都在 `package.json` 中注册。

## 常用命令

```sh
npm ci
npm run lint            # eslint .
npm run format:check    # prettier --check .
npm run typecheck       # tsconfig.json（strict）+ tsconfig.server.json（非 strict）
npm run test:launcher   # Docker 启动器测试，不需要数据库
docker compose -f compose.test.yaml -p site-pg-test up -d --wait   # 一次性测试库，监听 127.0.0.1:55432
npm test                # 完整测试，约 620 项；会跳过需要授权素材的测试
docker compose -f compose.test.yaml -p site-pg-test down
```

- 有原站授权素材时，加上 `AUTHORIZED_RUNTIME_ROOT=<含 assets/ 的绝对路径>`，`npm test` 会跑全部 681 项，`npm run test:authorized-runtime` 会跑原站兼容性门禁（9 项）。这两个测试都只读取该目录。
- 本机 Docker 环境：`npm run docker:up` / `docker:status` / `docker:down`。如果构建时镜像源返回 403，用 `DOCKER_BUILDKIT=0 npm run docker:up`，改用本地已缓存的基础镜像。

**提交前，上面的检查必须全部通过。** GitHub Actions 目前因账户计费被锁定，**不会执行**，所以本地检查就是唯一的门禁。不要把「CI 没有运行」当成「CI 通过」。

## 必须保持的不变量

1. **公开输出逐字节不变。** `tests/public-golden.test.js` 固定了所有公开路由的状态码、关键响应头和响应体的 SHA-256。只有在确实要改变公开输出时，才可以用 `UPDATE_PUBLIC_GOLDEN=1` 重新生成基线，并且要在 PR 中说明原因。
2. **字节锁定文件不能格式化，也不能为了加类型注释而修改**（已列入 `.prettierignore`）：
   - `shared/site-identity.js`、`shared/page-metadata-dom.js`：原样作为公开的 `identity.js` 输出；类型写在对应的 `.d.ts` 文件里；
   - `admin-server/engine/program-paths.js`：会通过 `Function#toString()` 写进公开的程序字节；
   - `examples/`：示例运行包的输入。
3. **篡改必须立即失败。** 数据库里的快照、manifest、引用、绑定或安装表一旦被改坏，**下一个请求**就必须返回 503 或 404，相关测试已覆盖这一点。因此读路径上**不要加跨请求的缓存或 TTL**，只能在单个请求内去掉重复的读取和哈希。
4. **SQL 预算。** `tests/db-request-cost.test.js` 规定了每个请求最多执行多少条 SQL：页面、端点、素材、资源和 media 都是 6 条，后台版本列表固定 9 条。只能往下调，不能放宽。
5. **数据库迁移。**
   - 已有的迁移文件不能修改，001/002 有校验和保护。
   - 新增迁移时：在 `admin-server/migrations/` 放下一个编号的 SQL 文件，并在 `migration-registry.js` 中登记。结构签名的取法：在空库上依次执行全部迁移，再对 `signatureQuery` 的结果取 SHA-256。
   - 同时要把 `docs/POSTGRESQL-MIGRATION.md` 的升级说明和 `docs/ENGINE-RUNTIME.md` 中的 schema 版本更新到位。
   - 线上升级必须是：备份 → 停应用 → `npm run db:migrate` → 启动。新镜像在执行迁移之前，会显示维护页。
6. **作品排序规则：`priority` 越大越靠前**（0–100），数值相同时保持原有顺序。后台的上移 / 下移会按网站显示顺序重写作品数组，并重新分配严格递减的 priority（见 `modules/helpers.js`）。
7. **媒体响应保持 `Cache-Control: no-store`**（所有者的决定 D1），保证资源移入回收站后，所有访客立即无法访问。
8. **用户可见的文案使用中文。** 修改文案时，要同步更新断言这些文案的测试（`tests/admin-*.test.js`、`tests/content-controls-ui.test.js`、`tests/setup-ui.test.js`）。

## 安全与数据边界

- **不要在输出、日志、提交或 PR 中写出**安装令牌、密码、`SITE_MASTER_KEY`、数据库 URL、会话 Cookie 或 S3 凭证。`.deployment/` 是私有目录，已被 git 忽略。
- 测试只能连接 `site_test_` 开头的专用库，不能使用真实站点的 `DATABASE_URL`。
- 不要下载或提交原站素材，不要执行 `docker compose down -v`，不要删除或覆盖已有的数据卷和备份。
- 本机端口 3302 上是用户的原站副本（`.deployment/original-visual-complete`），**只能读取或复制**，不能改动。演练时要先复制它的数据卷，再在单独的 Compose 项目里运行。
- 这台机器上没有保存连接生产服务器的 SSH。**不要假设可以访问服务器**，上线操作由所有者执行。发布方式：用 `docker buildx --platform linux/amd64` 构建镜像，再用 `docker image save` 导出离线包，附上 `SHA256SUMS`、`release.json` 和服务器操作步骤（参考 `docs/PRODUCTION.md`）。

## Git 与协作约定

- 提交信息使用 Conventional Commits（`feat`、`fix`、`perf`、`refactor`、`docs`、`build`、`test`、`style`、`chore`），正文说明改了什么、为什么改、怎么验证的。
- 在分支上开发，通过 PR 合并到 `main`，使用 merge commit。互相依赖的 PR 可以叠加，按顺序合并。
- `origin` 使用 SSH。如果本机没有可用的密钥，可以用已登录的 `gh` 走 HTTPS：
  `git -c 'credential.helper=!gh auth git-credential' push https://github.com/jiandanplus/active-theory-v6.git HEAD:refs/heads/<branch>`
- 代码风格：跟周围代码保持一致，注释只写「为什么」。纯格式化提交要单独提交，并把提交号加入 `.git-blame-ignore-revs`。

# active-theory-v6

基于现有 3D 前台的个人网站项目，提供中文管理后台、受保护的首次安装、PostgreSQL 内容管理，以及本地 / 通用 S3 兼容资源存储。面向单站点、单管理员、单应用实例自托管，不提供公开注册。

> 当前后台与 PostgreSQL 实现在 `feat/authenticated-resource-admin` 分支。下方克隆命令明确选择该分支，不假定已合并到 `main`。
>
> **代码与素材分开提供。** `assets/` 不在 Git 中；全新克隆可启动管理后台并安装空白站点，但完整 3D 页面需要自行提供有权使用的运行包、字体、模型和媒体。没有运行资源时，公开页显示未配置提示，不会自动从原站下载。

## 功能

- 首次访问 `/admin/`：安装令牌授权 → 数据库检查 → 选择空白内容、服务器内容包或旧站迁移 → 创建或保留管理员 → 手动登录。
- 中文后台管理网站信息、作品、音乐，以及六个场景中已识别的文案、资源和参数。
- 资源库支持本地上传、S3 兼容对象存储、HTTPS 外链；静态 GLB 可转换为当前引擎使用的 BIN。
- 草稿、认证预览、不可变发布快照及恢复为草稿；匿名访客只能读取已发布内容及获准资源。
- 服务端会话、密码哈希、CSRF / Origin 检查、登录限流和加密云凭证；没有默认管理员密码。
- 只读旧 SQLite 导入，保留账号、资源 ID 和发布历史，并检查新私有目录中准备好的上传文件。

**数据边界：** PostgreSQL 保存业务内容、资源记录、引用、账号和版本；媒体字节保存在服务器私有 `data/uploads/` 或 S3。外链只保存引用，不自动抓取。JavaScript / CSS / WASM 等程序包随代码与授权运行包部署，不允许后台任意上传执行。

## 环境要求

- Node.js **24 或更新版本**，使用 npm 安装锁文件依赖。
- 独立 **PostgreSQL 18** 数据库；当前实测 18.4。应用使用非超级用户角色，拥有专用数据库的 `CONNECT`、`CREATE` 权限。不要手动预建 `personal_site` schema。
- Docker 部署需要支持 Compose 的 Docker 环境；生产必须配置 HTTPS 反向代理。
- 本地媒体目录或持久卷可写；3D 素材需自行提供授权副本。

SQLite 仅作为旧站迁移的只读来源，不是运行时数据库。项目不能直接部署为 GitHub Pages 等纯静态站点。

## 本地启动

### 1. 获取代码与依赖

```sh
git clone --branch feat/authenticated-resource-admin https://github.com/jiandanplus/active-theory-v6.git
cd active-theory-v6
npm ci
```

已有检出目录先检查 `git status`，保留本地修改，不要重克隆覆盖。完整 3D 运行包放在 `assets/`；只有空白后台需求时可暂不提供，后续资源完整性仍须单独验收。

### 2. 配置数据库和本地环境

先按[数据库权限说明](docs/POSTGRESQL-MIGRATION.md#部署目标和权限)准备专用 PostgreSQL 18 数据库及非超级用户账号。应用只能创建自己的 schema / 表，不会安装数据库服务或创建云数据库。

仅在没有 `.env` 时复制模板：

```sh
test -e .env || cp .env.example .env
chmod 600 .env
```

编辑 `.env`，将占位值替换为本地实际值，不要提交此文件：

```dotenv
NODE_ENV=development
HOST=127.0.0.1
PORT=3000
SITE_ORIGIN=http://localhost:3000
DATABASE_URL=postgresql://site_app:URL_ENCODED_PASSWORD@127.0.0.1:5432/personal_site
SETUP_TOKEN=LOCALLY_GENERATED_HEX
# 使用 S3 前还需设置独立的 SITE_MASTER_KEY。
```

`SETUP_TOKEN` 使用本机生成的至少 32 随机字节 hex，不能照抄占位文字：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

仅在自己的终端生成并保存，不截图或分享输出。数据库密码在 URL 中需要编码。`SITE_DATA_DIR` 可指定私有媒体目录，默认是项目的 `data/`，不能指向公开静态目录。

### 3. 网页安装与发布

```sh
npm run dev
```

打开 `http://localhost:3000/admin/`，按向导完成安装。浏览器地址须与 `SITE_ORIGIN` 完全一致，不要混用 `localhost` 和 `127.0.0.1`。端口被占用时同时调整 `PORT` 与 `SITE_ORIGIN`，不要停止未知进程。

安装完成后移除环境中的 `SETUP_TOKEN` 并重启自己的应用，再手动登录。修改内容后先保存草稿、预览，再发布；没有发布版本时访客不会看到草稿。已安装实例即使重新设置安装令牌，也不能再次初始化。

网站设置、资源上传、字体限制和模型转换详见[后台使用说明](docs/ADMIN.md)。`admin:init` 仅给出网页安装指引，忘记密码使用受控的 `npm run admin:reset`，不要删库重建。

## 公网部署

推荐从[PostgreSQL 部署、升级与迁移指南](docs/POSTGRESQL-MIGRATION.md)开始，按需求选一个模板：

| 方式 | 文件 | 说明 |
| --- | --- | --- |
| 自带 PostgreSQL | `compose.yaml` | 独立数据库卷、非超级用户应用角色、健康依赖；数据库不映射宿主机端口 |
| 外部 PostgreSQL | `compose.external.yaml` | 独立使用，不与前一个模板叠加，不启动内置 db |
| 原生 Node.js | `npm start` | 自行准备 PG18、进程管理、私有持久目录与 HTTPS 代理 |

应用 Compose 端口默认只绑定 `127.0.0.1:3000`。生产 `SITE_ORIGIN` 必须为 HTTPS，`TRUST_PROXY` 只填写实际信任的代理地址／网段。代理要允许上传体积并为模型转换留足超时。**不要把测试数据库配置或开发 HTTP 服务直接暴露公网。**

备份必须包括 PostgreSQL、本地 uploads、授权资源包以及独立保管的主密钥；S3 对象另行备份。不要对真实部署执行 `docker compose down -v`。旧站迁移必须先停止旧写入、备份，再在新目录准备 uploads 并预检，不能只复制 SQLite 元数据。

## 配置对象存储

默认可使用本地存储。要使用 S3，先生成并保存 `SITE_MASTER_KEY`，然后在后台填写 Endpoint、Region、Bucket、对象前缀、凭证和**公开访问基地址**。Endpoint 与访客访问的 CDN / Bucket URL 是两个不同配置。

“测试连接”只执行只读权限检查，不等于公网访问或 CORS 已正常。应再上传小文件，用实际前台预览验证。切换默认存储只影响新上传，不会搬迁旧文件。当前不支持私有桶签名链接自动续期，详见[配置 S3](docs/ADMIN.md#配置-s3)。

## 常用命令与测试

| 命令 | 作用 |
| --- | --- |
| `npm run dev` / `npm start` | 启动同一 Node 服务，模式由环境决定，不是自动热更新 |
| `npm run admin:key` | 本机生成 S3 凭证加密主密钥，不要公开输出 |
| `npm run admin:reset` | 已安装实例的管理员恢复，使旧会话失效 |
| `npm run import:check -- …` | 只读导入预检；旧站需明确 `--root`、`--legacy`、`--data-dir` |
| `npm run db:migrate` | 维护窗口内显式校验／升级已安装库，不创建管理员 |
| `npm test` / `npm run test:postgres` | 相同的隔离 PostgreSQL 测试入口 |

启动专用测试数据库后运行，不要把生产连接串当测试连接：

```sh
docker compose -p site-pg-test -f compose.test.yaml up -d --wait
npm ci
npm test
npm audit
# 仅关闭上面创建的专用测试项目，其 tmpfs 数据是一次性的。
docker compose -p site-pg-test -f compose.test.yaml down
```

测试默认使用回环端口 55432 和 UUID 临时数据库，不回退生产 `DATABASE_URL`。如显式指定 `TEST_DATABASE_URL`，需确认专用目标后设置 `TEST_DATABASE_CONFIRMED=yes`。有授权运行包时执行对应引擎测试；缺包时七项引擎集成检查明确跳过，不代表完整 3D 已验收。

2026-10-13 在本地授权资源齐全的环境，完整测试 **199/199 通过、零跳过**，依赖审计零漏洞；实测范围和限制见[验证记录](docs/verification/postgresql-installation.md)。这不是对目标服务器、真实 S3 / CDN / CORS 或所有外部作品的验收承诺。

## 常见问题

- **后台能打开但提示数据库不可用**：检查 PG18、连接凭证、权限和网络。故障不会被当作新站，不要删除 schema 重试。
- **安装完成但没有完整 3D 页面**：检查资源包和预检的 `missingRequired`；空白业务内容与缺运行资源是不同状态。先补齐授权资源并在隔离环境预检，不运行旧下载脚本掩盖缺失。
- **保存后访客内容没变**：保存只修改草稿，预览需要登录；验证后点击发布。编辑磁盘 `cms/*.json` 不会自动覆盖已安装数据库。
- **修改中文 3D 文案被拒绝**：原字体为有限字形图集，当前不自动生成新字形。选择已支持文案或另行准备授权字体资源。
- **上传成功但 S3 前台加载失败**：分别检查公开基地址、对象可读权限和 CORS，不要把管理 API Endpoint 当公开 URL。
- **旧模型迁移后缺失**：把停机备份中的 uploads 复制到新运行目录再预检；安装器不会自动搬运。缺关键几何会标记相应模板未就绪，不能用安装成功代替页面验收。

## 资源授权、历史工具与仓库安全

仓库早期来自站点本地化与脱敏工作，原 CMS 中仍可能包含占位主机、示例品牌、链接和不完整媒体。脱敏不等于获得原 3D 引擎、字体、模型、音乐或示例内容的再分发授权。本仓库没有为所有这些内容统一授予开源许可；复用和公开部署前请确认各项权利、替换个人内容并确定适用许可证。

`download:core`、`download:assets`、`download:cms`、`patch-search-text.js` 等是保留的历史开发工具，不是新部署的必要步骤；它们可能下载或改写文件。后台正常运行不调用它们，不依赖上游实时代理，勿在已有站点上盲目执行。

`.env`、`.env.*`（模板除外）、`data/` 和 `assets/` 已在忽略规则中；不要强制提交密码、令牌、数据库、备份、云凭证或未经授权的资源。真实密钥若曾提交，删除文件不能撤销历史泄漏，须先轮换。

## 文档导航

- [后台与资源管理](docs/ADMIN.md)
- [部署、备份、升级与旧站迁移](docs/POSTGRESQL-MIGRATION.md)
- [实际验证与已知边界](docs/verification/postgresql-installation.md)
- [PostgreSQL 与安装向导设计](docs/superpowers/specs/2026-10-12-postgresql-installation-design.md)及[实施计划](docs/superpowers/plans/2026-10-12-postgresql-installation.md)
- [首版后台设计](docs/superpowers/specs/2026-10-12-personal-site-admin-design.md)及[首版实施计划](docs/superpowers/plans/2026-10-12-personal-site-admin.md)，历史记录中的 SQLite 主存储与终端首装决定已被 PostgreSQL 设计替代，不作为当前部署步骤。

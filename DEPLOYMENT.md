# 部署、升级与恢复

## 本地一条命令

Node.js 24+、Docker Compose v2 和正在运行的 Docker daemon 是主机前提；镜像中使用 Node.js 24 与 PostgreSQL 18。在仓库根目录执行：

```sh
npm run docker:up
```

启动器调用固定 `compose.yaml`，显式传入 `--env-file` 和随机项目名，等待数据库与应用就绪。默认 URL 是 `http://127.0.0.1:3300`，Compose 只绑定 IPv4 loopback。`.deployment/local/` 为 700、`config.env` 为 600；独立应用角色 `site_app` 没有超级用户 / 建库 / 建角色权限，bootstrap 超级用户仅用于 PostgreSQL 初始化。所有密码和密钥都由安全随机数产生，不提供默认公共密码。

主机已有的 `.env`、数据库、uploads 或端口 3000 不属于本流程；启动器不读取或覆盖它们。重复启动不会轮换密码、覆盖配置或删除卷。端口冲突会由 Compose 报错并保留状态。首次启动前可指定 `--port 3400`；若已有配置不同，必须选择另一个 `--directory .deployment/another-local`，不能静默覆盖。

```sh
npm run docker:status
npm run docker:token  # 仅在私有终端操作；不要共享输出
npm run docker:down   # 保留 PostgreSQL 与站点数据卷
```

启动成功后在 `/admin/` 输入安装令牌，完成数据库检查，选“自带示例 / 作品集”或空白内容，设置管理员并手动登录。在“引擎 / 运行包”登记内置模板，选择 `portfolio-v1`，再保存、预览、发布。内置模板来源是镜像 `/app/examples/portfolio/`，清单由可信服务器代码生成；无需上传来源不明的 JavaScript 或自行编写 JSON。示例内容、SVG 和 WebGL 为新写演示，不包含原站艺术资产。关闭 JavaScript 仍可阅读服务端生成的页面；WebGL 只是增强效果。

默认镜像不复制 `assets/`，默认 Compose 没有 `assets` bind，因此不会自动在主机创建空 assets 目录。`/app/data` 预先由 node 用户拥有，命名卷初始化继承该所有权。已有外部卷若来自 root，先备份并由运维核对权限，不要用宽泛的递归 chown 猜测修复路径。

`/health/live` 只证明进程可响应；`/health/ready` 要求数据库可访问、安装结构兼容。兼容的未安装数据库也返回 200，以允许浏览器安装。503 可能是数据库不可达、损坏或需显式升级；健康检查不是自动迁移工具。

## 生产与外部 PostgreSQL

本地 Compose 使用开发 cookie 设置，**只能用于本机演示**。公网部署使用独立 `compose.external.yaml`，不与本地文件叠加。它固定 `NODE_ENV=production`，应用仍拒绝 HTTP `SITE_ORIGIN`；宿主端口仍只监听 loopback，由可信 HTTPS 反向代理转发。此仓库不自动申请证书或配置公网 DNS。

1. 由数据库管理员创建专用 PostgreSQL 18 数据库与非超级用户应用角色，赋予该库 CONNECT、CREATE；撤销 public schema 的公共 CREATE。不要预建 `personal_site` schema，不要把数据库超级用户 URL 交给应用。数据库初始化参考 `docker/postgres-init.sh`；脚本不是可对既有生产库盲目重复执行的修复脚本。
2. 在秘密管理系统或 `.deployment/production.env` 准备 `SITE_ORIGIN=https://your-owned-domain.example`、`DATABASE_URL`、`SITE_MASTER_KEY`、首次 `SETUP_TOKEN`、`SITE_PORT`；生成至少 32 随机字节的 hex 密钥。密码需按 URL 规则编码。不要将文件提交 Git；文件权限 600。云数据库按供应商要求使用验证证书的 TLS 连接串，不要关闭证书验证。
3. 配置自己的可信 HTTPS 代理，再设置精确的 `TRUST_PROXY`（例如 `loopback`，依实际代理网络），不要无条件信任任意上游。`SITE_ORIGIN` 必须与浏览器入口一致；否则 Origin/CSRF 检查会拒绝请求。
4. 用单独文件启动并完成相同安装流程：

```sh
docker compose --project-name portfolio-production --env-file .deployment/production.env -f compose.external.yaml up --build --wait
```

不要运行 `docker compose config` 后把含密钥的完整输出放入报告；诊断语法用 `config --quiet`。外部数据库部署不需要 POSTGRES_PASSWORD 等 bootstrap 变量。上述命令是部署模板，不代表真实域名、TLS、云数据库或备份恢复已经验收。

## 资源存储

默认上传和内容寻址制品保存于私有数据卷，业务引用保存在 PostgreSQL。可在后台配置 S3 兼容存储；`SITE_MASTER_KEY` 用来加密保存云凭证，必须与备份一起安全保管。只允许明确的 HTTPS endpoint；私网 endpoint 需要精确 `S3_ENDPOINT_ALLOWLIST`。验证后再选默认存储；不要把真实访问密钥写进示例、聊天或 CI。S3 不在默认离线验收范围，也不会自动将所有已有本地资源迁移到云端。

## 备份与恢复（运维模板，未自动执行）

历史 `archive-deploy.js`（包括 `tools/legacy/` 入口）已禁用并以状态 1 退出，不创建或覆盖归档。旧的递归整库压缩可能把 `.deployment/`、环境密钥和私有数据一并带出，不能用于发布或备份；请使用本文的 Docker 发布流程与受访问控制的独立备份。

备份必须同时覆盖 PostgreSQL、站点私有数据卷（uploads、运行包 CAS、发布制品）、密钥配置及外部对象存储；只导出数据库不能恢复媒体。备份到受访问控制的异机位置并记录校验和，安装令牌和主密钥不能进入公开日志。

在维护窗口停止站点写入，确认配置文件的项目名 / 卷名，保持数据库运行。以下为本地配置的命令模板；先以私有终端读取项目名赋给 `PROJECT`，勿输出整个配置文件。

```sh
docker compose --project-name "$PROJECT" --env-file .deployment/local/config.env -f compose.yaml stop site
docker compose --project-name "$PROJECT" --env-file .deployment/local/config.env -f compose.yaml exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > /absolute/private/backup/site.dump
docker compose --project-name "$PROJECT" --env-file .deployment/local/config.env -f compose.yaml run --rm --no-deps -T site tar -C /app/data -cf - . > /absolute/private/backup/site-data.tar
docker compose --project-name "$PROJECT" --env-file .deployment/local/config.env -f compose.yaml start site
```

先确认备份目标不存在或使用新的带日期目录；不要覆盖唯一备份。备份期间不要升级应用。对于生产外部数据库，改用供应商备份 / pg_dump 流程，不要把本地 db 命令直接用于生产。

恢复必须先在**新的隔离项目、空白数据库和新数据卷**演练：由运维恢复角色与数据库归属，用 `pg_restore` 导入 dump，安全解包私有数据并保持 node 用户可读写，恢复同一主密钥和必要配置，验证 `/health/ready`、管理员登录、资源读取、版本预览与发布。确认恢复点与原站一致后，才另行批准切流。恢复会替换目标数据，不在启动器内自动执行；本任务没有声称真实灾备演练成功。

## 升级

保留原配置与卷；先做一致性备份并记录当前提交 / 镜像。阅读迁移说明，在维护窗口停写并准备回退。镜像更新后如健康检查显示不兼容，不要重跑安装器或手改迁移校验和。显式迁移已安装实例：

```sh
docker compose --project-name "$PROJECT" --env-file .deployment/local/config.env -f compose.yaml run --rm --no-deps site npm run db:migrate
npm run docker:up
```

`db:migrate` 拒绝未安装库，保留账号与历史，不自动创建管理员。完成后重新验证健康、登录、预览、公开页与旧版本读取。数据库迁移后的回退需要匹配的代码、数据库与数据备份，不能只换旧镜像。

## 可选授权旧引擎

`legacy-six-scenes-v1` 不在默认图片 / 字体 / 3D 素材分发范围。只有已取得权利的操作者才能准备运行包清单并按 `docs/ENGINE-RUNTIME.md` 登记，服务器固定路径白名单与哈希检查不会赋予版权。需要挂载源目录时使用只读长语法 bind，并设置 `bind.create_host_path: false`；错误路径应失败，不能静默创建空目录。不要把用户整个 home 或原始工程挂入容器。

已验证的测试 / 本机 Docker / 浏览器 / 公网生产 / 实际 S3 / 原站视觉是不同证据层，发布报告必须分别标注。

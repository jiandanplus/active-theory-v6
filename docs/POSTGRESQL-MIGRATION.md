# PostgreSQL 18 部署、升级与旧站切换

这是操作指南，不是对任何真实实例已迁移的声明。2026-10-13 的隔离验收与已知边界见 [实际验证记录](verification/postgresql-installation.md)。将代码推送到 GitHub 不会初始化数据库、重启当前服务或完成生产切换。

## 从哪里开始

- 首次部署：阅读下方数据库权限说明，然后选择「Compose 首次部署」或「外部数据库部署」。
- 旧 SQLite 站点：先阅读「旧站停机迁移门槛」，在新数据库与新媒体卷演练，不直接覆盖旧实例。
- 已安装 PostgreSQL 站点：先备份，再按「显式升级」维护；不要重复运行首次安装向导。
- 本机开发与功能介绍：见 [README](../README.md)；后台操作与 S3 设置见 [后台指南](ADMIN.md)。

当前功能位于 `feat/authenticated-resource-admin` 分支。新目录可使用以下命令；已有部署应先确认当前分支、备份和维护窗口，不要直接覆盖工作区：

```sh
git clone --branch feat/authenticated-resource-admin https://github.com/jiandanplus/active-theory-v6.git
cd active-theory-v6
```

仓库不包含被忽略的 `assets/`。完整 3D 页面需自行提供有授权的运行包，缺包时可以安装后台但公开页不会启动残缺场景。不要把历史下载脚本当作生产资源授权或初始化方案。

## 部署目标和权限

使用 Node.js >=24 与 PostgreSQL 18.x。应用必须连接非超级用户独立角色；角色只需专用数据库的 CONNECT、CREATE 权限及其自行创建对象的所有权。首次安装由 `001-initial.sql` 创建固定 `personal_site` schema；不要预建任意空 schema，也不要给应用超级用户权限来绕过预检。已有未知、空或漂移的 schema 会被拒绝，不能自动覆盖。

内置 Compose 创建单独 `site_bootstrap` 超级用户用于数据库管理，`docker/postgres-init.sh` 仅创建 `site_app` 非超级用户并授予专用数据库 CONNECT/CREATE，不创建应用 schema。脚本使用 psql 变量和 `format(%I/%L)` 引用角色、数据库、密码；不把密码拼入 shell SQL。初始化脚本只在全新 PG 卷执行；后续修改环境密码不会自动修改已有角色，需管理员在维护窗口单独轮换并同步 URL。

管理员可在外部数据库上执行等价授权（密码经交互 `\password site_app` 输入，不进入 SQL 历史）：

```sql
CREATE ROLE site_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE DATABASE personal_site;
GRANT CONNECT, CREATE ON DATABASE personal_site TO site_app;
-- 切到 personal_site 后：
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
```

不要把 `DATABASE_URL` 指向 bootstrap 账号。URL 中密码必须 URL 编码；`POSTGRES_APP_PASSWORD` 是原始密码，两者应对应。连接信息、安装令牌、主密钥都不能出现在日志、截图、Git 或分享链接。外部服务需安全 TLS；按服务的 CA 与证书要求配置连接，不能以关闭验证作为生产默认。安装令牌为本机生成 32–128 随机字节的偶数长度 hex；不要使用文档示例令牌。安装成功后移除 `SETUP_TOKEN` 并重建应用容器；即使重配新令牌也不能重复安装。

## Compose 首次部署

使用现代 Docker Compose（本次实际验证 v5.1.4）；模板未使用新式 `!reset`/`!override` 标签。准备已授权的 assets 内容包、域名 HTTPS 代理和受限部署环境文件，例如 `.env.deployment`（0600）。该名称受现有 `.env.*` 忽略规则保护，仍须检查 `git status`，不得强制加入 Git；示例中的口令、令牌和密钥必须替换，不能原样启动：

```dotenv
SITE_ORIGIN=https://your-domain.example
SITE_PORT=3000
SITE_ASSETS_DIR=./assets
DATABASE_URL=postgresql://site_app:URL_ENCODED_APP_PASSWORD@db:5432/personal_site
POSTGRES_USER=site_bootstrap
POSTGRES_PASSWORD=SEPARATE_BOOTSTRAP_PASSWORD
POSTGRES_DB=personal_site
POSTGRES_APP_USER=site_app
POSTGRES_APP_PASSWORD=RAW_APP_PASSWORD
SETUP_TOKEN=LOCALLY_GENERATED_HEX
SITE_MASTER_KEY=INDEPENDENT_LOCALLY_GENERATED_64_HEX
# 仅配置实际信任的反向代理网段；不能盲目填 true。
TRUST_PROXY=loopback
```

若容器内看到的代理 IP 不是回环地址，应配置准确的受信任地址/网段，而非照抄 loopback。应用在生产模式拒绝 HTTP `SITE_ORIGIN`；代理必须提供 HTTPS，转发 Host 与协议，并覆盖上传大小和模型请求超时。命令中的项目名和端口必须确认不与已有实例冲突。

```sh
docker compose --env-file .env.deployment -p personal-site -f compose.yaml config --quiet
docker compose --env-file .env.deployment -p personal-site -f compose.yaml up -d --build --wait
```

`config --quiet` 只验证，禁止直接输出展开的生产 config。数据库不映射宿主机端口；site 依赖 `pg_isready` healthy 后启动，运行期间断连仍返回维护状态。`site-data` 媒体卷和 `pg-data` 数据库卷独立；assets 只读挂载。PG18 官方镜像的 `PGDATA` 是 `/var/lib/postgresql/18/docker`，卷挂载父目录 `/var/lib/postgresql`；不能照抄 PG17 的 `/var/lib/postgresql/data`。镜像参考：[官方镜像说明](https://github.com/docker-library/docs/blob/master/postgres/README.md#pgdata)。生产应记录/固定经验证的镜像 digest，再评估升级，不假定浮动 18 标签永远同一小版本。

经 HTTPS 访问 `/admin/`：令牌授权 → 检查数据库 → 选择空白/服务器内容包/旧站来源 → 预检 → 创建或保留管理员 → 确认安装 → 手动登录。缺 `DATABASE_URL` 或数据库断连时后台壳仍可达，但不能安装。空白模式清空业务内容，授权运行资源齐全时仍可加载模板；缺运行包/字体/素材不会被装成“完整视觉网站”。`cms/` 仅是显式安装内容包的输入，运行时配置由 PG 快照提供，不从原 CMS 回源。

### 上线前验收

`up --wait` 只等待容器运行／健康，不代表账号初始化或 3D 页面已验收。逐项确认：

1. HTTPS 域名与 `SITE_ORIGIN` 一致；无数据库时后台显示维护提示，而非重新创建账号。
2. 安装后移除 `SETUP_TOKEN`，重建自己的 site 容器；旧账号仍可登录，不能再次初始化。
3. 上传小文件、保存草稿、登录预览、确认发布、退出登录，再用匿名窗口访问；私有草稿不可读。
4. 实际检查 Logo、黑洞、作品、联系浮层及音频；外链和 S3 的权限、CDN 与 CORS 使用最终域名验证。
5. 重建 site 后核对账号、发布版本和上传字节；另在独立目标演练恢复，不覆盖正在运行的库。

状态接口是 `/api/setup/status`，后台入口是 `/admin/`；旧 `/api/projects` 不是当前部署健康检查契约。容器日志查看仅限自己的 Compose 项目，分享前移除私有路径、临时 URL 与其他敏感信息。[Docker 官方环境文件说明](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/)、[启动与等待行为](https://docs.docker.com/reference/cli/docker/compose/up/)。

## 外部数据库部署

`compose.external.yaml` 是完整独立替代文件，**仅用 `-f compose.external.yaml`，不要与 `compose.yaml` 合并**。它没有 db 服务、depends_on、bootstrap 密码插值；只填外部非超级用户 `DATABASE_URL`、SITE_ORIGIN、令牌/密钥和资源配置。

```sh
docker compose --env-file .env.external -p personal-site -f compose.external.yaml config --quiet
docker compose --env-file .env.external -p personal-site -f compose.external.yaml config --services
# 应只列 site；不要求填写 POSTGRES_PASSWORD/POSTGRES_APP_PASSWORD。
docker compose --env-file .env.external -p personal-site -f compose.external.yaml up -d --build
```

外部库同样必须为 PG18，提供上述 CREATE 权限且未预建 personal_site；或恢复完整、受 checksum 与目录指纹校验的已安装 schema。任意手工建表、空 schema 或从无关库复制的指纹都不视作合法安装。

## 显式升级

`npm run db:migrate` 支持已安装数据库结构 1/2→3。它使用与安装相同的事务级 advisory lock `734216901`，锁内校验 PG18、schema 指纹和迁移 checksum，再顺序迁移；结构 3 重复运行是验证式 no-op。001/002 均不可修改。历史阶段 A 的 1→2 证据见[站点身份验证](verification/site-identity-upgrade.md)，本轮见[阶段 B 验证](verification/engine-delivery.md)，均不代表真实站点已升级。

### 从结构 1/2 升级到 3

在维护窗口停止应用写入和新构建，等待在途操作结束；先完成并验证 PostgreSQL、私有 `data/delivery`、uploads、授权 bundled 媒体和独立主密钥的一致备份。执行显式 `npm run db:migrate`，不重新初始化账号。

迁移保留历史内容和公开指针，将旧版本标记为 legacy。未生成兼容交付前网页返回维护 503；之后登记/选择包，在后台为当前旧版本执行“生成兼容交付”，或恢复为草稿后新发布。完成前台验证再恢复流量。数据库迁移成功不等于 3D 网站已经恢复可用。

兼容交付只生成一次，不代表当年原样重放。需改变包、内容或 SITE_ORIGIN 时发布新版本，不原地覆盖旧交付。schema 3 不承诺旧程序直接回滚；回退应恢复已验证的整套备份。迁移命令仍使用下方 stop → run db:migrate → up 流程，但必须等交付和浏览器门禁通过才恢复公开流量。

### 历史迁移 1→2 的行为（当前命令继续升级到 3）

新安装直接创建当前结构。已有实例不会在启动、登录或访问时自动升级；新程序检测到结构 1 时进入维护状态，不重新开放安装。

先在维护窗口停止旧应用写入，完成并验证 PostgreSQL、媒体和独立密钥备份，再在已确认的目标环境显式执行 npm run db:migrate。升级只补充当前站点字段和模板字段、增加一次草稿修订号；保留账号、资源 ID、安装来源和时间、发布指针及历史版本快照。无需再次创建管理员。

升级失败时数据库事务回滚；不要删除 schema 或重复初始化。结构 2 不能直接用旧程序回退运行；需要恢复时使用维护窗口内验证过的备份，不提供破坏性自动降级。升级前打开的后台编辑器应刷新后再编辑。

旧版本恢复只改变草稿，并以空描述、en 语言、空分享图补齐缺失字段。既有历史快照不被改写；旧引擎 metadata.json 接口保持原语义。

```sh
docker compose --env-file .env.deployment -p personal-site -f compose.yaml stop site
docker compose --env-file .env.deployment -p personal-site -f compose.yaml run --rm --no-deps site npm run db:migrate
docker compose --env-file .env.deployment -p personal-site -f compose.yaml up -d site
```

失败时保持维护并检查，不删 schema、不重置账号、不自动恢复旧 SQLite。不是 PG 主版本升级工具；当前拒绝 PG17/PG19。

## 备份与独立恢复

维护窗口停止 site，使 DB 与上传文件有一致边界；db 继续运行。备份目录使用 0700，dump/媒体包 0600，并加密离机保存。不要把备份放在公开静态目录。范例需先确认项目名、env 和目标路径：

```sh
umask 077
mkdir -p backup-YYYYMMDD
docker compose --env-file .env.deployment -p personal-site -f compose.yaml stop site
docker compose --env-file .env.deployment -p personal-site -f compose.yaml exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backup-YYYYMMDD/database.dump
docker compose --env-file .env.deployment -p personal-site -f compose.yaml run --rm --no-deps -T site tar -C /app/data -czf - . > backup-YYYYMMDD/private-data.tar.gz
# 包含 delivery/objects、staging、uploads（若存在）；不能只备份 uploads。
# 单独备份授权 bundled 媒体、原始运行包/清单、运行版本/SQL和部署配置；独立加密保管 SITE_MASTER_KEY。
docker compose --env-file .env.deployment -p personal-site -f compose.yaml up -d site
```

无 uploads 目录的空白站点需记录“尚无上传文件”，不能忽略 tar 错误当作备份成功。S3 dump 仅含对象引用与加密凭证，不含对象字节：启用桶版本控制/异地备份并记录 Endpoint、Bucket、前缀、公开 URL、对象策略、CORS 和保留期。历史版本引用不变，不会自动搬迁云对象或 bundled 媒体。主密钥丢失时旧凭证无法解密。

恢复必须到**新的隔离专用数据库**和新的媒体目录/卷，用独立端口和环境文件；保留原库。由数据库管理员创建恢复角色/数据库并授予同等权限后，以应用角色运行：

```sh
# 使用受限 .pgpass/服务配置，不在命令或日志打印 URL/密码。
pg_restore -h RESTORE_HOST -U RESTORE_APP_ROLE -d NEW_ISOLATED_DATABASE --no-owner --no-acl --exit-on-error backup-YYYYMMDD/database.dump
```

不要加 `--create`：它会以 dump 原数据库名恢复；也不要对原数据库加 `--clean`。解包完整 private-data 到新的空 site-data，保留运行用户所有权（CAS 目录 0700、对象 0600）；挂载同一备份的授权 bundled 媒体，配置独立保管的原 master key。核对 admins/resources/versions/runtime_bundles/delivery_artifacts/delivery_bindings 行数及对象摘要；运行 `npm run delivery:audit`，验证安装状态、账号、上传字节、历史、预览授权与匿名页面，再由用户确认切换。若恢复目标使用不同 SITE_ORIGIN，旧绑定应维护 503；先验证保留的程序字节与历史，再在新 Origin 明确新发布，不改写旧 manifest。参考 [PG18 dump/restore](https://www.postgresql.org/docs/18/backup-dump.html)、[pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html)。

`data/delivery` 不能被静态服务器/CDN 直接公开。对象缺失/损坏应从匹配备份恢复，不能回退当前 assets。`delivery:audit` 仅为只读瞬时诊断，不删除对象，也不判定在线 GC 安全；所有已登记包和 artifact（包括无 binding、已过期预览留下的 artifact）都属于保留集合。第一版无自动垃圾回收，清理须另行确认停机维护。

## 旧站停机迁移门槛

先用临时 root、媒体目录、UUID 数据库、独立端口完成只读报告和安装；`npm run import:check -- --root /AUTHORIZED_SOURCE --legacy /READ_ONLY_COPY/site.db --data-dir /NEW_PRIVATE_RUNTIME_DATA` 只输出报告，不连接目标生产库，不写 SQLite。`--data-dir` 必须是新应用真正使用的私有目录，先由操作员把停机备份的 uploads **复制**到该目录的 uploads，再预检；不能只迁移数据库元数据。不要为了预检重新打开真实数据；使用停机备份副本并确认完整性。

预检复用运行时对象 key／路径检查，拒绝 uploads 目录或对象路径符号链接，检查普通文件可读性并计算 SHA-256。检查在安装事务外完成；安装 API 再次预检，文件变化使旧 digest 失效。缺失／不可读／不安全文件按资源 ID 报告，不输出服务器绝对路径：实际引用的必需几何 BIN 会进入 `missingRequired`，影响草稿及相应历史模板 readiness；原始 GLB 依赖或未引用普通媒体缺失只警告。ID、引用、历史和 published 指针保留；仍允许带明确“不完整模板”报告安装，但不代表这些页面可用。必须在安装后核实关键页面，不能把“安装成功”当作视觉验收。安装器不复制、移动、删除上传文件，也不联网探测 S3。预检至安装完成期间保持备份与目标 staging 内容不变；完成后再开放写入。

### Docker：临时只读备份挂载与新私有卷交接

宿主机 `LEGACY_SQLITE_PATH` 不会自动出现在容器内。完整的**已停止旧写入后取得的备份目录**须包含 `site.db`、存在时的 `site.db-wal`／`site.db-shm` 和 `uploads/`；保留它们的同一时间边界，不只复制正在写入的主数据库文件。以下仅是操作范例，不要为验证范例停止真实服务。备份及 SQLite/WAL/SHM 绝不能放进 assets、cms 或其他公开目录。保留原备份所有权及哈希；如果备份是 0700，仅向容器 node UID 提供必要的只读目录遍历/读取权限（可用限定 ACL 或另一个权限受限的完整只读 staging 副本），不要放宽到全局可读。

先确认新数据库、新 Compose 项目名、新端口和全新 site-data 卷，且不是现存项目。创建仅本次迁移使用的 `compose.legacy-copy.yaml`（不修改两个默认模板）：

```yaml
services:
  site:
    environment:
      LEGACY_SQLITE_PATH: /legacy-backup/site.db
    volumes:
      - type: bind
        source: ${LEGACY_BACKUP_DIR:?Set absolute stopped-backup directory}
        target: /legacy-backup
        read_only: true
        bind:
          create_host_path: false
```

挂载整个备份目录而不是仅 site.db，以便 SQLite 只读连接找到对应 sidecar。源备份必须已停止写入且可只读打开；若只读 SQLite 无法打开，停止迁移并检查备份一致性/权限，不能把挂载改成可写来强行导入。参数选定后在同一个 shell 操作：

```sh
export LEGACY_BACKUP_DIR=/ABSOLUTE/PRIVATE/STOPPED_BACKUP
migration_project=NEW_UNIQUE_MIGRATION_PROJECT
migration_env=.env.deployment
migration_base=compose.yaml
# 外部 PG 改成 .env.external + compose.external.yaml；不要同时叠加两个 base。
dc() {
  docker compose --env-file "$migration_env" -p "$migration_project" \
    -f "$migration_base" -f compose.legacy-copy.yaml "$@"
}
dc config --quiet
dc build site
# 内置 PG 才运行下一行；外部 PG 应事先准备全新独立目标库。
dc up -d --wait db
# site 尚未启动。仅在全新且完全空的目标卷复制 uploads；有任何内容即失败。
# 不运行 mkdir -p 覆盖旧路径，也不把 SQLite 或备份整体复制到 /app/data。
dc run --rm --no-deps -T --user root site sh -ec '
  test -f /legacy-backup/site.db
  test -d /legacy-backup/uploads
  test ! -L /legacy-backup/uploads
  test -z "$(find /app/data -mindepth 1 -maxdepth 1 -print -quit)"
  cp -a -- /legacy-backup/uploads /app/data/uploads
  chown -hR node:node /app/data/uploads
'
# 再以镜像默认 node 用户预检，验证实际运行用户可读取源 SQLite 和目标媒体。
dc run --rm --no-deps -T site npm run import:check -- \
  --root /app --legacy /legacy-backup/site.db --data-dir /app/data
dc up -d site
```

`cp` 失败后不要盲目重跑或清空卷；保留源备份，检查部分目标副本，使用另一个全新目标卷重新演练。确实没有旧 uploads 时，先确认旧资源表无本地对象，再在全新目标卷创建 node 所有的空 uploads；不能忽略复制失败。源目录内的逃逸符号链接不会成为可用资源，需操作员解决并重新预检。请勿使用 `down -v` 删除真实卷。

通过 `/admin/` 选择旧站来源，检查报告、保留原账号并安装。比较备份前后哈希，核对版本/资源数量与 published 指针；逐项读取原始与派生上传字节（SHA-256 对比），以匿名访问权限验证已发布媒体和关键页面，并在应用重建后复查。未公开媒体应通过登录管理端验证，不应为了验收扩大匿名权限。HTTP 字节可读不等于 3D 内容视觉正确，关键页面仍需实际浏览器验收。

完成后从受限环境文件删除 `LEGACY_SQLITE_PATH` 和 `SETUP_TOKEN`，只用所选 base 重建 site，去掉临时挂载：

```sh
docker compose --env-file "$migration_env" -p "$migration_project" \
  -f "$migration_base" up -d --no-deps --force-recreate site
unset LEGACY_BACKUP_DIR
```

确认新容器没有 `/legacy-backup` 挂载，再收起临时 override 文件；保留备份，不删除原站数据。外部 PG 采用完全相同的临时 override、复制、预检、移除挂载步骤，只是 base 必须独立使用 `compose.external.yaml`，且跳过 `db` 服务命令。[Docker 官方 Compose 多文件合并说明](https://docs.docker.com/compose/how-tos/multiple-compose-files/merge/)、[bind mount 说明](https://docs.docker.com/engine/storage/bind-mounts/)。这些新迁移命令的验证范围见验证记录，不代表已执行生产迁移。

真实切换必须先交付验收给用户，确认数据库目标和维护时间；再针对明确 PID/服务停止旧写入（不 kill 所有 Node），备份 SQLite/WAL/SHM、本地媒体、资源与主密钥，设置受信任 `LEGACY_SQLITE_PATH` 进行首次安装。保留账号/ID/密文；会话失效需重新登录。不得删旧 data，不能以 SQLite 备份覆盖 PG 上线后的新写入。回滚需要明确的数据边界和用户确认；Git 推送与生产切换是两个独立操作。

## PG18 schema 指纹复现

指纹依赖 PostgreSQL 目录定义，不含 OID 或行数据。只在新建的 UUID 隔离库应用仓库未修改的 `001-initial.sql`，使用 `migrations.js` 的固定 `signatureQuery` 排序结果计算 SHA-256(JSON.stringify(rows))；同时核对 SQL checksum。不得从任意已运行 schema 抄一个 hash 来“修复”。本次在 18.4 的独立库重复生成并与固定签名核对（实际结果见验证记录），不能推断未来所有小版本都已验收。

```sh
docker compose -f compose.test.yaml -p site-pg-test up -d --wait
node scripts/test-postgres.js tests/deployment.test.js tests/postgres.test.js
```

`tests/deployment.test.js` 的指纹用例从仓库 SQL 建立干净结构并重复核对目录签名，fixture 清理自身 UUID 数据库；测试入口不回退到生产 URL。在新 PG18 小版本/镜像 digest 上必须重新执行，再运行完整 `npm run test:postgres` 与部署/恢复验收。若签名变化，停止上线，分析实际目录差异，而非自动改常量。

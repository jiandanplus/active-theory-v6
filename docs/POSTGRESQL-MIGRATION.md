# PostgreSQL 18 部署、升级与旧站切换

这是操作指南，不是对当前真实实例已迁移的声明。2026-10-13 的隔离验收与已知边界见 [实际验证记录](verification/postgresql-installation.md)。当前用户的 3000 端口服务未由本次操作重新启动，也未进行生产切换或 push。

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

使用现代 Docker Compose v2（本次实际验证 v5.1.4）；模板未使用新式 `!reset`/`!override` 标签。准备已授权的 assets 内容包、域名 HTTPS 代理和受限部署环境文件，例如 `deployment.env`（0600）：

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
docker compose --env-file deployment.env -p personal-site -f compose.yaml config --quiet
docker compose --env-file deployment.env -p personal-site -f compose.yaml up -d --build --wait
```

`config --quiet` 只验证，禁止直接输出展开的生产 config。数据库不映射宿主机端口；site 依赖 `pg_isready` healthy 后启动，运行期间断连仍返回维护状态。`site-data` 媒体卷和 `pg-data` 数据库卷独立；assets 只读挂载。PG18 官方镜像的 `PGDATA` 是 `/var/lib/postgresql/18/docker`，卷挂载父目录 `/var/lib/postgresql`；不能照抄 PG17 的 `/var/lib/postgresql/data`。镜像参考：[官方镜像说明](https://github.com/docker-library/docs/blob/master/postgres/README.md#pgdata)。生产应记录/固定经验证的镜像 digest，再评估升级，不假定浮动 18 标签永远同一小版本。

经 HTTPS 访问 `/admin/`：令牌授权 → 检查数据库 → 选择空白/服务器内容包/旧站来源 → 预检 → 创建或保留管理员 → 确认安装 → 手动登录。缺 `DATABASE_URL` 或数据库断连时后台壳仍可达，但不能安装。空白站点只建立后台；缺运行包/字体/素材不会被装成“完整视觉网站”。`cms/` 仅是显式安装内容包的输入，运行时配置由 PG 快照提供，不从原 CMS 回源。

## 外部数据库部署

`compose.external.yaml` 是完整独立替代文件，**仅用 `-f compose.external.yaml`，不要与 `compose.yaml` 合并**。它没有 db 服务、depends_on、bootstrap 密码插值；只填外部非超级用户 `DATABASE_URL`、SITE_ORIGIN、令牌/密钥和资源配置。

```sh
docker compose --env-file external.env -p personal-site -f compose.external.yaml config --quiet
docker compose --env-file external.env -p personal-site -f compose.external.yaml config --services
# 应只列 site；不要求填写 POSTGRES_PASSWORD/POSTGRES_APP_PASSWORD。
docker compose --env-file external.env -p personal-site -f compose.external.yaml up -d --build
```

外部库同样必须为 PG18，提供上述 CREATE 权限且未预建 personal_site；或恢复完整、受 checksum 与目录指纹校验的已安装 schema。任意手工建表、空 schema 或从无关库复制的指纹都不视作合法安装。

## 显式升级

先备份并确认维护窗口，停止应用写入，再运行 `npm run db:migrate`。它仅接受已安装实例，使用与安装相同的事务级 advisory lock `734216901`，锁内校验 PG18、schema 指纹与迁移 checksum，再调用版本迁移。当前只存在 001，因此在合法 v1 上重复运行是验证式 no-op；不会创建管理员，也不把未安装库变成已安装。未来 schema 升级需要增加经审查的顺序迁移及对应旧版本校验规则，不能修改已发布 001 来让 checksum“通过”。

```sh
docker compose --env-file deployment.env -p personal-site -f compose.yaml stop site
docker compose --env-file deployment.env -p personal-site -f compose.yaml run --rm --no-deps site npm run db:migrate
docker compose --env-file deployment.env -p personal-site -f compose.yaml up -d site
```

失败时保持维护并检查，不删 schema、不重置账号、不自动恢复旧 SQLite。不是 PG 主版本升级工具；当前拒绝 PG17/PG19。

## 备份与独立恢复

维护窗口停止 site，使 DB 与上传文件有一致边界；db 继续运行。备份目录使用 0700，dump/媒体包 0600，并加密离机保存。不要把备份放在公开静态目录。范例需先确认项目名、env 和目标路径：

```sh
umask 077
mkdir -p backup-YYYYMMDD
docker compose --env-file deployment.env -p personal-site -f compose.yaml stop site
docker compose --env-file deployment.env -p personal-site -f compose.yaml exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > backup-YYYYMMDD/database.dump
docker compose --env-file deployment.env -p personal-site -f compose.yaml run --rm --no-deps -T site tar -C /app/data -czf - uploads > backup-YYYYMMDD/uploads.tar.gz
# 单独备份授权 assets、运行版本/SQL/清单以及部署配置；独立加密保管 SITE_MASTER_KEY。
docker compose --env-file deployment.env -p personal-site -f compose.yaml up -d site
```

无 uploads 目录的空白站点需记录“尚无上传文件”，不能忽略 tar 错误当作备份成功。S3 dump 仅含对象引用与加密凭证，不含对象字节：启用桶版本控制/异地备份并记录 Endpoint、Bucket、前缀、公开 URL、对象策略、CORS 和保留期。历史版本引用不变，不会自动搬迁云对象或 bundled 媒体。主密钥丢失时旧凭证无法解密。

恢复必须到**新的隔离专用数据库**和新的媒体目录/卷，用独立端口和环境文件；保留原库。由数据库管理员创建恢复角色/数据库并授予同等权限后，以应用角色运行：

```sh
# 使用受限 .pgpass/服务配置，不在命令或日志打印 URL/密码。
pg_restore -h RESTORE_HOST -U RESTORE_APP_ROLE -d NEW_ISOLATED_DATABASE --no-owner --no-acl --exit-on-error backup-YYYYMMDD/database.dump
```

不要加 `--create`：它会以 dump 原数据库名恢复；也不要对原数据库加 `--clean`。解包 uploads 到新 site-data，保留运行用户所有权；挂载相同授权 bundled 资源并配置独立保管的原 master key。对 admins/resources/versions 等记录行数、检查安装状态/指纹、用原账号登录、读取上传字节并验证匿名发布页面，再由用户确认切换。参考 [PG18 dump/restore](https://www.postgresql.org/docs/18/backup-dump.html)、[pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html)。

## 旧站停机迁移门槛

先用临时 root、媒体目录、UUID 数据库、独立端口完成只读报告和安装；`npm run import:check -- --root /AUTHORIZED_SOURCE --legacy /READ_ONLY_COPY/site.db` 只输出报告，不连接目标生产库，不写 SQLite。不要为了预检重新打开真实数据；使用停机备份副本并确认完整性。

真实切换必须先交付验收给用户，确认数据库目标和维护时间；再针对明确 PID/服务停止旧写入（不 kill 所有 Node），备份 SQLite/WAL/SHM、本地媒体、资源与主密钥，设置受信任 `LEGACY_SQLITE_PATH` 进行首次安装。保留账号/ID/密文；会话失效需重新登录。不得删旧 data，不能以 SQLite 备份覆盖 PG 上线后的新写入。回滚需要明确的数据边界和用户确认；本次没有自动切换、发布公网或 push。

## PG18 schema 指纹复现

指纹依赖 PostgreSQL 目录定义，不含 OID 或行数据。只在新建的 UUID 隔离库应用仓库未修改的 `001-initial.sql`，使用 `migrations.js` 的固定 `signatureQuery` 排序结果计算 SHA-256(JSON.stringify(rows))；同时核对 SQL checksum。不得从任意已运行 schema 抄一个 hash 来“修复”。本次在 18.4 的独立库重复生成并与固定签名核对（实际结果见验证记录），不能推断未来所有小版本都已验收。

```sh
docker compose -f compose.test.yaml -p site-pg-test up -d --wait
node scripts/test-postgres.js tests/deployment.test.js tests/postgres.test.js
```

`tests/deployment.test.js` 的指纹用例从仓库 SQL 建立干净结构并重复核对目录签名，fixture 清理自身 UUID 数据库；测试入口不回退到生产 URL。在新 PG18 小版本/镜像 digest 上必须重新执行，再运行完整 `npm run test:postgres` 与部署/恢复验收。若签名变化，停止上线，分析实际目录差异，而非自动改常量。

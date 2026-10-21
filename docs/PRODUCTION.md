# 手动生产部署：Docker 镜像、1Panel 与原站内容

这份指南用于将 GitHub `main` 的代码和预构建镜像部署到自己的 Linux 服务器。示例域名为 `agi.drawbookai.cn`，请只操作自己拥有的域名和服务器。本文是操作说明，不表示服务器、DNS、证书或公网网站已经部署完成。

## 1. 先分清三个交付物

| 交付物 | 包含 | 不包含 |
| --- | --- | --- |
| GitHub 源码 | 后台、内容协议、数据库迁移、Docker 与文档 | 本机数据库、密码、上传文件、未提交的视觉实验 |
| Docker 应用镜像 | Node.js 24、锁文件生产依赖、同一版本服务代码 | 管理员、私钥、数据库、授权素材、已发布 v5 内容 |
| 私有站点迁移备份 | PostgreSQL、完整私有 data、授权 bundled 素材、原主密钥 | 不得上传公开仓库、镜像仓库或公开 Release |

应用镜像不包含原站素材 `assets/`。仅加载镜像可以启动后台，但不能凭空得到本机的黑洞、Logo、模型、字体或作品。需要保留现有画面时，迁移完整的原站数据与授权素材，不能改选 `portfolio-v1` 示例。数据库保存内容与资源记录，媒体字节仍在私有卷或 S3，不是存进镜像。

## 2. 获取源码与镜像

需要 Linux x86_64、Docker Engine 和 Compose v2。交付的 `linux/amd64` 镜像不能直接冒充 ARM64 镜像；ARM 服务器应重新构建相应平台。

```sh
git clone --branch main https://github.com/jiandanplus/active-theory-v6.git
cd active-theory-v6
```

从本机交付目录将 `portfolio-images-linux-amd64.tar.gz`、`SHA256SUMS`、`release.json` 复制到服务器上的独立发布目录。它们是本地离线交付文件，不假定已上传 GHCR / Docker Hub / GitHub Release。先在该目录校验和导入：

```sh
sha256sum --check SHA256SUMS
docker image load --input portfolio-images-linux-amd64.tar.gz
```

`release.json` 记录源码提交、目标架构、镜像标签 / ID 和归档校验值；用其中的应用标签填写 `SITE_IMAGE`。归档同时包含 PostgreSQL 18 的 amd64 镜像，避免首次启动必须再下载数据库镜像。镜像导入不启动容器，也不创建或覆盖数据库。

需要自行构建时，先确认工作目录是目标提交且没有把私有数据带入上下文：

```sh
docker buildx build --platform linux/amd64 --load --tag active-theory-portfolio:my-release .
docker image save --output portfolio-app.tar active-theory-portfolio:my-release
```

预构建镜像没有运行时 npm 安装步骤。官方命令参考：[跨平台构建](https://docs.docker.com/build/building/multi-platform/)、[保存镜像](https://docs.docker.com/reference/cli/docker/image/save/)、[导入镜像](https://docs.docker.com/reference/cli/docker/image/load/)。

## 3. 配置全新的独立生产实例

使用仓库根目录的 `compose.production.yaml`，**不要与开发用 `compose.yaml` 叠加**。该文件不执行 build，应用设为 production，仅绑定 `127.0.0.1:3302`，PostgreSQL 不映射公网端口；两个命名卷分别保存站点文件与 PG18 数据。

```sh
install -d -m 700 .deployment
test -e .deployment/production.env || cp docker/production.env.example .deployment/production.env
chmod 600 .deployment/production.env
```

在私有编辑器填写该文件。新安装的 `POSTGRES_PASSWORD`、`POSTGRES_APP_PASSWORD`、`SITE_MASTER_KEY`、`SETUP_TOKEN` 应分别生成独立的 64 位 hex；每个值都重新运行一次下面命令，不要重复使用同一个值，也不要发到聊天或 CI 日志：

```sh
openssl rand -hex 32
```

设置 `SITE_IMAGE` 为交付清单中的准确标签、`SITE_ORIGIN=https://agi.drawbookai.cn`。已初始化数据库不要直接改密码文件：这不会同步修改 PostgreSQL 角色密码。**迁移已有站点时必须恢复原 `SITE_MASTER_KEY`，不是生成新值替代它。** 应用账号固定为 `site_app`，与仅用于初始化的 `site_bootstrap` 分离。

先确认 3302 未被其他服务占用，再执行：

```sh
docker compose -p agi-portfolio --env-file .deployment/production.env -f compose.production.yaml config --quiet
docker compose -p agi-portfolio --env-file .deployment/production.env -f compose.production.yaml up -d --no-build --wait --wait-timeout 180
docker compose -p agi-portfolio --env-file .deployment/production.env -f compose.production.yaml ps
curl --fail http://127.0.0.1:3302/health/ready
```

不要把 `docker compose config` 的完整结果公开，其中包含密钥。`/health/ready` 返回 200 只证明数据库和安装结构可用，未安装实例也可能就绪；不证明素材、页面画面或证书正确。

若使用已有云 PostgreSQL，继续使用独立的 [`compose.external.yaml`](../compose.external.yaml)，不要启动第二个内置数据库；为它提供预构建镜像 override，或按 [DEPLOYMENT.md](../DEPLOYMENT.md#生产与外部-postgresql) 自行构建。

## 4. 1Panel、域名和 HTTPS（由部署者执行）

1. 在 DNS 控制台把 `agi.drawbookai.cn` 的 A 记录指向目标服务器公网 IP。仅在服务器真正支持 IPv6 时保留相应 AAAA；检查域名的 CAA 策略是否允许选用的证书机构。大陆服务器还应先确认自己的备案及接入要求。
2. 80 / 443 由现有 1Panel OpenResty 使用，不要再启动占用同端口的 Nginx、Caddy 或第二个代理。数据库、应用和 1Panel 管理内部端口不应因为部署本站而新增公网开放。
3. 在 1Panel 的“网站”中创建该域名的独立反向代理站点，上游为 `http://127.0.0.1:3302`。若 OpenResty 不是 host 网络，该地址指向代理容器自身，应改用实际可达的受控网络地址；不要为省事将应用端口映射到 `0.0.0.0`。
4. 由该站点的证书入口申请覆盖 `agi.drawbookai.cn` 的证书。使用 1Panel 原生 ACME / 自动续期；HTTP-01 需要公共 80 端口及验证目录可达。已有管理域名证书不代表覆盖本站，也不要覆盖其他站点的证书。
5. 证书签发并绑定成功后启用 HTTPS，确认验证路径不会被错误拦截，再启用 HTTP→HTTPS 跳转。检查续期任务、到期提醒以及续期后重载代理的关联。
6. 设置代理上传大小和超时，例如 `client_max_body_size 256m`、`proxy_read_timeout 300s`、`proxy_send_timeout 300s`；应用自身文件类型和大小限制仍有效。保持 `Host` / `X-Forwarded-Host`，设置 `X-Forwarded-Proto`，不能对 `/api/`、`/admin/`、认证预览及私有媒体启用公共缓存。

`TRUST_PROXY` 默认空值，不信任转发来源。若需要使用真实客户端 IP，先检查应用实际收到的代理 peer，只配置该地址（Docker 的网桥网关可能不是 127.0.0.1）；不要设置成无条件信任或整个私网。不能用开发 cookie 绕过 HTTPS。管理入口为 `https://agi.drawbookai.cn/admin/`，与 `SITE_ORIGIN` 完全一致。

## 5. 全新安装与原站迁移是两条不同路径

全新站点：HTTPS 正常后打开 `/admin/`，使用私有配置中的安装令牌，创建自己的管理员。没有默认账号 / 密码。安装后清空 `SETUP_TOKEN` 并只重建应用容器；不要重置数据库。原站完整素材准备和运行包登记按 [ENGINE-RUNTIME.md](ENGINE-RUNTIME.md) 执行，不能把示例站当成原站恢复。

**当前个人网站应使用本地已发布的 v5 内容，不使用当前预览草稿。** 这份发布仅交付源码与镜像，没有将本机数据库、上传资源或 v5 数据打入公开镜像，也没有自动导出私有迁移包。部署者迁移时需要：

1. 在本机自己的运行实例停写，按 [备份步骤](../DEPLOYMENT.md#备份与恢复运维模板) 导出一致的 PostgreSQL 与完整私有 data，并另存所有授权 bundled 素材、原运行包 / 清单和原主密钥。不要只复制 `assets/`、只导出数据库或压缩整个项目根目录。
2. 在服务器创建新的空白数据库和私有卷，先恢复同一份备份；恢复过程参见 [PostgreSQL 独立恢复](POSTGRESQL-MIGRATION.md#备份与独立恢复)。不要在已经初始化的站点上重跑安装向导，不用 `--clean` 导入现有库。还原文件需保持容器 node 用户可读写；不要宽泛递归修改未知路径所有权。
3. 将授权素材按原逻辑路径只读挂载到容器，使用长语法 bind 和 `create_host_path: false`。没有提供素材挂载的默认生产配置不会自动补齐它们。源站挂载声明需要按服务器上的新绝对路径另建 override，不能直接照抄本机 `/Users/...` 路径。
4. 启动后后台登录，运行 `docker compose -p agi-portfolio --env-file .deployment/production.env -f compose.production.yaml exec -T site npm run delivery:audit`。核对原账号、资源和历史保留；素材 override 必须同时加入所有相关 compose 命令。
5. 新域名下旧发布的 Origin 绑定仍指向 localhost，公开页暂时返回 503 是预期保护，**不要篡改历史 manifest / Origin**。后台“发布历史”选择 **v5 → 恢复为草稿**，明确覆盖的只是新服务器副本；本机草稿保持不动。确认选用原 `legacy-six-scenes-v1` 运行包，预览原 Logo、黑洞、粒子、作品与联系页后，在新 HTTPS Origin 下重新发布。
6. 新发布会生成新版本号，内容来自 v5；不要求或强行改写成版本号 5。完整数据库备份可能包含未发布草稿和历史，这些不应被误选为上线内容。若不希望将其带到服务器，应另行制作并验证内容裁剪迁移，不直接删表。

## 6. 上线前验收、升级与回滚

上线检查至少覆盖：有效 HTTPS / 域名、后台登录与安全 cookie、匿名不能读取草稿、首页 / Work / Contact 和移动端、原 3D Logo / 黑洞 / 粒子、上传与 GLB 转换、图片 / 视频 / 模型的实际字节、社媒链接与二维码、重建后持久数据、ACME 自动续期。真实 S3 另测上传 / 公共 URL / CORS，不以“测试连接成功”代替。

升级前记录源码 SHA、镜像 ID、当前发布版本，备份同一维护窗口的数据库、私有卷和密钥；只在自己的项目更新 `SITE_IMAGE`，用同一生产 Compose 和素材 override 启动。需要结构迁移时按 [升级说明](../DEPLOYMENT.md#升级) 显式执行，不自动重新安装。

```sh
# 仅停止自己的项目，持久卷保留
docker compose -p agi-portfolio --env-file .deployment/production.env -f compose.production.yaml down
```

**不要执行 `down -v`、不要删除卷、不要覆盖唯一备份。** 无数据库变化时可回到已记录旧镜像并重建自己的应用；发生结构或数据变化时，回退需恢复匹配的代码、数据库、私有文件和主密钥。切流前先在新的隔离目标验证，不影响已有 1Panel 和其他网站。

# Personal Portfolio CMS

保留原有 3D 个人网站，为作品列表等内容增加中文管理后台、登录认证、PostgreSQL 数据、本地/S3 资源存储、草稿预览与发布。前台的原 Logo、粒子、黑洞、布局和交互不是本次后台改造的重新设计对象。

后台只开放业务内容：顶部 3D Logo、场景文案、作品、音乐、开场视频与封面、底部六边形屏内容，以及联系链接、社媒图标和微信二维码。系统材质、贴图、反射、灯光、粒子参数与内部模型隐藏并由保存接口保护，不删除原素材。具体替换入口和预览发布步骤见 [后台使用说明](docs/ADMIN.md#内容替换入口与固定视觉)。

安装默认选择“保留原站页面（服务器内容包）”。`portfolio-v1` 只是可选的独立示例，页面与原站不同，不能用它代替原站交付或视觉验收。已有网站不要为了配置作品而切换到该示例；原模板使用 `legacy-six-scenes-v1`。相关纠偏与实际验证见 [原前端恢复记录](docs/verification/original-frontend-correction.md)。

## 一条命令启动

需要 Node.js 24+、npm 和带 Compose v2 的 Docker；先启动 Docker。无需先配置真实云服务。镜像不分发原站授权素材：后台能启动不代表原 3D 前台已经就绪，保留原站效果需要提供自己的完整原素材及受支持运行包，详见部署说明。

```sh
git clone --branch main https://github.com/jiandanplus/active-theory-v6.git
cd active-theory-v6
npm run docker:up
```

默认只监听本机 `http://127.0.0.1:3300`。启动器首次创建 `.deployment/local/config.env`，使用独立随机值生成数据库超级用户密码、应用角色密码、安装令牌和加密主密钥；再次执行保留原文件与持久卷。没有默认管理员账号或密码。交互终端会显示安装令牌，非交互日志隐藏令牌；需要时在私有终端执行 `npm run docker:token`。不要把令牌、配置文件或数据库 URL 发到聊天或公开日志。

首次使用：

1. 打开 `/admin/`，输入安装令牌，检查数据库。
2. 保持默认“保留原站页面”，预检原素材与原配置，创建自己的管理员密码，完成后手动登录；已有后台数据请使用明确的只读迁移流程，不要重置现有数据库。
3. 由服务器管理员按 [原运行包说明](docs/ENGINE-RUNTIME.md) 登记原站受支持程序包，在后台明确选择 `legacy-six-scenes-v1`。缺失素材应补回原文件，不用替代模板冒充恢复。
4. 在作品管理里修改名称、链接、封面、视频与排序，保存草稿，预览，再发布；验收对象是原 Work 页面和原 3D 场景。

只有明确想另建一个不同的示例网站时才选择示例模式，其独立流程是：总览 → 运行包 → 添加内置个人主页模板 → 在下拉框选择 `portfolio-v1` → 保存草稿 → 预览草稿 → 发布网站。此流程不保留原站视觉。

```sh
npm run docker:status
npm run docker:down
# 可选择其他本地端口；现有目录不会被改写
npm run docker:up -- --port 3400 --directory .deployment/another-local
```

`down` 不删除卷。不要用 `down -v` 代替。修改现有配置中的数据库密码不会更新已经初始化的数据库。

## 代码与数据边界

应用入口是 `server.js`，HTTP 组合位于 `admin-server/app.js`；后台浏览器模块位于 `admin-ui/modules/`；内容校验由 `shared/content-contract.js` 共享；示例位于 `examples/portfolio/`。PostgreSQL 保存业务记录、账号、资源引用和发布版本；私有 Docker 数据卷保存上传文件、运行包和发布制品；S3 为可选资源存储。公开请求不能读取草稿或任意服务器路径。

`GET /health/live` 检查进程，`GET /health/ready` 检查数据库与兼容安装状态；尚未安装但数据库可用也是就绪。生产入口必须 HTTPS；本地 HTTP 仅用于 loopback 演示，不能把开发模式配置作为公网部署。

## Docker 镜像与生产部署

自带 PostgreSQL 18 的生产部署使用独立 [compose.production.yaml](compose.production.yaml)，通过 `SITE_IMAGE` 选择已导入的镜像，不从当前工作目录自动构建；环境变量模板见 [docker/production.env.example](docker/production.env.example)。数据库不暴露宿主机端口，应用只监听 loopback，由现有 HTTPS 代理接入。

镜像打包、离线导入、1Panel 域名 / 证书、管理员初始化，以及将本机已发布 v5 内容迁移到新域名的步骤，见 [手动生产部署指南](docs/PRODUCTION.md)。镜像不包含本机账号、数据库、上传或授权原素材，也不等于已经上线。已有云 PostgreSQL 可使用 `compose.external.yaml`；不要将本地开发用 Compose 直接暴露公网。

## 开发与验证

```sh
npm ci
npm run lint
npm run format:check
npm run typecheck
npm run test:launcher
# 专用测试 PostgreSQL；不会操作真实站点数据库
docker compose -f compose.test.yaml up -d --wait
npm test
```

基础测试使用自建临时资源与专用 PostgreSQL，不需要原站素材。原站兼容性是独立且需要显式授权的门禁：`AUTHORIZED_RUNTIME_ROOT=/absolute/authorized/root npm run test:authorized-runtime`；没有素材会失败，不等于已经验证原站运行效果。CI 的绿色基础检查只证明代码、示例与隔离 Docker 路径，不证明生产 TLS、真实 S3、原站素材授权或浏览器视觉验收。

开发范围与质量工具的精确覆盖见 [CONTRIBUTING.md](CONTRIBUTING.md)。生产 / 外部 PostgreSQL、备份恢复和升级见 [DEPLOYMENT.md](DEPLOYMENT.md)。示例来源与未知继承内容的许可边界见 [PROVENANCE.md](PROVENANCE.md) 和 [THIRD_PARTY.md](THIRD_PARTY.md)。历史工具说明见 [tools/README.md](tools/README.md)，授权旧引擎协议见 [docs/ENGINE-RUNTIME.md](docs/ENGINE-RUNTIME.md)。

本轮架构与本地 Docker 交付的实际测试、浏览器、镜像身份和隔离恢复结果见 [C/D 验收记录](docs/verification/modular-docker-delivery.md)。记录明确区分自有示例验收、原 3D 场景视觉、公网部署和真实云存储，不把它们混为同一个完成结论。

## 许可状态

仓库未为全部历史代码或素材指定新的统一许可证。发布者必须确认继承代码、品牌、字体、模型与媒体的权利后，再决定如何许可和分发。新增样例不是“已获得原站素材授权”的声明。

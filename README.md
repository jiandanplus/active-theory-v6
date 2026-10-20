# Personal Portfolio CMS

可自托管的个人作品网站：中文管理后台、受保护的首次安装、PostgreSQL 内容与版本、私有资源库、认证预览，以及可追踪发布。默认提供本项目新写的 `portfolio-v1` 示例，不依赖原 Active Theory 的 JavaScript、字体、模型或媒体。它是新的作品集页面和程序化 WebGL 装饰，不是原站 3D 视觉的等价复制。

## 一条命令启动

需要 Node.js 24+、npm 和带 Compose v2 的 Docker；先启动 Docker。无需先下载原站素材，也无需先配置真实云服务。

```sh
git clone <YOUR_REPOSITORY_URL>
cd <YOUR_CHECKOUT>
npm run docker:up
```

默认只监听本机 `http://127.0.0.1:3300`。启动器首次创建 `.deployment/local/config.env`，使用独立随机值生成数据库超级用户密码、应用角色密码、安装令牌和加密主密钥；再次执行保留原文件与持久卷。没有默认管理员账号或密码。交互终端会显示安装令牌，非交互日志隐藏令牌；需要时在私有终端执行 `npm run docker:token`。不要把令牌、配置文件或数据库 URL 发到聊天或公开日志。

首次使用：

1. 打开 `/admin/`，输入安装令牌，检查数据库。
2. 选择自带作品集示例（或空白内容），创建自己的管理员密码，完成后手动登录。
3. 按顺序操作：总览 → 运行包 → 添加内置个人主页模板 → 在下拉框选择 `portfolio-v1` → 保存草稿 → 预览草稿 → 发布网站；样例路径见 [部署说明](DEPLOYMENT.md)。
4. 修改网站信息与作品，保存草稿，认证预览，再发布；打开公开首页和 `/work/<作品标识>` 验证。

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

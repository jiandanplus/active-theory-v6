<h1 align="center">Personal Portfolio CMS</h1>

<h3 align="center">3D 个人主页与作品集管理系统</h3>

<p align="center">
  <a href="https://v6.activetheory.net/">
    <img src="https://img.shields.io/badge/%E5%8E%9F%E7%BD%91%E7%AB%99-Active%20Theory%20v6-64748B?style=flat-square" alt="原网站：Active Theory v6" height="24" />
  </a>
  &nbsp;
  <a href="https://agi.drawbookai.cn/">
    <img src="https://img.shields.io/badge/%E5%9C%A8%E7%BA%BF%20Demo-AGI%20Voyager-0EA5E9?style=flat-square" alt="在线 Demo：AGI Voyager" height="24" />
  </a>
</p>

---

## 项目介绍

一个带有 3D 交互效果和中文管理后台的个人主页项目，适合展示个人介绍、作品集和联系方式。

支持在后台管理作品、文案、3D Logo、视频、社媒链接和二维码，提供登录认证、本地 / S3 兼容存储、草稿预览与发布，并支持 Docker 自托管部署。

## 项目来源与参考

本项目参考 [Active Theory v6](https://v6.activetheory.net/)，在原有页面、视觉与交互效果的基础上修改，增加个人网站后台管理能力，并重新打包发布。感谢 Active Theory 团队的设计与交互参考。

本项目并非 Active Theory 官方项目，注明来源不代表获得原站代码或素材的使用及再分发授权。相关许可说明见 [PROVENANCE.md](PROVENANCE.md) 和 [THIRD_PARTY.md](THIRD_PARTY.md)。

## 在线 Demo

[访问在线演示：agi.drawbookai.cn](https://agi.drawbookai.cn/)

## 一条命令启动

需要 Node.js 24+ 和 Docker Compose v2，并确保 Docker 已启动。

```sh
git clone --branch main https://github.com/jiandanplus/active-theory-v6.git
cd active-theory-v6
npm run docker:up
```

启动后访问：

- 网站：<http://127.0.0.1:3300/>
- 后台：<http://127.0.0.1:3300/admin/>

首次打开后台，按安装向导创建自己的管理员账号。安装令牌可在私有终端执行 `npm run docker:token` 查看；内容修改后按“保存草稿 → 预览 → 发布”生效。后台操作见 [使用说明](docs/ADMIN.md)。

仓库和默认镜像不包含原站完整 3D 素材。要使用在线 Demo 的原场景，需自行准备有权使用的素材与运行包，见 [原场景配置](docs/ENGINE-RUNTIME.md)。

<details>
<summary>可选：不准备原站素材，先体验独立示例</summary>

安装时选择示例模式，登录后操作：总览 → 运行包 → 添加内置个人主页模板 → 在下拉框选择 `portfolio-v1` → 保存草稿 → 预览草稿 → 发布网站。

这是独立的个人主页示例，不是在线 Demo 的原 3D 场景。

</details>

```sh
npm run docker:status
npm run docker:down
```

`docker:down` 停止本地服务并保留数据。

## 部署

生产环境使用独立的 `compose.production.yaml`，包含应用和 PostgreSQL 18。下面以 Linux amd64 服务器为例：

```sh
docker buildx build --platform linux/amd64 --load -t personal-portfolio:latest .
install -d -m 700 .deployment
test -e .deployment/production.env || cp docker/production.env.example .deployment/production.env
chmod 600 .deployment/production.env
```

编辑 `.deployment/production.env`，将 `SITE_IMAGE` 设置为 `personal-portfolio:latest`，填写自己的 HTTPS 域名，并分别配置数据库密码、主密钥和首次安装令牌。然后启动：

```sh
docker compose -p personal-portfolio --env-file .deployment/production.env -f compose.production.yaml up -d --no-build --wait
```

应用默认只监听 `127.0.0.1:3302`，需通过 Nginx / 1Panel 等反向代理接入域名与 HTTPS。完整配置、镜像导入、原站数据迁移见 [生产部署指南](docs/PRODUCTION.md)；外部数据库、备份与升级见 [部署文档](DEPLOYMENT.md)。

## 二次开发

开发环境使用 Node.js 24+ 和 PostgreSQL 18。先安装依赖，准备本地配置：

```sh
npm ci
test -e .env || cp .env.example .env
chmod 600 .env
```

按 `.env.example` 配置开发用 `DATABASE_URL`、`SITE_ORIGIN` 和首次安装的 `SETUP_TOKEN`，再运行 `npm run dev`。默认访问 `http://localhost:3000`。

主要代码位置：

```text
server.js       服务启动入口
admin-server/   后台 API、认证、数据库与资源存储
admin-ui/       中文管理后台界面
shared/         前后端共享的内容校验与配置
examples/       独立个人主页示例
docs/           使用、部署与开发文档
```

代码检查与测试：

```sh
npm run lint
npm run format:check
npm run typecheck
npm run test:launcher
docker compose -p site-pg-test -f compose.test.yaml up -d --wait
npm test
```

测试请使用专用数据库，不要连接已有站点的生产数据库。详细开发规范与测试范围见 [CONTRIBUTING.md](CONTRIBUTING.md)。

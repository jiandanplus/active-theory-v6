# active-theory-v6 (Sanitized)

该仓库是 `active-theory-v6` 的脱敏可公开版本，包含本地代理服务、CMS 数据编辑接口、文案注入脚本与部署脚本。

## 1. 已完成的脱敏处理

1. 将服务端与下载脚本中的上游地址改为环境变量可配置，不再硬编码。
2. 将默认联系邮箱替换为占位值 `contact@example.com`。
3. 将 `patch-search-text.js` 中默认邮箱、二维码地址、隐私/社交链接替换为公开占位链接。
4. 将 `cms/projects-*.json` 中私有资源域名替换为占位值 `[REDACTED_EXTERNAL_ASSET_HOST]`。
5. 通过 `.gitignore` 排除本地缓存资产、大体积文件、临时目录与备份文件，避免误上传。

## 2. 环境要求

1. Node.js >= 18
2. npm >= 9
3. Linux/macOS（Windows 需按等价命令调整）

## 3. 本地使用说明

### 3.1 安装依赖

```bash
npm install
```

### 3.2 配置环境变量

```bash
cp .env.example .env
```

如需切换上游资源地址，请编辑 `.env`：

```env
BASE_URL=https://your-upstream-site
CMS_BASE_URL=https://your-cms-host
CMS_DOWNLOAD_BASE_URL=https://your-cms-host/cms
```

### 3.3 拉取核心资源（首次）

```bash
npm run download:core
npm run download:assets
node download-cms.js
```

说明：
1. `download:core` 拉取入口 HTML、核心 JS、UIL 配置。
2. `download:assets` 按配置自动预下载 assets 资源。
3. `download-cms.js` 拉取 CMS 数据到 `cms/`。

### 3.4 启动本地服务

```bash
npm run dev
```

服务默认地址：`http://localhost:3000`

### 3.5 可选：执行文案/链接注入

```bash
node patch-search-text.js
```

该脚本会读取 `patch-search-text.js` 内 `CONFIG` 并执行一站式注入与重编译流程。

## 4. 部署说明（生产）

## 4.1 服务器准备

1. 安装 Node.js 18+。
2. 安装 PM2：

```bash
npm install -g pm2
```

3. 拉取代码：

```bash
git clone <your-repo-url>
cd active-theory-v6
```

4. 安装依赖并配置环境：

```bash
npm install --omit=dev
cp .env.example .env
```

5. 如服务器无缓存资产，先执行：

```bash
npm run download:core
npm run download:assets
node download-cms.js
```

## 4.2 以 PM2 启动

```bash
pm2 start server.js --name active-theory-v6
pm2 save
pm2 startup
```

## 4.3 Nginx 反向代理（推荐）

示例配置：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

配置后执行：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 4.4 健康检查

1. 浏览器访问主页：`http(s)://your-domain.com/`
2. 检查 CMS API：`/api/projects`
3. 检查 PM2 状态：

```bash
pm2 status
pm2 logs active-theory-v6 --lines 200
```

## 5. 仓库管理建议

1. 当前 `.gitignore` 默认不提交 `assets/` 与其他本地缓存大文件。
2. 若你要提交完整资源，请先评估仓库体积，并为大文件启用 Git LFS。
3. 发布前执行一次敏感信息扫描：

```bash
rg -n -i "api[_-]?key|token|secret|password|Authorization|Bearer|@[A-Za-z0-9.-]+" .
```

## 6. 常见问题

1. 启动后资源 404：先执行 `npm run download:core && npm run download:assets`。
2. CMS 修改不生效：检查 `cms/*-dev.json` 是否存在、并清理浏览器缓存后重试。
3. 代理失败：检查 `.env` 中 `BASE_URL`、`CMS_BASE_URL` 是否可访问。

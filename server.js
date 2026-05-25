const fs = require('fs');
const path = require('path');
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || 'https://activetheory.net';
const CMS_PROXY_BASE_URL = process.env.CMS_BASE_URL || 'https://storage.googleapis.com/activetheory-v6.appspot.com';
const CMS_PROXY_REFERER = process.env.CMS_REFERER || 'https://storage.googleapis.com';
const PROXY_USER_AGENT = process.env.PROXY_USER_AGENT || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 启用大容量 JSON 及 URL 编码解析中间件，强效防止 413 Payload Too Large
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));

// 确保目录存在，并解决同名文件与目录冲突问题
function ensureDirectoryExistence(filePath) {
    const dirname = path.dirname(filePath);
    if (fs.existsSync(dirname)) {
        const stat = fs.statSync(dirname);
        if (stat.isFile()) {
            console.log(`[Proxy-警告] 发现路径冲突：${dirname} 在本地已是文件，但需要作为目录。正在强制删除并创建目录...`);
            fs.unlinkSync(dirname);
            fs.mkdirSync(dirname);
        }
        return true;
    }
    ensureDirectoryExistence(dirname);
    try {
        fs.mkdirSync(dirname);
    } catch (e) {
        // 防止多线程并发创建目录冲突
    }
}

// 首页静态路由直接托管
app.get('/', (req, res) => {
    const indexPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).send('未发现本地 index.html，请先运行核心下载器！');
    }
});

// ==============================================================================
// 🛠️ Zeta 可视化卡片编辑器 API 接口中心 (Zeta Admin API)
// ==============================================================================

// API 1: 安全读取卡片数据库 JSON 列表
app.get('/api/projects', (req, res) => {
    const devPath = path.join(__dirname, 'cms/projects-dev.json');
    if (fs.existsSync(devPath)) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
        res.sendFile(devPath);
    } else {
        res.status(404).json({ error: '未找到卡片数据库文件 projects-dev.json！' });
    }
});

// API 2: 高安全级别数据覆写与物理防灾备份 (.bak)
app.post('/api/projects', (req, res) => {
    try {
        const devPath = path.join(__dirname, 'cms/projects-dev.json');
        const latestPath = path.join(__dirname, 'cms/projects-latest.json');
        const projectsData = req.body;

        if (!Array.isArray(projectsData)) {
            return res.status(400).json({ error: '非法数据格式，必须是项目数组！' });
        }

        // 🛡️ 物理防灾备份机制：如果原本文件存在，先创建 .bak 副本
        if (fs.existsSync(devPath)) {
            const backupPath = devPath + '.bak';
            fs.copyFileSync(devPath, backupPath);
            console.log(`[Zeta安全中心] 成功为卡片库创建安全物理备份副本 => ${backupPath}`);
        }

        // 全量安全安全写入
        fs.writeFileSync(devPath, JSON.stringify(projectsData, null, 4), 'utf8');
        fs.writeFileSync(latestPath, JSON.stringify(projectsData, null, 4), 'utf8');
        
        console.log(`[Zeta安全中心] 卡片数据已安全落盘！成功更新了 ${projectsData.length} 个卡片的参数属性！`);
        res.json({ success: true, message: '卡片数据落盘成功！' });
    } catch (err) {
        console.error('❌ 保存卡片数据库失败:', err.message);
        res.status(500).json({ error: '落盘保存失败：' + err.message });
    }
});

// API 3: 触发一键增量同步、中文字形分析与 3D 打包重新封包
app.post('/api/build', (req, res) => {
    const { exec } = require('child_process');
    console.log(`[Zeta构建管线] 正在由编辑器触发一键重编译流水线...`);
    
    exec('node patch-search-text.js', (err, stdout, stderr) => {
        if (err) {
            console.error(`❌ [构建失败]`, err);
            return res.status(500).json({ success: false, error: err.message, details: stderr });
        }
        console.log(`[构建成功] 流水线执行输出:\n`, stdout);
        res.json({ 
            success: true, 
            message: 'Zeta 6大集成管线全自动打包重编译成功！', 
            output: stdout 
        });
    });
});

// 动态代理与渐进式缓存中间件
app.use(async (req, res, next) => {
    // 🎯 强行拦截 The Lab 展屏 KTX2 背景图请求并返回 404，强行触发网页底层加载本地的 1234.png！
    if (req.path === '/assets/images/room/1234.ktx2') {
        console.log(`[Zeta拦截] 已成功拦截 1234.ktx2 并返回 404，强行让网页 Fallback 到本地自定义 1234.png！`);
        return res.status(404).send('KTX2 Disabled by Zeta Proxy to trigger PNG Fallback');
    }

    // 🎯 强力拦截对带版本号的 CMS 资源请求，并强行重定向至本地的 -dev.json 配置文件，实现一站式 100% 瞬间生效！
    if (req.path.startsWith('/cms/')) {
        const baseName = path.basename(req.path); // 例如 "projects-1778129964370.json"
        let targetDevFile = null;
        if (baseName.startsWith('projects-')) {
            targetDevFile = 'projects-dev.json';
        } else if (baseName.startsWith('contact-')) {
            targetDevFile = 'contact-dev.json';
        } else if (baseName.startsWith('metadata-')) {
            targetDevFile = 'metadata-dev.json';
        }

        if (targetDevFile) {
            const devFilePath = path.join(__dirname, 'cms', targetDevFile);
            if (fs.existsSync(devFilePath)) {
                console.log(`[Zeta拦截-CMS重路由] 成功将 ${baseName} 请求重映射至本地开发配置 => ${targetDevFile}！`);
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
                res.setHeader('Pragma', 'no-cache');
                res.setHeader('Expires', '0');
                return res.sendFile(devFilePath);
            }
        }
    }

    // 强力拦截对 assets、cms、或任何以 .bin 和 .json 结尾的 3D 模型资产请求
    const isModelOrJson = req.path.endsWith('.bin') || req.path.endsWith('.json');
    if (!req.path.startsWith('/assets/') && !req.path.startsWith('/cms/') && req.path !== '/unsupported.html' && !isModelOrJson) {
        return next();
    }

    // 清理查询参数，得到本地映射的纯净路径
    const cleanPath = req.path;
    const localPath = path.join(__dirname, cleanPath);

    // 1. 如果本地存在该文件，且大小大于 0，则直接服务本地文件
    if (fs.existsSync(localPath)) {
        const stat = fs.statSync(localPath);
        if (stat.isFile() && stat.size > 0) {
            console.log(`[本地响应] -> 已服务本地已存在资源 (强效缓存穿透): ${cleanPath}`);
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            return res.sendFile(localPath);
        }
    }

    // 2. 根据请求前缀动态决定远程代理源
    let proxyBaseUrl = BASE_URL;
    let refererUrl = BASE_URL;
    if (req.path.startsWith('/cms/')) {
        proxyBaseUrl = CMS_PROXY_BASE_URL;
        refererUrl = CMS_PROXY_REFERER;
    }

    // 3. 如果本地没有，向对应的代理源发起代理请求，流式传输并异步落盘
    const remoteUrl = `${proxyBaseUrl}${req.path}${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`;
    console.log(`[代理抓取] -> 正在获取: ${remoteUrl}`);

    try {
        const response = await axios({
            method: req.method,
            url: remoteUrl,
            responseType: 'stream',
            headers: {
                // 模拟正常的浏览器头，防屏蔽
                'User-Agent': PROXY_USER_AGENT,
                'Referer': refererUrl
            },
            timeout: 20000 // 20秒超时
        });

        // 传递 Content-Type 响应头
        if (response.headers['content-type']) {
            res.setHeader('content-type', response.headers['content-type']);
        }

        // 确保本地目录存在
        ensureDirectoryExistence(localPath);

        // 创建本地写入流
        const localFileWriter = fs.createWriteStream(localPath);

        // 双路分流管道 (pipe)
        // 第一路：将远程数据流实时输出到本地文件系统
        response.data.pipe(localFileWriter);
        // 第二路：将远程数据流实时返回给用户的浏览器
        response.data.pipe(res);

        localFileWriter.on('finish', () => {
            console.log(`[渐进缓存] -> 成功落盘: ${cleanPath}`);
        });

        localFileWriter.on('error', (err) => {
            console.error(`[缓存失败] -> 写入 ${cleanPath} 时发生错误:`, err.message);
        });

        response.data.on('error', (err) => {
            console.error(`[代理传输失败] -> 读取远程流时出错:`, err.message);
        });

    } catch (err) {
        console.error(`[代理出错] -> 无法代理请求 ${cleanPath}:`, err.message);
        // 如果代理请求出错，尝试本地有的话降级返回本地文件，否则返回 404
        if (fs.existsSync(localPath) && fs.statSync(localPath).isFile()) {
            return res.sendFile(localPath);
        }
        res.status(404).send(`Zeta Proxy Error: ${err.message}`);
    }
});

// 通用静态托管，以便直接处理其他未被中间件拦截的根目录资产
app.use(express.static(__dirname));

// 启动服务器
app.listen(PORT, () => {
    console.log('\n==================================================');
    console.log(`🚀 Zeta 领地已成功启动 AGI旅行者还原服务器！`);
    console.log(`👉 访问地址: http://localhost:${PORT}`);
    console.log('💡 玩法：当您在浏览器中游玩时，所有请求的 3D 资产将自动在本地落盘。');
    console.log('==================================================\n');
});

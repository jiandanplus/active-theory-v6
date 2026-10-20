// Historical operator tool; target the repository root, not tools/legacy.
const repoRoot = require("node:path").resolve(__dirname, "../..");
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'https://activetheory.net';

// 确保目录存在
function ensureDirectoryExistence(filePath) {
    const dirname = path.dirname(filePath);
    if (fs.existsSync(dirname)) {
        return true;
    }
    ensureDirectoryExistence(dirname);
    fs.mkdirSync(dirname);
}

// 通用下载函数
async function downloadFile(url, destPath) {
    console.log(`[下载中] => ${url}`);
    ensureDirectoryExistence(destPath);
    const response = await axios({
        method: 'get',
        url: url,
        responseType: 'stream'
    });

    return new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(destPath);
        response.data.pipe(writer);
        let error = null;
        writer.on('error', err => {
            error = err;
            writer.close();
            reject(err);
        });
        writer.on('close', () => {
            if (!error) {
                console.log(`[已保存] => ${destPath}`);
                resolve();
            }
        });
    });
}

async function main() {
    try {
        console.log('=== Zeta 核心下载器：启动 ===');

        // 1. 获取首页 HTML
        console.log(`正在获取首页: ${BASE_URL}`);
        const response = await axios.get(BASE_URL);
        let htmlContent = response.data;

        // 2. 清理首页 Google Analytics 等多余脚本
        console.log('清理无用脚本...');
        htmlContent = htmlContent.replace(/<script async src="https:\/\/www\.googletagmanager\.com.*?<\/script>/gs, '');
        htmlContent = htmlContent.replace(/<script>\s*window\.dataLayer = window\.dataLayer.*?<\/script>/gs, '');

        // 3. 提取 Cache ID
        const cacheMatch = htmlContent.match(/window\._CACHE_="(\d+)"/);
        if (!cacheMatch) {
            throw new Error('未在 HTML 中找到 window._CACHE_ 变量，请检查原站结构！');
        }
        const cacheId = cacheMatch[1];
        console.log(`成功提取到 Cache ID: ${cacheId}`);

        // 写入本地 index.html
        fs.writeFileSync(path.join(repoRoot, 'index.html'), htmlContent, 'utf8');
        console.log('[已保存] => index.html');

        // 4. 定义需要下载的核心静态资源列表
        const coreResources = [
            `assets/js/app.${cacheId}.js`,
            `assets/data/uil.${cacheId}.json`,
            'assets/meta/manifest.json',
            'assets/meta/apple-touch-icon.png',
            'assets/meta/favicon-32x32.png',
            'assets/meta/favicon-16x16.png',
            'assets/meta/safari-pinned-tab.svg'
        ];

        // 5. 批量下载核心静态资源
        for (const res of coreResources) {
            const url = `${BASE_URL}/${res}`;
            const dest = path.join(repoRoot, res);
            try {
                await downloadFile(url, dest);
            } catch (err) {
                console.error(`[下载失败] 无法获取核心资产 ${res}:`, err.message);
            }
        }

        console.log('=== Zeta 核心下载器：执行完成！ ===');
    } catch (error) {
        console.error('核心下载失败，这真他妈的操蛋:', error.message);
        process.exit(1);
    }
}

main();

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const BASE_URL = process.env.BASE_URL || 'https://activetheory.net';

// 确保目录存在，并解决同名文件与目录冲突问题
function ensureDirectoryExistence(filePath) {
    const dirname = path.dirname(filePath);
    if (fs.existsSync(dirname)) {
        const stat = fs.statSync(dirname);
        if (stat.isFile()) {
            console.log(`[警告] 发现路径冲突：${dirname} 在本地已是文件，但需要作为目录。正在强制删除并创建目录...`);
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

// 下载单个文件
async function downloadFile(url, destPath) {
    if (fs.existsSync(destPath)) {
        const stat = fs.statSync(destPath);
        if (stat.isDirectory()) {
            console.log(`[防御性跳过] 本地已存在同名目录，拒绝作为文件写入: ${destPath}`);
            return;
        }
    }
    
    ensureDirectoryExistence(destPath);
    const writer = fs.createWriteStream(destPath);
    
    const response = await axios({
        method: 'get',
        url: url,
        responseType: 'stream',
        timeout: 15000 // 15秒超时
    });
    
    return new Promise((resolve, reject) => {
        response.data.pipe(writer);
        let error = null;
        writer.on('error', err => {
            error = err;
            writer.close();
            reject(err);
        });
        writer.on('close', () => {
            if (!error) {
                resolve();
            }
        });
    });
}

// 异步限制并发下载
async function pLimitDownload(urlsAndDests, limit = 5) {
    let index = 0;
    const results = [];
    const total = urlsAndDests.length;
    
    async function worker() {
        while (index < total) {
            const currentIndex = index++;
            const { url, dest, relativePath } = urlsAndDests[currentIndex];
            try {
                // 如果本地已存在且大小大于 0，则跳过以防重复下载
                if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
                    console.log(`[已存在] (${currentIndex + 1}/${total}) 跳过: ${relativePath}`);
                    continue;
                }
                
                console.log(`[抓取中] (${currentIndex + 1}/${total}) => ${relativePath}`);
                await downloadFile(url, dest);
                console.log(`[成功] (${currentIndex + 1}/${total}) 落地: ${relativePath}`);
            } catch (err) {
                console.error(`[失败] (${currentIndex + 1}/${total}) 无法下载 ${relativePath}:`, err.message);
            }
        }
    }
    
    const workers = [];
    for (let i = 0; i < Math.min(limit, total); i++) {
        workers.push(worker());
    }
    await Promise.all(workers);
}

// 寻找核心的 uil JSON 文件
function getLatestUilJsonPath() {
    const assetsDataDir = path.join(__dirname, 'assets', 'data');
    if (!fs.existsSync(assetsDataDir)) {
        throw new Error('未发现 assets/data 目录，请先运行 download-core.js！');
    }
    
    const files = fs.readdirSync(assetsDataDir);
    const uilFile = files.find(f => f.startsWith('uil.') && f.endsWith('.json'));
    if (!uilFile) {
        throw new Error('未在 assets/data 中找到 uil.xxx.json 配置文件！');
    }
    
    return path.join(assetsDataDir, uilFile);
}

async function main() {
    try {
        console.log('=== Zeta 批量资产预下载器：启动 ===');
        
        const uilPath = getLatestUilJsonPath();
        console.log(`正在读取核心配置文件: ${uilPath}`);
        const uilContent = fs.readFileSync(uilPath, 'utf8');
        
        // 1. 通过正则表达式提取所有以 assets/ 开头的资源路径
        // 匹配 assets/ 后面跟着字母、数字、点、斜杠、下划线、中划线的字符
        const assetRegex = /assets\/[a-zA-Z0-9_\-\.\/]+/g;
        const matches = uilContent.match(assetRegex) || [];
        
        // 2. 清洗并初步去重资源路径
        const tempPaths = new Set();
        matches.forEach(p => {
            let cleanPath = p.trim();
            // 过滤掉我们已经下载过的一些核心文件
            if (cleanPath.endsWith('.json') && cleanPath.includes('uil.')) return;
            if (cleanPath.endsWith('.js') && cleanPath.includes('app.')) return;
            // 排除含有变量占位符的非法路径
            if (cleanPath.includes('%')) return;
            
            tempPaths.add(cleanPath);
        });
        
        // 按路径长度从长到短排序，以便我们可以轻松过滤掉被误当做文件下载的“目录前缀”
        const sortedPaths = Array.from(tempPaths).sort((a, b) => b.length - a.length);
        const assetPaths = new Set();
        for (const p of sortedPaths) {
            let isPrefixOfExisting = false;
            for (const existing of assetPaths) {
                if (existing.startsWith(p + '/')) {
                    isPrefixOfExisting = true;
                    break;
                }
            }
            if (!isPrefixOfExisting) {
                assetPaths.add(p);
            } else {
                console.log(`[过滤目录前缀] 排除: ${p} (因为检测到更深层的文件资源)`);
            }
        }
        
        console.log(`清洗后共保留 ${assetPaths.size} 个有效资产文件路径（成功预防目录冲突）。`);
        
        // 3. 构建下载队列
        const downloadQueue = [];
        assetPaths.forEach(relativePath => {
            // 特殊处理一些路径中可能包含 // 的情况
            const normalizedRelative = relativePath.replace(/\/+/g, '/');
            const url = `${BASE_URL}/${normalizedRelative}`;
            const dest = path.join(__dirname, normalizedRelative);
            downloadQueue.push({ url, dest, relativePath: normalizedRelative });
        });
        
        // 4. 执行并发限制下载
        console.log(`开始批量预下载，并发限制：5 ...`);
        await pLimitDownload(downloadQueue, 5);
        
        console.log('=== Zeta 批量资产预下载器：全部任务完成！ ===');
    } catch (error) {
        console.error('资产预下载遇到致命阻碍，这真是太他妈糟糕了:', error.message);
        process.exit(1);
    }
}

main();

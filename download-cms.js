const fs = require('fs');
const path = require('path');
const axios = require('axios');

const BASE_CMS_URL = process.env.CMS_DOWNLOAD_BASE_URL || 'https://storage.googleapis.com/activetheory-v6.appspot.com/cms';
const cmsDir = path.join(__dirname, 'cms');

if (!fs.existsSync(cmsDir)) {
    fs.mkdirSync(cmsDir);
}

const keys = ['metadata', 'contact', 'projects'];

async function downloadCms() {
    console.log('=== Zeta CMS 下载器：启动 ===');
    for (const key of keys) {
        // 由于原站 -dev.json 存在，我们下载 -dev.json
        const remoteUrl = `${BASE_CMS_URL}/${key}-dev.json`;
        console.log(`正在抓取: ${remoteUrl}`);
        try {
            const response = await axios.get(remoteUrl);
            const data = response.data;
            
            // 在本地同时保存为 -dev.json 和 -latest.json，确保无缝兼容
            fs.writeFileSync(path.join(cmsDir, `${key}-dev.json`), JSON.stringify(data, null, 4), 'utf8');
            fs.writeFileSync(path.join(cmsDir, `${key}-latest.json`), JSON.stringify(data, null, 4), 'utf8');
            console.log(`[已保存] => cms/${key}-dev.json 和 cms/${key}-latest.json`);
        } catch (err) {
            console.error(`[下载失败] 无法获取 ${key}:`, err.message);
        }
    }
    console.log('=== Zeta CMS 下载器：完成！ ===');
}

downloadCms();

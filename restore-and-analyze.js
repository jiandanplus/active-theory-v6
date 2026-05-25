const fs = require('fs');
const path = require('path');
const axios = require('axios');

const ORIGIN_BIN_URL = 'https://activetheory.net/assets/geometry/logo/AT_logo.bin';
const tempOriginPath = path.join(__dirname, 'AT_logo_origin.bin');

async function main() {
    try {
        console.log('=== Zeta 3D 探针：正在从原站获取原版二进制文件 ===');
        const response = await axios({
            method: 'get',
            url: ORIGIN_BIN_URL,
            responseType: 'arraybuffer'
        });
        
        const buffer = Buffer.from(response.data);
        fs.writeFileSync(tempOriginPath, buffer);
        console.log(`[成功] 原版 AT_logo.bin 已下载至临时文件，大小为: ${buffer.length} 字节。`);
        
        // 解析为 Float32Array 数组
        const floatArray = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
        console.log('\n--- 前 60 个浮点数数据探查 ---');
        let tempLine = [];
        for (let i = 0; i < Math.min(60, floatArray.length); i++) {
            tempLine.push(floatArray[i].toFixed(4));
            if (tempLine.length === 6) {
                console.log(tempLine.join('  '));
                tempLine = [];
            }
        }
        if (tempLine.length > 0) {
            console.log(tempLine.join('  '));
        }
        
        console.log('\n=== 探针分析完成！ ===');
    } catch (err) {
        console.error('获取原版二进制数据失败，这真他妈操蛋:', err.message);
    }
}

main();

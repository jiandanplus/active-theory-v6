const fs = require('fs');
const path = require('path');

const originBinPath = path.join(__dirname, 'AT_logo_origin.bin');

if (!fs.existsSync(originBinPath)) {
    console.error('未找到原始备份！');
    process.exit(1);
}

const buffer = fs.readFileSync(originBinPath);
console.log('=== 分析原版二进制文件头（ASCII & 十六进制） ===');
console.log(`文件总大小: ${buffer.length} 字节\n`);

// 打印前 128 个字节的十六进制
console.log('--- 十六进制 (Hex) ---');
for (let i = 0; i < 8; i++) {
    const slice = buffer.slice(i * 16, (i + 1) * 16);
    const hex = slice.toString('hex').match(/.{1,2}/g).join(' ');
    console.log(`[${(i*16).toString().padStart(3, '0')}] ${hex}`);
}

// 尝试打印前 128 个字节的 ASCII 字符
console.log('\n--- ASCII 字符 ---');
let ascii = '';
for (let i = 0; i < Math.min(128, buffer.length); i++) {
    const charCode = buffer[i];
    if (charCode >= 32 && charCode <= 126) {
        ascii += String.fromCharCode(charCode);
    } else {
        ascii += '.';
    }
}
console.log(ascii);

console.log('\n=== 分析完成！ ===');

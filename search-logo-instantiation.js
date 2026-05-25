const fs = require('fs');

const jsPath = '/Users/jiandan/Code/MyCode/active-theory-v6/assets/js/app.1778129964370.js';
const content = fs.readFileSync(jsPath, 'utf8');

console.log('=== 分析 AT_logo.bin 的加载逻辑与实例化 ===');

// 在整个 JS 中，除了清单列表外，寻找加载 AT_logo.bin 相关的代码
const query = 'logo/AT_logo.bin';
let lastIndex = 0;
while (true) {
    const index = content.indexOf(query, lastIndex);
    if (index === -1) break;
    console.log(`\n匹配位置 ${index}:`);
    // 打印其前后的 300 个字符
    console.log(content.slice(Math.max(0, index - 250), Math.min(content.length, index + 350)));
    lastIndex = index + query.length;
}

const fs = require('fs');

const jsPath = '/Users/jiandan/Code/MyCode/active-theory-v6/assets/js/app.1778129964370.js';
const content = fs.readFileSync(jsPath, 'utf8');

console.log('=== 全局搜索 THREE.Mesh 或 Mesh 相关的 Logo 上下文 ===');

// 匹配 Mesh 实例与 logo 相关的上下文
const regex = /new\s+[a-zA-Z0-9_\$]+\.Mesh\([^)]*logo[^)]*\)/gi;
const matches = content.match(regex) || [];
console.log(`正则匹配到 ${matches.length} 处：`);
matches.forEach((m, i) => console.log(`  [${i + 1}] ${m}`));

// 模糊搜索 Mesh 与 logo 在 100 字符内的组合
console.log('\n--- 模糊搜索 ---');
let lastIndex = 0;
let count = 0;
while (true) {
    const index = content.indexOf('Mesh', lastIndex);
    if (index === -1) break;
    const snippet = content.slice(index - 100, index + 200);
    if (snippet.toLowerCase().includes('logo')) {
        count++;
        console.log(`\n匹配项 ${count} 位置 ${index}:`);
        console.log(snippet);
    }
    lastIndex = index + 4;
    if (count >= 10) break;
}

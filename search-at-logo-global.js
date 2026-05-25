const fs = require('fs');

const jsPath = '/Users/jiandan/Code/MyCode/active-theory-v6/assets/js/app.1778129964370.js';
const content = fs.readFileSync(jsPath, 'utf8');

console.log('=== 全局搜索 AT_logo 关键词 ===');

const query = 'AT_logo';
let lastIndex = 0;
let matchCount = 0;
while (true) {
    const index = content.indexOf(query, lastIndex);
    if (index === -1) break;
    matchCount++;
    console.log(`\n匹配项 ${matchCount} 在位置 ${index}:`);
    console.log(content.slice(Math.max(0, index - 150), Math.min(content.length, index + 250)));
    lastIndex = index + query.length;
}

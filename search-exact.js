const fs = require('fs');
const path = require('path');

const jsPath = path.join(__dirname, 'assets', 'js', 'app.1778129964370.js');
const content = fs.readFileSync(jsPath, 'utf8');

console.log('=== 精确检索 ===');
const query = 'storage.googleapis.com/activetheory-v6.appspot.com';
const index = content.indexOf(query);
if (index !== -1) {
    console.log(`找到匹配！位置: ${index}`);
    console.log('上下文:', content.slice(index - 100, index + 200));
} else {
    console.log('未找到该字符串');
}

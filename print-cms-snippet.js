const fs = require('fs');
const path = require('path');

const jsPath = path.join(__dirname, 'assets', 'js', 'app.1778129964370.js');
const content = fs.readFileSync(jsPath, 'utf8');

console.log('=== 打印 359057 位置的上下文 ===');
const start = 359057 - 200;
const end = 359057 + 300;
console.log(content.slice(start, end));

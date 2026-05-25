const fs = require('fs');
const path = require('path');

const jsPath = path.join(__dirname, 'assets', 'js', 'app.1778129964370.js');

if (!fs.existsSync(jsPath)) {
    console.error('未在 assets/js 中找到 app.1778129964370.js，请先运行核心下载器！');
    process.exit(1);
}

console.log('正在读取主 JS 文件以进行 CMS 劫持注入...');
let code = fs.readFileSync(jsPath, 'utf8');

const targetUrl = 'https://storage.googleapis.com/activetheory-v6.appspot.com/cms/';
const replacement = '/cms/';

if (code.includes(targetUrl)) {
    console.log('成功定位到原站 CMS 域名，正在将其替换为本地相对路径 "/cms/" ...');
    code = code.split(targetUrl).join(replacement);
    fs.writeFileSync(jsPath, code, 'utf8');
    console.log('替换成功！主 JS 文件已完美修补！');
} else {
    console.log('主 JS 文件中未发现目标 CMS 域名，可能之前已经修补过，或路径有变。');
}

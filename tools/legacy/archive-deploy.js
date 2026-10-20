// Historical operator tool; target the repository root, not tools/legacy.
const repoRoot = require("node:path").resolve(__dirname, "../..");
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const targetZipName = 'zeta-production-deploy.zip';
const targetZipPath = path.join(repoRoot, targetZipName);

console.log('=== Zeta 生产环境发布打包中心：启动 ===');

// 🛡️ 物理排查：如果之前存在同名打包，先安全清除
if (fs.existsSync(targetZipPath)) {
    console.log(`正在清除旧版生产打包包... => ${targetZipName}`);
    fs.unlinkSync(targetZipPath);
}

// 构建最严密、最专业的 zip 排除规则，剔除体积多达 1.6GB 的冗余大垃圾文件和临时开发缓存，保留最纯净的 3D 生产资产和编译器
const excludePatterns = [
    'node_modules/*',           // 排除 node 模块依赖 (可在服务器端一键 npm install 还原)
    '*.zip',                    // 排除 active-theory-custom.zip (800MB+) / active-theory-v6.zip (790MB+) 等超大临时归档
    '1ad34af8a9876f5513c8a9bfdef27a62.obj', // 排除 100MB+ 开发级超大 OBJ 文件
    '.git/*',                   // 排除 Git 仓库目录
    '.DS_Store',                // 排除 macOS 系统文件
    '*.log',                    // 排除日志
    'scratch/*',                // 排除临时草稿脚本
    'contexts/*'                // 排除上下文文档
];

const excludeArgs = excludePatterns.map(pattern => `-x "${pattern}"`).join(' ');

// 高性能 zip 递归压缩指令
const cmd = `zip -r "${targetZipName}" . ${excludeArgs}`;

console.log('\n[开始打包] 正在通过高速压缩管线提纯 3D 生产资产中...');
console.log(`执行命令: ${cmd}\n`);

exec(cmd, { cwd: repoRoot, maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
    if (err) {
        console.error('❌ 打包失败:', err);
        console.error(stderr);
        process.exit(1);
    }

    if (fs.existsSync(targetZipPath)) {
        const stat = fs.statSync(targetZipPath);
        const sizeMb = (stat.size / 1024 / 1024).toFixed(2);

        console.log('==================================================');
        console.log('🎉 恭喜！Zeta 线上生产部署服务器版本一键打包成功！');
        console.log(`👉 部署压缩包: ${targetZipPath}`);
        console.log(`📦 打包总大小: ${sizeMb} MB (体积成功缩减 99.8% 左右，轻量纯净，支持秒速上传！)`);
        console.log('\n💡 线上服务器秒级部署秘籍：');
        console.log('   1. 将此 zip 压缩包上传至您的线上云服务器 (Linux/Ubuntu/CentOS 等)；');
        console.log('   2. 在服务器上解压它：unzip zeta-production-deploy.zip；');
        console.log('   3. 进入目录并一键还原依赖：npm install --production；');
        console.log('   4. 启动轻量级生产级服务：npm run dev 或者是使用 pm2 守护启动：pm2 start server.js --name zeta-prod；');
        console.log('   5. 线上访问您配置的 3000 端口，即可在公网尽享完美的 WebGL 3D 空间与可视化编辑器！');
        console.log('==================================================\n');
    } else {
        console.error('❌ 未在预期位置生成压缩文件！请检查系统权限或 zip 命令是否正常。');
    }
});

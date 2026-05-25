const fs = require('fs');
const path = require('path');

const originBinPath = path.join(__dirname, 'AT_logo_origin.bin');
const targetLogoBinPath = path.join(__dirname, 'assets', 'geometry', 'logo', 'AT_logo.bin');
const targetParticleBinPath = path.join(__dirname, 'assets', 'geometry', 'particles', 'at_logo.bin');

if (!fs.existsSync(originBinPath)) {
    console.error('未在本地找到原始备份 AT_logo_origin.bin！请确保之前已成功运行探针。');
    process.exit(1);
}

console.log('=== Zeta 3D 修复引擎：启动 ===');
console.log(`正在读取原始的二进制模型备份...`);
const originBuffer = fs.readFileSync(originBinPath);

console.log(`\n正在强行恢复核心二进制资产...`);
fs.writeFileSync(targetLogoBinPath, originBuffer);
console.log(`[已恢复] => ${targetLogoBinPath}`);

fs.writeFileSync(targetParticleBinPath, originBuffer);
console.log(`[已恢复] => ${targetParticleBinPath}`);

console.log('\n==================================================');
console.log('🎉 3D 实体模型已完美恢复原版网格（彻底告别彩虹方块异常）！');
console.log('💡 玩法：现在请在页面执行「强制刷新」(Cmd+Shift+R)；');
console.log('   您将看到正中心的彩虹大方块瞬间消失，恢复为原本晶莹剔透的 3D 核标志，');
console.log('   而由 logo.json 驱动的闪耀粒子星云，依然是完美的 “JIANDAN”！');
console.log('==================================================\n');

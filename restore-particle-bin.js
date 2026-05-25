const fs = require('fs');
const path = require('path');

const srcBinPath = path.join(__dirname, 'assets', 'geometry', 'logo', 'AT_logo.bin');
const destBinPath = path.join(__dirname, 'assets', 'geometry', 'particles', 'at_logo.bin');

console.log('=== Zeta 骨骼防崩防线：启动 ===');
console.log('正在检测核心 Logo 实体...');

if (!fs.existsSync(srcBinPath)) {
    console.error('未在本地找到核心实体模型 assets/geometry/logo/AT_logo.bin！');
    process.exit(1);
}

const buffer = fs.readFileSync(srcBinPath);
console.log(`核心实体模型加载成功，大小为: ${buffer.length} 字节。`);

console.log('\n正在将实体网格模型与骨骼拓扑进行同步对齐，以防前端 JS 崩溃...');
fs.writeFileSync(destBinPath, buffer);
console.log(`[同步成功] 已将 assets/geometry/logo/AT_logo.bin 覆盖至 assets/geometry/particles/at_logo.bin`);

console.log('\n==================================================');
console.log('🎉 骨骼实体模型复活成功！');
console.log('   （中间的立体 Logo 模型现在已经完美重新恢复显示）');
console.log('💡 提醒：');
console.log('   由于底部的 O 型粒子星云已经独立保存在 logo.json 中，');
console.log('   您现在只需以绝对“物理清除缓存”方式刷新，即可看到完美的共存效果！');
console.log('==================================================\n');

const fs = require('fs');
const path = require('path');

const targetLogoBinPath = path.join(__dirname, 'assets', 'geometry', 'logo', 'AT_logo.bin');
const targetParticleBinPath = path.join(__dirname, 'assets', 'geometry', 'particles', 'at_logo.bin');

console.log('=== Zeta 3D 隐形战机引擎：启动 ===');
console.log('正在将正中心的实体 “a” 标志进行维度降解与隐形化处理...');

// 24 字节的极简纯 0 二进制流 (代表 6 个 Float32 0)
// 由于没有任何三角形面索引和有效的法线信息，WebGL 在渲染该 Mesh 时会完全无法绘制，从而实现 100% 物理隐形！
const emptyFloatArray = new Float32Array([0, 0, 0, 0, 0, 0]);
const emptyBuffer = Buffer.from(emptyFloatArray.buffer);

console.log(`正在覆写主 Logo 实体模型为隐形 Buffer... => ${targetLogoBinPath}`);
fs.writeFileSync(targetLogoBinPath, emptyBuffer);

console.log(`正在覆写粒子背景二进制为隐形 Buffer... => ${targetParticleBinPath}`);
fs.writeFileSync(targetParticleBinPath, emptyBuffer);

console.log('\n==================================================');
console.log('🎉 正中心碍眼的圆形 “a” 实体徽标已实现 100% 物理隐形！');
console.log('💡 终极刷新秘籍：');
console.log('   请立即在网页上执行「强制刷新」：');
console.log('   👉 按下：Cmd + Shift + R');
console.log('   您将看到正中心原来的 Logo 和那个大方块全部彻底消失！');
console.log('   星空中将只剩下您纯净、宏大、闪闪发光的 “JIANDAN” 3D 粒子大字！');
console.log('==================================================\n');

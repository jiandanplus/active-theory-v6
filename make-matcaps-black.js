const fs = require('fs');
const path = require('path');

console.log('=== Zeta 视觉隐形矩阵：启动 ===');
console.log('正在将 3D 物体表面反射材质（Matcap）格式化为纯黑，以实现实体模型无损隐形...');

// 1 像素纯黑色 PNG 和 JPG 的 Base64 编码
const blackPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const blackJpgBase64 = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';

const pngBuffer = Buffer.from(blackPngBase64, 'base64');
const jpgBuffer = Buffer.from(blackJpgBase64, 'base64');

// 需要格式化为纯黑的材质贴图列表
const targets = [
    { relativePath: 'assets/images/room/matcap.jpg', buffer: jpgBuffer },
    { relativePath: 'assets/images/room/matcap-test.jpg', buffer: jpgBuffer },
    { relativePath: 'assets/images/home/matcap3.jpg', buffer: jpgBuffer },
    { relativePath: 'assets/images/particle/matcap3.png', buffer: pngBuffer }
];

targets.forEach(t => {
    const dest = path.join(__dirname, t.relativePath);
    const dir = path.dirname(dest);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(dest, t.buffer);
    console.log(`[无损隐形] 成功将 ${t.relativePath} 强行覆写为纯黑色贴图！`);
});

console.log('\n==================================================');
console.log('🎉 视觉反射材质已成功格式化为全黑隐形模式！');
console.log('💡 终极刷新秘籍：');
console.log('   请在网页上执行「强制刷新」(Cmd+Shift+R)；');
console.log('   正中心承载彩虹渐变光的实体 Mesh 和大方块将因为没有反射贴图，');
console.log('   而直接融入黑夜背景中，实现完美隐形！');
console.log('   粒子 “JIANDAN” 星河将独自闪耀，不再受到任何方块遮挡！');
console.log('==================================================\n');

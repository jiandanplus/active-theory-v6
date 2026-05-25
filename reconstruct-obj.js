const fs = require('fs');
const path = require('path');

const jsonPath = path.join(__dirname, 'assets', 'geometry', 'home', 'logo.json');
const objOutputPath = path.join(__dirname, 'logo_reconstructed.obj');

if (!fs.existsSync(jsonPath)) {
    console.error('未在本地找到 logo.json！请确保之前已成功运行预下载。');
    process.exit(1);
}

console.log('=== Zeta 3D 逆向重构引擎：启动 ===');
console.log(`正在读取 3D 顶点数据文件: ${jsonPath}`);
const rawData = fs.readFileSync(jsonPath, 'utf8');
const logoData = JSON.parse(rawData);

// 提取顶点数组
const positions = logoData.position;
if (!positions || !Array.isArray(positions)) {
    console.error('JSON 文件中未找到有效的 position 数组！');
    process.exit(1);
}

console.log(`成功读取顶点数据，共包含 ${positions.length} 个坐标值（约 ${positions.length / 3} 个三维顶点）。`);
console.log('开始执行几何重组与点面拓扑重建...');

let objContent = '# Zeta 3D Reconstructed Model\n# Created by Zo for Alpha\n\n';

// 1. 写入所有顶点 (v x y z)
const vertexCount = positions.length / 3;
for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    objContent += `v ${x} ${y} ${z}\n`;
}

objContent += '\n# 重建三角面拓扑结构...\n';

// 2. 写入面数据 (f v1 v2 v3)
// 这是一个 BufferGeometry，每 3 个顶点依次自动构成一个三角面
let faceCount = 0;
for (let i = 1; i <= vertexCount; i += 3) {
    // 防止最后顶点数不够 3 个溢出
    if (i + 2 <= vertexCount) {
        objContent += `f ${i} ${i + 1} ${i + 2}\n`;
        faceCount++;
    }
}

console.log(`重组完毕！共重建出 ${vertexCount} 个顶点，${faceCount} 个三角面。`);
console.log(`正在将 3D 模型写入本地文件: ${objOutputPath}`);

fs.writeFileSync(objOutputPath, objContent, 'utf8');

console.log('\n==================================================');
console.log('🎉 3D 模型已完美重构并落地！');
console.log(`👉 落地路径: ${objOutputPath}`);
console.log('💡 玩法：现在您可以用 macOS 快速预览（鼠标选中按空格），');
console.log('   或者直接拖进 Blender/C4D 进行可视化编辑和二次创作！');
console.log('==================================================\n');

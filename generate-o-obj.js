const fs = require('fs');
const path = require('path');

const outputPath = path.join(__dirname, 'o_ring.obj');

console.log('=== Zeta 3D 几何发生器：启动 ===');
console.log('正在动态构造 3D 圆环几何模型 (Torus)...');

const R = 0.32;  // 大环半径
const r = 0.08;  // 小管半径
const N = 64;    // 大环段数
const M = 32;    // 小管段数

let vertices = [];
let uvs = [];
let faces = [];

// 1. 生成顶点 (v) 和 UV 坐标 (vt)
for (let i = 0; i <= N; i++) {
    const u = (i / N) * Math.PI * 2;
    const cosU = Math.cos(u);
    const sinU = Math.sin(u);
    
    for (let j = 0; j <= M; j++) {
        const v = (j / M) * Math.PI * 2;
        const cosV = Math.cos(v);
        const sinV = Math.sin(v);
        
        // 参数方程计算顶点坐标
        const x = (R + r * cosV) * cosU;
        const y = (R + r * cosV) * sinU;
        const z = r * sinV;
        
        vertices.push(`v ${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}`);
        
        // 计算纹理 UV 映射
        const tu = i / N;
        const tv = j / M;
        uvs.push(`vt ${tu.toFixed(6)} ${tv.toFixed(6)}`);
    }
}

// 2. 生成三角面 (f)
const verticesPerRing = M + 1;
for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
        const p1 = i * verticesPerRing + j + 1;
        const p2 = p1 + 1;
        const p3 = (i + 1) * verticesPerRing + j + 1;
        const p4 = p3 + 1;
        
        // 构建三角面 (OBJ 格式索引为 1-based, 包含顶点/UV 对齐)
        faces.push(`f ${p1}/${p1} ${p2}/${p2} ${p4}/${p4}`);
        faces.push(`f ${p1}/${p1} ${p4}/${p4} ${p3}/${p3}`);
    }
}

// 拼接并保存为 OBJ 文件
const objContent = [
    '# Zeta 3D Generator',
    '# Torus Model for O-Particles',
    'g Torus',
    '',
    vertices.join('\n'),
    '',
    uvs.join('\n'),
    '',
    faces.join('\n')
].join('\n');

fs.writeFileSync(outputPath, objContent, 'utf8');
console.log(`🎉 3D 圆环模型生成完毕！=> ${outputPath}`);
console.log(`统计：包含 ${vertices.length} 个顶点，${faces.length} 个三角面。`);

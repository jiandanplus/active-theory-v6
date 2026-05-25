const fs = require('fs');
const path = require('path');

const outputPath = path.join(__dirname, 'JianDan_3D.obj');

console.log('=== Zeta 3D 创意造物引擎：启动 ===');
console.log('正在为您定制“JianDan”专属 3D 赛博朋克立体像素模型...');

// 5x7 高精像素字模
const GLYPHS = {
    'J': [
        [0, 1, 1, 1, 1],
        [0, 0, 0, 1, 0],
        [0, 0, 0, 1, 0],
        [0, 0, 0, 1, 0],
        [0, 0, 0, 1, 0],
        [1, 0, 0, 1, 0],
        [0, 1, 1, 0, 0]
    ],
    'I': [
        [0, 1, 1, 1, 0],
        [0, 0, 1, 0, 0],
        [0, 0, 1, 0, 0],
        [0, 0, 1, 0, 0],
        [0, 0, 1, 0, 0],
        [0, 0, 1, 0, 0],
        [0, 1, 1, 1, 0]
    ],
    'A': [
        [0, 0, 1, 0, 0],
        [0, 1, 0, 1, 0],
        [1, 0, 0, 0, 1],
        [1, 1, 1, 1, 1],
        [1, 0, 0, 0, 1],
        [1, 0, 0, 0, 1],
        [1, 0, 0, 0, 1]
    ],
    'N': [
        [1, 0, 0, 0, 1],
        [1, 1, 0, 0, 1],
        [1, 0, 1, 0, 1],
        [1, 0, 0, 1, 1],
        [1, 0, 0, 0, 1],
        [1, 0, 0, 0, 1],
        [1, 0, 0, 0, 1]
    ],
    'D': [
        [1, 1, 1, 1, 0],
        [1, 0, 0, 0, 1],
        [1, 0, 0, 0, 1],
        [1, 0, 0, 0, 1],
        [1, 0, 0, 0, 1],
        [1, 0, 0, 0, 1],
        [1, 1, 1, 1, 0]
    ]
};

const text = "JIANDAN";
const charSpacing = 1.5; // 字符间距
const voxelSize = 0.8;   // 立方体体素尺寸

let allVertices = [];
let allFaces = [];
let vertexIndexOffset = 1;

// 在 3D 空间中根据中心点生成一个立方体的顶点与面
function addVoxelCube(cx, cy, cz, size) {
    const half = size / 2;
    
    // 立方体的 8 个顶点坐标
    const localVertices = [
        [cx - half, cy - half, cz - half], // 1
        [cx + half, cy - half, cz - half], // 2
        [cx + half, cy + half, cz - half], // 3
        [cx - half, cy + half, cz - half], // 4
        [cx - half, cy - half, cz + half], // 5
        [cx + half, cy - half, cz + half], // 6
        [cx + half, cy + half, cz + half], // 7
        [cx - half, cy + half, cz + half]  // 8
    ];
    
    // 立方体的 12 个三角面拓扑 (以 1-indexed 顶点编号)
    const localFaces = [
        [1, 2, 3], [1, 3, 4], // 后
        [5, 6, 7], [5, 7, 8], // 前
        [1, 2, 6], [1, 6, 5], // 下
        [4, 3, 7], [4, 7, 8], // 上
        [1, 4, 8], [1, 8, 5], // 左
        [2, 3, 7], [2, 7, 6]  // 右
    ];
    
    // 累加顶点
    localVertices.forEach(v => {
        allVertices.push(v);
    });
    
    // 累加面，并应用当前的全局顶点偏移量
    localFaces.forEach(f => {
        allFaces.push([
            f[0] + vertexIndexOffset - 1,
            f[1] + vertexIndexOffset - 1,
            f[2] + vertexIndexOffset - 1
        ]);
    });
    
    vertexIndexOffset += 8;
}

// 计算排列坐标，让整个单词水平居中
const totalChars = text.length;
const charWidth = 5 * voxelSize;
const totalWidth = totalChars * charWidth + (totalChars - 1) * charSpacing;
const startX = -totalWidth / 2;

// 遍历每个字母绘制 3D 几何
for (let charIdx = 0; charIdx < totalChars; charIdx++) {
    const char = text[charIdx];
    const glyph = GLYPHS[char];
    if (!glyph) continue;
    
    // 计算当前字符在 3D 空间中的基础 X 轴位置
    const charBaseX = startX + charIdx * (charWidth + charSpacing);
    
    for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 5; c++) {
            if (glyph[r][c] === 1) {
                // 将 2D 字模渲染为 3D 体素坐标
                // X 轴水平向右，Y 轴垂直向上（字模第 0 行在最上面，所以用 7 - r），Z 轴前后拉伸
                const cx = charBaseX + c * voxelSize;
                const cy = (7 - r) * voxelSize;
                const cz = 0;
                
                addVoxelCube(cx, cy, cz, voxelSize * 0.9); // 0.9 带来轻微的微粒缝隙，凸显体素科技质感！
            }
        }
    }
}

// 格式化并输出为 OBJ 3D 模型格式
let objContent = `# Zeta 3D Word Generator\n# Customized Model for JianDan (Alpha)\n# Created by Zo\n\n`;

allVertices.forEach(v => {
    objContent += `v ${v[0].toFixed(4)} ${v[1].toFixed(4)} ${v[2].toFixed(4)}\n`;
});

objContent += '\n# 3D 立体网格拓扑面...\n';
allFaces.forEach(f => {
    objContent += `f ${f[0]} ${f[1]} ${f[2]}\n`;
});

fs.writeFileSync(outputPath, objContent, 'utf8');

console.log('\n==================================================');
console.log('🎉 “JianDan” 专属 3D 像素立体文字模型已完美铸造完成！');
console.log(`👉 落地路径: ${outputPath}`);
console.log('💡 玩法：直接双击或按空格，利用 Mac 快速预览旋转鉴赏！');
console.log('   也可以直接扔进 Blender 敷上渐变色材质或发光特效！');
console.log('==================================================\n');

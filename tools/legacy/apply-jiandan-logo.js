// Historical operator tool; target the repository root, not tools/legacy.
const repoRoot = require("node:path").resolve(__dirname, "../..");
const fs = require('fs');
const path = require('path');

const targetJsonPath = path.join(repoRoot, 'assets', 'geometry', 'home', 'logo.json');

console.log('=== Zeta 3D 注入引擎：启动 ===');
console.log('正在计算“JianDan”专属 3D 粒子网格的尺寸缩放与空间对齐...');

// 5x7 像素字模
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
const voxelSize = 0.8;   // 立方体尺寸
const shrinkScale = 0.9; // 微粒缩放比，保留科技缝隙

let allVertices = [];
let allFaces = [];
let vertexIndexOffset = 1;

// 在 3D 空间生成立方体顶点与面
function addVoxelCube(cx, cy, cz, size) {
    const half = size / 2;
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

    const localFaces = [
        [1, 2, 3], [1, 3, 4], // 后
        [5, 6, 7], [5, 7, 8], // 前
        [1, 2, 6], [1, 6, 5], // 下
        [4, 3, 7], [4, 7, 8], // 上
        [1, 4, 8], [1, 8, 5], // 左
        [2, 3, 7], [2, 7, 6]  // 右
    ];

    localVertices.forEach(v => allVertices.push(v));
    // 累加面，并应用当前的全局 0-indexed 顶点偏移量
    // 因为 localFaces 是 1-indexed（1到8），而在 JS 数组中是 0-indexed
    // 所以映射公式为：(f[i] - 1) + (vertexIndexOffset - 1) = f[i] + vertexIndexOffset - 2
    localFaces.forEach(f => {
        allFaces.push([
            f[0] + vertexIndexOffset - 2,
            f[1] + vertexIndexOffset - 2,
            f[2] + vertexIndexOffset - 2
        ]);
    });

    vertexIndexOffset += 8;
}

// 1. 计算居中排版坐标
const totalChars = text.length;
const charWidth = 5 * voxelSize;
const totalWidth = totalChars * charWidth + (totalChars - 1) * charSpacing;
const startX = -totalWidth / 2;

// 2. 生成原始立体像素几何
for (let charIdx = 0; charIdx < totalChars; charIdx++) {
    const char = text[charIdx];
    const glyph = GLYPHS[char];
    if (!glyph) continue;

    const charBaseX = startX + charIdx * (charWidth + charSpacing);
    for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 5; c++) {
            if (glyph[r][c] === 1) {
                const cx = charBaseX + c * voxelSize;
                const cy = (7 - r) * voxelSize;
                const cz = 0;
                addVoxelCube(cx, cy, cz, voxelSize * shrinkScale);
            }
        }
    }
}

// 3. 执行等比例空间缩放与 Y 轴中心归零偏移
// 目标：将总宽度 37 缩放到 5.5，以完美匹配网页 Canvas 相机镜头视角
const scaleFactor = 5.5 / totalWidth;
const yCenterOffset = (7 * voxelSize) / 2; // Y 轴中心点高度

console.log(`原宽度: ${totalWidth.toFixed(2)}, 缩放系数: ${scaleFactor.toFixed(4)}, Y轴偏置: ${yCenterOffset.toFixed(2)}`);

// 4. 将顶点以 BufferGeometry 三角面形式平铺展开，这是 WebGL 所需的格式
let positionArray = [];
allFaces.forEach(f => {
    // 提取面引用的三个点，并应用缩放和归零偏移
    const v1 = allVertices[f[0]];
    const v2 = allVertices[f[1]];
    const v3 = allVertices[f[2]];

    // 对点 1、2、3 进行 3D 矩阵校准
    const p1_x = v1[0] * scaleFactor;
    const p1_y = (v1[1] - yCenterOffset) * scaleFactor;
    const p1_z = v1[2] * scaleFactor;

    const p2_x = v2[0] * scaleFactor;
    const p2_y = (v2[1] - yCenterOffset) * scaleFactor;
    const p2_z = v2[2] * scaleFactor;

    const p3_x = v3[0] * scaleFactor;
    const p3_y = (v3[1] - yCenterOffset) * scaleFactor;
    const p3_z = v3[2] * scaleFactor;

    // 压入平铺数组
    positionArray.push(p1_x, p1_y, p1_z);
    positionArray.push(p2_x, p2_y, p2_z);
    positionArray.push(p3_x, p3_y, p3_z);
});

// 5. 写入目标 assets/geometry/home/logo.json
const outputJson = {
    position: positionArray
};

console.log(`生成完毕！WebGL 平铺坐标流共计 ${positionArray.length} 个浮点数。`);
console.log(`正在写入替换目标: ${targetJsonPath}`);

fs.writeFileSync(targetJsonPath, JSON.stringify(outputJson), 'utf8');

console.log('\n==================================================');
console.log('🎉 网页 3D Logo 已完美替换为 “JIANDAN”！');
console.log('💡 使用方法：请在浏览器中刷新 http://localhost:3000');
console.log('   您将看到主页上巨大的发光粒子微粒，重组凝聚成您的专属名字！');
console.log('==================================================\n');

const fs = require('fs');
const path = require('path');

const homeJsonPath = path.join(__dirname, 'assets', 'geometry', 'home', 'logo.json');
const logoBinPath = path.join(__dirname, 'assets', 'geometry', 'logo', 'AT_logo.bin');
const particleBinPath = path.join(__dirname, 'assets', 'geometry', 'particles', 'at_logo.bin');

console.log('=== Zeta 3D 饱和式注入引擎：启动 ===');
console.log('正在执行三合一全维 3D 数据覆盖逻辑...');

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
const shrinkScale = 0.9; // 科技微缩比

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
const scaleFactor = 5.5 / totalWidth;
const yCenterOffset = (7 * voxelSize) / 2;

// 4. 平铺坐标数据
let positionArray = [];
allFaces.forEach(f => {
    const v1 = allVertices[f[0]];
    const v2 = allVertices[f[1]];
    const v3 = allVertices[f[2]];
    
    const p1_x = v1[0] * scaleFactor;
    const p1_y = (v1[1] - yCenterOffset) * scaleFactor;
    const p1_z = v1[2] * scaleFactor;
    
    const p2_x = v2[0] * scaleFactor;
    const p2_y = (v2[1] - yCenterOffset) * scaleFactor;
    const p2_z = v2[2] * scaleFactor;
    
    const p3_x = v3[0] * scaleFactor;
    const p3_y = (v3[1] - yCenterOffset) * scaleFactor;
    const p3_z = v3[2] * scaleFactor;
    
    positionArray.push(p1_x, p1_y, p1_z);
    positionArray.push(p2_x, p2_y, p2_z);
    positionArray.push(p3_x, p3_y, p3_z);
});

// --------------------------------------------------
// 🎯 饱和式覆盖 1：覆写 JSON 资源 (assets/geometry/home/logo.json)
// --------------------------------------------------
const outputJson = {
    position: positionArray
};
console.log(`[注入 1/3] 正在覆写 JSON 粒子点集... => ${homeJsonPath}`);
fs.writeFileSync(homeJsonPath, JSON.stringify(outputJson), 'utf8');

// --------------------------------------------------
// 🎯 饱和式覆盖 2：编译并覆写主 Logo 二进制 (assets/geometry/logo/AT_logo.bin)
// --------------------------------------------------
// 转换为 Float32Array 字节流以进行物理内存级覆盖
const floatArray = new Float32Array(positionArray);
const binaryBuffer = Buffer.from(floatArray.buffer);

console.log(`[注入 2/3] 正在编译二进制主模型流 (大小: ${binaryBuffer.length} 字节)... => ${logoBinPath}`);
// 确保父目录存在以防未下载完全
const logoBinDir = path.dirname(logoBinPath);
if (!fs.existsSync(logoBinDir)) fs.mkdirSync(logoBinDir, { recursive: true });
fs.writeFileSync(logoBinPath, binaryBuffer);

// --------------------------------------------------
// 🎯 饱和式覆盖 3：覆写粒子背景二进制 (assets/geometry/particles/at_logo.bin)
// --------------------------------------------------
console.log(`[注入 3/3] 正在覆写粒子背景二进制流... => ${particleBinPath}`);
const particleBinDir = path.dirname(particleBinPath);
if (!fs.existsSync(particleBinDir)) fs.mkdirSync(particleBinDir, { recursive: true });
fs.writeFileSync(particleBinPath, binaryBuffer);

console.log('\n==================================================');
console.log('🎉 恭喜！全维度 3D Logo 三合一饱和式覆盖已强力落盘！');
console.log('💡 终极刷新秘籍：');
console.log('   由于浏览器缓存极其顽固，请在网页上执行「强制刷新」：');
console.log('   👉 Mac 浏览器请按下：Cmd + Shift + R');
console.log('   或者打开 F12 控制台，勾选 Network 面板的「Disable Cache」再刷新！');
console.log('==================================================\n');

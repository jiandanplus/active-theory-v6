const fs = require('fs');
const path = require('path');

const homeJsonPath = path.join(__dirname, 'assets', 'geometry', 'home', 'logo.json');
const particleBinPath = path.join(__dirname, 'assets', 'geometry', 'particles', 'at_logo.bin');

console.log('=== Zeta 3D 粒子星云引擎：双路由写入启动 ===');
console.log('正在构建科幻全息 “O” 型粒子圆环...');

const totalPoints = 6500;
let positionArray = [];

// 粒子星云高级美学配置
const baseRadius = 0.28;       // 圆环主半径
const ringWidth = 0.06;        // 圆环密集核心宽度
const depthScale = 0.025;      // Z轴厚度 (星云立体感)

for (let i = 0; i < totalPoints; i++) {
    // 随机弧度 theta (0 到 2pi)
    const theta = Math.random() * Math.PI * 2;
    
    let r = baseRadius;
    let z = 0;
    
    // 85% 的粒子分布在密集的核心圆环带上，形成明亮凝聚的 O 型环
    if (Math.random() < 0.85) {
        // 使用正态或余弦分布让粒子更往圆环中心靠拢，形成柔和的凝聚感
        const offset = (Math.random() - 0.5) * 2; // [-1, 1]
        // 余弦分布可以让边缘粒子更稀疏，中心更密集
        r += Math.cos(offset * Math.PI / 2) * offset * ringWidth;
        z = (Math.random() - 0.5) * depthScale;
    } 
    // 15% 的粒子作为弥散在圆环周围的“星云浮尘”，创造出极度奢华的高级毛玻璃散射星光
    else {
        r = baseRadius + (Math.random() - 0.5) * 0.25; // 较宽的散布范围
        z = (Math.random() - 0.5) * depthScale * 2.2;
    }
    
    const x = r * Math.cos(theta);
    const y = r * Math.sin(theta);
    
    positionArray.push(x, y, z);
}

// --------------------------------------------------
// 🎯 写入 1/2：覆写 JSON 点云资源 (assets/geometry/home/logo.json)
// --------------------------------------------------
const outputJson = {
    position: positionArray
};
console.log(`正在写入 JSON 点云文件... => ${homeJsonPath}`);
fs.writeFileSync(homeJsonPath, JSON.stringify(outputJson, null, 4), 'utf8');

// --------------------------------------------------
// 🎯 写入 2/2：编译并覆写底座粒子实际加载资源 (assets/geometry/particles/at_logo.bin)
// --------------------------------------------------
// 转换为 WebGL 高效浮点数组字节缓冲以进行物理覆写
const floatArray = new Float32Array(positionArray);
const binaryBuffer = Buffer.from(floatArray.buffer);

console.log(`正在写入二进制粒子点集文件... => ${particleBinPath}`);
// 确保父目录存在以防未下载完全
const particleBinDir = path.dirname(particleBinPath);
if (!fs.existsSync(particleBinDir)) fs.mkdirSync(particleBinDir, { recursive: true });
fs.writeFileSync(particleBinPath, binaryBuffer);

console.log('\n==================================================');
console.log('🎉 恭喜！科幻全息 “O” 型双形态粒子资源已饱和注入！');
console.log('   （此时您上方精致的 “JianDan” 立体模型将保持 100% 不变）');
console.log('💡 终极刷新秘籍：');
console.log('   请保持控制台「Disable Cache」开启，并在浏览器中执行：');
console.log('   👉 Mac 浏览器请按下：Cmd + Shift + R');
console.log('==================================================\n');

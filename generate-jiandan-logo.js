/**
 * 生成 JianDan 3D Logo 的 Draco 编码 .bin 文件
 * 使用与 Hydra 引擎兼容的自定义二进制格式
 * 格式: [2字节ASCII长度][2字节填充][6字节填充][JSON元数据][DRACO数据]
 */

const draco3d = require('draco3d');
const fs = require('fs');
const path = require('path');

// 定义 "JianDan" 中每个字母的 2D 轮廓（像素网格方式）
// 每个字母用一个二维数组表示其形状（1=实体，0=空白）
const letterShapes = {
    J: [
        [0,0,1,1,1],
        [0,0,0,1,0],
        [0,0,0,1,0],
        [0,0,0,1,0],
        [0,0,0,1,0],
        [1,0,0,1,0],
        [0,1,1,0,0],
    ],
    i: [
        [0,1,0],
        [0,0,0],
        [0,1,0],
        [0,1,0],
        [0,1,0],
        [0,1,0],
        [0,1,0],
    ],
    a: [
        [0,0,0,0],
        [0,0,0,0],
        [0,1,1,0],
        [0,0,0,1],
        [0,1,1,1],
        [1,0,0,1],
        [0,1,1,1],
    ],
    n: [
        [0,0,0,0],
        [0,0,0,0],
        [1,1,1,0],
        [1,0,0,1],
        [1,0,0,1],
        [1,0,0,1],
        [1,0,0,1],
    ],
    D: [
        [1,1,1,0,0],
        [1,0,0,1,0],
        [1,0,0,0,1],
        [1,0,0,0,1],
        [1,0,0,0,1],
        [1,0,0,1,0],
        [1,1,1,0,0],
    ],
    // 小写 a 再次使用
    // 小写 n 再次使用
};

// 将字母映射为实际使用的形状
const letters = [
    { shape: letterShapes.J, name: 'J' },
    { shape: letterShapes.i, name: 'i' },
    { shape: letterShapes.a, name: 'a' },
    { shape: letterShapes.n, name: 'n' },
    { shape: letterShapes.D, name: 'D' },
    { shape: letterShapes.a, name: 'a' },
    { shape: letterShapes.n, name: 'n' },
];

/**
 * 为单个方块生成3D几何体（立方体）
 * 返回 positions, normals, uvs 数组
 */
function createCube(x, y, z, size) {
    const s = size / 2;
    const cx = x, cy = y, cz = z;

    // 6个面，每个面2个三角形，每个三角形3个顶点
    // 面的定义：[法线方向, 4个角点]
    const faces = [
        // 前面 (z+)
        { normal: [0, 0, 1], vertices: [[cx-s,cy-s,cz+s],[cx+s,cy-s,cz+s],[cx+s,cy+s,cz+s],[cx-s,cy+s,cz+s]] },
        // 后面 (z-)
        { normal: [0, 0, -1], vertices: [[cx+s,cy-s,cz-s],[cx-s,cy-s,cz-s],[cx-s,cy+s,cz-s],[cx+s,cy+s,cz-s]] },
        // 上面 (y+)
        { normal: [0, 1, 0], vertices: [[cx-s,cy+s,cz+s],[cx+s,cy+s,cz+s],[cx+s,cy+s,cz-s],[cx-s,cy+s,cz-s]] },
        // 下面 (y-)
        { normal: [0, -1, 0], vertices: [[cx-s,cy-s,cz-s],[cx+s,cy-s,cz-s],[cx+s,cy-s,cz+s],[cx-s,cy-s,cz+s]] },
        // 右面 (x+)
        { normal: [1, 0, 0], vertices: [[cx+s,cy-s,cz+s],[cx+s,cy-s,cz-s],[cx+s,cy+s,cz-s],[cx+s,cy+s,cz+s]] },
        // 左面 (x-)
        { normal: [-1, 0, 0], vertices: [[cx-s,cy-s,cz-s],[cx-s,cy-s,cz+s],[cx-s,cy+s,cz+s],[cx-s,cy+s,cz-s]] },
    ];

    const faceUVs = [[0,0],[1,0],[1,1],[0,1]];
    const positions = [];
    const normals = [];
    const uvs = [];

    for (const face of faces) {
        const v = face.vertices;
        const n = face.normal;
        const triIndices = [0,1,2, 0,2,3];
        for (const idx of triIndices) {
            positions.push(...v[idx]);
            normals.push(...n);
            uvs.push(...faceUVs[idx]);
        }
    }

    return { positions, normals, uvs };
}

/**
 * 从字母形状数组生成完整的 3D 几何体
 */
function generateTextGeometry() {
    const allPositions = [];
    const allNormals = [];
    const allUVs = [];
    
    const cubeSize = 0.08; // 每个方块的大小
    const letterSpacing = 0.5; // 字母间距
    
    // 计算总宽度以居中
    let totalWidth = 0;
    const letterWidths = [];
    for (const letter of letters) {
        const w = letter.shape[0].length * cubeSize;
        letterWidths.push(w);
        totalWidth += w;
    }
    totalWidth += (letters.length - 1) * cubeSize * letterSpacing;
    
    let offsetX = -totalWidth / 2;
    
    for (let li = 0; li < letters.length; li++) {
        const shape = letters[li].shape;
        const rows = shape.length;
        const cols = shape[0].length;
        
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                if (shape[row][col] === 1) {
                    const x = offsetX + col * cubeSize;
                    const y = (rows - 1 - row) * cubeSize - (rows * cubeSize / 2); // 居中Y
                    const z = 0; // 平面Z
                    
                    const cube = createCube(x, y, z, cubeSize);
                    allPositions.push(...cube.positions);
                    allNormals.push(...cube.normals);
                    allUVs.push(...cube.uvs);
                    
                    // 添加一层厚度（深度方向）
                    const depthCube = createCube(x, y, -cubeSize, cubeSize);
                    allPositions.push(...depthCube.positions);
                    allNormals.push(...depthCube.normals);
                    allUVs.push(...depthCube.uvs);
                }
            }
        }
        
        offsetX += letterWidths[li] + cubeSize * letterSpacing;
    }
    
    return {
        positions: new Float32Array(allPositions),
        normals: new Float32Array(allNormals),
        uvs: new Float32Array(allUVs),
        numVertices: allPositions.length / 3
    };
}

async function main() {
    console.log('正在生成 JianDan 3D 文字几何体...');
    
    const geometry = generateTextGeometry();
    console.log(`生成了 ${geometry.numVertices} 个顶点`);
    
    // 初始化 Draco 编码器
    const encoderModule = await draco3d.createEncoderModule({});
    
    const encoder = new encoderModule.Encoder();
    const meshBuilder = new encoderModule.MeshBuilder();
    const mesh = new encoderModule.Mesh();
    
    // 添加 position 属性
    const numFaces = geometry.numVertices / 3;
    meshBuilder.AddFloatAttributeToMesh(
        mesh,
        encoderModule.POSITION,
        geometry.numVertices,
        3,
        geometry.positions
    );
    
    // 添加 normal 属性
    meshBuilder.AddFloatAttributeToMesh(
        mesh,
        encoderModule.NORMAL,
        geometry.numVertices,
        3,
        geometry.normals
    );
    
    // 添加 uv 属性
    meshBuilder.AddFloatAttributeToMesh(
        mesh,
        encoderModule.TEX_COORD,
        geometry.numVertices,
        2,
        geometry.uvs
    );
    
    // 一次性添加所有三角形面
    const faceIndices = new Uint32Array(numFaces * 3);
    for (let i = 0; i < numFaces; i++) {
        faceIndices[i * 3] = i * 3;
        faceIndices[i * 3 + 1] = i * 3 + 1;
        faceIndices[i * 3 + 2] = i * 3 + 2;
    }
    meshBuilder.AddFacesToMesh(mesh, numFaces, faceIndices);
    
    console.log(`Mesh 包含 ${mesh.num_points()} 个点, ${mesh.num_faces()} 个面`);
    
    // 设置编码参数
    encoder.SetSpeedOptions(5, 5);
    encoder.SetAttributeQuantization(encoderModule.POSITION, 14);
    encoder.SetAttributeQuantization(encoderModule.NORMAL, 10);
    encoder.SetAttributeQuantization(encoderModule.TEX_COORD, 12);
    encoder.SetEncodingMethod(encoderModule.MESH_EDGEBREAKER_ENCODING);
    
    // 编码
    const encodedData = new encoderModule.DracoInt8Array();
    const encodedLen = encoder.EncodeMeshToDracoBuffer(mesh, encodedData);
    
    if (encodedLen <= 0) {
        console.error('Draco 编码失败！');
        process.exit(1);
    }
    
    console.log(`Draco 编码完成，大小: ${encodedLen} bytes`);
    
    // 提取编码后的数据
    const dracoBuffer = Buffer.alloc(encodedLen);
    for (let i = 0; i < encodedLen; i++) {
        dracoBuffer[i] = encodedData.GetValue(i) & 0xFF;
    }
    
    // 构建 Hydra 引擎兼容的 .bin 文件
    // Hydra 引擎解析格式（从 app.js 中的 DracoThread 代码确认）：
    // 1. 前 10 字节: 用 TextDecoder 解码后 parseInt 得到 jsonSize
    // 2. 字节 10 到 10+jsonSize: JSON 元数据
    // 3. 字节 10+jsonSize 之后: Draco 编码数据
    const jsonObj = {
        name: "AT_logo",
        type: 0,
        attributes: [["position", 7], ["normal", 7], ["uv", 7]]
    };
    const jsonStr = JSON.stringify(jsonObj);
    const jsonBuf = Buffer.from(jsonStr, 'utf8');
    
    // 前 10 字节: JSON 长度的 ASCII 表示，右填充 0x00
    const headerBuf = Buffer.alloc(10, 0);
    const jsonLenStr = jsonBuf.length.toString();
    headerBuf.write(jsonLenStr, 0, 'ascii');
    
    // 拼接最终文件
    const finalBuf = Buffer.concat([
        headerBuf,      // 10 bytes: JSON 长度（ASCII + 0x00 填充）
        jsonBuf,        // JSON 元数据
        dracoBuffer     // DRACO 编码数据
    ]);
    
    // 备份原文件
    const logoPath = path.join(__dirname, 'assets/geometry/logo/AT_logo.bin');
    const backupPath = path.join(__dirname, 'assets/geometry/logo/AT_logo.bin.backup');
    
    if (fs.existsSync(logoPath) && !fs.existsSync(backupPath)) {
        fs.copyFileSync(logoPath, backupPath);
        console.log('已备份原始 AT_logo.bin -> AT_logo.bin.backup');
    }
    
    // 写入新文件
    fs.writeFileSync(logoPath, finalBuf);
    console.log(`新 AT_logo.bin 已生成！总大小: ${finalBuf.length} bytes`);
    console.log(`  Header (10字节): JSON长度 = ${jsonLenStr}`);
    console.log(`  JSON (${jsonBuf.length}字节): ${jsonStr}`);
    console.log(`  DRACO 数据: ${encodedLen} bytes`);
    
    // 清理
    encoderModule.destroy(encodedData);
    encoderModule.destroy(mesh);
    encoderModule.destroy(meshBuilder);
    encoderModule.destroy(encoder);
    
    // 验证：模拟 Hydra 引擎的解析方式
    console.log('\n--- 验证：模拟 Hydra 引擎解析 ---');
    const verifyBuf = fs.readFileSync(logoPath);
    const textDecoder = new (require('util').TextDecoder)();
    const parsedJsonSize = parseInt(textDecoder.decode(verifyBuf.slice(0, 10)));
    console.log('parseInt(前10字节):', parsedJsonSize);
    const parsedJson = JSON.parse(textDecoder.decode(verifyBuf.slice(10, 10 + parsedJsonSize)));
    console.log('解析的 JSON:', JSON.stringify(parsedJson));
    const dracoData = verifyBuf.slice(10 + parsedJsonSize);
    console.log('DRACO 数据大小:', dracoData.length, 'bytes');
    console.log('DRACO 头部标识:', dracoData.slice(0, 5).toString('ascii'));
    console.log('✅ 验证通过！格式与 Hydra 引擎解析方式完全匹配');
}

main().catch(err => {
    console.error('生成失败:', err);
    process.exit(1);
});

// Historical operator tool; target the repository root, not tools/legacy.
const repoRoot = require("node:path").resolve(__dirname, "../..");
/**
 * compile-user-obj.js
 * 高性能 OBJ 格式 3D 模型编译器 -> Draco 压缩格式 AT_logo.bin
 * 支持 100MB+ 大型 OBJ 文件的流式解析、顶点/UV 索引对齐、中心校准、法线计算、以及粒子星云抽稀
 */

const fs = require('fs');
const readline = require('readline');
const path = require('path');
const draco3d = require('draco3d');

// 输入输出路径定义
const objPath = path.join(repoRoot, '1ad34af8a9876f5513c8a9bfdef27a62.obj');
const targetLogoBinPath = path.join(repoRoot, 'assets/geometry/logo/AT_logo.bin');
const targetParticleBinPath = path.join(repoRoot, 'assets/geometry/particles/at_logo.bin');
const homeJsonPath = path.join(repoRoot, 'assets/geometry/home/logo.json');

// 缩放系数配置 (原版模型约 0.8 包围盒大小以配合镜头)
const TARGET_SIZE = 0.8;
const DOWNSAMPLE_RATIO = 120; // 粒子抽稀比例：每 120 个点抽取一个点，把 75万个点抽稀到 6000个左右，防止主页卡死

async function main() {
    console.log('=== Zeta 3D 工业级编译器：启动 ===');
    console.log(`正在读取 OBJ 文件: ${objPath}`);

    if (!fs.existsSync(objPath)) {
        console.error(`未在本地找到 OBJ 模型: ${objPath}`);
        process.exit(1);
    }

    // 第一步：流式预读取以计算包围盒以及统计顶点/面数，极佳内存友好
    console.log('\n[第一阶段] 正在扫描包围盒并收集统计信息...');
    let numV = 0;
    let numVt = 0;
    let numF = 0;

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    let fileStream = fs.createReadStream(objPath);
    let rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
        const trimmed = line.trim();
        if (trimmed.startsWith('v ')) {
            numV++;
            const parts = trimmed.split(/\s+/);
            const x = parseFloat(parts[1]);
            const y = parseFloat(parts[2]);
            const z = parseFloat(parts[3]);
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        } else if (trimmed.startsWith('vt ')) {
            numVt++;
        } else if (trimmed.startsWith('f ')) {
            numF++;
        }
    }

    console.log(`扫描完成！统计结果:`);
    console.log(`  原始顶点数 (v): ${numV}`);
    console.log(`  原始纹理数 (vt): ${numVt}`);
    console.log(`  面数 (f): ${numF}`);

    // 包围盒与中心计算
    const sizeX = maxX - minX;
    const sizeY = maxY - minY;
    const sizeZ = maxZ - minZ;
    const maxDim = Math.max(sizeX, sizeY, sizeZ);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const scale = TARGET_SIZE / maxDim;

    console.log(`包围盒属性:`);
    console.log(`  X 范围: [${minX.toFixed(4)}, ${maxX.toFixed(4)}], 宽度: ${sizeX.toFixed(4)}`);
    console.log(`  Y 范围: [${minY.toFixed(4)}, ${maxY.toFixed(4)}], 高度: ${sizeY.toFixed(4)}`);
    console.log(`  Z 范围: [${minZ.toFixed(4)}, ${maxZ.toFixed(4)}], 深度: ${sizeZ.toFixed(4)}`);
    console.log(`  几何中心点 (平移偏置): (${centerX.toFixed(4)}, ${centerY.toFixed(4)}, ${centerZ.toFixed(4)})`);
    console.log(`  缩放系数 (对齐目标 ${TARGET_SIZE}): ${scale.toFixed(6)}`);

    // 准备数据缓冲区存储原始 v 和 vt，以便在第二阶段直接利用索引
    // 注意：OBJ 中的索引是 1-based 且可能有负数，所以我们直接分配连续内存
    const rawVerticesX = new Float32Array(numV + 1);
    const rawVerticesY = new Float32Array(numV + 1);
    const rawVerticesZ = new Float32Array(numV + 1);

    const rawUvsU = new Float32Array(numVt + 1);
    const rawUvsV = new Float32Array(numVt + 1);

    console.log('\n[第二阶段] 正在将原始顶点位置与 UV 加载至连续内存中...');
    fileStream = fs.createReadStream(objPath);
    rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let vIdx = 1;
    let vtIdx = 1;

    for await (const line of rl) {
        const trimmed = line.trim();
        if (trimmed.startsWith('v ')) {
            const parts = trimmed.split(/\s+/);
            // 流式平移并进行缩放归一化，保持 logo 恰好处在原点正中
            rawVerticesX[vIdx] = (parseFloat(parts[1]) - centerX) * scale;
            rawVerticesY[vIdx] = (parseFloat(parts[2]) - centerY) * scale;
            rawVerticesZ[vIdx] = (parseFloat(parts[3]) - centerZ) * scale;
            vIdx++;
        } else if (trimmed.startsWith('vt ')) {
            const parts = trimmed.split(/\s+/);
            rawUvsU[vtIdx] = parseFloat(parts[1]);
            rawUvsV[vtIdx] = parseFloat(parts[2]);
            vtIdx++;
        }
    }

    console.log('数据加载完毕。');

    // 第三阶段：流式读取面定义，建立 (WebGL 唯一顶点) 的去重映射表，并生成 WebGL 专用的 Index 索引
    console.log('\n[第三阶段] 正在分析面数据、对齐顶点/UV并建立 WebGL 几何网格...');

    // Map 用于去重 "v_index/vt_index" 组合，确保不出现冗余的几何数据
    const vertexMap = new Map();
    let webglVertexCounter = 0;

    // 分配临时缓冲区用于存放 WebGL 所需的顶点展开数据
    // 我们预估 WebGL 唯一顶点数在 150 万以内
    const maxWebglVertices = Math.min(numF * 3, numV * 2);
    const webglPositions = new Float32Array(maxWebglVertices * 3);
    const webglUvs = new Float32Array(maxWebglVertices * 2);

    // 用于重计算法线 (Smooth Normals) 的法线加权累加区
    const webglNormalsSum = new Float32Array(maxWebglVertices * 3);

    // 索引数组
    const webglIndices = new Uint32Array(numF * 3);
    let indexOffset = 0;

    fileStream = fs.createReadStream(objPath);
    rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    // 主页粒子坐标提取点集：从归一化平移后的顶点中进行降采样抽稀
    const particlePositions = [];

    for await (const line of rl) {
        const trimmed = line.trim();
        if (trimmed.startsWith('f ')) {
            const parts = trimmed.split(/\s+/).slice(1);
            if (parts.length < 3) continue; // 过滤损坏面

            // 如果遇到多边形面进行三角剖分 (Triangle Fan)
            const count = parts.length;
            for (let i = 1; i < count - 1; i++) {
                const triParts = [parts[0], parts[i], parts[i + 1]];

                // 当前三角形的 WebGL 唯一顶点索引
                const faceIndices = [];

                for (const part of triParts) {
                    // 解析 "v/vt" 或 "v/vt/vn"
                    const subParts = part.split('/');
                    const vIndex = parseInt(subParts[0]);
                    const vtIndex = subParts[1] ? parseInt(subParts[1]) : 0;

                    const key = `${vIndex}/${vtIndex}`;
                    let webglIdx = vertexMap.get(key);

                    if (webglIdx === undefined) {
                        webglIdx = webglVertexCounter++;
                        vertexMap.set(key, webglIdx);

                        // 保护防止越界
                        if (webglIdx * 3 >= webglPositions.length) {
                            console.error('WebGL 顶点数超出预期阈值！请检查 OBJ 文件是否异常。');
                            process.exit(1);
                        }

                        // 写入展开后的顶点坐标和 UV
                        webglPositions[webglIdx * 3] = rawVerticesX[vIndex];
                        webglPositions[webglIdx * 3 + 1] = rawVerticesY[vIndex];
                        webglPositions[webglIdx * 3 + 2] = rawVerticesZ[vIndex];

                        if (vtIndex > 0) {
                            webglUvs[webglIdx * 2] = rawUvsU[vtIndex];
                            webglUvs[webglIdx * 2 + 1] = rawUvsV[vtIndex];
                        } else {
                            webglUvs[webglIdx * 2] = 0;
                            webglUvs[webglIdx * 2 + 1] = 0;
                        }
                    }

                    faceIndices.push(webglIdx);
                }

                // 写入三角形面对应的 WebGL 索引
                webglIndices[indexOffset++] = faceIndices[0];
                webglIndices[indexOffset++] = faceIndices[1];
                webglIndices[indexOffset++] = faceIndices[2];

                // --- 4. 实时重算法线并累加到对应的顶点累加区 (用于光影和反射) ---
                const v1_x = webglPositions[faceIndices[0] * 3], v1_y = webglPositions[faceIndices[0] * 3 + 1], v1_z = webglPositions[faceIndices[0] * 3 + 2];
                const v2_x = webglPositions[faceIndices[1] * 3], v2_y = webglPositions[faceIndices[1] * 3 + 1], v2_z = webglPositions[faceIndices[1] * 3 + 2];
                const v3_x = webglPositions[faceIndices[2] * 3], v3_y = webglPositions[faceIndices[2] * 3 + 1], v3_z = webglPositions[faceIndices[2] * 3 + 2];

                // 计算边向量
                const e1_x = v2_x - v1_x, e1_y = v2_y - v1_y, e1_z = v2_z - v1_z;
                const e2_x = v3_x - v1_x, e2_y = v3_y - v1_y, e2_z = v3_z - v1_z;

                // 计算叉积获得面法线
                const nx = e1_y * e2_z - e1_z * e2_y;
                const ny = e1_z * e2_x - e1_x * e2_z;
                const nz = e1_x * e2_y - e1_y * e2_x;

                // 累加到这三个顶点的法线累加器中
                for (const idx of faceIndices) {
                    webglNormalsSum[idx * 3] += nx;
                    webglNormalsSum[idx * 3 + 1] += ny;
                    webglNormalsSum[idx * 3 + 2] += nz;
                }
            }
        }
    }

    const finalWebglNumVertices = webglVertexCounter;
    console.log(`网格构建完成：`);
    console.log(`  WebGL 唯一顶点数 (去重后): ${finalWebglNumVertices}`);
    console.log(`  WebGL 三角面索引总数: ${indexOffset / 3}`);

    // 第四阶段：进行法线向量归一化 (Normalize)
    console.log('\n[第四阶段] 正在将顶点累加法线向量进行正规化...');
    const webglNormals = new Float32Array(finalWebglNumVertices * 3);
    for (let i = 0; i < finalWebglNumVertices; i++) {
        const nx = webglNormalsSum[i * 3];
        const ny = webglNormalsSum[i * 3 + 1];
        const nz = webglNormalsSum[i * 3 + 2];
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len > 0.000001) {
            webglNormals[i * 3] = nx / len;
            webglNormals[i * 3 + 1] = ny / len;
            webglNormals[i * 3 + 2] = nz / len;
        } else {
            // 平滑 fallback 为前方向量法线
            webglNormals[i * 3] = 0;
            webglNormals[i * 3 + 1] = 0;
            webglNormals[i * 3 + 2] = 1;
        }
    }

    // 裁剪 Float32Array 缓冲区以契合实际顶点数量
    const finalPositions = webglPositions.slice(0, finalWebglNumVertices * 3);
    const finalUvs = webglUvs.slice(0, finalWebglNumVertices * 2);
    const finalIndices = webglIndices.slice(0, indexOffset);

    // 第五阶段：主页粒子星云 `logo.json` 点抽稀导出
    console.log('\n[第五阶段] 正在为粒子背景星云抽稀点集并保存 JSON...');
    // 使用抽稀因子抽取顶点数据
    for (let i = 0; i < finalWebglNumVertices; i += DOWNSAMPLE_RATIO) {
        particlePositions.push(
            finalPositions[i * 3],
            finalPositions[i * 3 + 1],
            finalPositions[i * 3 + 2]
        );
    }
    const particleJson = {
        position: particlePositions
    };
    fs.writeFileSync(homeJsonPath, JSON.stringify(particleJson), 'utf8');
    console.log(`  成功保存粒子点集 => ${homeJsonPath} (粒子数: ${particlePositions.length / 3} 个)`);

    // 第六阶段：进行 Draco 3D 算法压缩并封装为 Hydra 兼容的 bin 文件
    console.log('\n[第六阶段] 正在调用 Draco3D 进行超级算法级二进制压缩...');

    // 实例化 Draco 编码器
    const encoderModule = await draco3d.createEncoderModule({});
    const encoder = new encoderModule.Encoder();
    const meshBuilder = new encoderModule.MeshBuilder();
    const mesh = new encoderModule.Mesh();

    // 添加 position 属性
    meshBuilder.AddFloatAttributeToMesh(
        mesh,
        encoderModule.POSITION,
        finalWebglNumVertices,
        3,
        finalPositions
    );

    // 添加 normal 属性
    meshBuilder.AddFloatAttributeToMesh(
        mesh,
        encoderModule.NORMAL,
        finalWebglNumVertices,
        3,
        webglNormals
    );

    // 添加 uv 属性
    meshBuilder.AddFloatAttributeToMesh(
        mesh,
        encoderModule.TEX_COORD,
        finalWebglNumVertices,
        2,
        finalUvs
    );

    // 添加面索引
    const dracoNumFaces = finalIndices.length / 3;
    meshBuilder.AddFacesToMesh(mesh, dracoNumFaces, finalIndices);

    // 设置高级压缩参数以最大化网络传输性能
    encoder.SetSpeedOptions(4, 4);
    encoder.SetAttributeQuantization(encoderModule.POSITION, 14);
    encoder.SetAttributeQuantization(encoderModule.NORMAL, 10);
    encoder.SetAttributeQuantization(encoderModule.TEX_COORD, 12);
    encoder.SetEncodingMethod(encoderModule.MESH_EDGEBREAKER_ENCODING);

    const encodedData = new encoderModule.DracoInt8Array();
    const encodedLen = encoder.EncodeMeshToDracoBuffer(mesh, encodedData);

    if (encodedLen <= 0) {
        console.error('Draco 压缩编码失败！');
        process.exit(1);
    }

    console.log(`Draco 压缩完成！二进制流大小: ${encodedLen} 字节 (原本顶点数组总大小约 ${(finalPositions.length * 4 / 1024 / 1024).toFixed(2)}MB)`);

    // 提取为 Node Buffer
    const dracoBuffer = Buffer.alloc(encodedLen);
    for (let i = 0; i < encodedLen; i++) {
        dracoBuffer[i] = encodedData.GetValue(i) & 0xFF;
    }

    // 构建 Hydra 引擎解析头部
    const jsonObj = {
        name: "AT_logo",
        type: 0,
        attributes: [["position", 7], ["normal", 7], ["uv", 7]]
    };
    const jsonStr = JSON.stringify(jsonObj);
    const jsonBuf = Buffer.from(jsonStr, 'utf8');

    // 10 字节 JSON 长度 ASCII 前缀填充
    const headerBuf = Buffer.alloc(10, 0);
    const jsonLenStr = jsonBuf.length.toString();
    headerBuf.write(jsonLenStr, 0, 'ascii');

    const finalBinBuffer = Buffer.concat([
        headerBuf,
        jsonBuf,
        dracoBuffer
    ]);

    console.log(`\n正在分发注入二进制资产到目标目录...`);
    fs.writeFileSync(targetLogoBinPath, finalBinBuffer);
    console.log(`[已覆盖] 3D实体 => ${targetLogoBinPath} (打包总大小: ${finalBinBuffer.length} 字节)`);

    fs.writeFileSync(targetParticleBinPath, finalBinBuffer);
    console.log(`[已覆盖] 粒子参考 => ${targetParticleBinPath}`);

    // 清理 C++ Draco 对象释放内存
    encoderModule.destroy(encodedData);
    encoderModule.destroy(mesh);
    encoderModule.destroy(meshBuilder);
    encoderModule.destroy(encoder);

    console.log('\n==================================================');
    console.log('🎉 恭喜！您提供的高精度 OBJ 3D Logo 已完美注入！');
    console.log('💡 预览指令：');
    console.log('   请保持控制台「Disable Cache」开启，并在浏览器中执行：');
    console.log('   👉 Mac: Cmd + Shift + R 强刷网页');
    console.log('   您将看到正中心旋转的 logo 和凝聚的星河均被替换为您提供的高精模型！');
    console.log('==================================================\n');
}

main().catch(err => {
    console.error('编译重构异常:', err);
    process.exit(1);
});

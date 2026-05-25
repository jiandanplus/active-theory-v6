/**
 * compile-o-particles.js
 * Zeta 3D 粒子专属 Draco 二进制编译器
 * 读取 o_ring.obj 圆环模型，生成符合 Hydra 引擎解码规范的 Draco 压缩文件
 * 只注入 assets/geometry/particles/at_logo.bin 和 assets/geometry/home/logo.json，保护上方自转实体 Logo 完美不变！
 */

const fs = require('fs');
const readline = require('readline');
const path = require('path');
const draco3d = require('draco3d');

// 输入输出路径定义
const objPath = path.join(__dirname, 'o_ring.obj');
const targetParticleBinPath = path.join(__dirname, 'assets/geometry/particles/at_logo.bin');
const homeJsonPath = path.join(__dirname, 'assets/geometry/home/logo.json');

// 缩放系数与抽稀配置
const TARGET_SIZE = 0.8; 
const DOWNSAMPLE_RATIO = 1; // 对 2145 个精致顶点直接全采，粒子圆环致密又亮丽！

async function main() {
    console.log('=== Zeta 粒子 Draco 编译器：启动 ===');
    console.log(`正在读取 OBJ 文件: ${objPath}`);
    
    if (!fs.existsSync(objPath)) {
        console.error(`未在本地找到 OBJ 模型: ${objPath}`);
        process.exit(1);
    }
    
    // 第一阶段：扫描包围盒并收集统计信息
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
    console.log(`  顶点数 (v): ${numV}`);
    console.log(`  纹理数 (vt): ${numVt}`);
    console.log(`  面数 (f): ${numF}`);
    
    // 居中和缩放校准
    const sizeX = maxX - minX;
    const sizeY = maxY - minY;
    const sizeZ = maxZ - minZ;
    const maxDim = Math.max(sizeX, sizeY, sizeZ);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const scale = TARGET_SIZE / maxDim;
    
    console.log(`包围盒属性:`);
    console.log(`  X: [${minX.toFixed(4)}, ${maxX.toFixed(4)}], Y: [${minY.toFixed(4)}, ${maxY.toFixed(4)}], Z: [${minZ.toFixed(4)}, ${maxZ.toFixed(4)}]`);
    console.log(`  几何中心点 (平移偏置): (${centerX.toFixed(4)}, ${centerY.toFixed(4)}, ${centerZ.toFixed(4)})`);
    console.log(`  缩放系数 (对齐目标 ${TARGET_SIZE}): ${scale.toFixed(6)}`);
    
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
            // 归一化中心偏移，使粒子圆环处于底座原点正中央
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
    
    // 第三阶段：对齐顶点/UV并建立 WebGL 几何网格
    console.log('\n[第三阶段] 正在分析面数据、对齐顶点/UV并建立 WebGL 几何网格...');
    const vertexMap = new Map(); 
    let webglVertexCounter = 0;
    
    const maxWebglVertices = numF * 3;
    const webglPositions = new Float32Array(maxWebglVertices * 3);
    const webglUvs = new Float32Array(maxWebglVertices * 2);
    const webglNormalsSum = new Float32Array(maxWebglVertices * 3);
    
    const webglIndices = new Uint32Array(numF * 3);
    let indexOffset = 0;
    
    fileStream = fs.createReadStream(objPath);
    rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    
    const particlePositions = [];
    
    for await (const line of rl) {
        const trimmed = line.trim();
        if (trimmed.startsWith('f ')) {
            const parts = trimmed.split(/\s+/).slice(1);
            if (parts.length < 3) continue;
            
            const count = parts.length;
            for (let i = 1; i < count - 1; i++) {
                const triParts = [parts[0], parts[i], parts[i + 1]];
                const faceIndices = [];
                
                for (const part of triParts) {
                    const subParts = part.split('/');
                    const vIndex = parseInt(subParts[0]);
                    const vtIndex = subParts[1] ? parseInt(subParts[1]) : 0;
                    
                    const key = `${vIndex}/${vtIndex}`;
                    let webglIdx = vertexMap.get(key);
                    
                    if (webglIdx === undefined) {
                        webglIdx = webglVertexCounter++;
                        vertexMap.set(key, webglIdx);
                        
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
                
                webglIndices[indexOffset++] = faceIndices[0];
                webglIndices[indexOffset++] = faceIndices[1];
                webglIndices[indexOffset++] = faceIndices[2];
                
                // 重算法线 (用于星云粒子自发光和折射)
                const v1_x = webglPositions[faceIndices[0] * 3], v1_y = webglPositions[faceIndices[0] * 3 + 1], v1_z = webglPositions[faceIndices[0] * 3 + 2];
                const v2_x = webglPositions[faceIndices[1] * 3], v2_y = webglPositions[faceIndices[1] * 3 + 1], v2_z = webglPositions[faceIndices[1] * 3 + 2];
                const v3_x = webglPositions[faceIndices[2] * 3], v3_y = webglPositions[faceIndices[2] * 3 + 1], v3_z = webglPositions[faceIndices[2] * 3 + 2];
                
                const e1_x = v2_x - v1_x, e1_y = v2_y - v1_y, e1_z = v2_z - v1_z;
                const e2_x = v3_x - v1_x, e2_y = v3_y - v1_y, e2_z = v3_z - v1_z;
                
                const nx = e1_y * e2_z - e1_z * e2_y;
                const ny = e1_z * e2_x - e1_x * e2_z;
                const nz = e1_x * e2_y - e1_y * e2_x;
                
                for (const idx of faceIndices) {
                    webglNormalsSum[idx * 3] += nx;
                    webglNormalsSum[idx * 3 + 1] += ny;
                    webglNormalsSum[idx * 3 + 2] += nz;
                }
            }
        }
    }
    
    const finalWebglNumVertices = webglVertexCounter;
    const finalPositions = webglPositions.slice(0, finalWebglNumVertices * 3);
    const finalUvs = webglUvs.slice(0, finalWebglNumVertices * 2);
    const finalIndices = webglIndices.slice(0, indexOffset);
    
    // 第四阶段：法线归一化
    console.log('\n[第四阶段] 正在将顶点法线向量进行正规化...');
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
            webglNormals[i * 3] = 0;
            webglNormals[i * 3 + 1] = 0;
            webglNormals[i * 3 + 2] = 1;
        }
    }
    
    // 第五阶段：主页粒子星云 `logo.json` 点抽稀导出
    console.log('\n[第五阶段] 正在为粒子背景星云抽稀点集并保存 JSON...');
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
    
    // 第六阶段：调用 Draco3D 算法压缩并封装为带有 10 字节 Hydra 前缀的二进制流
    console.log('\n[第六阶段] 正在调用 Draco3D 二进制算法压缩引擎...');
    const encoderModule = await draco3d.createEncoderModule({});
    const encoder = new encoderModule.Encoder();
    const meshBuilder = new encoderModule.MeshBuilder();
    const mesh = new encoderModule.Mesh();
    
    meshBuilder.AddFloatAttributeToMesh(mesh, encoderModule.POSITION, finalWebglNumVertices, 3, finalPositions);
    meshBuilder.AddFloatAttributeToMesh(mesh, encoderModule.NORMAL, finalWebglNumVertices, 3, webglNormals);
    meshBuilder.AddFloatAttributeToMesh(mesh, encoderModule.TEX_COORD, finalWebglNumVertices, 2, finalUvs);
    
    const dracoNumFaces = finalIndices.length / 3;
    meshBuilder.AddFacesToMesh(mesh, dracoNumFaces, finalIndices);
    
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
    
    const dracoBuffer = Buffer.alloc(encodedLen);
    for (let i = 0; i < encodedLen; i++) {
        dracoBuffer[i] = encodedData.GetValue(i) & 0xFF;
    }
    
    const jsonObj = {
        name: "AT_logo",
        type: 0,
        attributes: [["position", 7], ["normal", 7], ["uv", 7]]
    };
    const jsonStr = JSON.stringify(jsonObj);
    const jsonBuf = Buffer.from(jsonStr, 'utf8');
    
    const headerBuf = Buffer.alloc(10, 0);
    headerBuf.write(jsonBuf.length.toString(), 0, 'ascii');
    
    const finalBinBuffer = Buffer.concat([
        headerBuf,
        jsonBuf,
        dracoBuffer
    ]);
    
    console.log(`\n正在分发注入二进制粒子资产到目标目录...`);
    // 💡 饱和式保护：绝对不写入 assets/geometry/logo/AT_logo.bin，防止上方 “JianDan” 立体模型被篡改！
    
    fs.writeFileSync(targetParticleBinPath, finalBinBuffer);
    console.log(`[已覆写 - Draco 高精粒子源] => ${targetParticleBinPath} (打包大小: ${finalBinBuffer.length} 字节)`);
    
    encoderModule.destroy(encodedData);
    encoderModule.destroy(mesh);
    encoderModule.destroy(meshBuilder);
    encoderModule.destroy(encoder);
    
    console.log('\n==================================================');
    console.log('🎉 恭喜！基于 Draco 工业级打包的 “O” 型粒子资产已完美编译就绪！');
    console.log('   （此时您上方精致的 “JianDan” 立体模型已完美受到物理隔离保护）');
    console.log('==================================================\n');
}

main().catch(err => {
    console.error('粒子编译异常:', err);
    process.exit(1);
});

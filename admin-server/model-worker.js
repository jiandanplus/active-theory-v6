// Runs in a separate bounded process; only static GLB geometry is imported.
const fs = require("node:fs");
const assert = require("node:assert/strict");
const draco = require("draco3d");
const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let col = 0; col < 4; col++)
    for (let row = 0; row < 4; row++)
      for (let k = 0; k < 4; k++)
        out[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
  return out;
}
function transform(node) {
  if (node.matrix) {
    assert(
      node.matrix.length === 16 && node.matrix.every(Number.isFinite),
      "节点矩阵无效",
    );
    return node.matrix;
  }
  const [x, y, z, w] = node.rotation || [0, 0, 0, 1],
    [sx, sy, sz] = node.scale || [1, 1, 1],
    [tx, ty, tz] = node.translation || [0, 0, 0];
  return [
    (1 - 2 * y * y - 2 * z * z) * sx,
    (2 * x * y + 2 * w * z) * sx,
    (2 * x * z - 2 * w * y) * sx,
    0,
    (2 * x * y - 2 * w * z) * sy,
    (1 - 2 * x * x - 2 * z * z) * sy,
    (2 * y * z + 2 * w * x) * sy,
    0,
    (2 * x * z + 2 * w * y) * sz,
    (2 * y * z - 2 * w * x) * sz,
    (1 - 2 * x * x - 2 * y * y) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}
// Store the inverse-transpose in column-major order, matching normal multiplication below.
function normalMatrix(m) {
  const a = m[0],
    b = m[4],
    c = m[8],
    d = m[1],
    e = m[5],
    f = m[9],
    g = m[2],
    h = m[6],
    i = m[10];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  assert(Math.abs(det) > 1e-12, "模型缩放不能为零");
  return {
    det,
    n: [
      e * i - f * h,
      c * h - b * i,
      b * f - c * e,
      f * g - d * i,
      a * i - c * g,
      c * d - a * f,
      d * h - e * g,
      b * g - a * h,
      a * e - b * d,
    ].map((x) => x / det),
  };
}
async function convert(source, { size = 0.8 } = {}) {
  assert(
    source.length >= 20 &&
      source.toString("ascii", 0, 4) === "glTF" &&
      source.readUInt32LE(4) === 2,
    "需要有效的 GLB 2.0 模型",
  );
  assert(source.readUInt32LE(8) === source.length, "GLB 长度无效");
  assert(
    Number.isFinite(size) && size >= 0.1 && size <= 5,
    "模型尺寸应在 0.1–5 之间",
  );
  let document, binary;
  for (let at = 12; at < source.length; ) {
    assert(at + 8 <= source.length, "GLB 分块损坏");
    const length = source.readUInt32LE(at),
      type = source.readUInt32LE(at + 4);
    assert(at + 8 + length <= source.length, "GLB 数据不完整");
    const chunk = source.subarray(at + 8, at + 8 + length);
    if (type === 0x4e4f534a) document = JSON.parse(chunk.toString());
    if (type === 0x004e4942) binary = chunk;
    at += 8 + length;
  }
  assert(document && binary, "缺少 GLB 几何数据");
  assert(
    !document.animations?.length && !document.skins?.length,
    "首版不支持动画或蒙皮模型",
  );
  function accessor(id, components) {
    const a = document.accessors?.[id];
    assert(a && !a.sparse && !a.normalized, "不支持稀疏或归一化访问器");
    assert(
      a.type === { 1: "SCALAR", 2: "VEC2", 3: "VEC3" }[components],
      "访问器维度无效",
    );
    assert(a.count > 0 && a.count <= 9000000, "模型数据量超出限制");
    const v = document.bufferViews?.[a.bufferView];
    assert(v && v.buffer === 0 && !v.extensions, "不支持外部或压缩几何数据");
    const bytes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
    assert(bytes, "不支持该访问器数据类型");
    if (components !== 1)
      assert(a.componentType === 5126, "位置、法线和 UV 必须为浮点数据");
    const start = (v.byteOffset || 0) + (a.byteOffset || 0),
      stride = v.byteStride || components * bytes;
    assert(
      start >= 0 &&
        stride >= components * bytes &&
        start + (a.count - 1) * stride + components * bytes <= binary.length,
      "访问器范围无效",
    );
    const out =
      components === 1
        ? new Uint32Array(a.count)
        : new Float32Array(a.count * components);
    for (let j = 0; j < a.count; j++)
      for (let k = 0; k < components; k++) {
        const at = start + j * stride + k * bytes;
        out[j * components + k] =
          a.componentType === 5126
            ? binary.readFloatLE(at)
            : bytes === 1
              ? binary.readUInt8(at)
              : bytes === 2
                ? binary.readUInt16LE(at)
                : binary.readUInt32LE(at);
        assert(Number.isFinite(out[j * components + k]), "模型包含非有限数据");
      }
    return out;
  }
  const batches = [];
  let vertices = 0,
    faceCount = 0;
  function visit(id, parent, trail = new Set()) {
    assert(!trail.has(id) && trail.size < 64, "模型节点层级无效");
    const node = document.nodes?.[id];
    assert(node, "模型节点缺失");
    const world = multiply(parent, transform(node));
    if (node.mesh !== undefined) {
      const mesh = document.meshes?.[node.mesh];
      assert(mesh, "模型网格缺失");
      for (const p of mesh.primitives) {
        assert(
          (p.mode ?? 4) === 4 && !p.targets && !p.extensions,
          "仅支持静态、未压缩的三角网格",
        );
        const positions = accessor(p.attributes.POSITION, 3),
          count = positions.length / 3;
        const indices =
          p.indices === undefined
            ? Uint32Array.from({ length: count }, (_, i) => i)
            : accessor(p.indices, 1);
        assert(indices.length % 3 === 0, "三角面索引无效");
        for (const i of indices) assert(i < count, "索引越界");
        const normals =
          p.attributes.NORMAL === undefined
            ? new Float32Array(positions.length)
            : accessor(p.attributes.NORMAL, 3);
        assert(normals.length === positions.length, "法线数量无效");
        if (p.attributes.NORMAL === undefined)
          for (let j = 0; j < indices.length; j += 3) {
            const a = indices[j] * 3,
              b = indices[j + 1] * 3,
              c = indices[j + 2] * 3;
            const ux = positions[b] - positions[a],
              uy = positions[b + 1] - positions[a + 1],
              uz = positions[b + 2] - positions[a + 2],
              vx = positions[c] - positions[a],
              vy = positions[c + 1] - positions[a + 1],
              vz = positions[c + 2] - positions[a + 2];
            for (const q of [a, b, c]) {
              normals[q] += uy * vz - uz * vy;
              normals[q + 1] += uz * vx - ux * vz;
              normals[q + 2] += ux * vy - uy * vx;
            }
          }
        const uv =
          p.attributes.TEXCOORD_0 === undefined
            ? new Float32Array(count * 2)
            : accessor(p.attributes.TEXCOORD_0, 2);
        assert(uv.length === count * 2, "UV 数量无效");
        const { n, det } = normalMatrix(world);
        for (let j = 0; j < count; j++) {
          const x = positions[j * 3],
            y = positions[j * 3 + 1],
            z = positions[j * 3 + 2],
            nx = normals[j * 3],
            ny = normals[j * 3 + 1],
            nz = normals[j * 3 + 2];
          for (let k = 0; k < 3; k++) {
            positions[j * 3 + k] =
              world[k] * x +
              world[4 + k] * y +
              world[8 + k] * z +
              world[12 + k];
            normals[j * 3 + k] = n[k] * nx + n[3 + k] * ny + n[6 + k] * nz;
          }
          const len = Math.hypot(...normals.subarray(j * 3, j * 3 + 3));
          for (let k = 0; k < 3; k++) normals[j * 3 + k] /= len || 1;
        }
        if (det < 0)
          for (let j = 0; j < indices.length; j += 3)
            [indices[j + 1], indices[j + 2]] = [indices[j + 2], indices[j + 1]];
        batches.push({ positions, normals, uv, indices });
        vertices += count;
        faceCount += indices.length / 3;
        assert(
          vertices <= 2000000 && faceCount <= 3000000,
          "模型超出 200 万顶点或 300 万三角面限制",
        );
      }
    }
    const next = new Set(trail);
    next.add(id);
    for (const child of node.children || []) visit(child, world, next);
  }
  const scene = document.scenes?.[document.scene || 0];
  assert(scene?.nodes?.length, "模型没有场景");
  for (const id of scene.nodes) visit(id, I);
  assert(vertices && faceCount, "模型没有三角面");
  const positions = new Float32Array(vertices * 3),
    normals = new Float32Array(vertices * 3),
    uvs = new Float32Array(vertices * 2),
    indices = new Uint32Array(faceCount * 3);
  let vo = 0,
    io = 0;
  for (const batch of batches) {
    positions.set(batch.positions, vo * 3);
    normals.set(batch.normals, vo * 3);
    uvs.set(batch.uv, vo * 2);
    for (const idx of batch.indices) indices[io++] = idx + vo;
    vo += batch.positions.length / 3;
  }
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let j = 0; j < positions.length; j++) {
    min[j % 3] = Math.min(min[j % 3], positions[j]);
    max[j % 3] = Math.max(max[j % 3], positions[j]);
  }
  const extent = Math.max(...max.map((v, k) => v - min[k]));
  assert(extent > 0, "模型尺寸为零");
  for (let j = 0; j < positions.length; j++)
    positions[j] =
      ((positions[j] - (max[j % 3] + min[j % 3]) / 2) * size) / extent;
  const m = await draco.createEncoderModule({}),
    encoder = new m.Encoder(),
    builder = new m.MeshBuilder(),
    mesh = new m.Mesh(),
    encoded = new m.DracoInt8Array();
  try {
    builder.AddFloatAttributeToMesh(mesh, m.POSITION, vertices, 3, positions);
    builder.AddFloatAttributeToMesh(mesh, m.NORMAL, vertices, 3, normals);
    builder.AddFloatAttributeToMesh(mesh, m.TEX_COORD, vertices, 2, uvs);
    builder.AddFacesToMesh(mesh, faceCount, indices);
    encoder.SetSpeedOptions(4, 4);
    encoder.SetAttributeQuantization(m.POSITION, 14);
    encoder.SetAttributeQuantization(m.NORMAL, 10);
    encoder.SetAttributeQuantization(m.TEX_COORD, 12);
    encoder.SetEncodingMethod(m.MESH_EDGEBREAKER_ENCODING);
    const length = encoder.EncodeMeshToDracoBuffer(mesh, encoded);
    assert(length > 0, "模型压缩失败");
    const payload = Buffer.alloc(length);
    for (let i = 0; i < length; i++) payload[i] = encoded.GetValue(i) & 255;
    const meta = Buffer.from(
        JSON.stringify({
          name: "AT_logo",
          type: 0,
          attributes: [
            ["position", 7],
            ["normal", 7],
            ["uv", 7],
          ],
        }),
      ),
      header = Buffer.alloc(10);
    header.write(String(meta.length));
    return {
      buffer: Buffer.concat([header, meta, payload]),
      vertices,
      faces: faceCount,
    };
  } finally {
    for (const obj of [encoded, mesh, builder, encoder]) m.destroy(obj);
  }
}
if (require.main === module) {
  process.on("message", async (job) => {
    try {
      const result = await convert(fs.readFileSync(job.input), {
        size: job.size,
      });
      fs.writeFileSync(job.output, result.buffer, { flag: "wx", mode: 0o600 });
      process.send({
        ok: true,
        vertices: result.vertices,
        faces: result.faces,
      });
    } catch (error) {
      process.send({ ok: false, error: String(error.message).slice(0, 300) });
    } finally {
      process.disconnect();
    }
  });
}
module.exports = { convert };

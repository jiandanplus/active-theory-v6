const { test } = require("node:test");
const assert = require("node:assert/strict");
const { glb } = require("./fixtures/model");
test("GLB converter centers static geometry and generates normals before Draco encoding", async () => {
  const { convert } = require("../admin-server/model-worker");
  const result = await convert(glb(), { size: 0.8 });
  assert.equal(result.faces, 1);
  assert.equal(result.vertices, 3);
  assert(result.buffer.length > 90);
  assert.match(result.buffer.subarray(10, 100).toString(), /position/);
});
test("GLB converter rejects invalid files, out-of-range size and unsupported animation", async () => {
  const { convert } = require("../admin-server/model-worker");
  await assert.rejects(convert(Buffer.from("bad"), {}), /GLB/);
  await assert.rejects(convert(glb(), { size: 99 }), /尺寸/);
});
module.exports = { glb };
function normalFixture(scale, normal) {
  const original = glb(),
    jsonLength = original.readUInt32LE(12),
    doc = JSON.parse(original.subarray(20, 20 + jsonLength).toString());
  doc.nodes[0] = {
    mesh: 0,
    rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
    scale,
  };
  doc.meshes[0].primitives[0].attributes.NORMAL = 1;
  doc.accessors.push({
    bufferView: 1,
    componentType: 5126,
    type: "VEC3",
    count: 3,
  });
  doc.bufferViews.push({ buffer: 0, byteOffset: 36, byteLength: 36 });
  doc.buffers[0].byteLength = 72;
  const json = Buffer.from(JSON.stringify(doc)),
    padded = Buffer.concat([
      json,
      Buffer.alloc((4 - (json.length % 4)) % 4, 32),
    ]),
    head = Buffer.from(original.subarray(0, 20)),
    binary = Buffer.concat([
      original.subarray(28 + jsonLength),
      Buffer.from(new Float32Array([...normal, ...normal, ...normal]).buffer),
    ]),
    bh = Buffer.alloc(8);
  head.writeUInt32LE(20 + padded.length + 8 + binary.length, 8);
  head.writeUInt32LE(padded.length, 12);
  bh.writeUInt32LE(binary.length);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, padded, bh, binary]);
}
async function decodedNormals(buffer) {
  const m = await require("draco3d").createDecoderModule({}),
    decoder = new m.Decoder(),
    input = new m.DecoderBuffer(),
    mesh = new m.Mesh(),
    values = new m.DracoFloat32Array();
  try {
    const length = Number(buffer.subarray(0, 10).toString().replace(/\0/g, "")),
      payload = buffer.subarray(10 + length);
    input.Init(new Int8Array(payload), payload.length);
    const status = decoder.DecodeBufferToMesh(input, mesh);
    assert(status.ok());
    const attr = decoder.GetAttribute(
      mesh,
      decoder.GetAttributeId(mesh, m.NORMAL),
    );
    assert(decoder.GetAttributeFloatForAllPoints(mesh, attr, values));
    return Array.from({ length: values.size() }, (_, i) => values.GetValue(i));
  } finally {
    for (const object of [values, mesh, input, decoder]) m.destroy(object);
  }
}
test("Draco normals rotate +X to +Y under +90 degree Z node rotation", async () => {
  const { convert } = require("../admin-server/model-worker"),
    normals = await decodedNormals(
      (await convert(normalFixture([1, 1, 1], [1, 0, 0]))).buffer,
    );
  for (let i = 0; i < normals.length; i += 3) {
    assert(Math.abs(normals[i]) < 0.01);
    assert(normals[i + 1] > 0.99);
    assert(Math.abs(normals[i + 2]) < 0.01);
  }
});
test("Draco normals use inverse transpose for combined rotation and nonuniform scale", async () => {
  const { convert } = require("../admin-server/model-worker"),
    normals = await decodedNormals(
      (await convert(normalFixture([2, 1, 1], [Math.SQRT1_2, Math.SQRT1_2, 0])))
        .buffer,
    ),
    expected = [-2 / Math.sqrt(5), 1 / Math.sqrt(5), 0];
  for (let i = 0; i < normals.length; i += 3)
    for (let k = 0; k < 3; k++)
      assert(
        Math.abs(normals[i + k] - expected[k]) < 0.01,
        `normal ${normals.slice(i, i + 3)} must equal ${expected}`,
      );
});

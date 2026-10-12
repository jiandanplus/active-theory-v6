function glb() {
  const positions = Buffer.from(
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer,
  );
  const json = Buffer.from(
    JSON.stringify({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, translation: [4, 0, 0] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [
        { bufferView: 0, componentType: 5126, type: "VEC3", count: 3 },
      ],
      bufferViews: [{ buffer: 0, byteLength: 36 }],
      buffers: [{ byteLength: 36 }],
    }),
  );
  const padded = Buffer.concat([
    json,
    Buffer.alloc((4 - (json.length % 4)) % 4, 32),
  ]);
  const head = Buffer.alloc(20);
  head.write("glTF");
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + padded.length + 8 + positions.length, 8);
  head.writeUInt32LE(padded.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  const bh = Buffer.alloc(8);
  bh.writeUInt32LE(positions.length, 0);
  bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, padded, bh, positions]);
}
module.exports = { glb };

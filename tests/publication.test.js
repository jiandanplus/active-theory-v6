const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { openStore } = require("../admin-server/database");
const { initialConfig } = require("../admin-server/config");
test("publication rejects missing managed resources, raw GLB geometry and missing glyphs", async () => {
  const { validatePublication } = require("../admin-server/publication");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "site-publish-test-"));
  fs.mkdirSync(path.join(root, "assets/data"), { recursive: true });
  fs.mkdirSync(path.join(root, "assets/fonts"));
  fs.writeFileSync(
    path.join(root, "assets/data/uil.1.json"),
    JSON.stringify({
      INPUT_Element_3_About_text3d_text: "A",
      INPUT_Element_3_About_text3d_fontStyle: "font: Demo",
      INPUT_Config_8_ParticleTest_geometry: { src: "assets/base.bin" },
    }),
  );
  fs.writeFileSync(
    path.join(root, "assets/fonts/Demo.json"),
    JSON.stringify({ chars: [{ char: "A" }] }),
  );
  const store = openStore(path.join(root, "data"));
  const base = initialConfig(root);
  store.set("schema", base);
  try {
    const draft = structuredClone(base);
    draft.scenes[0].fields[0].value = "/media/missing";
    await assert.rejects(
      validatePublication(
        store,
        root,
        { dataDir: path.join(root, "data") },
        draft,
      ),
      /不存在/,
    );
    store.set("resources", [
      {
        id: "missing",
        url: "/media/missing",
        kind: "model",
        status: "uploaded",
        source: "local",
        key: "x.glb",
      },
    ]);
    await assert.rejects(
      validatePublication(
        store,
        root,
        { dataDir: path.join(root, "data") },
        draft,
      ),
      /转换/,
    );
    draft.scenes[0].fields[0].value = base.scenes[0].fields[0].value;
    draft.scenes[1].fields[0].value = "中";
    await assert.rejects(validatePublication(store, root, {}, draft), /字形/);
    await validatePublication(store, root, {}, base);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

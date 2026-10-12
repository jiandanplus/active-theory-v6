const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { contentFixture } = require("./content");
const { initialConfig } = require("../../admin-server/config");
const { encryptCredentials } = require("../../admin-server/storage");

function importFixture(t) {
  const f = contentFixture(t);
  const dataDir = path.join(f.root, "private-runtime");
  fs.mkdirSync(path.join(dataDir, "uploads"), { recursive: true });
  fs.writeFileSync(
    path.join(dataDir, "uploads/source.glb"),
    "original-model-bytes",
  );
  fs.writeFileSync(
    path.join(dataDir, "uploads/derived.bin"),
    "converted-logo-bytes",
  );
  fs.writeFileSync(
    path.join(dataDir, "uploads/optional.png"),
    "optional-image-bytes",
  );
  const uil = {
    INPUT_P_Element_1_Home_geometry: { src: "/models/derived-logo.bin" },
    INPUT_P_Element_3_About_text3d_text: "Original author",
  };
  fs.writeFileSync(
    path.join(f.root, "assets/data/uil.fixture.json"),
    JSON.stringify(uil),
  );
  fs.writeFileSync(path.join(f.root, "cms/projects-dev.json"), "[]");
  const config = initialConfig(f.root);
  const schema = structuredClone(config);
  config.site.title = "Legacy owner";
  const created = "2020-01-02T03:04:05.000Z";
  const resources = [
    {
      id: "source-logo",
      source: "local",
      storageId: "local",
      key: "source.glb",
      url: "/media/source-logo",
      name: "source.glb",
      kind: "model",
      status: "uploaded",
      created,
    },
    {
      id: "derived-logo",
      source: "local",
      storageId: "local",
      key: "derived.bin",
      url: "/models/derived-logo.bin",
      name: "derived.bin",
      kind: "model",
      status: "ready",
      originalId: "source-logo",
      created,
    },
    {
      id: "cloud-image",
      source: "s3",
      storageId: "cloud",
      key: "image.png",
      url: "/media/cloud-image",
      name: "image.png",
      kind: "image",
      status: "uploaded",
      created,
    },
    {
      id: "optional-image",
      source: "local",
      storageId: "local",
      key: "optional.png",
      url: "/media/optional-image",
      name: "optional.png",
      kind: "image",
      status: "uploaded",
      created,
    },
  ];
  const masterKey = "ab".repeat(32);
  const credentials = encryptCredentials(
    { accessKeyId: "private-access", secretAccessKey: "private-secret" },
    { masterKey },
  );
  const db = new DatabaseSync(f.legacyPath);
  try {
    db.exec(
      "DELETE FROM settings;DELETE FROM admins;DELETE FROM versions;DELETE FROM audit;CREATE TABLE sessions(id TEXT);INSERT INTO sessions VALUES('secret-session');",
    );
    for (const [key, value] of Object.entries({
      schema,
      draft: config,
      revision: 7,
      published: 42,
      resources,
      storages: [
        { id: "local", type: "local", name: "Local" },
        { id: "cloud", type: "s3", name: "Cloud", credentials },
      ],
      defaultStorage: "cloud",
    }))
      db.prepare("INSERT INTO settings VALUES(?,?)").run(
        key,
        JSON.stringify(value),
      );
    db.prepare("INSERT INTO settings VALUES(?,?)").run(
      "sessions",
      "not-json-ignored",
    );
    db.prepare("INSERT INTO admins VALUES(?,?)").run(
      "legacy_owner",
      "preserved-password-hash",
    );
    for (const id of [41, 42])
      db.prepare("INSERT INTO versions VALUES(?,?,?)").run(
        id,
        created,
        JSON.stringify({
          ...config,
          site: { ...config.site, title: `Version ${id}` },
        }),
      );
    db.prepare("INSERT INTO audit VALUES(?,?,?,?)").run(
      12,
      created,
      "legacy.publish",
      "legacy_owner",
    );
  } finally {
    db.close();
  }
  return {
    ...f,
    dataDir,
    config,
    schema,
    resources,
    credentials,
    masterKey,
    sourceHash: createHash("sha256")
      .update(fs.readFileSync(f.legacyPath))
      .digest("hex"),
  };
}
module.exports = { importFixture };

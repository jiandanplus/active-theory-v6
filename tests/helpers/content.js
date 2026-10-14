const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

function contentFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "site-content-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = {
    site: {
      title: "Fixture",
      email: "test@example.test",
      emailLink: "test@example.test",
      navWork: "Work",
      navContact: "Contact",
      contactTitle: "Contact",
      cityLax: "LA",
      cityNyc: "NY",
      cityAms: "AMS",
      labUrl: "",
    },
    projects: [
      {
        id: "p1",
        slug: "one",
        name: "One",
        tags: "test",
        video: { url: "/media/image", thumbnail: "/media/image" },
        projectLogo: { url: "/media/image" },
        completionDate: "2026-01-01",
      },
    ],
    scenes: [
      {
        id: "Home",
        label: "Home",
        fields: [{ key: "image", type: "resource", value: "/media/image" }],
      },
    ],
    songs: [{ id: "song1", title: "Song", src: "/media/audio" }],
  };
  const template = {
    baseUIL: { font: { src: "assets/font.png" } },
    contact: { email: "test@example.test" },
    metadata: { title: "Fixture" },
    fontCoverage: { letters: "abc" },
    readiness: { ready: true },
  };
  const assets = {
    image: { resourceId: "image", fileName: "image.png" },
    audio: { resourceId: "audio", fileName: "song.mp3" },
    font: { resourceId: "font", fileName: "assets/font.png" },
    unused: { resourceId: "unused", fileName: "unused.png" },
  };
  const draft = {
    format: 2,
    config,
    template,
    assets,
    legacyMap: { "assets/font.png": "font" },
  };
  const resources = ["image", "audio", "font", "unused"].map((id) => ({
    id,
    source: "bundled",
    url: `/media/${id}`,
    name: id,
    kind: id === "audio" ? "audio" : "image",
    status: "ready",
    size: 1,
    created: "2026-01-01T00:00:00.000Z",
  }));
  const bundle = {
    draft,
    schema: structuredClone(config),
    versions: [
      {
        id: 42,
        created: "2026-01-01T00:00:00.000Z",
        snapshot: structuredClone(draft),
      },
    ],
    published: 42,
    revision: 3,
    resources,
    storages: [{ id: "local", type: "local", name: "Local" }],
    defaultStorage: "local",
    admin: { username: "admin", hash: "fixture-hash" },
    audit: [{ action: "fixture.import", actor: "admin" }],
    report: {
      counts: { resources: 4 },
      missingRequired: [],
      warnings: [],
      credentialsUnavailable: [],
      hasAdmin: true,
      digest: "fixture",
    },
  };
  for (const dir of [
    "assets/data",
    "assets/images",
    "assets/fonts",
    "assets/js",
    "cms",
  ])
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  const write = (name, value) =>
    fs.writeFileSync(
      path.join(root, name),
      typeof value === "string" || Buffer.isBuffer(value)
        ? value
        : JSON.stringify(value),
    );
  write("assets/data/uil.fixture.json", template.baseUIL);
  write("cms/projects-dev.json", config.projects);
  write("cms/contact-dev.json", template.contact);
  write("cms/metadata-dev.json", template.metadata);
  const pixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6pXQAAAAASUVORK5CYII=",
    "base64",
  );
  write("assets/images/font.png", pixel);
  write("assets/images/image.png", pixel);
  write("assets/fonts/font.json", {
    chars: [{ id: 97, char: "a" }],
    pages: ["../images/font.png"],
  });
  write("index.html", '<!doctype html><html><head><title>Fixture</title></head><body><script>window._UNSUPPORTED_PAGE_ = "unsupported.html"; var s = "assets/js/app." + window._CACHE_ + ".js";</script></body></html>');
  write("assets/js/app.fixture.js", "let SONGS = [];");
  const legacyPath = path.join(root, "legacy.sqlite");
  const db = new DatabaseSync(legacyPath);
  try {
    db.exec(
      "CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);CREATE TABLE admins(username TEXT PRIMARY KEY,hash TEXT NOT NULL);CREATE TABLE versions(id INTEGER PRIMARY KEY AUTOINCREMENT,created TEXT NOT NULL,config TEXT NOT NULL);CREATE TABLE audit(id INTEGER PRIMARY KEY AUTOINCREMENT,created TEXT NOT NULL,action TEXT NOT NULL,actor TEXT);",
    );
    for (const [key, value] of Object.entries({
      draft: config,
      schema: config,
      revision: bundle.revision,
      published: bundle.published,
      resources,
      storages: bundle.storages,
      defaultStorage: bundle.defaultStorage,
    }))
      db.prepare("INSERT INTO settings VALUES(?,?)").run(
        key,
        JSON.stringify(value),
      );
    db.prepare("INSERT INTO admins VALUES(?,?)").run(
      bundle.admin.username,
      bundle.admin.hash,
    );
    db.prepare("INSERT INTO versions(id,created,config) VALUES(?,?,?)").run(
      42,
      bundle.versions[0].created,
      JSON.stringify(config),
    );
    db.prepare("INSERT INTO audit(created,action,actor) VALUES(?,?,?)").run(
      bundle.versions[0].created,
      "fixture.import",
      "admin",
    );
  } finally {
    db.close();
  }
  return {
    root,
    bundle,
    legacyPath,
    sourceHash: createHash("sha256")
      .update(fs.readFileSync(legacyPath))
      .digest("hex"),
  };
}
module.exports = { contentFixture };

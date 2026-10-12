const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const express = require("express");
const { postgresFixture } = require("./helpers/postgres");
const { contentFixture } = require("./helpers/content");
const { contentRepository } = require("../admin-server/repositories/content");
const {
  resourceRepository,
} = require("../admin-server/repositories/resources");
const load = () => require("../admin-server/storage");
test("real database INSERT rejection never returns success or overwrites concurrent registration", async (t) => {
  const f = await fixture(t);
  await f.store.query(
    "CREATE FUNCTION personal_site.reject_resource_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.name = 'reject' THEN RAISE EXCEPTION 'test-write-failure'; END IF; RETURN NEW; END $$",
  );
  await f.store.query(
    "CREATE TRIGGER reject_resource_test BEFORE INSERT ON personal_site.resources FOR EACH ROW EXECUTE FUNCTION personal_site.reject_resource_test()",
  );
  const link = (name) =>
    fetch(f.base + "/api/admin/resources/link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        kind: "image",
        url: "https://example.com/a.png",
      }),
    });
  const responses = await Promise.all([
    link("first"),
    link("second"),
    link("reject"),
  ]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [201, 201, 500],
  );
  const rows = await resourceRepository(f.store).list();
  assert.equal(rows.length, 6);
  assert.equal(new Set(rows.map((r) => r.id)).size, 6);
  assert(
    !JSON.stringify(await responses[2].json()).includes("test-write-failure"),
  );
});
test("storage implementation is available", () =>
  assert.equal(typeof load().createAdapter, "function"));
test("real S3 put at old endpoint cannot be registered after storage relocation", async (t) => {
  const objects = [];
  const server = http.createServer(async (req, res) => {
    const parts = [];
    for await (const chunk of req) parts.push(chunk);
    objects.push({ url: req.url, bytes: Buffer.concat(parts) });
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const endpoint = `http://127.0.0.1:${server.address().port}`,
    masterKey = "ab".repeat(32);
  const f = await fixture(t, { masterKey, endpointAllowlist: [endpoint] });
  const config = {
    id: "s3",
    type: "s3",
    endpoint,
    bucket: "bucket",
    publicBaseUrl: "https://cdn.example.com/",
    forcePathStyle: true,
    credentials: load().encryptCredentials(
      { accessKeyId: "test", secretAccessKey: "test" },
      { masterKey },
    ),
  };
  const {
    storageRepository,
  } = require("../admin-server/repositories/storages");
  await f.store.transaction((tx) => storageRepository(tx).upsert(config));
  const s = load(),
    original = s.createAdapter,
    originalLog = console.error,
    messages = [];
  s.createAdapter = async (...args) => {
    const adapter = await original(...args),
      put = adapter.put;
    adapter.put = async (...values) => {
      await put(...values);
      await f.store.transaction((tx) =>
        storageRepository(tx).upsert({
          ...config,
          endpoint: "https://new.example.com",
        }),
      );
    };
    return adapter;
  };
  console.error = (...args) => messages.push(args);
  try {
    const body = new FormData();
    body.append("storageId", "s3");
    body.append(
      "file",
      new Blob([
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
          "base64",
        ),
      ]),
      "pixel.png",
    );
    assert.equal(
      (
        await fetch(f.base + "/api/admin/resources/upload", {
          method: "POST",
          body,
        })
      ).status,
      409,
    );
    assert.equal((await resourceRepository(f.store).list()).length, 4);
    assert.equal(objects.length, 1);
    assert(objects[0].bytes.length > 0);
    assert.equal(messages.length, 1);
    assert.deepEqual(Object.keys(messages[0][1]), ["key"]);
  } finally {
    s.createAdapter = original;
    console.error = originalLog;
  }
});
test("S3 configuration persists masked encrypted credentials and permits explicit recovery", async (t) => {
  const endpoint = "http://127.0.0.1:19876",
    masterKey = "ab".repeat(32);
  const f = await fixture(t, { masterKey, endpointAllowlist: [endpoint] });
  const save = (value) =>
    fetch(f.base + "/api/admin/storages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
  const value = {
    id: "s3",
    type: "s3",
    endpoint,
    bucket: "bucket",
    publicBaseUrl: "https://cdn.example.com/",
    forcePathStyle: true,
    accessKeyId: "test-access",
    secretAccessKey: "test-secret",
    isDefault: true,
  };
  const response = await save(value);
  assert.equal(response.status, 201);
  const masked = await response.json();
  assert.equal(masked.storage.credentials, undefined);
  assert.equal(masked.storage.secretAccessKey, "configured");
  const repo =
    require("../admin-server/repositories/storages").storageRepository(f.store);
  const stored = await repo.get("s3");
  assert.deepEqual(
    load().decryptCredentials(stored.credentials, { masterKey }),
    { accessKeyId: "test-access", secretAccessKey: "test-secret" },
  );
  assert.equal(await repo.getDefault(), "s3");
  await f.store.query(
    "UPDATE personal_site.storages SET credentials=$1,available=false WHERE id='s3'",
    [JSON.stringify({ iv: "broken", tag: "broken", data: "broken" })],
  );
  assert.equal(
    (
      await save({
        ...value,
        accessKeyId: "configured",
        secretAccessKey: "configured",
      })
    ).status,
    503,
  );
  assert.equal(
    (
      await save({
        ...value,
        accessKeyId: "replacement",
        secretAccessKey: "replacement-secret",
      })
    ).status,
    200,
  );
  assert.equal((await repo.get("s3")).available, true);
  await f.store.transaction((tx) =>
    resourceRepository(tx).insert({
      id: "s3-resource",
      source: "s3",
      storageId: "s3",
      key: "object.png",
      url: "/media/s3-resource",
      name: "image",
      kind: "image",
      status: "uploaded",
    }),
  );
  assert.equal((await save({ ...value, prefix: "relocated" })).status, 409);
});
test("upload cannot register an object against storage changed during put", async (t) => {
  const f = await fixture(t),
    s = load(),
    original = s.createAdapter;
  const messages = [],
    originalLog = console.error;
  s.createAdapter = async (...args) => {
    const adapter = await original(...args),
      put = adapter.put;
    adapter.put = async (...values) => {
      await put(...values);
      await f.store.query(
        "UPDATE personal_site.storages SET available=false WHERE id='local'",
      );
    };
    return adapter;
  };
  console.error = (...args) => messages.push(args);
  try {
    const body = new FormData();
    body.append(
      "file",
      new Blob([
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
          "base64",
        ),
      ]),
      "pixel.png",
    );
    const response = await fetch(f.base + "/api/admin/resources/upload", {
      method: "POST",
      body,
    });
    assert.equal(response.status, 409);
    assert.equal((await resourceRepository(f.store).list()).length, 4);
  } finally {
    s.createAdapter = original;
    console.error = originalLog;
  }
});
test("unavailable storage never accepts media bytes", async (t) => {
  const dataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "unavailable-storage-"),
  );
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  await assert.rejects(
    load().createAdapter({ type: "local", available: false }, { dataDir }),
    (e) => e.status === 503,
  );
});
test("real upload INSERT failure preserves only an orphan and clears multipart temp", async (t) => {
  const f = await fixture(t);
  await f.store.query(
    "CREATE FUNCTION personal_site.reject_resource_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test-write-failure'; END $$",
  );
  await f.store.query(
    "CREATE TRIGGER reject_resource_test BEFORE INSERT ON personal_site.resources FOR EACH ROW EXECUTE FUNCTION personal_site.reject_resource_test()",
  );
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  const body = new FormData();
  body.append("file", new Blob([png]), "pixel.png");
  const messages = [];
  const original = console.error;
  console.error = (...args) => messages.push(args);
  let response;
  try {
    response = await fetch(f.base + "/api/admin/resources/upload", {
      method: "POST",
      body,
    });
  } finally {
    console.error = original;
  }
  assert.equal(response.status, 500);
  assert.equal((await resourceRepository(f.store).list()).length, 4);
  assert.deepEqual(fs.readdirSync(path.join(f.dir, "tmp")), []);
  const objects = fs.readdirSync(path.join(f.dir, "uploads"));
  assert.equal(objects.length, 1);
  assert.deepEqual(messages, [
    ["Unregistered media object", { key: objects[0] }],
  ]);
});
test("concurrent uploads retain independent rows and local delivery rejects invalid ranges", async (t) => {
  const f = await fixture(t);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  const upload = () => {
    const body = new FormData();
    body.append("file", new Blob([png]), "pixel.png");
    return fetch(f.base + "/api/admin/resources/upload", {
      method: "POST",
      body,
    });
  };
  const responses = await Promise.all([upload(), upload()]);
  assert.deepEqual(
    responses.map((r) => r.status),
    [201, 201],
  );
  const rows = await Promise.all(
    responses.map(async (r) => (await r.json()).resource),
  );
  assert.notEqual(rows[0].id, rows[1].id);
  assert.equal((await resourceRepository(f.store).list()).length, 6);
  for (const range of ["bytes=999-", "bytes=8-2", "bytes=-", "bytes=0-1,3-4"])
    assert.equal(
      (
        await fetch(f.base + rows[0].url, {
          headers: { "x-preview": "1", Range: range },
        })
      ).status,
      416,
    );
});
test("unexpired preview blocks trash, expired preview is pruned and bundled resources are read-only", async (t) => {
  const f = await fixture(t);
  const linked = await fetch(f.base + "/api/admin/resources/link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "image", url: "https://example.com/a.png" }),
  });
  const { resource } = await linked.json();
  const draft = await contentRepository(f.store).getDraft();
  draft.snapshot.config.projects[0].video.url = `/media/${resource.id}`;
  await f.store.transaction((tx) =>
    contentRepository(tx).putPreview({
      id: "preview-media",
      owner: "admin",
      expires: new Date(Date.now() + 60000).toISOString(),
      snapshot: draft.snapshot,
    }),
  );
  const trash = (id) =>
    fetch(f.base + "/api/admin/resources/" + id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: '{"trashed":true}',
    });
  assert.equal((await trash(resource.id)).status, 409);
  await f.store.query(
    "UPDATE personal_site.previews SET expires=$1 WHERE id=$2",
    [new Date(Date.now() - 1000).toISOString(), "preview-media"],
  );
  assert.equal((await trash(resource.id)).status, 200);
  assert.equal((await trash("unused")).status, 409);
});
test("local adapter removes incomplete objects after input stream failure", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "local-put-failure-"));
  const adapter = await load().createAdapter(
    { type: "local" },
    { dataDir: dir },
  );
  async function* broken() {
    yield Buffer.from("partial");
    throw new Error("broken stream");
  }
  try {
    await assert.rejects(adapter.put("failed.png", broken()));
    assert.deepEqual(fs.readdirSync(path.join(dir, "uploads")), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("reject unsafe URLs and object paths and missing encryption key", async () => {
  const s = load();
  assert.throws(
    () => s.encryptCredentials({ secretAccessKey: "secret" }, {}),
    /主密钥/,
  );
  for (const key of ["../a", "/a", "a/../b", "a\\b"])
    assert.throws(() => s.validateKey(key));
  await assert.rejects(s.validateEndpoint("http://127.0.0.1:8080", {}));
  await assert.rejects(s.validateEndpoint("ftp://example.com", {}));
  assert.throws(() => s.externalUrl("https://user:pass@example.com/x"));
  assert.throws(() => s.externalUrl("javascript:alert(1)"));
});
test("encrypts credentials and masks every credential", () => {
  const s = load(),
    options = { masterKey: "ab".repeat(32) },
    creds = {
      accessKeyId: "access",
      secretAccessKey: "secret",
      sessionToken: "token",
    };
  const cipher = s.encryptCredentials(creds, options);
  assert(!JSON.stringify(cipher).includes("secret"));
  assert.deepEqual(s.decryptCredentials(cipher, options), creds);
  const masked = s.redactStorage({ ...creds, credentials: cipher });
  assert(!Object.values(masked).includes("secret"));
  assert.equal(masked.accessKeyId, "configured");
  assert.equal(masked.credentials, undefined);
});
test("public object base rejects query and fragment instead of corrupting keys", () => {
  const s = load();
  for (const base of [
    "https://cdn.example/media?token=x",
    "https://cdn.example/media#hash",
  ])
    assert.throws(() => s.publicUrl({ publicBaseUrl: base }, "folder/a.png"));
  assert.equal(
    s.publicUrl(
      { publicBaseUrl: "https://cdn.example/media" },
      "folder/a b.png",
    ),
    "https://cdn.example/media/folder/a%20b.png",
  );
});
test("S3 virtual-hosted DNS requests use validated pinned bucket host", async (t) => {
  const dns = require("node:dns/promises"),
    original = dns.lookup;
  const hosts = [];
  const server = http.createServer((req, res) => {
    hosts.push(req.headers.host);
    res.end();
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const endpoint = `http://storage.test:${server.address().port}`;
  dns.lookup = async () => [{ address: "127.0.0.1", family: 4 }];
  let adapter;
  try {
    adapter = await load().createAdapter(
      {
        type: "s3",
        endpoint,
        bucket: "bucket",
        region: "us-east-1",
        forcePathStyle: false,
        accessKeyId: "test",
        secretAccessKey: "test",
      },
      { endpointAllowlist: [endpoint] },
    );
    await adapter.test();
    assert.equal(hosts[0], `bucket.storage.test:${server.address().port}`);
  } finally {
    adapter?.close();
    dns.lookup = original;
    await new Promise((r) => server.close(r));
  }
});
test("S3 adapter performs real Put Get Head Delete against isolated HTTP service", async (t) => {
  const objects = new Map(),
    methods = [];
  const server = http.createServer(async (req, res) => {
    methods.push(req.method);
    const key = req.url.split("?")[0];
    if (req.method === "PUT") {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      objects.set(key, Buffer.concat(chunks));
      res.writeHead(200, { ETag: '"test"' });
      res.end();
    } else if (req.method === "DELETE") {
      objects.delete(key);
      res.writeHead(204);
      res.end();
    } else if (!objects.has(key)) {
      res.writeHead(404);
      res.end();
    } else {
      res.writeHead(200, {
        "Content-Length": objects.get(key).length,
        "Content-Type": "image/png",
      });
      res.end(req.method === "HEAD" ? undefined : objects.get(key));
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  const adapter = await load().createAdapter(
    {
      type: "s3",
      endpoint,
      region: "us-east-1",
      bucket: "bucket",
      forcePathStyle: true,
      accessKeyId: "test",
      secretAccessKey: "test",
    },
    { endpointAllowlist: [endpoint] },
  );
  t.after(() => adapter.close());
  await adapter.put("prefix/object.png", Buffer.from("hello"), {
    size: 5,
    mime: "image/png",
  });
  assert.equal((await adapter.head("prefix/object.png")).ContentLength, 5);
  assert.equal(
    await (await adapter.get("prefix/object.png")).Body.transformToString(),
    "hello",
  );
  await adapter.delete("prefix/object.png");
  assert.equal(objects.size, 0);
  assert.deepEqual(methods, ["PUT", "HEAD", "GET", "DELETE"]);
});
async function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-test-")),
    { store } = await postgresFixture(t),
    app = express(),
    admin = express.Router();
  app.use(express.json());
  await store.transaction((tx) =>
    contentRepository(tx).importBundle(contentFixture(t).bundle),
  );
  app.use((req, res, next) => {
    req.adminSession = { username: "owner" };
    if (!req.url.startsWith("/api/admin") && !req.headers["x-preview"])
      req.adminSession = null;
    next();
  });
  app.use("/api/admin", admin);
  require("../admin-server/resources").mountResources({
    app,
    admin,
    store,
    options: { dataDir: dir, ...options },
  });
  app.use((err, req, res, next) => {
    const e = require("../admin-server/http").publicError(err);
    res.status(e.status).json({ error: e.message });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { store, dir, base: `http://127.0.0.1:${server.address().port}` };
}
test("resources reject missing storage, empty and spoofed uploads, preserve references", async (t) => {
  const f = await fixture(t),
    upload = async (body) =>
      fetch(f.base + "/api/admin/resources/upload", { method: "POST", body });
  const missing = new FormData();
  missing.append("storageId", "missing");
  missing.append("file", new Blob(["bad"]), "a.png");
  assert.equal((await upload(missing)).status, 400);
  const empty = new FormData();
  assert.equal((await upload(empty)).status, 400);
  const spoof = new FormData();
  spoof.append(
    "file",
    new Blob(["<script>bad</script>"], { type: "image/png" }),
    "a.png",
  );
  assert.equal((await upload(spoof)).status, 400);
  const linked = await fetch(f.base + "/api/admin/resources/link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: "https://example.com/a.png", kind: "image" }),
  });
  assert.equal(linked.status, 201);
  const { resource } = await linked.json();
  assert.equal(resource.accessibility, "unverified");
  await f.store.transaction((tx) =>
    resourceRepository(tx).replaceReferences({
      ownerType: "draft",
      ownerId: "draft",
      references: [{ resourceId: resource.id, slot: "image" }],
    }),
  );
  assert.equal(
    (
      await fetch(f.base + "/api/admin/resources/" + resource.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: '{"trashed":true}',
      })
    ).status,
    409,
  );
});
test("local uploads are private until published, support range and cannot traverse symlinks", async (t) => {
  const f = await fixture(t),
    png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
      "base64",
    );
  const form = new FormData();
  form.append(
    "file",
    new Blob([png], { type: "image/png" }),
    "../original.png",
  );
  const response = await fetch(f.base + "/api/admin/resources/upload", {
    method: "POST",
    body: form,
  });
  assert.equal(response.status, 201);
  const { resource } = await response.json();
  assert.equal((await fetch(f.base + resource.url)).status, 404);
  assert.equal(
    (await fetch(f.base + resource.url, { headers: { "x-preview": "1" } }))
      .status,
    200,
  );
  await f.store.transaction((tx) =>
    resourceRepository(tx).replaceReferences({
      ownerType: "version",
      ownerId: "42",
      references: [{ resourceId: resource.id, slot: "image" }],
    }),
  );
  const range = await fetch(f.base + resource.url, {
    headers: { Range: "bytes=0-7" },
  });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 8);
  const file = path.join(f.dir, "uploads", resource.key);
  fs.unlinkSync(file);
  fs.symlinkSync("/etc/passwd", file);
  assert.equal((await fetch(f.base + resource.url)).status, 404);
});
test("multipart rejects multiple files and clears temporary files", async (t) => {
  const f = await fixture(t),
    form = new FormData();
  form.append("file", new Blob(["one"]), "one.png");
  form.append("file", new Blob(["two"]), "two.png");
  assert.equal(
    (
      await fetch(f.base + "/api/admin/resources/upload", {
        method: "POST",
        body: form,
      })
    ).status,
    400,
  );
  assert.deepEqual(fs.readdirSync(path.join(f.dir, "tmp")), []);
  assert.equal((await resourceRepository(f.store).list()).length, 4);
});
test("multipart file without a filename returns 400 without terminating server", async (t) => {
  const f = await fixture(t);
  const response = await fetch(f.base + "/api/admin/resources/upload", {
    method: "POST",
    headers: { "Content-Type": "multipart/form-data; boundary=missing" },
    body: '--missing\r\nContent-Disposition: form-data; name="file"\r\nContent-Type: application/octet-stream\r\n\r\nhello\r\n--missing--\r\n',
    signal: AbortSignal.timeout(1000),
  });
  assert.equal(response.status, 400);
  assert.equal((await resourceRepository(f.store).list()).length, 4);
});
test("external registration never contacts destination and rejects non-HTTPS", async (t) => {
  const f = await fixture(t);
  for (const url of [
    "http://127.0.0.1/a.png",
    "file:///etc/passwd",
    "https://user:pass@example.com/a",
  ])
    assert.equal(
      (
        await fetch(f.base + "/api/admin/resources/link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, kind: "image" }),
        })
      ).status,
      400,
    );
});
test("aborted multipart upload releases temporary files and records no resource", async (t) => {
  const f = await fixture(t);
  await new Promise((resolve) => {
    const req = http.request(
      f.base + "/api/admin/resources/upload",
      {
        method: "POST",
        headers: { "Content-Type": "multipart/form-data; boundary=test" },
      },
      () => {},
    );
    req.on("error", resolve);
    req.write(
      '--test\r\nContent-Disposition: form-data; name="file"; filename="x.png"\r\nContent-Type: image/png\r\n\r\npartial',
    );
    setTimeout(() => req.destroy(), 30);
  });
  await new Promise((r) => setTimeout(r, 80));
  assert.deepEqual(fs.readdirSync(path.join(f.dir, "tmp")), []);
  assert.equal((await resourceRepository(f.store).list()).length, 4);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const express = require("express");
const { openStore } = require("../admin-server/database");
const load = () => require("../admin-server/storage");
test("storage implementation is available", () =>
  assert.equal(typeof load().createAdapter, "function"));
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
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "storage-test-")),
    store = openStore(dir),
    app = express(),
    admin = express.Router();
  app.use(express.json());
  app.use((req, res, next) => {
    if (req.headers["x-preview"]) req.adminSession = {};
    next();
  });
  app.use("/api/admin", admin);
  require("../admin-server/resources").mountResources({
    app,
    admin,
    store,
    options: { dataDir: dir },
  });
  app.use((err, req, res, next) =>
    res.status(err.status || 500).json({ error: err.message }),
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => {
    server.close();
    store.close();
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
  f.store.set("draft", { cover: resource.url });
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
  f.store.db
    .prepare("INSERT INTO versions(created,config) VALUES(?,?)")
    .run(new Date().toISOString(), JSON.stringify({ cover: resource.url }));
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
  assert.deepEqual(f.store.get("resources", []), []);
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
  assert.deepEqual(f.store.get("resources", []), []);
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
  assert.deepEqual(f.store.get("resources", []), []);
});

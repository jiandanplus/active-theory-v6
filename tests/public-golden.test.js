const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { deliveryFixture } = require("./helpers/delivery");
const { httpFixture } = require("./helpers/http");
const {
  deliveryRepository,
} = require("../admin-server/repositories/deliveries");

// Public output must stay byte-identical across performance and structure work.
// Regenerate deliberately with UPDATE_PUBLIC_GOLDEN=1 only for an intended change.
const goldenPath = path.join(__dirname, "fixtures/public-golden.json");
const HEADERS = [
  "content-type",
  "cache-control",
  "content-security-policy",
  "x-robots-tag",
  "x-content-type-options",
  "x-frame-options",
  "referrer-policy",
  "location",
  "etag",
  "strict-transport-security",
  "content-length",
];

async function fingerprint(f, route, init = {}) {
  const response = await f.request(route, { redirect: "manual", ...init });
  const body = Buffer.from(await response.arrayBuffer());
  const headers = {};
  for (const name of HEADERS)
    if (response.headers.has(name)) headers[name] = response.headers.get(name);
  return {
    status: response.status,
    headers,
    sha256: crypto.createHash("sha256").update(body).digest("hex"),
  };
}
async function publicRoutes(f, version) {
  const repo = deliveryRepository(f.store);
  const { artifactDigest } = await repo.getBinding({
    type: "version",
    id: String(version),
  });
  const { manifest } = await repo.getArtifact(artifactDigest);
  return [
    ...Object.keys(manifest.routes).sort(),
    ...Object.keys(manifest.endpoints)
      .sort()
      .map((name) => `/api/site/${version}/${name}`),
    ...Object.keys(manifest.runtime)
      .sort()
      .map((key) => `/api/site/${version}/runtime/${key}`),
    "/unsupported.html",
    "/assets/font.png",
    "/assets/missing.png",
    "/media/image",
    "/media/audio",
    "/media/unused",
    "/models/image.bin",
    "/assets/geometry/admin/image.bin",
    `/api/site/${version}/resources/image/image.png`,
    `/api/site/${version}/resources/audio/song.mp3`,
    `/api/site/${version}/resources/unused/unused.png`,
    "/api/site/999/identity.js",
    "/work/missing",
    "/health/live",
    "/health/ready",
  ];
}
async function capture(f, routes) {
  const result = {};
  for (const route of routes) {
    result[route] = await fingerprint(f, route);
    result["HEAD " + route] = await fingerprint(f, route, { method: "HEAD" });
  }
  result["RANGE /media/image"] = await fingerprint(f, "/media/image", {
    headers: { Range: "bytes=1-3" },
  });
  return result;
}
// Serve real bytes: local uploads for image and font, an S3 redirect for audio.
async function mediaSources(f) {
  fs.mkdirSync(f.root + "/data/uploads", { recursive: true });
  fs.writeFileSync(
    f.root + "/data/uploads/image.png",
    Buffer.from("golden-image-bytes"),
  );
  fs.writeFileSync(
    f.root + "/data/uploads/font.png",
    Buffer.from("golden-font-bytes"),
  );
  for (const id of ["image", "font"])
    await f.store.query(
      "UPDATE personal_site.resources SET source='local',storage_id='local',object_key=$1,mime='image/png' WHERE id=$2",
      [id + ".png", id],
    );
  await f.store.query(
    `UPDATE personal_site.resources SET source='s3',details=details || '{"publicUrl":"https://cdn.example.test/song.mp3"}'::jsonb WHERE id='audio'`,
  );
}
async function scenarios(t) {
  const out = {};
  const pinned = await deliveryFixture(t, { publish: true });
  await mediaSources(pinned);
  out.pinned = await capture(
    pinned,
    await publicRoutes(pinned, pinned.published),
  );
  const preview = await pinned.service.preview({
    revision: 3,
    actor: pinned.actor,
  });
  const privatePreview = await fingerprint(pinned, "/?preview=" + preview);
  out.pinned["/?preview=<id> anonymous"] = privatePreview;
  out.pinned["/?preview=<id> admin"] = {
    ...(await fingerprint(pinned, "/?preview=" + preview, {
      headers: { Cookie: pinned.headers.Cookie },
    })),
    sha256: "<preview body varies by id>",
  };

  const sample = await httpFixture(t);
  await sample.createAdmin();
  const headers = await sample.login();
  const builtin = await (
    await sample.request("/api/admin/runtime/builtin", {
      method: "POST",
      headers,
      body: "{}",
    })
  ).json();
  assert.equal(
    (
      await sample.request("/api/admin/runtime/selection", {
        method: "PUT",
        headers,
        body: JSON.stringify({ digest: builtin.digest, generation: 0 }),
      })
    ).status,
    200,
  );
  const published = await (
    await sample.request("/api/admin/publish", {
      method: "POST",
      headers,
      body: JSON.stringify({ revision: 3 }),
    })
  ).json();
  await mediaSources(sample);
  out.portfolio = await capture(
    sample,
    await publicRoutes(sample, published.version),
  );

  const empty = await httpFixture(t, { installed: false });
  out.uninstalled = await capture(empty, [
    "/",
    "/work",
    "/api/site/1/identity.js",
    "/health/live",
  ]);
  return out;
}

test(
  "public responses match the recorded golden baseline",
  { timeout: 120000 },
  async (t) => {
    const actual = await scenarios(t);
    if (process.env.UPDATE_PUBLIC_GOLDEN === "1") {
      fs.writeFileSync(goldenPath, JSON.stringify(actual, null, 2) + "\n");
      return;
    }
    const expected = JSON.parse(fs.readFileSync(goldenPath, "utf8"));
    for (const scenario of Object.keys(expected))
      for (const route of Object.keys(expected[scenario]))
        assert.deepEqual(
          actual[scenario]?.[route],
          expected[scenario][route],
          `${scenario} ${route}`,
        );
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort());
  },
);

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const launcher = path.join(root, "scripts/docker-local.js");

function fixture(t) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "portfolio-launcher-"),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, "owned");
}
function run(directory, ...args) {
  return spawnSync(
    process.execPath,
    [launcher, "up", "--directory", directory, "--dry-run", ...args],
    { encoding: "utf8" },
  );
}
test("one-command launcher exists", () =>
  assert.ok(fs.existsSync(launcher), "missing Docker launcher"));
test("local port 80 is accepted with a canonical origin", (t) => {
  const directory = fixture(t);
  const result = run(directory, "--port", "80");
  assert.equal(result.status, 0, result.stderr);
  const env = require("node:util").parseEnv(
    fs.readFileSync(path.join(directory, "config.env"), "utf8"),
  );
  assert.equal(env.SITE_ORIGIN, "http://127.0.0.1");
});
test("launcher creates private random distinct secrets once and preserves config bytes", (t) => {
  const directory = fixture(t);
  const first = run(directory);
  assert.equal(first.status, 0, first.stderr);
  const file = path.join(directory, "config.env");
  const before = fs.readFileSync(file, "utf8");
  const env = require("node:util").parseEnv(before);
  assert.equal(env.SITE_PORT, "3300");
  assert.equal(env.SITE_ORIGIN, "http://127.0.0.1:3300");
  assert.notEqual(env.POSTGRES_USER, env.POSTGRES_APP_USER);
  const secrets = [
    "POSTGRES_PASSWORD",
    "POSTGRES_APP_PASSWORD",
    "SETUP_TOKEN",
    "SITE_MASTER_KEY",
  ].map((key) => env[key]);
  assert.ok(secrets.every((value) => /^[a-f0-9]{64}$/.test(value)));
  assert.equal(new Set(secrets).size, secrets.length);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  assert.equal(run(directory).status, 0);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.doesNotMatch(first.stdout, new RegExp(env.SETUP_TOKEN));
  assert.match(first.stdout, /--env-file/);
});
test("launcher refuses invalid ports and unsafe origins before writing config", (t) => {
  for (const args of [
    ["--port", "0"],
    ["--port", "65536"],
    ["--port", "3e3"],
    ["--origin", "http://example.com:3300"],
    ["--origin", "http://127.0.0.1:3300/path"],
    ["--origin", "http://user:pass@127.0.0.1:3300"],
    ["--origin", "http://127.0.0.1:3000"],
  ]) {
    const directory = fixture(t);
    const result = run(directory, ...args);
    assert.notEqual(result.status, 0, args.join(" "));
    assert.equal(fs.existsSync(path.join(directory, "config.env")), false);
  }
});
test("launcher rejects existing unowned config and conflicting port without overwriting", (t) => {
  const directory = fixture(t);
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "config.env"), "operator data");
  assert.notEqual(run(directory).status, 0);
  assert.equal(
    fs.readFileSync(path.join(directory, "config.env"), "utf8"),
    "operator data",
  );
  const owned = fixture(t);
  assert.equal(run(owned).status, 0);
  const before = fs.readFileSync(path.join(owned, "config.env"), "utf8");
  assert.notEqual(run(owned, "--port", "3400").status, 0);
  assert.equal(fs.readFileSync(path.join(owned, "config.env"), "utf8"), before);
});
test("status and down preserve config and never request deletion of volumes", (t) => {
  const directory = fixture(t);
  assert.equal(run(directory).status, 0);
  const before = fs.readFileSync(path.join(directory, "config.env"), "utf8");
  for (const command of ["status", "down"]) {
    const result = spawnSync(
      process.execPath,
      [launcher, command, "--directory", directory, "--dry-run"],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /--volumes|\s-v(?:\s|$)/);
    assert.equal(
      fs.readFileSync(path.join(directory, "config.env"), "utf8"),
      before,
    );
  }
});
test("default image is writable non-root, healthchecked, and independent of original assets", () => {
  const docker = fs.readFileSync(path.join(root, "Dockerfile"), "utf8");
  const compose = fs.readFileSync(path.join(root, "compose.yaml"), "utf8");
  assert.match(docker, /USER node/);
  assert.match(docker, /chown.*node:node.*\/app\/data/);
  assert.match(docker, /HEALTHCHECK/);
  assert.match(docker, /health\/ready/);
  assert.match(docker, /COPY examples/);
  assert.doesNotMatch(docker, /COPY (?:\. |assets|tools|\.env)/);
  assert.doesNotMatch(compose, /SITE_ASSETS_DIR|\/app\/assets/);
  assert.match(compose, /127\.0\.0\.1:/);
  assert.match(compose, /NODE_ENV: development/);
  const external = fs.readFileSync(
    path.join(root, "compose.external.yaml"),
    "utf8",
  );
  assert.match(external, /NODE_ENV: production/);
  assert.doesNotMatch(external, /POSTGRES_PASSWORD|\n  db:/);
});

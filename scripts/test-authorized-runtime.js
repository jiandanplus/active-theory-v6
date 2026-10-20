#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = process.env.AUTHORIZED_RUNTIME_ROOT;
if (
  !root ||
  !fs.existsSync(path.join(root, "assets/js/app.1778129964370.js"))
) {
  console.error(
    "Authorized-runtime gate requires AUTHORIZED_RUNTIME_ROOT containing explicitly authorized original bytes. This is not covered by the sample tests.",
  );
  process.exit(1);
}
const result = spawnSync(
  process.execPath,
  [
    "--test",
    "--test-name-pattern=^authorized runtime:",
    "tests/frontend.test.js",
  ],
  { stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);

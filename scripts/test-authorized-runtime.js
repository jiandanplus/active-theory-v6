#!/usr/bin/env node
const { spawnSync } = require("node:child_process");
const { loadAuthorizedRuntime } = require("./authorized-runtime-input");
async function main() {
  await loadAuthorizedRuntime(process.env.AUTHORIZED_RUNTIME_ROOT);
  const result = spawnSync(
    process.execPath,
    [
      "--test",
      "--test-reporter=tap",
      "--test-name-pattern=^authorized runtime:",
      "tests/frontend.test.js",
    ],
    { stdio: "inherit", env: process.env },
  );
  process.exitCode = result.status ?? 1;
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

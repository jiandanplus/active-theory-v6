const { spawnSync } = require("node:child_process");
const defaultUrl =
  "postgresql://site_test:local-test-only@127.0.0.1:55432/site_test_control";
if (
  process.env.TEST_DATABASE_URL &&
  process.env.TEST_DATABASE_CONFIRMED !== "yes"
) {
  console.error(
    "Explicit TEST_DATABASE_URL requires TEST_DATABASE_CONFIRMED=yes after confirming a dedicated test database.",
  );
  process.exit(1);
}
// The optional original-runtime compatibility gate is explicit and never silently
// reported as complete by the clean-clone suite. Synthetic contract tests remain.
const optionalRuntime = process.env.AUTHORIZED_RUNTIME_ROOT
  ? []
  : ["--test-skip-pattern=^authorized runtime:"];
const result = spawnSync(
  process.execPath,
  [
    "--disable-warning=ExperimentalWarning",
    "--test",
    ...optionalRuntime,
    ...(process.argv.slice(2).length
      ? process.argv.slice(2)
      : ["tests/*.test.js"]),
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      TEST_DATABASE_URL: process.env.TEST_DATABASE_URL || defaultUrl,
      TEST_DATABASE_CONFIRMED: "yes",
    },
  },
);
process.exit(result.status ?? 1);

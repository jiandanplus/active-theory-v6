#!/usr/bin/env node
const path = require("node:path");
const { readBundle } = require("../admin-server/importers/bundle");
const { readLegacy } = require("../admin-server/importers/sqlite");
async function main(args = process.argv.slice(2)) {
  if (!args.includes("--check"))
    throw Error("Only read-only --check is supported");
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === "--check") continue;
    if (
      !["--root", "--legacy", "--mode", "--data-dir"].includes(key) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw Error("Invalid check options");
    options[key.slice(2)] = args[++i];
  }
  const root = path.resolve(options.root || path.join(__dirname, ".."));
  const bundle = options.legacy
    ? await readLegacy({
        root,
        legacyPath: path.resolve(options.legacy),
        masterKey: process.env.SITE_MASTER_KEY,
        dataDir: options["data-dir"]
          ? path.resolve(options["data-dir"])
          : undefined,
      })
    : await readBundle({ root, mode: options.mode || "empty" });
  process.stdout.write(JSON.stringify(bundle.report, null, 2) + "\n");
}
if (require.main === module)
  main().catch(() => {
    process.stderr.write(
      "Import check failed: source configuration needs operator review.\n",
    );
    process.exitCode = 1;
  });
module.exports = { main };

const fs = require("node:fs"),
  path = require("node:path");
function loadOptions(root = path.resolve(__dirname, "..")) {
  const envPath = path.join(root, ".env");
  if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
  return {
    root,
    dataDir: path.resolve(process.env.SITE_DATA_DIR || path.join(root, "data")),
    production: process.env.NODE_ENV === "production",
    origin:
      process.env.SITE_ORIGIN || `http://localhost:${process.env.PORT || 3000}`,
    masterKey: process.env.SITE_MASTER_KEY,
    endpointAllowlist: (process.env.S3_ENDPOINT_ALLOWLIST || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    trustProxy: process.env.TRUST_PROXY || false,
  };
}
module.exports = { loadOptions };

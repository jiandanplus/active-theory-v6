#!/usr/bin/env node
// @ts-check
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { parseEnv } = require("node:util");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const marker = "personal-site-local-v1\n";

/** Validate the local-only URL without weakening production HTTPS checks.
 * @param {string} port
 * @param {string} origin
 */
function validateLocal(port, origin) {
  if (!/^[1-9]\d{0,4}$/.test(port) || Number(port) > 65535)
    throw Error("Port must be an integer from 1 to 65535.");
  const url = new URL(origin);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.port || "80") !== port ||
    origin !== url.origin
  ) {
    throw Error(
      "Local origin must be http://127.0.0.1:PORT or http://localhost:PORT, matching the selected port, with no path.",
    );
  }
}

/** @param {string[]} argv */
function parseArguments(argv) {
  const command = argv[0] || "up";
  if (!["up", "status", "down", "token"].includes(command))
    throw Error("Use up, status, down, or token.");
  /** @type {{command:string, directory:string, port?:string, origin?:string, dryRun:boolean}} */
  const options = {
    command,
    directory: path.join(root, ".deployment", "local"),
    dryRun: false,
  };
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i];
    if (key === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (!["--directory", "--port", "--origin"].includes(key) || !argv[i + 1])
      throw Error("Unknown or incomplete option.");
    const value = argv[++i];
    if (key === "--directory") options.directory = path.resolve(value);
    if (key === "--port") options.port = value;
    if (key === "--origin") options.origin = value;
  }
  return options;
}

/** @param {ReturnType<typeof parseArguments>} options */
function configuration(options) {
  const directory = options.directory;
  const file = path.join(directory, "config.env");
  const ownerFile = path.join(directory, ".owner");
  if (options.port || options.origin)
    validateLocal(
      options.port || "3300",
      options.origin ||
        new URL(`http://127.0.0.1:${options.port || "3300"}`).origin,
    );
  if (!fs.existsSync(directory)) {
    if (options.command !== "up")
      throw Error(
        "Local deployment has not been initialized. Run npm run docker:up.",
      );
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(ownerFile, marker, { flag: "wx", mode: 0o600 });
  }
  if (
    fs.lstatSync(directory).isSymbolicLink() ||
    !fs.existsSync(ownerFile) ||
    fs.lstatSync(ownerFile).isSymbolicLink() ||
    fs.readFileSync(ownerFile, "utf8") !== marker
  )
    throw Error("Refusing an unowned or symlinked deployment directory.");
  if (!fs.existsSync(file)) {
    if (options.command !== "up")
      throw Error("Missing local deployment config.");
    const port = options.port || "3300";
    const origin = options.origin || new URL(`http://127.0.0.1:${port}`).origin;
    validateLocal(port, origin);
    const secret = () => randomBytes(32).toString("hex");
    const password = secret();
    const env = {
      SITE_COMPOSE_PROJECT: `portfolio-local-${randomBytes(6).toString("hex")}`,
      SITE_PORT: port,
      SITE_ORIGIN: origin,
      POSTGRES_USER: "site_bootstrap",
      POSTGRES_PASSWORD: secret(),
      POSTGRES_DB: "personal_site",
      POSTGRES_APP_USER: "site_app",
      POSTGRES_APP_PASSWORD: password,
      DATABASE_URL: `postgresql://site_app:${password}@db:5432/personal_site`,
      SETUP_TOKEN: secret(),
      SITE_MASTER_KEY: secret(),
    };
    fs.writeFileSync(
      file,
      Object.entries(env)
        .map(([key, value]) => `${key}=${value}`)
        .join("\n") + "\n",
      { flag: "wx", mode: 0o600 },
    );
  }
  if (
    fs.lstatSync(file).isSymbolicLink() ||
    fs.statSync(file).mode & 0o077 ||
    fs.statSync(directory).mode & 0o077
  )
    throw Error(
      "Deployment directory/config must be private (700/600), never symlinked.",
    );
  const parsed = parseEnv(fs.readFileSync(file, "utf8"));
  /** @type {Record<string, string>} */
  const env = {};
  for (const [key, value] of Object.entries(parsed))
    if (value !== undefined) env[key] = value;
  validateLocal(env.SITE_PORT, env.SITE_ORIGIN);
  for (const key of [
    "POSTGRES_PASSWORD",
    "POSTGRES_APP_PASSWORD",
    "SETUP_TOKEN",
    "SITE_MASTER_KEY",
  ])
    if (!/^[a-f0-9]{64}$/.test(env[key] || ""))
      throw Error(`Invalid owned config field: ${key}`);
  if (
    !/^portfolio-local-[a-f0-9]{12}$/.test(env.SITE_COMPOSE_PROJECT) ||
    env.POSTGRES_USER !== "site_bootstrap" ||
    env.POSTGRES_APP_USER !== "site_app" ||
    env.POSTGRES_DB !== "personal_site" ||
    env.DATABASE_URL !==
      `postgresql://site_app:${env.POSTGRES_APP_PASSWORD}@db:5432/personal_site`
  )
    throw Error("Owned local database configuration is inconsistent.");
  if (
    (options.port && options.port !== env.SITE_PORT) ||
    (options.origin && options.origin !== env.SITE_ORIGIN)
  )
    throw Error(
      "Existing configuration differs; refusing to overwrite it. Use another owned directory.",
    );
  return { file, env };
}

/** @param {string[]} [argv] */
function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  const { file, env } = configuration(options);
  if (options.command === "token") {
    if (!options.dryRun)
      process.stdout.write(`Setup token: ${env.SETUP_TOKEN}\n`);
    return;
  }
  const args = [
    "compose",
    "--project-directory",
    root,
    "--project-name",
    env.SITE_COMPOSE_PROJECT,
    "--env-file",
    file,
    "-f",
    path.join(root, "compose.yaml"),
  ];
  args.push(
    ...(options.command === "up"
      ? ["up", "--build", "--wait", "--wait-timeout", "180"]
      : options.command === "status"
        ? ["ps"]
        : ["down"]),
  );
  if (options.dryRun) {
    console.log(
      JSON.stringify({ executable: "docker", args, origin: env.SITE_ORIGIN }),
    );
    return;
  }
  // The explicit private env file wins over ambient application/Compose variables.
  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv))
    if (key in env || key.startsWith("COMPOSE_")) delete childEnv[key];
  const result = spawnSync("docker", args, {
    cwd: root,
    env: childEnv,
    stdio: "inherit",
  });
  if (result.error)
    throw Error(
      "Docker Compose is unavailable. Install Docker with Compose v2 and start its daemon.",
    );
  if (result.status !== 0)
    throw Error(
      "Compose did not complete. Configuration and persistent volumes were preserved; inspect npm run docker:status.",
    );
  if (options.command === "up") {
    console.log(
      `Website: ${env.SITE_ORIGIN}/\nInstaller: ${env.SITE_ORIGIN}/admin/`,
    );
    console.log(
      process.stdout.isTTY
        ? `Setup token (operator only): ${env.SETUP_TOKEN}`
        : "Setup token hidden outside a private interactive terminal; use npm run docker:token privately.",
    );
    console.log(
      `Keep ${file} private and backed up. Do not paste tokens into chat or public logs.`,
    );
  }
}
if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Local deployment failed.",
    );
    process.exitCode = 1;
  }
}
module.exports = { validateLocal, parseArguments, configuration, main };

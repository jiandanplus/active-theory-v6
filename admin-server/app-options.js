const path = require("node:path");
const fs = require("node:fs");

// Normalize and validate createApp options before anything is mounted.
/**
 * @param {any} [input]
 * @returns {any}
 */
function appOptions(input = {}) {
  /** @type {any} */
  const options = {
    root: path.resolve(__dirname, ".."),
    production: false,
    origin: "http://localhost:3000",
    ...input,
  };
  options.dataDir = path.resolve(
    options.dataDir || path.join(options.root, "data"),
  );
  const canonical = (p) =>
    fs.existsSync(p)
      ? fs.realpathSync(p)
      : path.join(canonical(path.dirname(p)), path.basename(p));
  const privatePath = canonical(options.dataDir);
  for (const folder of ["assets", "room", "bush.bin", "admin-ui"]) {
    const publicPath = canonical(path.join(options.root, folder));
    if (
      privatePath === publicPath ||
      privatePath.startsWith(publicPath + path.sep)
    )
      throw new Error("私有数据目录不能位于公开资源目录中");
  }
  if (privatePath === canonical(options.root))
    throw new Error("私有数据目录不能等于项目根目录");
  let origin;
  try {
    origin = new URL(options.origin);
  } catch {
    throw new Error("SITE_ORIGIN 必须是完整来源地址");
  }
  if (
    !["http:", "https:"].includes(origin.protocol) ||
    origin.origin !== options.origin.replace(/\/$/, "")
  )
    throw new Error("SITE_ORIGIN 不能包含路径、凭证或查询参数");
  options.origin = origin.origin;
  if (options.production && !options.origin.startsWith("https://"))
    throw new Error("生产环境 SITE_ORIGIN 必须为 HTTPS");
  return options;
}
module.exports = { appOptions };

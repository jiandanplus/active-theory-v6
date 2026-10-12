const fs = require("node:fs"),
  path = require("node:path");
const { baseUIL } = require("./config");
const { localFile } = require("./storage");
const { fail } = require("./security");

// Never fetch arbitrary browser asset URLs server-side (SSRF). Public CORS and
// availability are an explicit preview requirement, not a fake "verified" flag.
async function validatePublication(
  store,
  root,
  options,
  config = store.get("draft"),
) {
  const schema = store.get("schema"),
    resources = store.get("resources", []),
    warnings = new Set();
  const geometry = new Set(
    config.scenes
      .flatMap((s) => s.fields)
      .filter((f) => f.type === "geometry")
      .map((f) => f.value),
  );
  const checked = new Set();
  async function visit(value, base) {
    if (typeof value === "string") {
      if (checked.has(value)) return;
      const managed = /^\/(?:media\/([^/?#]+)|models\/([^/?#]+)\.bin)$/.exec(
        value,
      );
      if (managed) {
        checked.add(value);
        const resource = resources.find(
          (r) => r.id === (managed[1] || managed[2]) && !r.trashed,
        );
        if (!resource) throw fail(422, `引用的资源不存在或已回收：${value}`);
        if (geometry.has(value) && resource.status !== "ready")
          throw fail(422, "模型需要先完成 GLB → BIN 转换");
        if (resource.source === "local") {
          try {
            const file = await localFile(
              path.join(options.dataDir, "uploads"),
              resource.key,
            );
            if (!fs.statSync(file).isFile()) throw Error();
          } catch {
            throw fail(422, `本地资源不存在：${resource.name || value}`);
          }
        } else
          warnings.add("云端/外链资源的公网访问和 CORS 需要在前台预览确认");
      } else if (
        value !== base &&
        /^(?:\/?assets\/|room\/|bush\.bin\/)/.test(value)
      ) {
        checked.add(value);
        const relative = value.replace(/^\//, "").split(/[?#]/)[0];
        try {
          const file = fs.realpathSync(path.join(root, relative));
          if (
            !file.startsWith(fs.realpathSync(root) + path.sep) ||
            !fs.statSync(file).isFile()
          )
            throw Error();
        } catch {
          throw fail(422, `站内资源不存在：${value}`);
        }
      } else if (value !== base && /^https:/.test(value))
        warnings.add("云端/外链资源的公网访问和 CORS 需要在前台预览确认");
    } else if (value && typeof value === "object")
      for (const [key, item] of Object.entries(value))
        await visit(item, base?.[key]);
  }
  await visit(config, schema);
  const uil = baseUIL(root);
  for (const scene of config.scenes)
    for (const field of scene.fields) {
      if (field.type !== "text" || field.value === uil[field.key]) continue;
      const style = uil[field.key.replace(/_text$/, "_fontStyle")];
      const name =
        typeof style === "string"
          ? style.match(/(?:^|\n)font:\s*([\w-]+)/)?.[1]
          : null;
      if (!name)
        throw fail(422, "无法确认此 3D 文案使用的字体，请先检查字体配置");
      let chars;
      try {
        chars = JSON.parse(
          fs.readFileSync(
            path.join(root, "assets/fonts", name + ".json"),
            "utf8",
          ),
        ).chars;
      } catch {
        throw fail(422, `缺少字体图集：${name}`);
      }
      const available = new Set(
        chars.map((c) => c.char || String.fromCodePoint(c.id)),
      );
      const missing = [
        ...new Set(
          [...field.value].filter((c) => !/[\s]/u.test(c) && !available.has(c)),
        ),
      ];
      if (missing.length)
        throw fail(
          422,
          `字体 ${name} 缺少字形：${missing.slice(0, 20).join("")}。请先重新生成字体图集。`,
        );
    }
  return [...warnings];
}
module.exports = { validatePublication };

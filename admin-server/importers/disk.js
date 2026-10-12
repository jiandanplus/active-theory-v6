const fs = require("node:fs"),
  path = require("node:path");
const SCENES = {
  Home: "开场 · Logo",
  About: "个人介绍",
  Work: "作品空间",
  TreeScene: "罐体 · 黑洞",
  CleanRoom: "实验室",
  Footer: "结尾",
};
function read(root, file, fallback = "") {
  try {
    const actual = fs.realpathSync(path.join(root, file));
    if (!actual.startsWith(fs.realpathSync(root) + path.sep))
      throw Object.assign(new Error("Import source outside root"), {
        status: 409,
      });
    return fs.readFileSync(actual, "utf8");
  } catch (error) {
    if (error.status) throw error;
    return fallback;
  }
}
function uilFile(root) {
  return fs.existsSync(path.join(root, "assets/data"))
    ? fs
        .readdirSync(path.join(root, "assets/data"))
        .filter((n) => /^uil\.[\w-]+\.json$/.test(n))
        .sort()
        .at(-1)
    : undefined;
}
function baseUIL(root) {
  const name = uilFile(root);
  return name ? JSON.parse(read(root, `assets/data/${name}`, "{}")) : {};
}
function appFile(root) {
  return fs.existsSync(path.join(root, "assets/js"))
    ? fs
        .readdirSync(path.join(root, "assets/js"))
        .filter((n) => /^app\.[\w-]+\.js$/.test(n))
        .sort()
        .at(-1)
    : undefined;
}
function initialConfig(root) {
  const uil = baseUIL(root),
    name = appFile(root),
    source = name ? read(root, `assets/js/${name}`) : "";
  const scenes = Object.entries(SCENES).map(([id, label]) => ({
    id,
    label,
    fields: [],
  }));
  for (const [key, value] of Object.entries(uil)) {
    let id = Object.keys(SCENES).find((id) =>
      new RegExp(`(?:_|/)${id}(?:_|/|$)`).test(key),
    );
    if (/ParticleTest/.test(key)) id = "Home";
    if (!id) continue;
    let type, fieldValue;
    if (/text3d_text$/.test(key)) {
      type = "text";
      fieldValue = value;
    } else if (
      value &&
      typeof value === "object" &&
      typeof value.src === "string"
    ) {
      type = /geometry$/.test(key) ? "geometry" : "resource";
      fieldValue = value.src;
    } else if (
      typeof value === "number" &&
      /\/(uBrightness|uSpeed|uNormalStrength)$/.test(key)
    ) {
      type = "number";
      fieldValue = value;
    } else continue;
    const resourceName =
      typeof fieldValue === "string"
        ? fieldValue.split("/").at(-1).split("?")[0]
        : "";
    const label =
      type === "text"
        ? key.includes("Element_3_About")
          ? "个人标题"
          : key.includes("Element_4_About")
            ? "个人介绍"
            : "场景文案"
        : type === "number"
          ? key.split("/").at(-1)
          : resourceName;
    scenes
      .find((s) => s.id === id)
      .fields.push({ key, label, type, value: fieldValue });
  }
  if (
    source &&
    String(uil.INPUT_P_Element_21_TreeScenecode_1_code || "").includes(
      "Lensed accretion",
    )
  ) {
    for (const [key, label, value] of [
      ["speed", "流动速度", 1],
      ["brightness", "发光强度", 1],
      ["size", "整体尺寸", 1],
    ])
      scenes
        .find((s) => s.id === "TreeScene")
        .fields.push({
          key: `__blackhole_${key}`,
          label,
          type: "number",
          value,
        });
  }
  const inner = (ref, otherwise = "") =>
    source.match(
      new RegExp(`_innerText: ("(?:[^"\\\\]|\\\\.)*"), refName: "${ref}"`),
    )?.[1];
  const text = (ref, otherwise = "") => {
    try {
      return JSON.parse(inner(ref) || JSON.stringify(otherwise));
    } catch {
      return otherwise;
    }
  };
  const site = {
    title:
      read(root, "index.html").match(/<title>([^<]*)<\/title>/)?.[1] ||
      "个人网站",
    navWork: "Work",
    navContact: "Contact",
    contactTitle: text("contact", "CONTACT US"),
    cityLax: text("lax", ""),
    cityNyc: text("nyc", ""),
    cityAms: text("ams", ""),
    email: text("email", ""),
    emailLink: source.match(/mailto:([^"'\s]+)/)?.[1] || "",
    labUrl:
      source.match(
        /let url = "(https:\/\/[^" ]+)"; async function updateLayout/,
      )?.[1] || "https://atlab.io",
  };
  const songs = [];
  const songText = source.match(/let SONGS = (\[[\s\S]*?\]);/)?.[1] || "";
  for (const match of songText.matchAll(
    /\{ title: ("(?:[^"\\]|\\.)*"), src: ("(?:[^"\\]|\\.)*") \}/g,
  ))
    songs.push({ title: JSON.parse(match[1]), src: JSON.parse(match[2]) });
  return {
    site,
    projects: JSON.parse(read(root, "cms/projects-dev.json", "[]")),
    scenes,
    songs,
  };
}
module.exports = { initialConfig, appFile, baseUIL, read };

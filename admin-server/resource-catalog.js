const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const defaultManifest = require("./engine-assets.json");
const EPOCH = "1970-01-01T00:00:00.000Z";
const conflict = (message) =>
  Object.assign(new Error(message), { status: 409 });
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, stable(value[k])]),
    );
  return value;
}
const digest = (value) =>
  createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
async function checksum(file) {
  const h = createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}
const kind = (file) =>
  /\.(mp3|wav|ogg|m4a)$/i.test(file)
    ? "audio"
    : /\.(mp4|webm|mov)$/i.test(file)
      ? "video"
      : /\.(bin|glb|gltf)$/i.test(file) || file.startsWith("assets/geometry/")
        ? "model"
        : /\.(json|woff2?|otf|ttf)$/i.test(file)
          ? "font"
          : "image";
const program = (file) =>
  /\.(?:js|css|wasm|vs|fs|glsl|map)$/i.test(file) ||
  /^assets\/(?:js|shaders)\//.test(file);
function joinedURL(parent, value) {
  if (typeof value !== "string")
    throw conflict("Invalid dependent resource URL");
  const url = /^(?:\/|https:\/\/|assets\/)/.test(value)
    ? value
    : path.posix.join(path.posix.dirname(parent), value);
  if (!/^https:\/\//.test(url) && !localURL(url))
    throw conflict("Dependent resource escapes outside assets");
  return url;
}
function localURL(value) {
  if (typeof value !== "string" || !value) return null;
  if (/^https:\/\//.test(value)) {
    const u = new URL(value);
    if (u.username || u.password)
      throw conflict("Media URL must not contain credentials");
    return null;
  }
  if (/^\/(?:media\/|models\/|assets\/geometry\/admin\/)/.test(value))
    return null;
  if (value.includes("\\") || /[\x00-\x1f]/.test(value))
    throw conflict("Invalid resource path");
  const raw = value.split(/[?#]/)[0].replace(/^\//, "");
  if (!raw.startsWith("assets/")) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw conflict("Invalid resource encoding");
  }
  if (
    [raw, decoded].some((v) =>
      v.split("/").some((p) => !p || p === "." || p === ".."),
    ) ||
    /%(?:2f|5c|00)/i.test(raw)
  )
    throw conflict("Resource path escapes allowed directory");
  return { raw, decoded };
}
async function inventoryResources({
  root,
  config = {},
  template = {},
  manifest = defaultManifest,
}) {
  root = await fs.promises.realpath(root);
  const resources = new Map(),
    assets = {},
    legacyMap = {},
    missingRequired = [],
    warnings = [];
  async function resolve(value) {
    const names = localURL(value);
    if (!names) return null;
    // Raw percent-encoded filenames win. Decode at most once; never rewrite an
    // existing literal %20 name to a different file.
    const candidates = [
      ...new Set([names.raw, names.decoded, names.raw.replace(/ /g, "%20")]),
    ];
    for (const relative of candidates) {
      const full = path.join(root, relative);
      try {
        const actual = await fs.promises.realpath(full);
        if (!actual.startsWith(root + path.sep))
          throw conflict("Resource symlink escapes outside root");
        const allowed = path.join(root, "assets") + path.sep;
        if (!actual.startsWith(allowed))
          throw conflict("Resource outside assets whitelist");
        const stat = await fs.promises.stat(actual);
        if (!stat.isFile()) continue;
        return {
          path: relative,
          size: stat.size,
          checksum: await checksum(actual),
        };
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return { path: names.raw, size: null, checksum: null };
  }
  async function register(entry) {
    if (
      !entry ||
      typeof entry.slot !== "string" ||
      typeof entry.url !== "string"
    )
      throw conflict("Invalid engine asset manifest");
    const info = await resolve(entry.url);
    if (!info) {
      if (/^https:\/\//.test(entry.url)) {
        if (entry.required) missingRequired.push(entry.slot);
        warnings.push(
          `External resource is unverified (not fetched): ${entry.slot}`,
        );
        const id = "external-" + digest(entry.url).slice(0, 32);
        resources.set(id, {
          id,
          source: "external",
          url: entry.url,
          name: new URL(entry.url).pathname.split("/").pop() || "external",
          kind: entry.type || "image",
          status: "unverified",
          size: null,
          created: EPOCH,
        });
        assets[entry.slot] = {
          resourceId: id,
          fileName: new URL(entry.url).pathname.split("/").pop() || "external",
          url: entry.url,
          owner: entry.owner,
          required: !!entry.required,
          group: entry.group,
        };
        legacyMap[entry.url] = entry.slot;
      }
      return;
    }
    const disabled = /\.disabled$/i.test(info.path),
      exists = info.checksum !== null && !disabled;
    if (!exists) {
      if (entry.required) missingRequired.push(entry.slot);
      else warnings.push(`Optional resource unavailable: ${entry.slot}`);
    }
    if (program(info.path) || entry.type === "program") return;
    const id = "bundled-" + digest(info.path).slice(0, 32);
    if (!resources.has(id))
      resources.set(id, {
        id,
        source: "bundled",
        storageId: null,
        key: null,
        url: info.path,
        path: info.path,
        name: path.posix.basename(info.path),
        kind: entry.type || kind(info.path),
        status: disabled ? "disabled" : exists ? "ready" : "missing",
        size: info.size,
        checksum: info.checksum,
        created: EPOCH,
        trashed: false,
      });
    assets[entry.slot] = {
      resourceId: id,
      fileName: path.posix.basename(info.path),
      url: entry.url,
      owner: entry.owner,
      required: !!entry.required,
      group: entry.group,
      dependencies: [...(entry.dependencies || [])],
    };
    for (const alias of [entry.url, info.path, "/" + info.path])
      if (!Object.hasOwn(legacyMap, alias)) legacyMap[alias] = entry.slot;
    if (exists && /^assets\/fonts\/.*\.json$/i.test(info.path)) {
      let font;
      try {
        font = JSON.parse(
          await fs.promises.readFile(path.join(root, info.path), "utf8"),
        );
      } catch {
        throw conflict(`Invalid font JSON: ${entry.slot}`);
      }
      const pages =
        Array.isArray(font.pages) && font.pages.length
          ? font.pages
          : [path.posix.basename(info.path).replace(/\.json$/, ".png")];
      for (const [i, page] of pages.entries()) {
        if (typeof page !== "string") throw conflict("Invalid font page");
        const url = joinedURL(info.path, page),
          slot = `${entry.slot}:atlas:${i}`;
        assets[entry.slot].dependencies.push(slot);
        await register({
          ...entry,
          slot,
          url,
          type: "image",
          dependencies: [],
        });
      }
    }
    return id;
  }
  for (const entry of manifest.assets || manifest) await register(entry);
  for (const [i, p] of (config.projects || []).entries())
    for (const type of ["video", "image", "projectLogo"])
      for (const field of ["url", "thumbnail"])
        if (p[type]?.[field])
          await register({
            owner: "project",
            slot: `project:${p.id || p.slug || i}:${type}:${field}:${digest(p[type][field]).slice(0, 24)}`,
            url: p[type][field],
            type: field === "thumbnail" || type !== "video" ? "image" : "video",
            required: false,
          });
  for (const [i, song] of (config.songs || []).entries())
    if (song.src)
      await register({
        owner: "song",
        slot: `song:${song.id || i}:${digest(song.src).slice(0, 24)}`,
        url: song.src,
        type: "audio",
        required: false,
      });
  async function metadataImage(value, slot) {
    if (typeof value === "string" && value)
      await register({
        owner: "metadata",
        slot,
        url: value,
        type: "image",
        required: false,
      });
    else if (value && typeof value === "object") {
      if (value.url) await metadataImage(value.url, slot);
      for (const [name, item] of Object.entries(value.sizes || {}))
        await metadataImage(item, `${slot}:${name}`);
    }
  }
  for (const name of ["ogImage", "twitterImage"])
    await metadataImage(template.metadata?.[name], `metadata:${name}`);
  for (const scene of config.scenes || [])
    for (const field of scene.fields || [])
      if (["resource", "geometry"].includes(field.type) && field.value)
        await register({
          owner: "scene",
          slot: `scene:${scene.id}:${digest([field.key, field.value]).slice(0, 24)}`,
          url: field.value,
          type: field.type === "geometry" ? "model" : undefined,
          required: true,
        });
  const effective = structuredClone(template.baseUIL || {});
  for (const scene of config.scenes || [])
    for (const field of scene.fields || [])
      if (!field.key.startsWith("__"))
        effective[field.key] = ["resource", "geometry"].includes(field.type)
          ? { src: field.value }
          : field.value;
  for (const [key, value] of Object.entries(effective))
    if (value && typeof value === "object" && typeof value.src === "string")
      await register({
        owner: "uil",
        slot: `uil:${key}`,
        url: value.src,
        type: /geometry$/.test(key) ? "model" : undefined,
        required: true,
      });
  // Only declared icon/font HTML slots are resources; links and scripts are not
  // inferred from arbitrary strings in minified source.
  let html = "";
  try {
    const actual = await fs.promises.realpath(path.join(root, "index.html"));
    if (!actual.startsWith(root + path.sep))
      throw conflict("HTML source outside root");
    html = await fs.promises.readFile(actual, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const [i, m] of [...html.matchAll(/<link\b[^>]*>/gi)].entries()) {
    const tag = m[0],
      rel = /\brel=["']([^"']+)["']/i.exec(tag)?.[1],
      url = /\bhref=["']([^"']+)["']/i.exec(tag)?.[1];
    if (!url || !/(?:icon|manifest)/i.test(rel || "")) continue;
    if (/manifest/i.test(rel)) {
      const info = await resolve(url);
      if (info?.checksum) {
        const data = JSON.parse(
          await fs.promises.readFile(path.join(root, info.path), "utf8"),
        );
        for (const [j, icon] of (data.icons || []).entries())
          await register({
            owner: "html-manifest",
            slot: `html:manifest:${j}`,
            url: joinedURL(info.path, icon.src),
            type: "image",
            required: false,
          });
      }
    } else
      await register({
        owner: "html",
        slot: `html:icon:${i}`,
        url,
        type: "image",
        required: false,
      });
  }
  for (const [i, m] of [
    ...html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g),
  ].entries())
    if (/\.(woff2?|ttf|otf)$/i.test(m[1]))
      await register({
        owner: "html-font",
        slot: `html:font:${i}`,
        url: m[1],
        type: "font",
        required: false,
      });
  async function scan(relative) {
    let entries;
    try {
      entries = await fs.promises.readdir(path.join(root, relative), {
        withFileTypes: true,
      });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) await scan(file);
      else if (entry.isSymbolicLink()) {
        const actual = await fs.promises.realpath(path.join(root, file));
        if (!actual.startsWith(path.join(root, "assets") + path.sep))
          throw conflict("Resource symlink escapes outside assets");
        if ((await fs.promises.stat(actual)).isDirectory())
          throw conflict("Resource directory symlink not permitted");
        if (!program(file))
          await register({
            owner: "inventory",
            slot: `inventory:${file}`,
            url: file,
            required: false,
          });
      } else if (
        !program(file) &&
        !/^assets\/(?:data|meta)\//.test(file) &&
        /^(?:assets\/(?:images|video|music|geometry|fonts)\/)/.test(file)
      )
        await register({
          owner: "inventory",
          slot: `inventory:${file}`,
          url: file,
          required: false,
        });
    }
  }
  await scan("assets");
  const rows = [...resources.values()].sort((a, b) => a.id.localeCompare(b.id));
  const report = {
    counts: { resources: rows.length, assets: Object.keys(assets).length },
    missingRequired: [...new Set(missingRequired)].sort(),
    warnings: [...new Set(warnings)].sort(),
    credentialsUnavailable: [],
    hasAdmin: false,
  };
  report.digest = digest({ resources: rows, assets, legacyMap, report });
  return { resources: rows, assets, legacyMap, report };
}
module.exports = { inventoryResources, digest, checksum, conflict };

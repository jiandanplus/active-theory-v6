const fs = require("node:fs");
const {normalizeConfig} = require('../../shared/site-identity');
const path = require("node:path");
const { initialConfig, baseUIL } = require("./disk");
const { composeSnapshot, collectReferences } = require("../snapshots");
const { inventoryResources, digest, conflict } = require("../resource-catalog");

async function readJSON(root, file, fallback) {
  try {
    const actual = await fs.promises.realpath(path.join(root, file));
    if (!actual.startsWith(root + path.sep))
      throw conflict("Import source symlink outside root");
    return JSON.parse(await fs.promises.readFile(actual, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return structuredClone(fallback);
    if (error.status) throw error;
    throw conflict(`Invalid source JSON: ${file}`);
  }
}
function stableIDs(config) {
  const copy = structuredClone(config);
  copy.projects = copy.projects.map((p, i) => ({
    ...p,
    id: p.id || `project-${digest([p.slug, i]).slice(0, 32)}`,
  }));
  copy.songs = copy.songs.map((s, i) => ({
    ...s,
    id: s.id || `song-${digest([s.title, s.src, i]).slice(0, 32)}`,
  }));
  return copy;
}
function emptyConfig(config) {
  const copy = structuredClone(config);
  for (const key of Object.keys(copy.site))
    if (!["navWork", "navContact"].includes(key))
      copy.site[key] = key === "title" ? "个人网站" : "";
  copy.site.language = 'en';
  copy.projects = [];
  copy.songs = [];
  for (const scene of copy.scenes)
    for (const field of scene.fields)
      if (
        field.type === "text" ||
        (typeof field.value === "string" &&
          /^\/(?:media\/|models\/|assets\/geometry\/admin\/)/.test(field.value))
      )
        field.value = "";
  return copy;
}
function scrub(value) {
  if (typeof value === "string") return "";
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, scrub(v)]),
    );
  return value;
}
async function baseline(root) {
  root = await fs.promises.realpath(root);
  // Disk parser remains the legacy runtime entry, but all import source files
  // are checked before reading. Nothing is created if a bundle is absent.
  for (const folder of ["assets", "assets/data", "assets/js", "cms"]) {
    try {
      const actual = await fs.promises.realpath(path.join(root, folder));
      if (!actual.startsWith(root + path.sep))
        throw conflict("Import directory symlink outside root");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  for (const folder of ["assets/data", "assets/js", "cms"]) {
    let entries;
    try {
      entries = await fs.promises.readdir(path.join(root, folder));
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const name of entries) {
      const actual = await fs.promises.realpath(path.join(root, folder, name));
      if (!actual.startsWith(root + path.sep))
        throw conflict("Import source symlink outside root");
    }
  }
  let config, uil;
  try {
    config = initialConfig(root);
    uil = baseUIL(root);
  } catch {
    throw conflict("Invalid bundled configuration");
  }
  const template = {
    baseUIL: uil,
    contact: await readJSON(root, "cms/contact-dev.json", {}),
    metadata: await readJSON(root, "cms/metadata-dev.json", {}),
    fontCoverage: {},
    readiness: { ready: false },
  };
  return { root, config, template };
}
async function complete({
  root,
  config,
  schema,
  template,
  versions = [],
  published = null,
  revision = 0,
  resources = [],
  storages = [{ id: "local", type: "local", name: "Local", available: true }],
  defaultStorage = "local",
  admin = null,
  audit = [],
  warnings = [],
  credentialsUnavailable = [],
  localUnavailable = [],
}) {
  config = stableIDs(normalizeConfig(config));
  schema = stableIDs(normalizeConfig(schema));
  const allConfigs = [
    config,
    ...versions.map((v) => v.config || v.snapshot?.config),
  ];
  const combined = {
    ...config,
    projects: allConfigs.flatMap((c) => c.projects),
    songs: allConfigs.flatMap((c) => c.songs),
    scenes: allConfigs.flatMap((c) => c.scenes),
  };
  const catalog = await inventoryResources({
    root,
    config: combined,
    template,
  });
  const existing = new Map(resources.map((r) => [r.id, structuredClone(r)]));
  for (const row of catalog.resources) {
    if (existing.has(row.id))
      throw conflict("Legacy resource ID collides with catalog ID");
    existing.set(row.id, row);
  }
  for (const row of resources) {
    const slot = `legacy:${row.id}`;
    catalog.assets[slot] = {
      resourceId: row.id,
      fileName: path.posix.basename(row.key || row.name || row.url || row.id),
      url: row.url,
      owner: "legacy",
    };
    catalog.legacyMap[row.url] = slot;
    if (row.originalId)
      catalog.assets[slot].dependencies = [`legacy:${row.originalId}`];
  }
  template = structuredClone(template);
  template.readiness = {
    ready: catalog.report.missingRequired.length === 0,
    missingRequired: catalog.report.missingRequired,
    engineAssets: Object.fromEntries(
      Object.entries(catalog.assets)
        .filter(
          ([, a]) =>
            ![
              "inventory",
              "project",
              "song",
              "scene",
              "uil",
              "legacy",
            ].includes(a.owner),
        )
        .map(([slot, a]) => [slot, a.url]),
    ),
  };
  for (const row of catalog.resources.filter(
    (r) =>
      r.kind === "font" && r.path?.endsWith(".json") && r.status === "ready",
  )) {
    const font = await readJSON(root, row.path, {});
    template.fontCoverage[row.id] = (font.chars || [])
      .map((c) => c.char || String.fromCodePoint(c.id))
      .join("");
  }
  const draft = composeSnapshot({
    config,
    template,
    assets: catalog.assets,
    legacyMap: catalog.legacyMap,
  });
  const history = versions.map((v) => ({
    id: v.id,
    created: v.created,
    snapshot: composeSnapshot({
      config: stableIDs(v.config || v.snapshot.config),
      template,
      assets: catalog.assets,
      legacyMap: catalog.legacyMap,
    }),
  }));
  const ids = new Set(existing.keys());
  for (const row of existing.values())
    if (row.originalId && !ids.has(row.originalId))
      throw conflict(`Original resource missing: ${row.id}`);
  const checked = new Set();
  function original(id, chain = new Set()) {
    if (chain.has(id))
      throw conflict(`Cyclic original resource dependency: ${id}`);
    if (checked.has(id)) return;
    chain.add(id);
    const next = existing.get(id)?.originalId;
    if (next) original(next, chain);
    chain.delete(id);
    checked.add(id);
  }
  for (const id of ids) original(id);
  const unavailable = new Set(localUnavailable);
  const requiredLocal = new Set();
  for (const snapshot of [draft, ...history.map((v) => v.snapshot)]) {
    const missing = new Set(snapshot.template.readiness.missingRequired);
    for (const ref of collectReferences(snapshot)) {
      if (!ids.has(ref.resourceId))
        throw conflict(`Referenced resource missing: ${ref.resourceId}`);
      if (existing.get(ref.resourceId).trashed)
        throw conflict(`Referenced resource is trashed: ${ref.resourceId}`);
      if (!unavailable.has(ref.resourceId) || ref.slot.includes(":dependency:"))
        continue;
      const scene = /^config\.scenes\.(\d+)\.fields\.(\d+)\.value$/.exec(
        ref.slot,
      );
      const geometry = scene
        ? snapshot.config.scenes[scene[1]].fields[scene[2]].type === "geometry"
        : /^template\.baseUIL\..*(?:geometry|initialPositions)\.(?:src|relative)$/.test(
            ref.slot,
          );
      if (geometry) {
        const slot = `legacy:${ref.resourceId}`;
        missing.add(slot);
        requiredLocal.add(slot);
      }
    }
    snapshot.template.readiness.missingRequired = [...missing].sort();
    snapshot.template.readiness.ready = missing.size === 0;
  }
  catalog.report.missingRequired = [
    ...new Set([...catalog.report.missingRequired, ...requiredLocal]),
  ].sort();
  for (const id of localUnavailable)
    warnings.push(
      `Local resource unavailable (missing, unreadable or unsafe): legacy:${id}`,
    );
  const report = {
    ...catalog.report,
    counts: {
      resources: existing.size,
      assets: Object.keys(catalog.assets).length,
      versions: history.length,
      projects: config.projects.length,
      songs: config.songs.length,
      storages: storages.length,
      audit: audit.length,
    },
    warnings: [...new Set([...catalog.report.warnings, ...warnings])].sort(),
    credentialsUnavailable: [...credentialsUnavailable].sort(),
    hasAdmin: !!admin,
  };
  const bundle = {
    draft,
    schema,
    versions: history,
    published,
    revision,
    resources: [...existing.values()].sort((a, b) => a.id.localeCompare(b.id)),
    storages,
    defaultStorage,
    admin,
    audit,
    report,
  };
  delete report.digest;
  report.digest = digest(bundle);
  return bundle;
}
async function readBundle({ root, mode = "empty" }) {
  if (!["empty", "bundle"].includes(mode))
    throw conflict("Unsupported import mode");
  const base = await baseline(root);
  if (mode === "empty") {
    base.config = emptyConfig(base.config);
    base.template.contact = scrub(base.template.contact);
    base.template.metadata = scrub(base.template.metadata);
    for (const key of Object.keys(base.template.baseUIL)) {
      if (/text3d_text$/.test(key)) base.template.baseUIL[key] = "";
      else if (
        /^\/(?:media\/|models\/|assets\/geometry\/admin\/)/.test(
          base.template.baseUIL[key]?.src || "",
        )
      )
        base.template.baseUIL[key] = { ...base.template.baseUIL[key], src: "" };
    }
  }
  try {
    require("../config").validateConfig(base.config, base.config);
  } catch {
    throw conflict("Invalid bundled configuration");
  }
  // An empty deployment intentionally strips content but keeps the template
  // schema, control slots, geometry and authorized local engine assets.
  return complete({ ...base, schema: structuredClone(base.config) });
}
module.exports = { readBundle, baseline, complete, stableIDs };

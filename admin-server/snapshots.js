const {normalizeSite} = require('../shared/site-identity');
const SITE_KEYS = [
  "description", "language", "socialImage",
  "title",
  "navWork",
  "navContact",
  "contactTitle",
  "cityLax",
  "cityNyc",
  "cityAms",
  "email",
  "emailLink",
  "labUrl",
];
// Deleted means SceneLayout skips construction; invisible layers still load.
// Explicit dormant layouts come from the checked-in runtime scene manifest.
function inactiveUIL(template, key, policy = {inactiveLayouts: require('./engine-assets.json').inactiveLayouts || []}) {
  const match = /(?:Config|Element)_(\d+)_([A-Za-z][A-Za-z0-9]*)/.exec(key);
  if (!match) return false;
  const [, index, scene] = match;
  return (
    template.baseUIL?.[`sl_${scene}_${index}_deleted`] === true ||
    policy.inactiveLayouts.includes(scene)
  );
}
function canonicalResourceURL(value) {
  if (typeof value !== "string") return value;
  // External queries are identity (including signed URL encoding and order),
  // unlike local loader/cache suffixes. Never normalize remote targets.
  if (/^https?:\/\//i.test(value)) return value;
  const file = value.split(/[?#]/)[0];
  try {
    return decodeURIComponent(file).replace(/^\//, "");
  } catch {
    return file;
  }
}
function resourceAsset(snapshot, value) {
  const assets = snapshot.assets || {};
  const exact = snapshot.legacyMap?.[value];
  if (exact && assets[exact]) return assets[exact];
  const key = canonicalResourceURL(value);
  const alias = Object.keys(snapshot.legacyMap || {}).find(
    (k) => canonicalResourceURL(k) === key,
  );
  if (alias) return assets[snapshot.legacyMap[alias]];
  return Object.values(assets).find(
    (a) =>
      a.resourceId === managedId(value) ||
      a.resourceId === value ||
      canonicalResourceURL(a.url) === key ||
      canonicalResourceURL(a.fileName) === key,
  );
}
function versionResourceURL(version, resource, fileName) {
  return `/api/site/${encodeURIComponent(version)}/resources/${encodeURIComponent(resource.id || resource.resourceId)}/${encodeURIComponent(fileName)}`;
}
function mapResourceURL(snapshot, version, value) {
  if (typeof value !== "string") return value;
  const asset = resourceAsset(snapshot, value);
  if (!asset?.resourceId || !asset.fileName) return value;
  let suffix = value.match(/[?#].*$/)?.[0] || "";
  // A resource ID denotes exact bytes. Do not ask the decoder to derive a KTX
  // sibling by changing only its cosmetic filename while keeping the PNG ID.
  if (!/\.ktx2?$/i.test(asset.fileName))
    suffix = suffix.replace(/-compressedKtx2?/g, "");
  return (
    versionResourceURL(version, asset, asset.fileName.split("/").at(-1)) +
    suffix
  );
}
function mapResourceTree(snapshot, version, value) {
  if (typeof value === "string")
    return mapResourceURL(snapshot, version, value);
  if (Array.isArray(value))
    return value.map((v) => mapResourceTree(snapshot, version, v));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [
      k,
      mapResourceTree(snapshot, version, v),
    ]),
  );
}
const managedId = (value) => {
  if (typeof value !== "string") return null;
  return (
    /^\/media\/([^/?#]+)(?:[?#]|$)/.exec(value)?.[1] ||
    /^\/(?:models\/|assets\/geometry\/admin\/)([^/?#]+)\.bin(?:[?#]|$)/.exec(
      value,
    )?.[1] ||
    null
  );
};
function composeSnapshot({ config, template, assets = {}, legacyMap = {} }) {
  const projected = Object.fromEntries(
    ["site", "projects", "scenes", "songs"].map((k) => [k, config[k]]),
  );
  return structuredClone({
    format: 2,
    config: projected,
    template: Object.fromEntries(
      ["baseUIL", "contact", "metadata", "fontCoverage", "readiness"].map(
        (k) => [k, template[k]],
      ),
    ),
    assets,
    legacyMap,
  });
}
function collectReferences(snapshot, policy) {
  const result = new Map();
  const assets = snapshot.assets || {};
  const aliases = new Map(
    Object.entries(snapshot.legacyMap || {}).map(([url, slot]) => [
      canonicalResourceURL(url),
      assets[slot],
    ]),
  );
  for (const asset of Object.values(assets))
    for (const url of [asset.url, asset.fileName, asset.resourceId])
      if (url && !aliases.has(canonicalResourceURL(url)))
        aliases.set(canonicalResourceURL(url), asset);
  const add = (id, slot) => {
    if (id) result.set(`${id}\0${slot}`, { resourceId: id, slot });
  };
  const dependency = (name, slot, seen = new Set()) => {
    const entry = Object.hasOwn(assets, name)
      ? [name, assets[name]]
      : Object.entries(assets).find(([, asset]) => asset.resourceId === name);
    const [canonical, asset] = entry || [name, undefined];
    if (seen.has(canonical)) return;
    seen.add(canonical);
    add(asset?.resourceId || name, slot);
    for (const dep of [
      ...(asset?.dependencies || []),
      ...(asset?.companions || []),
    ])
      dependency(dep, `${slot}:dependency:${dep}`, seen);
  };
  const resolve = (value, slot) => {
    const direct = managedId(value);
    if (direct) add(direct, slot);
    const mapped = snapshot.legacyMap?.[value];
    const canonicalAsset = aliases.get(canonicalResourceURL(value));
    for (const [name, asset] of Object.entries(assets)) {
      if (
        name === mapped ||
        asset === canonicalAsset ||
        asset.fileName === value ||
        asset.url === value ||
        direct === asset.resourceId ||
        asset.resourceId === value
      ) {
        add(asset.resourceId, slot);
        for (const dep of [
          ...(asset.dependencies || []),
          ...(asset.companions || []),
        ])
          dependency(dep, `${slot}:dependency:${dep}`, new Set([name]));
      }
    }
  };
  if (snapshot.config.site?.socialImage)
    resolve(snapshot.config.site.socialImage, 'config.site.socialImage');
  const walk = (value, slot) => {
    if (typeof value === "string") resolve(value, slot);
    else if (value && typeof value === "object")
      for (const [key, item] of Object.entries(value))
        walk(item, `${slot}.${key}`);
  };
  const template = structuredClone(snapshot.template);
  for (const key of Object.keys(template.baseUIL || {}))
    if (inactiveUIL(template, key, policy)) delete template.baseUIL[key];
  for (const scene of snapshot.config.scenes || [])
    for (const field of scene.fields || [])
      if (
        !field.key.startsWith("__") &&
        !inactiveUIL(snapshot.template, field.key, policy)
      ) {
        if (["resource", "geometry"].includes(field.type)) {
          if (template.baseUIL[field.key]?.src !== field.value)
            template.baseUIL[field.key] = { src: field.value };
        } else if (["text", "number"].includes(field.type))
          delete template.baseUIL[field.key];
        else template.baseUIL[field.key] = field.value;
      }
  for (const [i, project] of snapshot.config.projects.entries())
    for (const kind of ["video", "image", "projectLogo"])
      if (project[kind])
        for (const key of ["url", "thumbnail"])
          if (typeof project[kind][key] === "string")
            resolve(project[kind][key], `config.projects.${i}.${kind}.${key}`);
  for (const [i, scene] of snapshot.config.scenes.entries())
    for (const [j, field] of scene.fields.entries())
      if (
        ["resource", "geometry"].includes(field.type) &&
        !inactiveUIL(snapshot.template, field.key, policy)
      )
        resolve(field.value, `config.scenes.${i}.fields.${j}.value`);
  for (const [i, song] of snapshot.config.songs.entries())
    resolve(song.src, `config.songs.${i}.src`);
  // Readiness contains inventory information, not arbitrary public grants.
  for (const [slot, url] of Object.entries(
    template.readiness?.engineAssets || {},
  )) {
    const asset = assets[slot];
    if (asset?.available !== false || asset?.required)
      resolve(url, `template.readiness.engineAssets.${slot}`);
  }
  delete template.readiness;
  delete template.fontCoverage;
  walk(template, "template");
  return require('./delivery/contracts').normalizeReferences([...result.values()]);
}
function publicSnapshot(snapshot, versionId) {
  const { config } = snapshot;
  const pick = (value, keys) =>
    Object.fromEntries(
      keys.filter((k) => Object.hasOwn(value, k)).map((k) => [k, value[k]]),
    );
  const publicConfig = structuredClone({
    site: pick(normalizeSite(config.site), SITE_KEYS),
    projects: config.projects.map((p) => ({
      ...pick(p, [
        "slug",
        "name",
        "description",
        "tags",
        "clientName",
        "completionDate",
        "uiColor",
        "priority",
        "projectURL",
        "caseStudyURL",
      ]),
      ...Object.fromEntries(
        ["video", "image", "projectLogo"]
          .filter((k) => p[k])
          .map((k) => [k, pick(p[k], ["url", "thumbnail"])]),
      ),
    })),
    scenes: config.scenes.map((s) => ({
      ...pick(s, ['id', 'label']),
      fields: s.fields.map((f) => pick(f, ["key", "label", "type", "value"])),
    })),
    songs: config.songs.map((s) => pick(s, ["title", "src"])),
  });
  const media = (value) => mapResourceURL(snapshot, versionId, value);
  publicConfig.site.socialImage = media(publicConfig.site.socialImage);
  for (const p of publicConfig.projects)
    for (const kind of ["video", "image", "projectLogo"])
      if (p[kind])
        for (const key of ["url", "thumbnail"])
          if (typeof p[kind][key] === "string")
            p[kind][key] = media(p[kind][key]);
  for (const s of publicConfig.scenes)
    for (const f of s.fields)
      if (["resource", "geometry"].includes(f.type)) f.value = media(f.value);
  for (const s of publicConfig.songs) s.src = media(s.src);
  return publicConfig;
}
module.exports = {
  composeSnapshot,
  collectReferences,
  publicSnapshot,
  inactiveUIL,
  canonicalResourceURL,
  resourceAsset,
  mapResourceURL,
  mapResourceTree,
  versionResourceURL,
};

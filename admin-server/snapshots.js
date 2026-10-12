const SITE_KEYS = [
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
function collectReferences(snapshot) {
  const result = new Map();
  const assets = snapshot.assets || {};
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
    for (const [name, asset] of Object.entries(assets)) {
      if (
        name === mapped ||
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
  const walk = (value, slot) => {
    if (typeof value === "string") resolve(value, slot);
    else if (value && typeof value === "object")
      for (const [key, item] of Object.entries(value))
        walk(item, `${slot}.${key}`);
  };
  const template = structuredClone(snapshot.template);
  for (const scene of snapshot.config.scenes || [])
    for (const field of scene.fields || [])
      if (!field.key.startsWith("__")) {
        if (["resource", "geometry"].includes(field.type))
          template.baseUIL[field.key] = { src: field.value };
        else if (["text", "number"].includes(field.type))
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
      if (["resource", "geometry"].includes(field.type))
        resolve(field.value, `config.scenes.${i}.fields.${j}.value`);
  for (const [i, song] of snapshot.config.songs.entries())
    resolve(song.src, `config.songs.${i}.src`);
  walk(template, "template");
  return [...result.values()].sort(
    (a, b) =>
      a.resourceId.localeCompare(b.resourceId) || a.slot.localeCompare(b.slot),
  );
}
function publicSnapshot(snapshot, versionId) {
  const { config } = snapshot;
  const pick = (value, keys) =>
    Object.fromEntries(
      keys.filter((k) => Object.hasOwn(value, k)).map((k) => [k, value[k]]),
    );
  const publicConfig = structuredClone({
    site: pick(config.site, SITE_KEYS),
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
      id: s.id,
      label: s.label,
      fields: s.fields.map((f) => pick(f, ["key", "label", "type", "value"])),
    })),
    songs: config.songs.map((s) => pick(s, ["title", "src"])),
  });
  const media = (value) => {
    const slot = snapshot.legacyMap?.[value];
    const asset =
      snapshot.assets?.[slot] ||
      Object.values(snapshot.assets || {}).find(
        (a) =>
          a.fileName === value ||
          a.url === value ||
          managedId(value) === a.resourceId ||
          a.resourceId === value,
      );
    if (!asset?.resourceId || !asset.fileName) return value;
    const name = asset.fileName.split("/").at(-1);
    return `/api/site/${encodeURIComponent(versionId)}/resources/${encodeURIComponent(asset.resourceId)}/${encodeURIComponent(name)}`;
  };
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
module.exports = { composeSnapshot, collectReferences, publicSnapshot };

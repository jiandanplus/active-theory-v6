export function newProject(id) {
  return {
    id,
    name: "新作品",
    slug: "new-project-" + id.slice(0, 12),
    description: "",
    tags: "",
    clientName: "",
    completionDate: new Date().toISOString(),
    uiColor: "7058d8",
    priority: 0,
    projectURL: "",
    caseStudyURL: "",
    video: { url: "", thumbnail: "" },
    projectLogo: { url: "" },
    image: { url: "" },
  };
}
export function canPick(resource, kind) {
  if (resource.trashed) return false;
  if (kind === "geometry")
    return (
      resource.kind === "model" &&
      resource.status === "ready" &&
      /^\/models\/[\w-]+\.bin$/.test(resource.url || "")
    );
  return kind === "resource"
    ? resource.kind !== "model"
    : resource.kind === kind;
}
export function storageBody(values) {
  const body = { ...values, type: "s3" };
  for (const key of ["accessKeyId", "secretAccessKey", "sessionToken"])
    if (!body[key] || body[key] === "configured") delete body[key];
  return body;
}
export function canConvert(resource) {
  return (
    resource.kind === "model" &&
    ["local", "s3"].includes(resource.source) &&
    resource.status !== "ready" &&
    !resource.trashed
  );
}
// PostgreSQL jsonb reorders object keys, so never render in stored key order.
// Known keys follow the label definition order; unknown keys follow alphabetically.
export function orderedSiteKeys(site, labels, excluded = []) {
  const skip = new Set(excluded);
  const keys = Object.keys(site || {}).filter((key) => !skip.has(key));
  const known = Object.keys(labels || {}).filter((key) => keys.includes(key));
  return [...known, ...keys.filter((key) => !known.includes(key)).sort()];
}
export function resourcePreviewURL(resource) {
  return resource.source === "bundled"
    ? "/media/" + encodeURIComponent(resource.id)
    : resource.url;
}

// Project order on the site: higher `priority` first (0–100); equal values
// keep their stored order. The admin list shows exactly this order.
const priorityOf = (project) =>
  Number.isFinite(project.priority) ? project.priority : 0;
export function projectsByPriority(projects) {
  return projects
    .map((project, index) => ({ project, index }))
    .sort(
      (a, b) =>
        priorityOf(b.project) - priorityOf(a.project) || a.index - b.index,
    )
    .map(({ project }) => project);
}
// Distinct tag texts already used by projects, most used first, for the tag
// dropdown. Values are kept verbatim so selecting one never rewrites it.
export function tagChoices(projects) {
  const counts = new Map();
  for (const project of projects) {
    const tag = typeof project.tags === "string" ? project.tags : "";
    if (tag.trim()) counts.set(tag, (counts.get(tag) || 0) + 1);
  }
  return [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
}
// Priority for a new project so it is listed first.
export function topPriority(projects) {
  return Math.min(100, Math.max(-1, ...projects.map(priorityOf)) + 1);
}
// Move one place up (delta -1) or down (+1) in site order. The array is
// rewritten in that order and priorities become strictly descending, so the
// original runtime (sorted by priority) and array-order renderers agree.
// Returns false when the project is already at that end.
export function moveProject(projects, project, delta) {
  const order = projectsByPriority(projects);
  const from = order.indexOf(project),
    to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return false;
  [order[from], order[to]] = [order[to], order[from]];
  const top = Math.min(100, order.length - 1);
  order.forEach((item, rank) => {
    item.priority = Math.max(0, top - rank);
  });
  projects.splice(0, projects.length, ...order);
  return true;
}

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

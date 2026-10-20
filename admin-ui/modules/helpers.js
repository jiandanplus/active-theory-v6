"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.SiteAdminModules ||= {})["helpers"] = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
function newProject(id) {
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
function canPick(resource, kind) {
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
function storageBody(values) {
  const body = { ...values, type: "s3" };
  for (const key of ["accessKeyId", "secretAccessKey", "sessionToken"])
    if (!body[key] || body[key] === "configured") delete body[key];
  return body;
}
function canConvert(resource) {
  return (
    resource.kind === "model" &&
    ["local", "s3"].includes(resource.source) &&
    resource.status !== "ready" &&
    !resource.trashed
  );
}
function resourcePreviewURL(resource) {
  return resource.source === "bundled"
    ? "/media/" + encodeURIComponent(resource.id)
    : resource.url;
}

return { newProject, canPick, storageBody, canConvert, resourcePreviewURL };
});

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isPrivateRequest,
  isPublicPage,
} = require("../admin-server/middleware/request-policy");

const req = (path, query = {}) => ({ path, query });

test("private requests cover admin, setup, preview targets and preview queries", () => {
  for (const [path, query] of [
    ["/admin", {}],
    ["/ADMIN/", {}],
    ["/admin/modules/api.js", {}],
    ["/api/admin/config", {}],
    ["/API/Admin", {}],
    ["/api/setup/status", {}],
    ["/api/site/preview-0f8c/identity.js", {}],
    ["/api/site/%70review-0f8c/identity.js", {}],
    ["/API/SITE/preview-x", {}],
    ["/", { preview: "preview-1" }],
    ["/assets/font.png", { preview: "" }],
  ])
    assert.equal(isPrivateRequest(req(path, query)), true, path);
  for (const path of [
    "/",
    "/work/one",
    "/api/site/42/identity.js",
    "/api/site/%E0%A4%A/identity.js",
    "/administrator",
    "/api/administer",
    "/media/image",
  ])
    assert.equal(isPrivateRequest(req(path)), false, path);
});

test("public pages match the published routes only", () => {
  for (const path of [
    "/",
    "/work",
    "/work/x/",
    "/contact",
    "/BASIC/work/x",
    "/unsupported.html",
  ])
    assert.equal(isPublicPage(req(path)), true, path);
  for (const path of ["/work/x/y", "/api/site/1/app.js", "/admin", "/media/x"])
    assert.equal(isPublicPage(req(path)), false, path);
});

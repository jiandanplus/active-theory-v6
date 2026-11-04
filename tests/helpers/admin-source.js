const fs = require("node:fs");
const path = require("node:path");
// Test-only source locator for legacy VM fixtures. Production executes independent factories.
module.exports = function adminSource() {
  const modules = [
    "helpers",
    "state",
    "api",
    "dom",
    "session",
    "actions",
    "overview",
    "site",
    "scenes",
    "projects",
    "resources",
    "storage",
    "versions",
    "security",
  ];
  // Dedent each module so `function create(` sits at column 0 and its inner
  // functions at two spaces, independent of the UMD wrapper's formatting.
  const sources = modules.map((name) => {
    const source = fs.readFileSync(
      path.join(__dirname, "../../admin-ui/modules", name + ".js"),
      "utf8",
    );
    const indent = /^( *)function create\(/m.exec(source)?.[1].length || 0;
    return indent
      ? source.replace(new RegExp(`^ {1,${indent}}`, "gm"), "")
      : source;
  });
  const functions = new Map();
  for (const source of sources) {
    const matches = [...source.matchAll(/^ {2}(?:async )?function (\w+)\(/gm)];
    for (let index = 0; index < matches.length; index++) {
      const match = matches[index];
      const end =
        index + 1 < matches.length
          ? matches[index + 1].index
          : source.indexOf("  return {", match.index);
      functions.set(
        match[1],
        source
          .slice(match.index, end)
          .replaceAll("context.content", "content")
          .replaceAll("context.saveStatus", "saveStatus"),
      );
    }
  }
  const order = [
    "node",
    "button",
    "notify",
    "confirmAction",
    "run",
    "api",
    "dirty",
    "updateStatus",
    "building",
    "validRevision",
    "validRuntime",
    "refreshRuntime",
    "field",
    "panel",
    "heading",
    "warning",
    "empty",
    "check",
    "load",
    "login",
    "shell",
    "logout",
    "save",
    "preview",
    "publish",
    "render",
    "overviewView",
    "showRuntimePanel",
    "siteView",
    "scenesView",
    "projectsView",
    "refreshResources",
    "conversionEditor",
    "resourceCard",
    "picker",
    "resourcesView",
    "uploadFile",
    "storageView",
    "storageEditor",
    "versionsView",
    "securityView",
    "init",
  ];
  return (
    sources[0] +
    "\n" +
    order.map((name) => functions.get(name) || "").join("\n")
  );
};

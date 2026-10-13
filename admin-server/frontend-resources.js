const fs = require("node:fs/promises");
const path = require("node:path");
const { contentRepository } = require("./repositories/content");
const { resourceRepository } = require("./repositories/resources");
const { collectReferences, mapResourceTree } = require("./snapshots");
const { fail } = require("./security");
const { localFile, externalUrl } = require("./storage");

async function resolveVersion(store, { version, preview, admin } = {}) {
  const repo = contentRepository(store);
  const id = String(version || preview || (await repo.getDraft())?.published);
  if (id.startsWith("preview-")) {
    if (!admin) throw fail(401, "预览需要登录");
    const row = await store.transaction(async (tx) => {
      const previews = contentRepository(tx),
        now = new Date();
      await previews.prunePreviews(now);
      return previews.getPreview(
        id,
        typeof admin === "string" ? admin : admin.username,
        now,
      );
    });
    if (!row) throw fail(404, "预览已过期");
    return { id, snapshot: row.snapshot };
  }
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))
    throw fail(404, "版本不存在");
  const row = await repo.getVersion(Number(id));
  if (!row) throw fail(404, "版本不存在");
  return { id, snapshot: row.snapshot };
}
async function resolvePublishedResource(store, { version, id, admin }) {
  const { snapshot } = await resolveVersion(store, { version, admin });
  if (!collectReferences(snapshot).some((ref) => ref.resourceId === id))
    throw fail(404, "资源不存在");
  const resource = await resourceRepository(store).get(id);
  if (
    !resource ||
    resource.trashed ||
    ["missing", "disabled", "failed"].includes(resource.status)
  )
    throw fail(404, "资源不存在");
  const asset = Object.values(snapshot.assets).find(
    (a) => a.resourceId === id && a.document,
  );
  if (asset?.document)
    return {
      ...resource,
      document: mapResourceTree(snapshot, version, asset.document),
    };
  return resource;
}
async function sendResource(req, res, next, resource, options) {
  res.set("X-Content-Type-Options", "nosniff");
  if (!res.get('Cache-Control')) res.set("Cache-Control", "no-store");
  if (resource.document)
    return res.type("application/manifest+json").send(resource.document);
  if (resource.source === "external")
    return res.redirect(302, externalUrl(resource.url));
  if (resource.source === "s3")
    return res.redirect(302, externalUrl(resource.publicUrl));
  let file;
  try {
    if (resource.source === "bundled") {
      if (!resource.path) throw Error();
      const root = await fs.realpath(options.root);
      file = await fs.realpath(path.resolve(root, resource.path));
      if (!file.startsWith(root + path.sep)) throw Error();
    } else
      file = await localFile(
        path.join(options.dataDir, "uploads"),
        resource.key,
      );
    if (!(await fs.stat(file)).isFile()) throw Error();
  } catch {
    throw fail(404, "资源不存在");
  }
  if (resource.mime) res.type(resource.mime);
  // The decorative filename never selects disk bytes; only validated DB metadata
  // reaches sendFile, whose range support is needed by video/audio decoders.
  return res.sendFile(
    file,
    { dotfiles: "deny", cacheControl: false },
    (error) => {
      if (error) next(error);
    },
  );
}
module.exports = { resolveVersion, resolvePublishedResource, sendResource };

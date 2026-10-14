const fs = require("node:fs/promises");
const path = require("node:path");
const { contentRepository } = require("./repositories/content");
const { resourceRepository } = require("./repositories/resources");
const { deliveryRepository } = require('./repositories/deliveries');
const { storageRepository } = require('./repositories/storages');
const { fail } = require("./security");
const { localFile, externalUrl } = require("./storage");

async function resolveVersion(store, { version, preview, admin } = {}) {
  const repo = contentRepository(store);
  const selected=version||preview||(await store.query('SELECT published FROM personal_site.site_settings WHERE id=true')).rows[0]?.published;
  if(!version&&!preview&&selected==null)throw fail(503,'网站尚未发布');
  const id=String(selected);
  if (id.startsWith("preview-")) {
    if (!admin) throw fail(401, "预览需要登录");
    const row = await repo.getPreview(id, admin.username, new Date());
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
  const { id: targetId, snapshot } = await resolveVersion(store, { version, admin });
  const target={type:targetId.startsWith('preview-')?'preview':'version',id:targetId};
  if (!(await deliveryRepository(store).references(target)).some((ref) => ref.resourceId === id))
    throw fail(404, "资源不存在");
  const resource = await resourceRepository(store).get(id);
  await assertLiveResource(store,resource);
  const asset = Object.values(snapshot.assets).find(
    (a) => a.resourceId === id && a.document,
  );
  if (asset?.document)
    return {
      ...resource,
      document: true,
      deliveryTarget:target,
    };
  return {...resource,deliveryTarget:target};
}
async function assertLiveResource(store,resource) {
  if(!resource||resource.trashed||['missing','disabled','failed'].includes(resource.status))throw fail(404,'资源不存在');
  if(resource.storageId) {
    const storage=await storageRepository(store).get(resource.storageId);
    if(!storage||!storage.available)throw fail(404,'资源不存在');
  }
}
async function rejectTargetlessDocument(store,id) {
  // The same identity can have different derived bytes per target. Without an
  // explicit target neither the current version nor an arbitrary grant wins.
  const result=await store.query(`SELECT 1 FROM (
      SELECT snapshot FROM personal_site.versions
      UNION ALL SELECT snapshot FROM personal_site.previews
    ) snapshots CROSS JOIN LATERAL jsonb_each(snapshots.snapshot->'assets') asset
    WHERE asset.value->>'resourceId'=$1 AND asset.value ? 'document' LIMIT 1`,[id]);
  if(result.rowCount)throw fail(404,'资源文档需要明确版本');
}
async function sendResource(req, res, next, resource, options) {
  res.set("X-Content-Type-Options", "nosniff");
  if (!res.get('Cache-Control')) res.set("Cache-Control", "no-store");
  // Media ranges remain supported; conditional GET is reserved for CAS programs.
  delete req.headers['if-none-match'];
  delete req.headers['if-modified-since'];
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
    { dotfiles: "deny", cacheControl: false, etag:false, lastModified:false },
    (error) => {
      if (error) next(error);
    },
  );
}
module.exports = { resolveVersion, resolvePublishedResource, sendResource, assertLiveResource, rejectTargetlessDocument };

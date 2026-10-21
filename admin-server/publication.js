const fs = require("node:fs/promises");
const path = require("node:path");
const { localFile } = require("./storage");
const { fail } = require("./security");
const {
  collectReferences,
  inactiveUIL,
  resourceAsset,
} = require("./snapshots");
const { resourceRepository } = require("./repositories/resources");
const { storageRepository } = require("./repositories/storages");
const { MEDIA_FIELDS } = require('../shared/page-content');
function resourceId(snapshot, url) {
  const direct =
    /^\/media\/([^/?#]+)(?:[?#]|$)/.exec(url)?.[1] ||
    /^\/(?:models\/|assets\/geometry\/admin\/)([^/?#]+)\.bin(?:[?#]|$)/.exec(
      url,
    )?.[1];
  const asset = resourceAsset(snapshot, url);
  return direct || asset?.resourceId;
}

// Database-only checks are repeated under the site lock after file validation.
async function checkPublicationState(store, snapshot, {references, geometryIds, policy} = {}) {
  const resources = resourceRepository(store),
    storages = storageRepository(store);
  const geometry = new Set(
    geometryIds ?? snapshot.config.scenes
      .flatMap((s) => s.fields)
      .filter(
        (f) => f.type === "geometry" && !inactiveUIL(snapshot.template, f.key, policy),
      )
      .map((f) => resourceId(snapshot, f.value)),
  );
  const rows = [];
  for (const id of [
    ...new Set((references ?? collectReferences(snapshot, policy)).map((r) => r.resourceId)),
  ].sort()) {
    const row = await resources.get(id);
    if (
      !row ||
      row.trashed ||
      ["missing", "disabled", "failed"].includes(row.status)
    )
      throw fail(422, "引用的资源不存在或已回收");
    if (geometry.has(row.id) && row.status !== "ready")
      throw fail(422, "模型需要先完成 GLB → BIN 转换");
    if (row.storageId) {
      const storage = await storages.get(row.storageId);
      if (!storage || storage.available === false)
        throw fail(422, "资源存储配置不可用");
    }
    rows.push(row);
  }
  if (snapshot.config.site?.socialImage) {
    const id = resourceId(snapshot, snapshot.config.site.socialImage);
    if (!rows.some(row => row.id === id && row.kind === 'image'))
      throw fail(422, '分享图片必须引用可用的图片资源');
  }
  for (const [key, field] of Object.entries(MEDIA_FIELDS)) {
    const url=snapshot.config.site?.[key];
    if (!url) continue;
    const id=resourceId(snapshot,url);
    if (!rows.some(row=>row.id===id&&row.kind===field.kind))
      throw fail(422, `${field.label}必须引用可用的${field.kind==='video'?'视频':'图片'}资源`);
  }
  if (snapshot.template.readiness?.missingRequired?.length)
    throw fail(422, "缺少前台运行所需资源");
  return rows;
}

async function validatePublication(store, options = {}, snapshot, context) {
  const rows = await checkPublicationState(store, snapshot, context),
    warnings = new Set();
  const media = [snapshot.config.site?.socialImage,
    ...Object.keys(MEDIA_FIELDS).map(key=>snapshot.config.site?.[key])].filter(Boolean);
  for (const p of snapshot.config.projects)
    for (const kind of ["video", "image", "projectLogo"])
      for (const key of ["url", "thumbnail"])
        if (p[kind]?.[key]) media.push(p[kind][key]);
  for (const scene of snapshot.config.scenes)
    for (const field of scene.fields)
      if (
        ["geometry", "resource"].includes(field.type) &&
        !inactiveUIL(snapshot.template, field.key, context?.policy)
      )
        media.push(field.value);
  media.push(...snapshot.config.songs.map((s) => s.src));
  for (const url of media) {
    if (/^https:/.test(url)) {
      warnings.add("云端/外链资源的公网访问和 CORS 需要在前台预览确认");
      continue;
    }
    if (!/^(?:\/?assets\/|\/media\/|\/models\/|room\/|bush\.bin\/)/.test(url))
      continue;
    const mapped = resourceAsset(snapshot, url);
    if (
      !mapped &&
      !rows.some((r) => r.url === url || r.id === resourceId(snapshot, url))
    )
      throw fail(422, "引用的站内资源不存在");
  }
  for (const row of rows) {
    if (row.source === "local") {
      try {
        const file = await localFile(
          path.join(options.dataDir, "uploads"),
          row.key,
        );
        if (!(await fs.stat(file)).isFile()) throw Error();
      } catch {
        throw fail(422, `本地资源不存在：${row.name}`);
      }
    } else if (row.source === "bundled" && row.path) {
      try {
        const root = await fs.realpath(options.root),
          file = await fs.realpath(path.resolve(root, row.path));
        if (
          !file.startsWith(root + path.sep) ||
          !(await fs.stat(file)).isFile()
        )
          throw Error();
      } catch {
        throw fail(422, `站内资源不存在：${row.name}`);
      }
    } else if (["s3", "external"].includes(row.source))
      warnings.add("云端/外链资源的公网访问和 CORS 需要在前台预览确认");
  }
  const uil = snapshot.template.baseUIL;
  for (const scene of snapshot.config.scenes)
    for (const field of scene.fields) {
      if (
        field.type !== "text" ||
        field.value === uil[field.key] ||
        inactiveUIL(snapshot.template, field.key, context?.policy)
      )
        continue;
      const name = uil[field.key.replace(/_text$/, "_fontStyle")]?.match?.(
        /(?:^|\n)font:\s*([\w-]+)/,
      )?.[1];
      if (!name)
        throw fail(422, "无法确认此 3D 文案使用的字体，请先检查字体配置");
      const url = `assets/fonts/${name}.json`,
        slot = snapshot.legacyMap[url] || snapshot.legacyMap["/" + url];
      const asset =
        snapshot.assets[slot] ||
        Object.values(snapshot.assets).find(
          (a) => a.fileName === url || a.url === url,
        );
      const chars = snapshot.template.fontCoverage?.[asset?.resourceId];
      if (typeof chars !== "string") throw fail(422, `缺少字体图集：${name}`);
      const available = new Set([...chars]);
      const missing = [
        ...new Set(
          [...field.value].filter((c) => !/[\s]/u.test(c) && !available.has(c)),
        ),
      ];
      if (missing.length)
        throw fail(
          422,
          `字体 ${name} 缺少字形：${missing.slice(0, 20).join("")}。请先重新生成字体图集。`,
        );
    }
  const pageLabels=['contactHomeText','contactJoinText','contactAboutText','contactQrText']
    .map(key=>snapshot.config.site?.[key]).filter(Boolean);
  if(pageLabels.length){
    const font='NBArchitektStd-Bold',url=`assets/fonts/${font}.json`;
    const asset=resourceAsset(snapshot,url);
    const chars=snapshot.template.fontCoverage?.[asset?.resourceId];
    if(typeof chars!=='string')throw fail(422,`缺少字体图集：${font}`);
    const available=new Set([...chars]);
    const missing=[...new Set(pageLabels.flatMap(text=>[...text].filter(c=>!/[\s]/u.test(c)&&!available.has(c))))];
    if(missing.length)throw fail(422,`字体 ${font} 缺少字形：${missing.slice(0,20).join('')}。请使用现有字体支持的文字。`);
  }
  return [...warnings];
}
module.exports = { validatePublication, checkPublicationState };

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const busboy = require("busboy");
const S = require("../storage");
const { resourceRepository } = require("../repositories/resources");
const { storageRepository } = require("../repositories/storages");
const { contentRepository } = require("../repositories/content");
const { auditRepository } = require("../repositories/audit");
const MiB = 1024 * 1024,
  LIMITS = {
    image: 25 * MiB,
    audio: 100 * MiB,
    model: 200 * MiB,
    video: 1024 * MiB,
  };
const TYPES = {
  png: "image",
  jpg: "image",
  gif: "image",
  webp: "image",
  avif: "image",
  mp4: "video",
  webm: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  opus: "audio",
  glb: "model",
};
function references(config, resource) {
  if (!config) return false;
  if (typeof config === "string")
    return (
      config === resource.url ||
      config === `/media/${resource.id}` ||
      config === resource.id
    );
  if (Array.isArray(config)) return config.some((v) => references(v, resource));
  if (typeof config === "object")
    return Object.values(config).some((v) => references(v, resource));
  return false;
}
async function multipart(req, dir, max) {
  await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
  if ((await fs.promises.lstat(dir)).isSymbolicLink())
    throw S.fail("临时目录不可访问");
  const filename = path.join(dir, randomUUID() + ".tmp");
  const fields = {};
  let name,
    size = 0,
    error,
    task;
  try {
    await new Promise((resolve, reject) => {
      let bb;
      try {
        bb = busboy({
          headers: req.headers,
          limits: {
            files: 1,
            fields: 2,
            parts: 3,
            fieldSize: 256,
            fileSize: max,
          },
        });
      } catch {
        reject(S.fail("需要 multipart 文件上传"));
        return;
      }
      const abort = () => {
        error = S.fail("上传已中断");
        bb.destroy(error);
      };
      req.once("aborted", abort);
      const timer = setTimeout(abort, 120000);
      timer.unref();
      bb.on("field", (key, value, info) => {
        if (
          key !== "storageId" ||
          fields[key] !== undefined ||
          info.valueTruncated
        )
          error = S.fail("上传字段无效");
        else fields[key] = value;
      });
      bb.on("file", (key, file, info) => {
        if (key !== "file" || task) {
          error = S.fail("只允许一个文件");
          file.resume();
          return;
        }
        if (typeof info.filename !== "string" || !info.filename.trim()) {
          error = S.fail("上传文件缺少文件名");
          file.resume();
          return;
        }
        name = path.basename(info.filename).slice(0, 255);
        file.on("limit", () => {
          error = S.fail("文件超过大小限制", 413);
        });
        file.on("data", (c) => (size += c.length));
        task = pipeline(
          file,
          fs.createWriteStream(filename, { flags: "wx", mode: 0o600 }),
        ).catch((e) => {
          error = S.fail("上传文件写入失败");
        });
      });
      for (const event of ["filesLimit", "fieldsLimit", "partsLimit"])
        bb.on(event, () => {
          error = S.fail("上传内容数量超限");
        });
      bb.on("error", () => reject(S.fail("上传内容无效")));
      bb.on("close", async () => {
        clearTimeout(timer);
        req.off("aborted", abort);
        if (task) await task;
        if (error) reject(error);
        else if (!task || !size) reject(S.fail("上传文件不能为空"));
        else resolve();
      });
      req.pipe(bb);
    });
    return { filename, name, size, storageId: fields.storageId };
  } catch (e) {
    await fs.promises.unlink(filename).catch(() => {});
    throw e;
  }
}
async function commitResource(store, resource, actor, action, storage) {
  return store.transaction(async (tx) => {
    await tx.query(
      "SELECT id FROM personal_site.site_settings WHERE id=true FOR UPDATE",
    );
    if (storage) {
      const current = await storageRepository(tx).get(storage.id);
      if (
        !current ||
        current.available === false ||
        [
          "type",
          "endpoint",
          "bucket",
          "prefix",
          "publicBaseUrl",
          "forcePathStyle",
        ].some((key) => current[key] !== storage[key])
      )
        throw S.fail("存储配置已改变，请重新上传或转换", 409);
    }
    const value = await resourceRepository(tx).insert(resource);
    await auditRepository(tx).append(action, actor);
    return value;
  });
}
function createResourceService({ store, options }) {
  let uploads = 0;
  const save = (resource, actor, action, storage) =>
    commitResource(store, resource, actor, action, storage);
  async function link(body, actor) {
    const b = body || {};
    if (!LIMITS[b.kind]) throw S.fail("资源类型无效");
    const url = S.externalUrl(b.url);
    const resource = await save(
      {
        id: randomUUID(),
        name: String(
          b.name || new URL(url).pathname.split("/").pop() || "外链",
        ).slice(0, 255),
        kind: b.kind,
        mime: null,
        size: null,
        url,
        source: "external",
        storageId: null,
        key: null,
        created: new Date().toISOString(),
        trashed: false,
        accessibility: "unverified",
        status: b.kind === "model" ? "unverified" : "linked",
      },
      actor,
      "resource.link",
    );
    return resource;
  }
  async function upload(req, actor) {
    if (uploads >= 2) throw S.fail("上传繁忙，请稍后再试", 429);
    uploads++;
    let upload, adapter, orphanKey;
    try {
      upload = await multipart(
        req,
        path.join(options.dataDir, "tmp"),
        Math.max(...Object.values({ ...LIMITS, ...options.uploadLimits })),
      );
      const config = await storageRepository(store).get(
        upload.storageId || (await storageRepository(store).getDefault()),
      );
      if (!config) throw S.fail("上传存储不存在");
      let type;
      try {
        type = await (
          await import("file-type")
        ).fileTypeFromFile(upload.filename);
      } catch {
        throw S.fail("文件签名无效");
      }
      const kind = TYPES[type?.ext];
      if (!kind) throw S.fail("文件类型不支持或签名无效");
      if (upload.size > { ...LIMITS, ...options.uploadLimits }[kind])
        throw S.fail("文件超过该类型大小限制", 413);
      const id = randomUUID(),
        key =
          (config.type === "s3" && config.prefix
            ? config.prefix.replace(/\/$/, "") + "/"
            : "") +
          id +
          "." +
          type.ext;
      adapter = await S.createAdapter(config, options);
      await adapter.put(key, fs.createReadStream(upload.filename), {
        size: upload.size,
        mime: type.mime,
      });
      orphanKey = key;
      const resource = await save(
        {
          id,
          name: upload.name,
          kind,
          mime: type.mime,
          size: upload.size,
          url: `/media/${id}`,
          source: config.type,
          storageId: config.id,
          key,
          created: new Date().toISOString(),
          trashed: false,
          status: "uploaded",
          accessibility: config.type === "local" ? "verified" : "unverified",
          ...(config.type === "s3"
            ? { publicUrl: S.publicUrl(config, key) }
            : {}),
        },
        actor,
        "resource.upload",
        config,
      );
      orphanKey = null;
      return resource;
    } catch (error) {
      if (orphanKey)
        console.error("Unregistered media object", { key: orphanKey });
      throw error;
    } finally {
      uploads--;
      adapter?.close();
      if (upload) await fs.promises.unlink(upload.filename).catch(() => {});
    }
  }
  async function setTrashed(id, trashed, actor) {
    const r = await resourceRepository(store).get(id);
    if (!r) throw S.fail("资源不存在", 404);
    if (typeof trashed !== "boolean") throw S.fail("必须明确指定回收状态");
    if (r.source === "bundled") throw S.fail("内置资源只读", 409);
    const resource = await store.transaction(async (tx) => {
      await tx.query(
        "SELECT id FROM personal_site.site_settings WHERE id=true FOR UPDATE",
      );
      await contentRepository(tx).prunePreviews(new Date().toISOString());
      const value = await resourceRepository(tx).setTrashed(r.id, trashed);
      await auditRepository(tx).append("resource.trash", actor);
      return value;
    });
    return resource;
  }
  return {
    list: () => resourceRepository(store).list(),
    link,
    upload,
    setTrashed,
  };
}
module.exports = { createResourceService, references, commitResource };

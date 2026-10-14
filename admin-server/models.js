const fs = require("node:fs"),
  path = require("node:path");
const { fork } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const { Transform } = require("node:stream");
const { createAdapter, localFile } = require("./storage");
const { fail } = require("./security");
const { resourceRepository } = require("./repositories/resources");
const { storageRepository } = require("./repositories/storages");
const { commitResource } = require("./resources");
function runWorker(job) {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, "model-worker.js"), [], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      execArgv: ["--max-old-space-size=1536"],
    });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(
      () => finish(fail(422, "模型处理超时，请减少模型面数")),
      120000,
    );
    child.on("error", () => finish(fail(422, "模型处理进程启动失败")));
    child.on("exit", () => finish(fail(422, "模型处理进程异常退出")));
    child.on("message", (message) =>
      finish(message.ok ? null : fail(422, message.error), message),
    );
    child.send(job);
  });
}
function mountModels({ app, admin, store, options }) {
  let active = false;
  admin.post("/resources/:id/convert", async (req, res, next) => {
    let tmp,
      adapter,
      claimed = false;
    try {
      if (active) throw fail(429, "已有模型正在处理，请稍后再试");
      active = true;
      claimed = true;
      const source = await resourceRepository(store).get(req.params.id);
      if (
        !source ||
        source.trashed ||
        source.source === "bundled" ||
        source.kind !== "model" ||
        source.source === "external" ||
        source.status === "ready"
      )
        throw fail(400, "请先上传 GLB 文件到本地或已配置的云存储");
      const size = req.body.size ?? 0.8;
      if (!Number.isFinite(size) || size < 0.1 || size > 5)
        throw fail(400, "模型尺寸应在 0.1–5 之间");
      fs.mkdirSync(path.join(options.dataDir, "tmp"), {
        recursive: true,
        mode: 0o700,
      });
      tmp = fs.mkdtempSync(path.join(options.dataDir, "tmp", "model-"));
      const input = path.join(tmp, "input.glb"),
        output = path.join(tmp, "output.bin");
      const storage = await storageRepository(store).get(source.storageId);
      if (!storage) throw fail(400, "源存储配置缺失");
      adapter = await createAdapter(storage, options);
      let bytes = 0;
      const limit = new Transform({
        transform(chunk, encoding, callback) {
          bytes += chunk.length;
          callback(
            bytes > 200 * 1024 * 1024 ? fail(413, "模型超过 200 MiB") : null,
            chunk,
          );
        },
      });
      const { Body } = await adapter.get(source.key);
      await pipeline(
        Body,
        limit,
        fs.createWriteStream(input, { flags: "wx", mode: 0o600 }),
      );
      const result = await runWorker({ input, output, size }),
        id = randomUUID();
      const key =
        (storage.type === "s3" && storage.prefix
          ? storage.prefix.replace(/\/$/, "") + "/"
          : "") +
        id +
        ".bin";
      const byteLength = fs.statSync(output).size;
      await adapter.put(key, fs.createReadStream(output), {
        size: byteLength,
        mime: "application/octet-stream",
      });
      const resource = {
        ...source,
        id,
        name: source.name.replace(/\.glb$/i, "") + ".bin",
        key,
        url: `/models/${id}.bin`,
        created: new Date().toISOString(),
        size: byteLength,
        status: "ready",
        originalId: source.id,
        vertices: result.vertices,
        faces: result.faces,
        mime: "application/octet-stream",
      };
      if (storage.type === "s3")
        resource.publicUrl = require("./storage").publicUrl(storage, key);
      try {
        await commitResource(
          store,
          resource,
          req.adminSession.username,
          "model.convert",
          storage,
        );
      } catch (error) {
        console.error("Unregistered media object", { key });
        throw error;
      }
      res.status(201).json({ resource });
    } catch (error) {
      next(error);
    } finally {
      adapter?.close();
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
      if (claimed) active = false;
    }
  });
  app.get(
    ["/models/:id.bin", "/assets/geometry/admin/:id.bin"],
    async (req, res, next) => {
      try {
        const resource = await resourceRepository(store).get(req.params.id);
        if (
          !resource ||
          resource.trashed ||
          resource.status !== "ready" ||
          (!req.adminSession &&
            !(await resourceRepository(store).isPublished(resource.id)))
        )
          throw fail(404, "模型不存在");
        await require('./frontend-resources').assertLiveResource(store,resource);
        await require('./frontend-resources').rejectTargetlessDocument(store,resource.id);
        require('./delivery/response').noStore(res);
        delete req.headers['if-none-match'];
        delete req.headers['if-modified-since'];
        if (resource.source === "s3")
          return res.redirect(302, resource.publicUrl);
        const file = await localFile(
          path.join(options.dataDir, "uploads"),
          resource.key,
        );
        res.type("application/octet-stream").sendFile(file,{cacheControl:false,etag:false,lastModified:false});
      } catch (error) {
        next(error);
      }
    },
  );
}
module.exports = { mountModels };

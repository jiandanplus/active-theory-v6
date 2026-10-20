const { randomUUID } = require("node:crypto");
const S = require("../storage");
const { resourceRepository } = require("../repositories/resources");
const { storageRepository } = require("../repositories/storages");
const { auditRepository } = require("../repositories/audit");

function createStorageService({ store, options }) {
  const storages = () => storageRepository(store).list();
  const resources = () => resourceRepository(store).list();
  async function list() {
    return {
      storages: (await storages()).map(S.redactStorage),
      defaultStorage: await storageRepository(store).getDefault(),
    };
  }
  async function save(body, actor) {
    const input = body || {},
      all = await storages(),
      id = input.id || randomUUID(),
      old = all.find((x) => x.id === id);
    if (id === "local") {
      if (input.isDefault)
        await store.transaction((tx) =>
          storageRepository(tx).setDefault("local"),
        );
      return { status: 200, storage: S.redactStorage(old) };
    }
    if (input.type !== "s3") throw S.fail("仅支持 S3 或本地存储");
    const value = {
      id,
      type: "s3",
      name: String(input.name || "S3").slice(0, 100),
      endpoint: input.endpoint,
      region: input.region || "us-east-1",
      bucket: input.bucket,
      prefix: input.prefix || "",
      publicBaseUrl: input.publicBaseUrl,
      forcePathStyle: !!input.forcePathStyle,
    };
    await S.validateEndpoint(value.endpoint, options);
    value.publicBaseUrl = S.externalUrl(value.publicBaseUrl);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,62}$/.test(value.bucket || ""))
      throw S.fail("Bucket 无效");
    if (value.prefix) S.validateKey(value.prefix.replace(/\/$/, ""));
    S.publicUrl(value, "validation");
    if (
      old &&
      (await resources()).some((r) => r.storageId === id) &&
      ["endpoint", "bucket", "prefix", "publicBaseUrl", "forcePathStyle"].some(
        (k) => old[k] !== value[k],
      )
    )
      throw S.fail("已有资源的存储位置不可更改，请新建配置", 409);
    let creds = {};
    if (old?.credentials) {
      try {
        creds = S.decryptCredentials(old.credentials, options);
      } catch (error) {
        if (
          !input.accessKeyId ||
          input.accessKeyId === "configured" ||
          !input.secretAccessKey ||
          input.secretAccessKey === "configured"
        )
          throw error;
      }
    }
    for (const key of ["accessKeyId", "secretAccessKey", "sessionToken"])
      if (input[key] && input[key] !== "configured")
        creds[key] = String(input[key]);
    if (!creds.accessKeyId || !creds.secretAccessKey)
      throw S.fail("请填写 S3 凭证");
    value.credentials = S.encryptCredentials(creds, options);
    await store.transaction(async (tx) => {
      await storageRepository(tx).upsert(value);
      if (input.isDefault) await storageRepository(tx).setDefault(id);
      await auditRepository(tx).append("storage.save", actor);
    });
    return { status: old ? 200 : 201, storage: S.redactStorage(value) };
  }
  async function test(id) {
    const config = await storageRepository(store).get(id);
    if (!config) throw S.fail("存储不存在", 404);
    const adapter = await S.createAdapter(config, options);
    try {
      await adapter.test();
      return { ok: true, readOnly: true, publicAccessibility: "unverified" };
    } finally {
      adapter.close();
    }
  }
  return { list, save, test };
}
module.exports = { createStorageService };

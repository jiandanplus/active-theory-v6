const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const dns = require("node:dns/promises");
const net = require("node:net");
const http = require("node:http");
const https = require("node:https");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} = require("@aws-sdk/client-s3");
const { NodeHttpHandler } = require("@smithy/node-http-handler");
function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}
function master(options) {
  if (!/^[a-f\d]{64}$/i.test(options.masterKey || ""))
    throw fail("S3 凭证需要配置有效的部署主密钥");
  return Buffer.from(options.masterKey, "hex");
}
function encryptCredentials(value, options) {
  const key = master(options),
    iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return {
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    data: data.toString("hex"),
  };
}
function decryptCredentials(value, options) {
  try {
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      master(options),
      Buffer.from(value.iv, "hex"),
    );
    decipher.setAuthTag(Buffer.from(value.tag, "hex"));
    return JSON.parse(
      Buffer.concat([
        decipher.update(Buffer.from(value.data, "hex")),
        decipher.final(),
      ]).toString(),
    );
  } catch {
    throw fail("存储凭证无法解密，请检查部署主密钥", 503);
  }
}
function redactStorage(value) {
  const { credentials, accessKeyId, secretAccessKey, sessionToken, ...safe } =
    value;
  return {
    ...safe,
    accessKeyId: credentials || accessKeyId ? "configured" : "",
    secretAccessKey: credentials || secretAccessKey ? "configured" : "",
    sessionToken: credentials || sessionToken ? "configured" : "",
    credentialsConfigured: !!credentials,
  };
}
function validateKey(key) {
  if (
    typeof key !== "string" ||
    !key ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.split("/").some((p) => !p || p === "." || p === "..") ||
    /[\x00-\x1f]/.test(key)
  )
    throw fail("对象路径无效");
  return key;
}
function externalUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fail("资源 URL 无效");
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw fail("资源 URL 必须是无凭证的 HTTPS 地址");
  return url.href;
}
function privateAddress(ip) {
  if (net.isIP(ip) === 4) {
    const a = ip.split(".").map(Number);
    return (
      a[0] === 0 ||
      a[0] === 10 ||
      a[0] === 127 ||
      a[0] >= 224 ||
      (a[0] === 169 && a[1] === 254) ||
      (a[0] === 172 && a[1] >= 16 && a[1] <= 31) ||
      (a[0] === 192 && a[1] === 168) ||
      (a[0] === 100 && a[1] >= 64 && a[1] <= 127) ||
      (a[0] === 198 && (a[1] === 18 || a[1] === 19))
    );
  }
  return !/^2[0-9a-f]{3}:/i.test(ip);
}
async function validateEndpoint(value, options = {}) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fail("存储 Endpoint 无效");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw fail("存储 Endpoint 必须是无凭证的 HTTP(S) 源地址");
  const allowed = (options.endpointAllowlist || []).includes(url.origin);
  if (url.protocol !== "https:" && !allowed)
    throw fail("HTTP Endpoint 需要部署白名单");
  if (options.production && url.protocol !== "https:")
    throw fail("生产 Endpoint 必须为 HTTPS");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addresses;
  try {
    addresses = net.isIP(host)
      ? [{ address: host, family: net.isIP(host) }]
      : await dns.lookup(host, { all: true });
  } catch {
    throw fail("Endpoint DNS 查询失败");
  }
  if (
    !addresses.length ||
    (!allowed && addresses.some((a) => privateAddress(a.address)))
  )
    throw fail("私网 Endpoint 需要部署白名单");
  return { url, addresses };
}
function publicUrl(storage, key) {
  validateKey(key);
  const base = new URL(externalUrl(storage.publicBaseUrl));
  if (base.search || base.hash)
    throw fail("公共访问基础 URL 不能包含查询参数或片段");
  base.pathname =
    base.pathname.replace(/\/$/, "") +
    "/" +
    key.split("/").map(encodeURIComponent).join("/");
  return base.href;
}
async function localFile(dir, key) {
  validateKey(key);
  let current = dir;
  const root = await fs.promises.realpath(dir);
  for (const part of key.split("/")) {
    current = path.join(current, part);
    const stat = await fs.promises.lstat(current);
    if (stat.isSymbolicLink()) throw fail("资源路径不可访问", 404);
  }
  const resolved = await fs.promises.realpath(current);
  if (!resolved.startsWith(root + path.sep))
    throw fail("资源路径不可访问", 404);
  return resolved;
}
async function createAdapter(storage, options = {}) {
  if (storage.type === "local") {
    const dir = path.join(options.dataDir, "uploads");
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
    if ((await fs.promises.lstat(dir)).isSymbolicLink())
      throw fail("上传目录不能是符号链接");
    return {
      put: async (key, body) => {
        validateKey(key);
        if (key.includes("/")) throw fail("本地对象键无效");
        const file = path.join(dir, key),
          handle = await fs.promises.open(file, "wx", 0o600);
        let complete = false;
        try {
          for await (const value of Buffer.isBuffer(body) ? [body] : body) {
            const chunk = Buffer.from(value);
            let offset = 0;
            while (offset < chunk.length) {
              const { bytesWritten } = await handle.write(
                chunk,
                offset,
                chunk.length - offset,
              );
              if (!bytesWritten) throw Error("Incomplete write");
              offset += bytesWritten;
            }
          }
          complete = true;
        } finally {
          await handle.close();
          if (!complete) await fs.promises.unlink(file).catch(() => {});
        }
      },
      head: async (key) => fs.promises.stat(await localFile(dir, key)),
      get: async (key) => ({
        Body: fs.createReadStream(await localFile(dir, key)),
      }),
      delete: async (key) => fs.promises.unlink(await localFile(dir, key)),
      test: async () => ({ ok: true }),
      close() {},
    };
  }
  if (storage.type !== "s3") throw fail("存储类型无效");
  const { url, addresses } = await validateEndpoint(storage.endpoint, options);
  const credentials = storage.credentials
    ? decryptCredentials(storage.credentials, options)
    : {
        accessKeyId: storage.accessKeyId,
        secretAccessKey: storage.secretAccessKey,
        sessionToken: storage.sessionToken,
      };
  const baseHost = url.hostname.replace(/^\[|\]$/g, ""),
    pinned = new Map([[baseHost, addresses]]);
  const lookup = (host, opts, cb) => {
    (async () => {
      if (!pinned.has(host)) {
        if (storage.forcePathStyle || host !== `${storage.bucket}.${baseHost}`)
          throw fail("Endpoint 主机不匹配");
        const actual = new URL(url);
        actual.hostname = host;
        const allowlist = [...(options.endpointAllowlist || [])];
        if (allowlist.includes(url.origin)) allowlist.push(actual.origin);
        const checked = await validateEndpoint(actual.origin, {
          ...options,
          endpointAllowlist: allowlist,
        });
        pinned.set(host, checked.addresses);
      }
      const a = pinned.get(host)[0];
      cb(null, opts.all ? [a] : a.address, a.family);
    })().catch((error) => cb(error));
  };
  const client = new S3Client({
    endpoint: url.origin,
    region: storage.region || "us-east-1",
    forcePathStyle: !!storage.forcePathStyle,
    credentials,
    maxAttempts: 1,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    requestHandler: new NodeHttpHandler({
      httpAgent: new http.Agent({ lookup }),
      httpsAgent: new https.Agent({ lookup }),
      connectionTimeout: 5000,
      socketTimeout: 30000,
    }),
  });
  const send = async (Command, key, extra = {}) => {
    try {
      return await client.send(
        new Command({
          Bucket: storage.bucket,
          ...(key ? { Key: validateKey(key) } : {}),
          ...extra,
        }),
      );
    } catch {
      throw fail("对象存储操作失败，请检查配置及权限", 502);
    }
  };
  return {
    put: (key, Body, info = {}) =>
      send(PutObjectCommand, key, {
        Body,
        ContentLength: info.size,
        ContentType: info.mime,
      }),
    head: (key) => send(HeadObjectCommand, key),
    get: (key) => send(GetObjectCommand, key),
    delete: (key) => send(DeleteObjectCommand, key),
    test: () => send(HeadBucketCommand),
    close: () => client.destroy(),
  };
}
module.exports = {
  fail,
  encryptCredentials,
  decryptCredentials,
  redactStorage,
  validateKey,
  externalUrl,
  validateEndpoint,
  publicUrl,
  localFile,
  createAdapter,
};

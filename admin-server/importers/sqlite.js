const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");
const path = require("node:path");
const { baseline, complete } = require("./bundle");
const { validateConfig } = require("../config");
const { decryptCredentials, localFile } = require("../storage");
const { conflict, checksum } = require("../resource-catalog");
const KEYS = new Set([
  "schema",
  "draft",
  "revision",
  "published",
  "resources",
  "storages",
  "defaultStorage",
]);
function validate(config, schema) {
  try {
    // SQLite JSON key order is not a semantic part of site configuration.
    if (
      !config?.site ||
      !schema?.site ||
      Object.keys(config.site).sort().join("|") !==
        Object.keys(schema.site).sort().join("|")
    )
      throw Error();
    const ordered = {
      ...config,
      site: Object.fromEntries(
        Object.keys(schema.site).map((k) => [k, config.site[k]]),
      ),
    };
    validateConfig(ordered, schema);
  } catch {
    throw conflict("Invalid legacy configuration or schema");
  }
}
async function readLegacy({ root, legacyPath, masterKey, dataDir }) {
  if (typeof legacyPath !== "string" || !legacyPath)
    throw conflict("Server legacy source path is required");
  // The service must stop the old writer before invoking import. A read
  // transaction gives a consistent SQLite snapshot; no WAL/journal PRAGMA,
  // schema creation or writable legacy connection is permitted here.
  const actual = await fs.promises.realpath(legacyPath);
  const db = new DatabaseSync(actual, { readOnly: true });
  let settings, versions, admins, audit;
  try {
    db.exec("BEGIN");
    settings = {};
    for (const row of db.prepare("SELECT key,value FROM settings").all())
      if (KEYS.has(row.key)) {
        try {
          settings[row.key] = JSON.parse(row.value);
        } catch {
          throw conflict(`Invalid legacy setting: ${row.key}`);
        }
      }
    versions = db
      .prepare("SELECT id,created,config FROM versions ORDER BY id")
      .all()
      .map((row) => {
        try {
          return { ...row, config: JSON.parse(row.config) };
        } catch {
          throw conflict("Invalid legacy version JSON");
        }
      });
    admins = db
      .prepare("SELECT username,hash FROM admins ORDER BY username")
      .all();
    audit = db
      .prepare("SELECT id,created,action,actor FROM audit ORDER BY id")
      .all();
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    if (error.status) throw error;
    throw conflict("Legacy database format cannot be imported");
  } finally {
    db.close();
  }
  if (admins.length > 1)
    throw conflict("Multiple legacy administrators require resolution");
  const admin = admins[0] ? { ...admins[0] } : null;
  if (
    admin &&
    (typeof admin.username !== "string" ||
      !admin.username ||
      typeof admin.hash !== "string" ||
      !admin.hash)
  )
    throw conflict("Invalid legacy administrator");
  validate(settings.schema, settings.schema);
  validate(settings.draft, settings.schema);
  if (!Number.isSafeInteger(settings.revision) || settings.revision < 0)
    throw conflict("Invalid legacy revision");
  for (const version of versions) {
    if (
      !Number.isSafeInteger(version.id) ||
      version.id <= 0 ||
      !Number.isFinite(Date.parse(version.created))
    )
      throw conflict("Invalid legacy version");
    validate(version.config, settings.schema);
  }
  if (
    settings.published !== null &&
    (!Number.isSafeInteger(settings.published) ||
      !versions.some((v) => v.id === settings.published))
  )
    throw conflict("Invalid legacy published pointer");
  const resources = settings.resources || [],
    storages = settings.storages || [
      { id: "local", type: "local", name: "Local" },
    ],
    credentialsUnavailable = [];
  if (
    !Array.isArray(resources) ||
    !Array.isArray(storages) ||
    !resources.every((r) => r && typeof r === "object" && !Array.isArray(r)) ||
    !storages.every((s) => s && typeof s === "object" && !Array.isArray(s)) ||
    new Set(resources.map((r) => r.id)).size !== resources.length ||
    new Set(storages.map((s) => s.id)).size !== storages.length
  )
    throw conflict("Invalid duplicate resource or storage records");
  for (const storage of storages) {
    if (
      typeof storage.id !== "string" ||
      !storage.id ||
      !["local", "s3"].includes(storage.type)
    )
      throw conflict("Invalid legacy storage");
    storage.available = storage.type === "local";
    if (storage.type === "s3") {
      if (storage.credentials)
        try {
          const value = decryptCredentials(storage.credentials, { masterKey });
          storage.available = !!(value.accessKeyId && value.secretAccessKey);
        } catch {}
      if (!storage.available) credentialsUnavailable.push(storage.id);
      // Plain credentials are never migrated as configuration or printed.
      if (
        storage.accessKeyId ||
        storage.secretAccessKey ||
        storage.sessionToken
      )
        throw conflict(
          `Unencrypted legacy credentials require reconfiguration: ${storage.id}`,
        );
    }
  }
  const defaultStorage = settings.defaultStorage || "local";
  if (!storages.some((s) => s.id === defaultStorage))
    throw conflict("Legacy default storage is missing");
  for (const row of resources)
    if (
      typeof row.id !== "string" ||
      !row.id ||
      !["local", "s3", "external", "bundled"].includes(row.source) ||
      typeof row.url !== "string" ||
      !row.url ||
      typeof row.name !== "string" ||
      !row.name ||
      !["image", "video", "audio", "model", "font"].includes(row.kind) ||
      !Number.isFinite(Date.parse(row.created)) ||
      (row.storageId && !storages.some((s) => s.id === row.storageId))
    )
      throw conflict("Invalid legacy resource metadata");
  for (const row of audit)
    if (
      !Number.isSafeInteger(row.id) ||
      !Number.isFinite(Date.parse(row.created)) ||
      typeof row.action !== "string"
    )
      throw conflict("Invalid legacy audit");
  // The operator stages a COPY into the new runtime directory first. Never
  // infer it from SQLite/root, copy files, or perform I/O in the PG transaction.
  const localUnavailable = [];
  for (const row of resources.filter((r) => r.source === "local")) {
    try {
      if (typeof dataDir !== "string" || !path.isAbsolute(dataDir))
        throw Error();
      const uploads = path.join(dataDir, "uploads");
      if ((await fs.promises.lstat(uploads)).isSymbolicLink()) throw Error();
      const file = await localFile(uploads, row.key);
      const stat = await fs.promises.stat(file);
      if (!stat.isFile()) throw Error();
      row.checksum = await checksum(file); // Also proves read access; digest catches byte changes.
      row.size = stat.size;
    } catch {
      localUnavailable.push(row.id);
      row.status = "missing";
      row.checksum = null;
      row.size = null;
    }
  }
  const base = await baseline(root);
  return complete({
    ...base,
    config: settings.draft,
    schema: settings.schema,
    versions,
    published: settings.published,
    revision: settings.revision,
    resources,
    storages,
    defaultStorage,
    admin,
    audit,
    warnings: [
      "Stop the legacy instance from writing before import.",
      "Historical versions did not independently save their baseline template; current original baseline is supplied for every historical snapshot.",
    ],
    credentialsUnavailable,
    localUnavailable,
  });
}
module.exports = { readLegacy };

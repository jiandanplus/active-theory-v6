const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { sha256, sourcePath } = require('./contracts');

const unsafe = () => new Error('Unsafe or changed delivery file');
const identity = (a, b) => a.dev === b.dev && a.ino === b.ino;
const digestValid = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sizeValid = value => Number.isSafeInteger(value) && value >= 0;

function absoluteRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || root.includes('\0')
    || root.split(path.sep).some(p => p === '.' || p === '..')) throw unsafe();
  return path.resolve(root);
}

// Check every ancestor, including ancestors above the supplied root. Do not
// realpath-normalize caller input: that would hide a caller's symlink.
async function directories(directory, create = false) {
  const paths = [path.parse(directory).root];
  for (const part of directory.slice(paths[0].length).split(path.sep).filter(Boolean)) {
    paths.push(path.join(paths.at(-1), part));
  }
  const result = [];
  for (const name of paths) {
    if (create) {
      try { await fs.mkdir(name, { mode: 0o700 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    const stat = await fs.lstat(name, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(name) !== name) throw unsafe();
    result.push({ name, stat });
  }
  return result;
}
async function unchangedDirectories(before) {
  const after = await directories(before.at(-1).name);
  if (after.length !== before.length || after.some((entry, i) => !identity(entry.stat, before[i].stat))) throw unsafe();
}
function sameFile(a, b, checkChangeTime) {
  return identity(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs
    && (!checkChangeTime || a.ctimeNs === b.ctimeNs);
}

async function readFile(root, relative, maxBytes, checkChangeTime) {
  const file = path.join(root, relative);
  const parents = await directories(path.dirname(file));
  const before = await fs.lstat(file, { bigint: true });
  if (!before.isFile() || before.size > BigInt(maxBytes) || await fs.realpath(file) !== file) throw unsafe();
  const resolved = path.relative(root, file);
  if (!resolved || resolved.startsWith('..' + path.sep) || path.isAbsolute(resolved)) throw unsafe();
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat({ bigint: true });
    if (!opened.isFile() || !sameFile(before, opened, checkChangeTime)) throw unsafe();
    const chunks = [];
    let length = 0;
    for (;;) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, maxBytes - length + 1));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      length += bytesRead;
      if (length > maxBytes) throw unsafe();
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const after = await handle.stat({ bigint: true });
    const named = await fs.lstat(file, { bigint: true });
    if (!named.isFile() || !sameFile(opened, after, checkChangeTime)
      || !sameFile(after, named, checkChangeTime) || after.size !== BigInt(length)
      || await fs.realpath(file) !== file) throw unsafe();
    await unchangedDirectories(parents);
    return Buffer.concat(chunks, length);
  } finally { await handle.close(); }
}

async function readSource(root, relative, maxBytes) {
  root = absoluteRoot(root);
  sourcePath(relative);
  if (!sizeValid(maxBytes)) throw unsafe();
  return readFile(root, relative, maxBytes, true);
}

function createCAS(dataDir) {
  const root = absoluteRoot(dataDir);
  const objects = path.join(root, 'delivery/objects');
  const staging = path.join(root, 'delivery/staging');
  async function prepare() {
    await directories(root);
    await directories(objects, true);
    await directories(staging, true);
  }
  async function read(entry) {
    if (!entry || !digestValid(entry.sha256) || !sizeValid(entry.size)) throw unsafe();
    // Hard-link publication/temporary unlink can legitimately change ctime.
    // CAS integrity instead rests on the digest of this exact returned buffer.
    const bytes = await readFile(root, path.join('delivery/objects', entry.sha256), entry.size, false);
    if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256) {
      throw Object.assign(unsafe(), { code: 'DELIVERY_INTEGRITY' });
    }
    return bytes;
  }
  async function put(input) {
    if (!Buffer.isBuffer(input) && !(input instanceof Uint8Array)) throw unsafe();
    const bytes = Buffer.from(input); // Freeze the caller's bytes before any await.
    const entry = { sha256: sha256(bytes), size: bytes.length };
    await prepare();
    const parents = await directories(staging);
    const tmp = await fs.mkdtemp(path.join(staging, 'put-'));
    const owned = await fs.lstat(tmp, { bigint: true });
    const temporary = path.join(tmp, 'object');
    try {
      await unchangedDirectories(parents);
      const handle = await fs.open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); }
      finally { await handle.close(); }
      await unchangedDirectories(parents);
      const staged = await readFile(root, path.relative(root, temporary), bytes.length, true);
      if (sha256(staged) !== entry.sha256) throw unsafe();
      const destinationParents = await directories(objects);
      try { await fs.link(temporary, path.join(objects, entry.sha256)); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      await unchangedDirectories(destinationParents);
      const directoryHandle = await fs.open(objects, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
      await read(entry);
      return entry;
    } finally {
      // Never remove a destination, another call's temporary, or a replaced
      // directory. Avoid recursive removal even within the owned temporary.
      await unchangedDirectories(parents);
      const current = await fs.lstat(tmp, { bigint: true });
      if (!current.isDirectory() || !identity(current, owned)) throw unsafe();
      try { await fs.unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await fs.rmdir(tmp);
    }
  }
  async function inspect({ readOnly = false } = {}) {
    if (!readOnly) await prepare();
    else {
      // A fresh installation may have neither directory. Verify existing
      // ancestors first, without mkdir or normalization of symlink input.
      let parents = await directories(root);
      for (const directory of [path.join(root, 'delivery'), objects]) {
        try { await fs.lstat(directory); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          await unchangedDirectories(parents);
          return { objects: [], bytes: 0 };
        }
        parents = await directories(directory);
      }
    }
    const parents = await directories(objects);
    const entries = [];
    for (const name of (await fs.readdir(objects)).sort()) {
      if (!digestValid(name)) throw unsafe();
      const stat = await fs.lstat(path.join(objects, name));
      if (!stat.isFile() || !sizeValid(stat.size)) throw unsafe();
      entries.push({ sha256: name, size: stat.size });
    }
    await unchangedDirectories(parents);
    // Metadata inventory only: callers MUST use read with declared identity
    // before treating an object as verified. Corrupt/orphan bytes stay intact.
    const bytes = entries.reduce((sum, entry) => sum + entry.size, 0);
    if (!sizeValid(bytes)) throw unsafe();
    return { objects: entries, bytes };
  }
  return { put, read, inspect };
}

module.exports = { createCAS, readSource };

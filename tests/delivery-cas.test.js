const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createCAS, readSource } = require('../admin-server/delivery/cas');
const { sha256 } = require('../admin-server/delivery/contracts');

async function fixture(t) {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'delivery-cas-')));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
test('CAS rechecks existing bytes and never repairs corruption in place', async t => {
  const dir = await fixture(t), cas = createCAS(dir);
  const entry = await cas.put(Buffer.from('original'));
  assert.deepEqual(entry, { sha256: sha256('original'), size: 8 });
  assert.equal((await cas.read(entry)).toString(), 'original');
  const object = path.join(dir, 'delivery/objects', entry.sha256);
  await fs.writeFile(object, 'damaged');
  await assert.rejects(cas.read(entry));
  await assert.rejects(cas.put(Buffer.from('original')));
  assert.equal(await fs.readFile(object, 'utf8'), 'damaged');
});
test('source reads bounded ordinary files and rejects ambiguous declared paths', async t => {
  const dir = await fixture(t);
  await fs.writeFile(path.join(dir, 'file'), 'hello');
  assert.equal((await readSource(dir, 'file', 5)).toString(), 'hello');
  await assert.rejects(readSource(dir, 'file', 4));
  for (const name of ['../file', '/file', 'a/../file', 'a//file', '%66ile', 'a\\file', '.hidden', 'file?x', 'file#x', 'file\0']) {
    await assert.rejects(readSource(dir, name, 100));
  }
  await fs.mkdir(path.join(dir, 'directory'));
  await assert.rejects(readSource(dir, 'directory', 100));
});
test('CAS converges concurrent puts without replacing inode; inventory includes corrupt orphans', async t => {
  const dir = await fixture(t), cas = createCAS(dir);
  const entries = await Promise.all(Array.from({ length: 16 }, () => createCAS(dir).put(Buffer.from('same'))));
  assert.ok(entries.every(e => e.sha256 === entries[0].sha256));
  const file = path.join(dir, 'delivery/objects', entries[0].sha256);
  const before = await fs.stat(file);
  await cas.put(Buffer.from('same'));
  assert.equal((await fs.stat(file)).ino, before.ino);
  const orphan = 'a'.repeat(64);
  await fs.writeFile(path.join(dir, 'delivery/objects', orphan), 'bad');
  assert.deepEqual(await cas.inspect(), { objects: [entries[0], { sha256: orphan, size: 3 }].sort((a,b) => a.sha256.localeCompare(b.sha256)), bytes: 7 });
  await assert.rejects(cas.read({ sha256: orphan, size: 3 }));
  await assert.rejects(cas.read({ ...entries[0], size: 5 }));
  for (const digest of ['../file', 'A'.repeat(64), 'a'.repeat(63)]) await assert.rejects(cas.read({ sha256: digest, size: 4 }));
  assert.deepEqual(await fs.readdir(path.join(dir, 'delivery/staging')), []);
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  for (const name of ['delivery', 'delivery/objects', 'delivery/staging']) assert.equal((await fs.stat(path.join(dir, name))).mode & 0o777, 0o700);
});
test('source and CAS reject symlinks at root, ancestor, parent and leaf', async t => {
  const dir = await fixture(t);
  await fs.mkdir(path.join(dir, 'real'));
  await fs.writeFile(path.join(dir, 'real/file'), 'safe');
  await fs.symlink(path.join(dir, 'real'), path.join(dir, 'alias'));
  await fs.symlink(path.join(dir, 'real/file'), path.join(dir, 'leaf'));
  await assert.rejects(readSource(dir, 'leaf', 100));
  await assert.rejects(readSource(dir, 'alias/file', 100));
  await assert.rejects(readSource(path.join(dir, 'alias'), 'file', 100));
  await fs.mkdir(path.join(dir, 'real/nested'));
  await assert.rejects(createCAS(path.join(dir, 'alias/nested')).put(Buffer.from('x')));
  const cas = createCAS(dir), entry = await cas.put(Buffer.from('safe'));
  const object = path.join(dir, 'delivery/objects', entry.sha256);
  await fs.unlink(object);
  await fs.symlink(path.join(dir, 'real/file'), object);
  await assert.rejects(cas.read(entry));
  await assert.rejects(cas.put(Buffer.from('safe')));
  await assert.rejects(cas.inspect());
  await fs.rename(path.join(dir, 'delivery/objects'), path.join(dir, 'saved'));
  await fs.symlink(path.join(dir, 'saved'), path.join(dir, 'delivery/objects'));
  await assert.rejects(cas.inspect());
  await assert.rejects(cas.put(Buffer.from('other')));
});

// Intercept only the low-level syscall; all files and successful I/O remain real.
function interceptOpen(t, intercept) {
  const open = fs.open;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await open(...args);
    await intercept(handle, ...args);
    return handle;
  });
}
test('source rejects in-place mutation during descriptor read', async t => {
  const dir = await fixture(t), file = path.join(dir, 'file');
  await fs.writeFile(file, 'original');
  interceptOpen(t, async (handle, name) => {
    if (name !== file) return;
    const read = handle.read.bind(handle);
    handle.read = async (...args) => {
      const result = await read(...args);
      await fs.writeFile(file, 'modified');
      return result;
    };
  });
  await assert.rejects(readSource(dir, 'file', 100));
});
test('source stops the bounded descriptor read when an append crosses maxBytes', async t => {
  const dir=await fixture(t),file=path.join(dir,'file');
  await fs.writeFile(file,'1234');
  let reads=0,largestRead=0;
  interceptOpen(t,async(handle,name)=>{
    if(name!==file)return;
    const read=handle.read.bind(handle);
    handle.read=async(...args)=>{
      reads++;largestRead=Math.max(largestRead,args[2]);
      if(reads===1)await fs.appendFile(file,'567890');
      return read(...args);
    };
    // A post-read identity/size check is not the protection exercised here.
    const stat=handle.stat.bind(handle);
    handle.stat=async(...args)=>{if(reads)throw Error('unexpected post-read stat');return stat(...args);};
  });
  await assert.rejects(readSource(dir,'file',4),{message:'Unsafe or changed delivery file'});
  assert.equal(reads,1);assert.equal(largestRead,5);
  assert.equal(await fs.readFile(file,'utf8'),'1234567890');
});
test('put cleanup refuses its replaced owned directory and preserves replacement contents',async t=>{
  const dir=await fixture(t),cas=createCAS(dir);let replacement,saved;
  const link=fs.link;
  t.mock.method(fs,'link',async(source,destination)=>{
    replacement=path.dirname(source);saved=replacement+'-saved';
    await fs.rename(replacement,saved);
    await fs.mkdir(replacement);
    await fs.writeFile(path.join(replacement,'object'),'replacement object');
    await fs.writeFile(path.join(replacement,'keep'),'replacement keep');
    // Link the already-written owned bytes, not the replacement object.
    return link(path.join(saved,'object'),destination);
  });
  await assert.rejects(cas.put(Buffer.from('original')),{message:'Unsafe or changed delivery file'});
  assert.equal(await fs.readFile(path.join(replacement,'object'),'utf8'),'replacement object');
  assert.equal(await fs.readFile(path.join(replacement,'keep'),'utf8'),'replacement keep');
  assert.equal(await fs.readFile(path.join(saved,'object'),'utf8'),'original');
  assert.equal((await cas.read({sha256:sha256('original'),size:8})).toString(),'original');
});
test('source rejects replacement after open without reading the replacement path', async t => {
  const dir = await fixture(t), file = path.join(dir, 'file');
  await fs.writeFile(file, 'original');
  let observed;
  interceptOpen(t, async (handle, name) => {
    if (name !== file) return;
    await fs.rename(file, path.join(dir, 'old'));
    await fs.writeFile(file, 'attacker');
    const read = handle.read.bind(handle);
    handle.read = async (...args) => {
      const result = await read(...args);
      if (result.bytesRead) observed = args[0].subarray(0, result.bytesRead).toString();
      return result;
    };
  });
  await assert.rejects(readSource(dir, 'file', 100));
  assert.ok(observed === undefined || observed === 'original');
});
test('read returns the verified buffer, never reopens the path after verification', async t => {
  const dir = await fixture(t), cas = createCAS(dir), entry = await cas.put(Buffer.from('original'));
  const file = path.join(dir, 'delivery/objects', entry.sha256);
  let opens = 0;
  interceptOpen(t, async (handle, name) => { if (name === file) opens++; });
  const result = await cas.read(entry);
  await fs.writeFile(file, 'modified');
  assert.equal(result.toString(), 'original');
  assert.equal(opens, 1);
  await assert.rejects(cas.read(entry));
});
for (const fault of ['write', 'sync', 'link']) {
  test(`put fails closed on ${fault} failure and cleans only its staging directory`, async t => {
    const dir = await fixture(t), cas = createCAS(dir);
    await cas.put(Buffer.from('existing'));
    const staging = path.join(dir, 'delivery/staging');
    await fs.mkdir(path.join(staging, 'unrelated'));
    await fs.writeFile(path.join(staging, 'unrelated/keep'), 'keep');
    const error = Object.assign(new Error('injected disk failure'), { code: fault === 'write' ? 'ENOSPC' : 'EACCES' });
    if (fault === 'link') t.mock.method(fs, 'link', async () => { throw error; });
    else interceptOpen(t, async (handle, name) => {
      if (!name.startsWith(staging + path.sep)) return;
      handle[fault === 'write' ? 'writeFile' : 'sync'] = async () => { throw error; };
    });
    await assert.rejects(cas.put(Buffer.from('new')), e => e === error);
    assert.deepEqual(await fs.readdir(staging), ['unrelated']);
    assert.equal(await fs.readFile(path.join(staging, 'unrelated/keep'), 'utf8'), 'keep');
    await assert.rejects(fs.stat(path.join(dir, 'delivery/objects', sha256('new'))), { code: 'ENOENT' });
    assert.equal((await cas.read({ sha256: sha256('existing'), size: 8 })).toString(), 'existing');
  });
}
test('source fails closed when an ancestor is replaced during read', async t => {
  const dir = await fixture(t), folder = path.join(dir, 'parent');
  await fs.mkdir(folder);
  await fs.writeFile(path.join(folder, 'file'), 'original');
  let changed = false;
  interceptOpen(t, async (handle, name) => {
    if (name !== path.join(folder, 'file')) return;
    const read = handle.read.bind(handle);
    handle.read = async (...args) => {
      const result = await read(...args);
      if (!changed) {
        changed = true;
        await fs.rename(folder, path.join(dir, 'saved'));
        await fs.symlink(path.join(dir, 'saved'), folder);
      }
      return result;
    };
  });
  await assert.rejects(readSource(dir, 'parent/file', 100));
});
test('cross-device publication fails without fallback or destination creation', async t => {
  const dir = await fixture(t), cas = createCAS(dir);
  t.mock.method(fs, 'link', async () => { throw Object.assign(new Error('cross-device'), { code: 'EXDEV' }); });
  await assert.rejects(cas.put(Buffer.from('new')), { code: 'EXDEV' });
  assert.deepEqual(await cas.inspect(), { objects: [], bytes: 0 });
  assert.deepEqual(await fs.readdir(path.join(dir, 'delivery/staging')), []);
});
test('post-publication directory sync failure rejects but preserves the unreferenced object', async t => {
  const dir = await fixture(t), cas = createCAS(dir);
  interceptOpen(t, async (handle, name) => {
    if (name === path.join(dir, 'delivery/objects')) {
      handle.sync = async () => { throw Object.assign(new Error('disk sync'), { code: 'EIO' }); };
    }
  });
  await assert.rejects(cas.put(Buffer.from('orphan')), { code: 'EIO' });
  const entry = { sha256: sha256('orphan'), size: 6 };
  assert.equal((await cas.read(entry)).toString(), 'orphan');
  assert.deepEqual(await cas.inspect(), { objects: [entry], bytes: 6 });
  assert.deepEqual(await fs.readdir(path.join(dir, 'delivery/staging')), []);
});
test('put snapshots mutable input and supports empty objects; invalid sizes fail closed', async t => {
  const dir = await fixture(t), cas = createCAS(dir);
  const input = Buffer.from('original'), pending = cas.put(input);
  input.fill(0);
  assert.equal((await cas.read(await pending)).toString(), 'original');
  assert.equal((await cas.read(await cas.put(Buffer.alloc(0)))).length, 0);
  for (const size of [-1, 1.2, Infinity, NaN, '1', Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(cas.read({ sha256: sha256('original'), size }));
    await assert.rejects(readSource(dir, 'file', size));
  }
});
test('directory masquerading as CAS object and staging symlinks fail closed', async t => {
  const dir = await fixture(t), cas = createCAS(dir), entry = await cas.put(Buffer.from('x'));
  const object = path.join(dir, 'delivery/objects', entry.sha256);
  await fs.unlink(object);
  await fs.mkdir(object);
  await assert.rejects(cas.read(entry));
  await assert.rejects(cas.put(Buffer.from('x')));
  await assert.rejects(cas.inspect());
  await fs.rename(path.join(dir, 'delivery/staging'), path.join(dir, 'saved'));
  await fs.symlink(path.join(dir, 'saved'), path.join(dir, 'delivery/staging'));
  await assert.rejects(cas.put(Buffer.from('new')));
  assert.deepEqual(await fs.readdir(path.join(dir, 'saved')), []);
});

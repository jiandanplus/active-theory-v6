const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const {readSource} = require('../../admin-server/delivery/cas');
const {sha256} = require('../../admin-server/delivery/contracts');

// Explicit opt-in only. Never enumerate the source or copy private/media files.
async function authorizedRuntimeFixture(t, sourceRoot) {
  assert(sourceRoot && path.isAbsolute(sourceRoot), 'Explicit absolute source root required');
  const profile = require('../../admin-server/engine/registry').get('legacy-six-scenes-v1');
  assert.equal(profile.programs.length, 11);
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'authorized-runtime-'));
  t.after(() => fs.rm(root, {recursive:true, force:true}));
  for (const input of profile.programs) {
    const bytes = await readSource(sourceRoot, input.path, 32 * 1024 * 1024);
    assert.equal(sha256(bytes), input.sha256, `Trusted fixture input: ${input.key}`);
    const target = path.join(root, input.path);
    await fs.mkdir(path.dirname(target), {recursive:true});
    await fs.writeFile(target, bytes, {flag:'wx'});
  }
  return {root, profile};
}

module.exports = {authorizedRuntimeFixture};

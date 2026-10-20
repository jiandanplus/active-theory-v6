const path = require('node:path');
const {readSource} = require('../admin-server/delivery/cas');
const {sha256} = require('../admin-server/delivery/contracts');

async function loadAuthorizedRuntime(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw new Error('Authorized-runtime gate requires explicit absolute AUTHORIZED_RUNTIME_ROOT; sample tests do not verify original-runtime compatibility.');
  }
  const profile = require('../admin-server/engine/registry').get('legacy-six-scenes-v1');
  const files = new Map();
  const mime = {html:'text/html',program:'text/javascript',wasm:'application/wasm',shader:'text/plain'};
  const manifest = {manifestVersion:1,profileId:profile.id,templateId:profile.templateId,
    entryKey:'index',files:[],dependencies:structuredClone(profile.dependencies)};
  // Read only this trusted, closed list. Never scan the supplied directory,
  // require package code, or infer identity from a caller-provided manifest.
  for (const input of profile.programs) {
    let bytes;
    try { bytes = await readSource(root, input.path, 32 * 1024 * 1024); }
    catch { throw new Error(`Authorized-runtime fixed input unavailable or unsafe: ${input.key}`); }
    if (sha256(bytes) !== input.sha256) {
      throw new Error(`Authorized-runtime trusted profile hash mismatch: ${input.key}`);
    }
    files.set(input.key, bytes);
    manifest.files.push({key:input.key,path:input.path,role:input.role,mime:mime[input.role],
      size:bytes.length,sha256:input.sha256});
  }
  return {profile,files,manifest};
}

module.exports = {loadAuthorizedRuntime};

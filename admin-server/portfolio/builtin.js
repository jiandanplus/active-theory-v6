const fs = require('node:fs/promises');
const path = require('node:path');
const profile = require('../engine/profiles/portfolio-v1');
const {sha256} = require('../delivery/contracts');
const root = path.resolve(__dirname,'../..');
async function builtinRuntime() {
  const mime = {html:'text/html',program:'text/javascript',shader:'text/plain'};
  const files = [];
  for (const entry of profile.programs) {
    const bytes = await fs.readFile(path.join(root,entry.path));
    if (sha256(bytes) !== entry.sha256) throw new Error('Built-in runtime identity mismatch');
    files.push({...entry,mime:mime[entry.role],size:bytes.length});
  }
  return {root,manifest:{manifestVersion:1,profileId:profile.id,templateId:profile.templateId,
    entryKey:'index',files,dependencies:structuredClone(profile.dependencies)}};
}
module.exports = {builtinRuntime};

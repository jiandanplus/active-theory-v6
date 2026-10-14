const legacy=require('./profiles/legacy-six-scenes-v1');
const {fail}=require('../security');
const {assertRuntimeManifest,sha256,canonicalJSON}=require('../delivery/contracts');
// This registry is fixed in trusted server code. Packages cannot register profiles.
function get(profileId) {
  if(profileId!==legacy.id)throw fail(422,'不支持的运行配置');
  return legacy;
}
function validateRuntime(manifest,files,profile) {
  assertRuntimeManifest(manifest);
  const bad=()=>fail(422,'运行包不符合受支持配置');
  if(!(files instanceof Map)||files.size!==manifest.files.length||manifest.profileId!==profile.id
    ||manifest.templateId!==profile.templateId||manifest.entryKey!=='index'
    ||manifest.files.length!==profile.programs.length)throw bad();
  let totalBytes=0;
  for(const expected of profile.programs){
    const entry=manifest.files.find(f=>f.key===expected.key),bytes=files.get(expected.key);
    if(!entry||entry.path!==expected.path||entry.role!==expected.role||!Buffer.isBuffer(bytes)
      ||bytes.length!==entry.size||sha256(bytes)!==entry.sha256
      ||(expected.sha256&&expected.sha256!==entry.sha256))throw bad();
    totalBytes+=bytes.length;
  }
  const edges=values=>values.map(canonicalJSON).sort();
  if(canonicalJSON(edges(manifest.dependencies))!==canonicalJSON(edges(profile.dependencies)))throw bad();
  const patches=profile.validateSources(files);
  return {patches,files:files.size,totalBytes};
}
module.exports=Object.freeze({get,validateRuntime});

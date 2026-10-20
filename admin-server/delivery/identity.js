const fs=require('node:fs/promises');
const path=require('node:path');
const {digestJSON,sha256}=require('./contracts');
// Explicit, reviewed trusted-source closure. Never scan candidate roots or mtimes.
const ADAPTER_SOURCES=Object.freeze([
  'admin-server/delivery/builder.js','admin-server/delivery/cas.js','admin-server/delivery/contracts.js',
  'admin-server/delivery/identity.js','admin-server/delivery/projection.js','admin-server/delivery/registration.js',
  'admin-server/engine/legacy-adapter.js','admin-server/engine/patches.js',
  'admin-server/engine/profiles/legacy-six-scenes-v1.js','admin-server/engine/program-paths.js',
  'admin-server/engine/registry.js','admin-server/engine/render.js','admin-server/page-metadata.js',
  'admin-server/snapshots.js','shared/page-metadata-dom.js','shared/site-identity.js',
  'admin-server/engine/profiles/portfolio-v1.js','admin-server/portfolio/render.js','admin-server/portfolio/styles.js',
].sort());
async function captureAdapterIdentity(){
  const sources=new Map();
  for(const name of ADAPTER_SOURCES){
    sources.set(name,await fs.readFile(path.join(__dirname,'../..',name)));
  }
  const digest=digestJSON(ADAPTER_SOURCES.map(name=>({path:name,sha256:sha256(sources.get(name))})));
  return {sources,digest};
}
function projectionDigest(snapshot,profile){
  return digestJSON({profileId:profile.id,templateId:profile.templateId,policy:profile.policy,snapshot});
}
module.exports={ADAPTER_SOURCES,captureAdapterIdentity,projectionDigest};

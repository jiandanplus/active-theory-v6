const {installationStatus}=require('../installation');
const {resolveVersion}=require('../frontend-resources');
const {deliveryRepository}=require('../repositories/deliveries');
const {digestJSON}=require('./contracts');
const {fail}=require('../security');
const unavailable=()=>fail(503,'缺少前台运行资源或交付不可用，请由管理员检查交付状态');

// Historical reads depend only on persisted identities, trusted origin and CAS.
async function resolveDelivery({store,cas,options,version,preview,admin}) {
  const state=await installationStatus(store);
  if(state.state!=='installed')throw unavailable();
  const {id,snapshot}=await resolveVersion(store,{version,preview,admin});
  const target={type:id.startsWith('preview-')?'preview':'version',id};
  try {
    const repo=deliveryRepository(store);
    const binding=await repo.getBinding(target);
    if(!binding?.artifactDigest)throw unavailable();
    const artifact=await repo.getArtifact(binding.artifactDigest);
    // Repository validates manifest/hash/runtime/target/source/frozen grants;
    // also compare the authorized snapshot, not just a later reread.
    if(!artifact||artifact.manifest.sourceSnapshotDigest!==digestJSON(snapshot)
      ||artifact.manifest.origin!==options.origin)throw unavailable();
    return {target,snapshot,binding,manifest:artifact.manifest};
  } catch { throw unavailable(); }
}

async function readDeliveryFile(resolved,lookup,cas) {
  const selectors=['endpoint','runtimeKey','pagePath','resourceId'];
  const supplied=Object.keys(lookup);
  if(supplied.length!==1||!selectors.includes(supplied[0])||typeof lookup[supplied[0]]!=='string')
    throw fail(400,'交付文件选择无效');
  const selector=supplied[0],value=lookup[selector],manifest=resolved.manifest;
  const mapping=manifest[{endpoint:'endpoints',runtimeKey:'runtime',pagePath:'routes',resourceId:'documents'}[selector]];
  if(!Object.hasOwn(mapping,value))throw fail(404,'资源不存在');
  const entry=manifest.files.find(file=>file.key===mapping[value]);
  if(!entry||(selector==='runtimeKey'&&!['program','stylesheet','wasm'].includes(entry.role))
    ||(entry.role==='resource-document'&&selector!=='resourceId'))throw unavailable();
  let bytes;
  try { bytes=await cas.read(entry); } catch { throw unavailable(); }
  const cacheKind=manifest.kind==='pinned'&&['program','stylesheet','wasm','shader'].includes(entry.role)
    ?'pinned-program':'no-store';
  return {entry,bytes,cacheKind};
}
module.exports={resolveDelivery,readDeliveryFile};

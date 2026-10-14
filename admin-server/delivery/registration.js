const {fail}=require('../security');
const {assertRuntimeManifest,canonicalJSON,digestJSON,sha256}=require('./contracts');
const {readSource}=require('./cas');
const trustedRegistry=require('../engine/registry');
const {runtimeRepository}=require('../repositories/runtime');
const {auditRepository}=require('../repositories/audit');
function actorName(actor) {
  if(typeof actor!=='string'||!actor||actor.length>64||/[\x00-\x1f\x7f]/.test(actor))throw fail(400,'审计用户名无效');
  return actor;
}
function acceptedProfile(manifest,registry) {
  const profile=registry.get(manifest.profileId),bad=()=>fail(422,'运行包不符合受支持配置');
  if(manifest.profileId!==profile.id||manifest.templateId!==profile.templateId||manifest.entryKey!=='index'
    ||manifest.files.length!==profile.programs.length)throw bad();
  for(const expected of profile.programs) {
    const entry=manifest.files.find(file=>file.key===expected.key);
    if(!entry||entry.path!==expected.path||entry.role!==expected.role||(expected.sha256&&entry.sha256!==expected.sha256))throw bad();
  }
  const edges=values=>canonicalJSON(values.map(canonicalJSON).sort());
  if(edges(manifest.dependencies)!==edges(profile.dependencies))throw bad();
  return profile;
}
async function registerRuntime({store,cas,root,manifest,registry=trustedRegistry,actor}) {
  assertRuntimeManifest(manifest);
  // Own the declared identity before the first asynchronous operation.
  manifest=JSON.parse(canonicalJSON(manifest));
  actor=actorName(actor);
  const profile=acceptedProfile(manifest,registry),files=new Map();
  for(const entry of manifest.files) {
    const bytes=await readSource(root,entry.path,entry.size);
    if(bytes.length!==entry.size||sha256(bytes)!==entry.sha256)throw fail(422,'运行包文件校验失败');
    files.set(entry.key,bytes);
  }
  const report=trustedRegistry.validateRuntime(manifest,files,profile);
  const digest=digestJSON(manifest);
  // No CAS or database writes before all sources, closure and patches pass.
  for(const entry of manifest.files) {
    const stored=await cas.put(files.get(entry.key));
    if(stored.sha256!==entry.sha256||stored.size!==entry.size)throw fail(422,'运行包文件保存校验失败');
  }
  await store.transaction(async tx=>{
    const {inserted}=await runtimeRepository(tx).insertBundle({digest,manifest});
    if(inserted)await auditRepository(tx).append('runtime.register',actor);
  });
  return {digest,profileId:manifest.profileId,files:report.files,bytes:report.totalBytes};
}
async function selectRuntime({store,cas,registry=trustedRegistry,digest,expectedGeneration,actor}) {
  if(typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest)
    ||!Number.isSafeInteger(expectedGeneration)||expectedGeneration<0)throw fail(400,'运行包选择参数无效');
  actor=actorName(actor);
  const registered=await runtimeRepository(store).getBundle(digest);
  if(!registered)throw fail(404,'运行包不存在');
  const manifest=registered.manifest;
  assertRuntimeManifest(manifest);
  if(digestJSON(manifest)!==digest||registered.profileId!==manifest.profileId)throw fail(422,'运行包登记校验失败');
  const profile=acceptedProfile(manifest,registry),files=new Map();
  for(const entry of manifest.files)files.set(entry.key,await cas.read(entry));
  trustedRegistry.validateRuntime(manifest,files,profile);
  return store.transaction(async tx=>{
    const site=await tx.query('SELECT id FROM personal_site.site_settings WHERE id=true FOR UPDATE');
    if(!site.rowCount)throw fail(404,'网站不存在');
    const repo=runtimeRepository(tx),current=await repo.getSelection({lock:true});
    const selected=await repo.select({digest,expectedGeneration});
    if(selected.generation!==current.generation)await auditRepository(tx).append('runtime.select',actor);
    return selected;
  });
}
module.exports={registerRuntime,selectRuntime};

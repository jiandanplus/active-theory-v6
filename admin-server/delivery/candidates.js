const {randomUUID}=require('node:crypto');
const {fail}=require('../security');
const {contentRepository}=require('../repositories/content');
const {runtimeRepository}=require('../repositories/runtime');
const {authRepository}=require('../repositories/auth');
const {validatePublication}=require('../publication');
const {canonicalJSON,digestJSON,assertRuntimeManifest,assertArtifactManifest,normalizeReferences}=require('./contracts');
const {projectSnapshot}=require('./projection');
const {captureAdapterIdentity,projectionDigest}=require('./identity');
const {validateRuntime}=require('../engine/registry');

function assertActor(actor){
  if(!actor||typeof actor.id!=='string'||!/^[a-f0-9]{64}$/.test(actor.id)||typeof actor.username!=='string'||!actor.username)throw fail(401,'登录已失效');
}
function freeze(value){
  if(value&&typeof value==='object'&&!Object.isFrozen(value)){
    for(const item of Object.values(value))freeze(item);
    Object.freeze(value);
  }
  return value;
}
async function prepareDraftCandidate({store,options,registry,cas,revision,actor,targetType='version'}){
  assertActor(actor);
  options={root:options.root,dataDir:options.dataDir,origin:options.origin};
  if(!Number.isSafeInteger(revision)||revision<0)throw fail(400,'配置版本无效');
  if(!['version','preview'].includes(targetType))throw fail(400,'交付目标无效');
  const captured=await store.transaction(async tx=>{
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const repo=contentRepository(tx),draft=await repo.getDraft();
    if(!draft||draft.revision!==revision)throw fail(409,'配置版本冲突，请刷新后重新编辑');
    const template=await repo.getTemplate(),selection=await runtimeRepository(tx).getSelection();
    if(!selection.digest)throw fail(422,'请先选择运行包');
    const bundle=await runtimeRepository(tx).getBundle(selection.digest);
    if(!bundle)throw fail(422,'运行包不存在');
    return {source:draft.snapshot,draftRevision:draft.revision,template,selection,bundle};
  });
  const target={type:targetType,id:targetType==='version'?String(await contentRepository(store).reserveVersionId()):'preview-'+randomUUID()};
  const {source,draftRevision,template,selection,bundle}=captured;
  assertRuntimeManifest(bundle.manifest);
  if(digestJSON(bundle.manifest)!==selection.digest||bundle.profileId!==bundle.manifest.profileId)throw fail(422,'运行包登记校验失败');
  const selectedProfile=registry.get(bundle.profileId);
  // Functions are trusted code; own all serializable profile policy/closure inputs.
  const profile={};
  for(const [key,value] of Object.entries(selectedProfile))profile[key]=typeof value==='function'?value:structuredClone(value);
  freeze(profile);
  const runtimeFiles=new Map();
  for(const entry of bundle.manifest.files)runtimeFiles.set(entry.key,await cas.read(entry));
  validateRuntime(bundle.manifest,runtimeFiles,profile);
  profile.validateSnapshot(source);
  require('../config').validateConfig(source.config,template.schema);
  const projected=projectSnapshot(source,target,profile,{runtimeFiles});
  const context={references:projected.references,geometryIds:projected.geometryIds,policy:profile.policy};
  const warnings=await validatePublication(store,options,projected.snapshot,context);
  const adapter=await captureAdapterIdentity();
  return freeze({target,source,draftRevision,selection,bundle,profile,origin:options.origin,
    references:projected.references,geometryIds:projected.geometryIds,
    projectionDigest:projectionDigest(projected.snapshot,profile),adapterDigest:adapter.digest,warnings,
    // Retain the captured projection for final fixed-reference checks, never recompose.
    projectedSnapshot:projected.snapshot});
}
function assertArtifactMatchesCandidate(artifact,candidate,kind){
  assertArtifactManifest(artifact.manifest);
  const m=artifact.manifest,expected={
    kind,target:candidate.target,origin:candidate.origin,
    runtimeDigest:candidate.selection.digest,selectionGeneration:candidate.selection.generation,
    profileId:candidate.profile.id,templateId:candidate.profile.templateId,
    sourceSnapshotDigest:digestJSON(candidate.source),projectionDigest:candidate.projectionDigest,
    adapterDigest:candidate.adapterDigest,referencesDigest:digestJSON(normalizeReferences(candidate.references)),
  };
  for(const [key,value] of Object.entries(expected)){
    if(canonicalJSON(m[key])!==canonicalJSON(value))throw fail(422,'交付与构建候选不一致');
  }
  if(digestJSON(m)!==artifact.digest||digestJSON(normalizeReferences(artifact.references))!==expected.referencesDigest)throw fail(422,'交付摘要不一致');
}
async function recheckCandidate(tx,candidate,actor,options){
  // Standalone site lock, then a fresh aggregate read (not a waiting subquery).
  const current=await contentRepository(tx).getDraft({lock:true});
  if(!current||current.revision!==candidate.draftRevision||digestJSON(current.snapshot)!==digestJSON(candidate.source))throw fail(409,'配置版本冲突，请刷新后重新编辑');
  const selection=await runtimeRepository(tx).getSelection();
  if(canonicalJSON(selection)!==canonicalJSON(candidate.selection))throw fail(409,'运行包选择已变化，请刷新');
  const ids=[...new Set(candidate.references.map(ref=>ref.resourceId))].sort();
  await tx.query('SELECT id FROM personal_site.resources WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',[ids]);
  await validatePublication(tx,options,candidate.projectedSnapshot,{
    references:candidate.references,geometryIds:candidate.geometryIds,policy:candidate.profile.policy,
  });
  await authRepository(tx).lockValidSession(actor,Date.now());
  if(candidate.origin!==options.origin)throw fail(422,'交付来源不一致');
}
module.exports={prepareDraftCandidate,assertArtifactMatchesCandidate,recheckCandidate,assertActor};

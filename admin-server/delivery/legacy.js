const {fail}=require('../security');
const {contentRepository}=require('../repositories/content');
const {deliveryRepository}=require('../repositories/deliveries');
const {runtimeRepository}=require('../repositories/runtime');
const {auditRepository}=require('../repositories/audit');
const {canonicalJSON,digestJSON}=require('./contracts');
const {assertActor,prepareCapturedCandidate,assertArtifactMatchesCandidate,recheckCandidateResources}=require('./candidates');

function assertUnbound(binding,expectedGeneration){
  if(!binding||binding.mode!=='legacy'||binding.artifactDigest!==null||binding.generation!==expectedGeneration)
    throw fail(409,'此版本已生成交付或状态已变化');
}
async function legacy({store,options,registry,cas,build,versionId,expectedGeneration,actor}){
  actor=actor&&{id:actor.id,username:actor.username};
  assertActor(actor);
  if(!Number.isSafeInteger(versionId)||versionId<1||!Number.isSafeInteger(expectedGeneration)||expectedGeneration<0)
    throw fail(400,'旧版交付参数无效');
  const target={type:'version',id:String(versionId)};
  const captured=await store.transaction(async tx=>{
    await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const deliveries=deliveryRepository(tx),version=await contentRepository(tx).getVersion(versionId);
    if(!version)throw fail(404,'版本不存在');
    assertUnbound(await deliveries.getBinding(target),expectedGeneration);
    const references=await deliveries.references(target),runtime=runtimeRepository(tx),selection=await runtime.getSelection();
    if(!selection.digest)throw fail(422,'请先选择运行包');
    const bundle=await runtime.getBundle(selection.digest);
    if(!bundle)throw fail(422,'运行包不存在');
    return {source:version.snapshot,selection,bundle,referenceCeiling:references};
  });
  const candidate=await prepareCapturedCandidate({store,options,registry,cas,captured,target,referenceCeiling:captured.referenceCeiling});
  const artifact=JSON.parse(canonicalJSON(await build({...candidate,cas,kind:'legacy-render'})));
  assertArtifactMatchesCandidate(artifact,candidate,'legacy-render');
  return store.transaction(async tx=>{
    // Serialize with selection/resource mutations without reading or composing draft.
    await tx.query('SELECT id FROM personal_site.site_settings WHERE id=true FOR UPDATE');
    const deliveries=deliveryRepository(tx);
    assertUnbound(await deliveries.getBinding(target,{lock:true}),expectedGeneration);
    const selection=await runtimeRepository(tx).getSelection();
    if(canonicalJSON(selection)!==canonicalJSON(candidate.selection))throw fail(409,'运行包选择已变化，请刷新');
    const current=await contentRepository(tx).getVersion(versionId),references=await deliveries.references(target);
    if(!current||digestJSON(current.snapshot)!==digestJSON(candidate.source)||digestJSON(references)!==digestJSON(candidate.references))
      throw fail(409,'历史版本或引用已变化');
    await recheckCandidateResources(tx,candidate,actor,options);
    await deliveries.putArtifact(artifact);
    await deliveries.bindLegacyOnce(target,artifact.digest,expectedGeneration);
    await auditRepository(tx).append('delivery.legacy',actor.username);
    return {version:versionId,artifactDigest:artifact.digest};
  });
}
module.exports={legacy};

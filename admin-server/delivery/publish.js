const {prepareDraftCandidate,assertArtifactMatchesCandidate,recheckCandidate}=require('./candidates');
const {canonicalJSON}=require('./contracts');
const {contentRepository}=require('../repositories/content');
const {deliveryRepository}=require('../repositories/deliveries');
const {auditRepository}=require('../repositories/audit');
async function publish({store,options,registry,cas,build,revision,actor,withWarnings=false}){
  // Own the authenticated identity before the long build can yield.
  actor=actor&&{id:actor.id,username:actor.username};
  const candidate=await prepareDraftCandidate({store,options,registry,cas,revision,actor,targetType:'version'});
  const built=await build({...candidate,cas,kind:'pinned'});
  // Own builder output before validation and final database awaits.
  const artifact=JSON.parse(canonicalJSON(built));
  assertArtifactMatchesCandidate(artifact,candidate,'pinned');
  const id=await store.transaction(async tx=>{
    await recheckCandidate(tx,candidate,actor,options);
    const repo=contentRepository(tx),deliveries=deliveryRepository(tx);
    const version=await repo.insertReservedVersion({id:Number(candidate.target.id),snapshot:candidate.source,references:artifact.references});
    await deliveries.putArtifact(artifact);
    await deliveries.bindPinned(candidate.target,artifact.digest);
    await repo.setPublished(version.id);
    await auditRepository(tx).append('config.publish',actor.username);
    return version.id;
  });
  return withWarnings?{version:id,warnings:candidate.warnings}:id;
}
module.exports={publish};

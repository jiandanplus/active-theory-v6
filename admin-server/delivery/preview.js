const {prepareDraftCandidate,assertArtifactMatchesCandidate,recheckCandidate}=require('./candidates');
const {canonicalJSON}=require('./contracts');
const {contentRepository}=require('../repositories/content');
const {deliveryRepository}=require('../repositories/deliveries');
const {auditRepository}=require('../repositories/audit');

async function preview({store,options,registry,cas,build,revision,actor}){
  actor=actor&&{id:actor.id,username:actor.username};
  const candidate=await prepareDraftCandidate({store,options,registry,cas,revision,actor,targetType:'preview'});
  const built=await build({...candidate,cas,kind:'pinned'});
  const artifact=JSON.parse(canonicalJSON(built));
  assertArtifactMatchesCandidate(artifact,candidate,'pinned');
  return store.transaction(async tx=>{
    await recheckCandidate(tx,candidate,actor,options);
    const repo=contentRepository(tx),deliveries=deliveryRepository(tx);
    // Build and every potentially waiting authorization check have finished.
    const now=Date.now();
    await repo.prunePreviews(new Date(now));
    await repo.insertPreview({id:candidate.target.id,owner:actor.username,
      expires:new Date(now+30*60000),snapshot:candidate.source,references:artifact.references});
    await deliveries.putArtifact(artifact);
    await deliveries.bindPinned(candidate.target,artifact.digest);
    const excess=(await tx.query(
      'SELECT id FROM personal_site.previews WHERE owner=$1 ORDER BY expires DESC,id DESC OFFSET 5',
      [actor.username],
    )).rows.map(row=>row.id);
    await tx.query("DELETE FROM personal_site.resource_references WHERE owner_type='preview' AND owner_id=ANY($1::text[])",[excess]);
    await tx.query('DELETE FROM personal_site.previews WHERE id=ANY($1::text[])',[excess]);
    await auditRepository(tx).append('config.preview',actor.username);
    return candidate.target.id;
  });
}
module.exports={preview};

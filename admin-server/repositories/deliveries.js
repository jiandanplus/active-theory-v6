const {fail}=require('../security');
const {toSafeInteger}=require('../postgres');
const {canonicalJSON,digestJSON,assertArtifactManifest,assertRuntimeManifest}=require('../delivery/contracts');
const {resourceRepository}=require('./resources');
const validDigest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
function targetValue(target) {
  if(!target||Object.keys(target).length!==2||typeof target.id!=='string'||(target.type==='version'
    ? !/^[1-9][0-9]*$/.test(target.id)||!Number.isSafeInteger(Number(target.id))
    : target.type!=='preview'||!/^preview-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(target.id)))throw fail(400,'交付目标无效');
  return {type:target.type,id:target.id};
}
const mismatch=()=>fail(409,'交付身份不一致');
// Caller owns the transaction spanning content, references, artifact and binding.
function deliveryRepository(db) {
  const resources=resourceRepository(db);
  async function checkRuntime(manifest) {
    const row=(await db.query('SELECT * FROM personal_site.runtime_bundles WHERE digest=$1',[manifest.runtimeDigest])).rows[0];
    if(!row)throw mismatch();
    assertRuntimeManifest(row.manifest);
    if(digestJSON(row.manifest)!==row.digest||row.profile_id!==row.manifest.profileId||row.profile_id!==manifest.profileId||row.manifest.templateId!==manifest.templateId)throw mismatch();
  }
  async function checkTarget(target,artifact,kind) {
    if(!artifact||artifact.kind!==kind||canonicalJSON(artifact.manifest.target)!==canonicalJSON(target))throw mismatch();
    const table=target.type==='version'?'versions':'previews';
    const row=(await db.query(`SELECT snapshot FROM personal_site.${table} WHERE id=$1`,[target.id])).rows[0];
    if(!row||digestJSON(row.snapshot)!==artifact.manifest.sourceSnapshotDigest||digestJSON(await repo.references(target))!==artifact.manifest.referencesDigest)throw mismatch();
  }
  const repo={
    async references(target) {
      target=targetValue(target);
      return resources.referencesForOwner({ownerType:target.type,ownerId:target.id});
    },
    async getArtifact(digest) {
      if(!validDigest(digest))throw fail(400,'交付标识无效');
      const row=(await db.query('SELECT * FROM personal_site.delivery_artifacts WHERE digest=$1',[digest])).rows[0];
      if(!row)return null;
      assertArtifactManifest(row.manifest);
      if(digestJSON(row.manifest)!==row.digest||row.runtime_digest!==row.manifest.runtimeDigest||row.kind!==row.manifest.kind)throw mismatch();
      await checkRuntime(row.manifest);
      return {digest:row.digest,manifest:row.manifest,runtimeDigest:row.runtime_digest,kind:row.kind,createdAt:row.created_at.toISOString()};
    },
    async putArtifact({digest,manifest}) {
      assertArtifactManifest(manifest);
      const canonical=canonicalJSON(manifest),owned=JSON.parse(canonical);
      if(!validDigest(digest)||digestJSON(owned)!==digest)throw mismatch();
      await checkRuntime(owned);
      await db.query('INSERT INTO personal_site.delivery_artifacts(digest,runtime_digest,kind,manifest) VALUES($1,$2,$3,$4) ON CONFLICT(digest) DO NOTHING',[digest,owned.runtimeDigest,owned.kind,canonical]);
      const current=await repo.getArtifact(digest);
      if(!current||canonicalJSON(current.manifest)!==canonical)throw mismatch();
      return current;
    },
    async getBinding(target,{lock=false}={}) {
      target=targetValue(target);
      const column=target.type==='version'?'version_id':'preview_id';
      const row=(await db.query(`SELECT * FROM personal_site.delivery_bindings WHERE ${column}=$1${lock?' FOR UPDATE':''}`,[target.id])).rows[0];
      if(!row)return null;
      if(row.artifact_digest)await checkTarget(target,await repo.getArtifact(row.artifact_digest),row.mode==='pinned'?'pinned':'legacy-render');
      else if(row.mode!=='legacy')throw mismatch();
      return {target,mode:row.mode,artifactDigest:row.artifact_digest,generation:toSafeInteger(row.generation)};
    },
    async bindPinned(target,digest) {
      target=targetValue(target);
      await db.query('SELECT id FROM personal_site.site_settings WHERE id=true FOR UPDATE');
      await checkTarget(target,await repo.getArtifact(digest),'pinned');
      const column=target.type==='version'?'version_id':'preview_id';
      await db.query(`INSERT INTO personal_site.delivery_bindings(${column},mode,artifact_digest) VALUES($1,'pinned',$2)`,[target.id,digest]);
      return repo.getBinding(target);
    },
    async bindLegacyOnce(target,digest,expectedGeneration) {
      target=targetValue(target);
      if(target.type!=='version'||!Number.isSafeInteger(expectedGeneration)||expectedGeneration<0)throw fail(400,'旧版交付绑定参数无效');
      await db.query('SELECT id FROM personal_site.site_settings WHERE id=true FOR UPDATE');
      await checkTarget(target,await repo.getArtifact(digest),'legacy-render');
      const r=await db.query("UPDATE personal_site.delivery_bindings SET artifact_digest=$1,generation=generation+1 WHERE version_id=$2 AND mode='legacy' AND artifact_digest IS NULL AND generation=$3 RETURNING id",[digest,target.id,expectedGeneration]);
      if(r.rowCount!==1)throw fail(409,'旧版交付已绑定或发生变化');
      return repo.getBinding(target);
    },
    async summaries(versionIds) {
      if(!Array.isArray(versionIds))throw fail(400,'版本编号无效');
      const result=[];
      for(const id of versionIds){const binding=await repo.getBinding({type:'version',id:String(id)});if(binding)result.push(binding);}
      return result;
    },
  };
  return repo;
}
module.exports={deliveryRepository};

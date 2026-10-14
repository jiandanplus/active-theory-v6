const {fail}=require('../security');
const {canonicalJSON,assertRuntimeManifest}=require('../delivery/contracts');
const {toSafeInteger}=require('../postgres');
const validDigest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const validGeneration=value=>Number.isSafeInteger(value)&&value>=0;
const selection=row=>({digest:row.runtime_digest,generation:toSafeInteger(row.generation)});
const bundle=row=>row?{digest:row.digest,profileId:row.profile_id,manifest:row.manifest,registeredAt:row.registered_at.toISOString()}:null;
function runtimeRepository(db) {
  const repo={
    async insertBundle({digest,manifest}) {
      if(!validDigest(digest))throw fail(400,'运行包标识无效');
      assertRuntimeManifest(manifest);
      const canonical=canonicalJSON(manifest),owned=JSON.parse(canonical);
      const result=await db.query(`INSERT INTO personal_site.runtime_bundles(digest,profile_id,manifest)
        VALUES($1,$2,$3) ON CONFLICT(digest) DO NOTHING RETURNING digest`,[digest,owned.profileId,canonical]);
      const current=await repo.getBundle(digest);
      if(!current||current.profileId!==owned.profileId||canonicalJSON(current.manifest)!==canonical)
        throw fail(409,'运行包登记内容冲突');
      return {bundle:current,inserted:result.rowCount===1};
    },
    async getBundle(digest) {
      if(!validDigest(digest))throw fail(400,'运行包标识无效');
      return bundle((await db.query('SELECT * FROM personal_site.runtime_bundles WHERE digest=$1',[digest])).rows[0]);
    },
    async listBundles() {
      return (await db.query('SELECT * FROM personal_site.runtime_bundles ORDER BY digest')).rows.map(bundle);
    },
    async getSelection({lock=false}={}) {
      const row=(await db.query(`SELECT runtime_digest,generation FROM personal_site.runtime_selection WHERE id=true${lock?' FOR UPDATE':''}`)).rows[0];
      if(!row)throw fail(503,'运行包选择不可用');
      return selection(row);
    },
    async select({digest,expectedGeneration}) {
      if(!validDigest(digest)||!validGeneration(expectedGeneration))throw fail(400,'运行包选择参数无效');
      const current=await repo.getSelection({lock:true});
      if(current.generation!==expectedGeneration)throw fail(409,'运行包选择已变化，请刷新');
      if(current.digest===digest)return current;
      const result=await db.query(`UPDATE personal_site.runtime_selection SET runtime_digest=$1,generation=generation+1
        WHERE id=true AND generation=$2 RETURNING runtime_digest,generation`,[digest,expectedGeneration]);
      if(!result.rowCount)throw fail(409,'运行包选择已变化，请刷新');
      return selection(result.rows[0]);
    },
  };
  return repo;
}
module.exports={runtimeRepository};

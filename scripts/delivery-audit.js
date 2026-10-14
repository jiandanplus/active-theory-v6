#!/usr/bin/env node
const {createCAS}=require('../admin-server/delivery/cas');
const {assertRuntimeManifest,assertArtifactManifest,digestJSON}=require('../admin-server/delivery/contracts');
const {runtimeRepository}=require('../admin-server/repositories/runtime');
const {inspectInstallation}=require('../admin-server/migrations');
const incomplete=()=>new Error('Delivery audit could not complete safely');
const MAX_OBJECT_BYTES=256*1024*1024;

// Diagnostic only: the DB snapshot and filesystem cannot form an atomic GC
// eligibility decision. All registered manifests survive binding expiry.
async function auditDelivery({store,cas}) {
  try {
    const references=await store.transaction(async tx=>{
      await tx.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const entries=new Map(),bundles=new Map();
      function retain(files){
        for(const file of files){
          if(entries.has(file.sha256)&&entries.get(file.sha256)!==file.size)throw incomplete();
          entries.set(file.sha256,file.size);
        }
      }
      for(const bundle of await runtimeRepository(tx).listBundles()){
        assertRuntimeManifest(bundle.manifest);
        if(digestJSON(bundle.manifest)!==bundle.digest||bundle.profileId!==bundle.manifest.profileId)throw incomplete();
        bundles.set(bundle.digest,bundle.manifest);retain(bundle.manifest.files);
      }
      // Deliberately not joined to bindings, previews, or current publication.
      for(const row of (await tx.query('SELECT digest,runtime_digest,kind,manifest FROM personal_site.delivery_artifacts ORDER BY digest')).rows){
        const m=row.manifest;assertArtifactManifest(m);
        const runtime=bundles.get(m.runtimeDigest);
        if(digestJSON(m)!==row.digest||row.runtime_digest!==m.runtimeDigest||row.kind!==m.kind
          ||!runtime||runtime.profileId!==m.profileId||runtime.templateId!==m.templateId)throw incomplete();
        retain(m.files);
      }
      return entries;
    });
    const inventory=await cas.inspect({readOnly:true});
    const present=new Set(inventory.objects.map(e=>e.sha256));
    const invalidObjects=[];let referencedObjectCount=0;
    // Sequential, bounded reads verify orphans too. Never allocate a buffer
    // based on an unbounded filesystem-reported size.
    for(const entry of inventory.objects){
      if(entry.size>MAX_OBJECT_BYTES)throw incomplete();
      if(references.has(entry.sha256))referencedObjectCount++;
      let invalid=references.has(entry.sha256)&&references.get(entry.sha256)!==entry.size;
      try {await cas.read(entry);}
      catch(error){if(error.code!=='DELIVERY_INTEGRITY')throw incomplete();invalid=true;}
      if(invalid)invalidObjects.push(entry.sha256);
    }
    return {objectCount:present.size,totalBytes:inventory.bytes,referencedObjectCount,
      unreferencedObjectCount:present.size-referencedObjectCount,
      missingObjects:[...references.keys()].filter(digest=>!present.has(digest)).sort(),invalidObjects:invalidObjects.sort()};
  } catch {throw incomplete();}
}
async function main(argv=process.argv.slice(2),{
  loadOptions=require('../admin-server/options').loadOptions,
  openPostgres=require('../admin-server/postgres').openPostgres,
}={}){
  if(argv.length)throw incomplete();
  const options=loadOptions();if(!options.databaseUrl)throw incomplete();
  const store=openPostgres({databaseUrl:options.databaseUrl});
  try {
    const state=await inspectInstallation(store);
    if(state.state!=='installed'||state.schemaVersion!==3)throw incomplete();
    const report=await auditDelivery({store,cas:createCAS(options.dataDir)});
    console.log(JSON.stringify(report));
    if(report.missingObjects.length||report.invalidObjects.length)throw incomplete();
    return report;
  } finally {await store.close();}
}
if(require.main===module)main().catch(()=>{
  console.error('Delivery audit failed; no objects were modified. Check configuration and integrity.');
  process.exitCode=1;
});
module.exports={auditDelivery,main};

// Frozen schema-001 data: never derive history or references from production code.
const created = '2026-01-01T00:00:00.000Z';
function legacyBundle() {
  const config = {
    site:{title:'Fixture',email:'test@example.test',emailLink:'test@example.test',navWork:'Work',navContact:'Contact',contactTitle:'Contact',cityLax:'LA',cityNyc:'NY',cityAms:'AMS',labUrl:''},
    projects:[{id:'p1',slug:'one',name:'One',tags:'test',video:{url:'/media/image',thumbnail:'/media/image'},projectLogo:{url:'/media/image'},completionDate:'2026-01-01'}],
    scenes:[{id:'Home',label:'Home',fields:[{key:'image',type:'resource',value:'/media/image'}]}],
    songs:[{id:'song1',title:'Song',src:'/media/audio'}],
  };
  const template = {baseUIL:{font:{src:'assets/font.png'}},contact:{email:'test@example.test'},metadata:{title:'Fixture'},fontCoverage:{letters:'abc'},readiness:{ready:true}};
  const assets = Object.fromEntries([['image','image.png'],['audio','song.mp3'],['font','assets/font.png'],['unused','unused.png']].map(([id,fileName])=>[id,{resourceId:id,fileName}]));
  const draft = {format:2,config,template,assets,legacyMap:{'assets/font.png':'font'}};
  return {draft,schema:structuredClone(config),revision:3,published:42,defaultStorage:'local',
    versions:[42,43].map(id=>({id,created,snapshot:structuredClone(draft)})),
    admin:{username:'admin',hash:'fixture-hash'},
    storages:[{id:'local',type:'local',name:'Local'},{id:'fixture-cloud',type:'s3',name:'Fake credentials preservation',credentials:{iv:'fixture-not-a-key',tag:'fixture-not-a-key',ciphertext:'fixture-not-a-key'}}],
    resources:['image','audio','font','unused'].map(id=>({id,source:'bundled',url:`/media/${id}`,name:id,kind:id==='audio'?'audio':'image',size:1,status:'ready',created,details:{}})),
    audit:[{created,action:'fixture.import',actor:'admin'}]};
}
async function seedLegacy(tx,bundle) {
  await tx.query("INSERT INTO personal_site.admins(id,username,hash) VALUES(true,'admin','fixture-hash')");
  for(const storage of bundle.storages) await tx.query('INSERT INTO personal_site.storages(id,type,config,credentials,available) VALUES($1,$2,$3,$4,true)',[storage.id,storage.type,{name:storage.name},storage.credentials?JSON.stringify(storage.credentials):null]);
  const {template,assets,legacyMap} = bundle.draft;
  await tx.query("INSERT INTO personal_site.templates(id,schema_config,content) VALUES('default',$1,$2)",[bundle.schema,{template,assets,legacyMap}]);
  for(const v of bundle.versions) await tx.query('INSERT INTO personal_site.versions(id,created,snapshot) VALUES($1,$2,$3)',[v.id,v.created,v.snapshot]);
  for(const r of bundle.resources) await tx.query('INSERT INTO personal_site.resources(id,source,url,name,kind,size,status,created,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[r.id,r.source,r.url,r.name,r.kind,r.size,r.status,r.created,r.details]);
  await tx.query("INSERT INTO personal_site.site_settings(id,site,revision,published,template_id,default_storage) VALUES(true,$1,3,42,'default','local')",[bundle.draft.config.site]);
  await tx.query("INSERT INTO personal_site.projects(id,slug,ordinal,content) VALUES('p1','one',0,$1)",[bundle.draft.config.projects[0]]);
  await tx.query("INSERT INTO personal_site.scenes(id,ordinal,label,fields) VALUES('Home',0,'Home',$1)",[JSON.stringify(bundle.draft.config.scenes[0].fields)]);
  await tx.query("INSERT INTO personal_site.songs(id,ordinal,title,src) VALUES('song1',0,'Song','/media/audio')");
  await tx.query("INSERT INTO personal_site.previews(id,owner,expires,snapshot) VALUES('preview-fixture-upgrade','admin','2099-01-01T00:00:00Z',$1)",[bundle.draft]);
  await tx.query("INSERT INTO personal_site.sessions(id,username,csrf,created,touched) VALUES('fixture-session','admin','fixture-csrf',1,1)");
  const references = [['image','config.projects.0.video.url'],['image','config.projects.0.video.thumbnail'],['image','config.projects.0.projectLogo.url'],['image','config.scenes.0.fields.0.value'],['image','template.baseUIL.image.src'],['audio','config.songs.0.src'],['font','template.baseUIL.font.src']];
  for(const [type,id] of [['draft','draft'],['version','42'],['version','43'],['preview','preview-fixture-upgrade']])
    for(const [resource,slot] of references) await tx.query('INSERT INTO personal_site.resource_references(resource_id,owner_type,owner_id,slot) VALUES($1,$2,$3,$4)',[resource,type,id,slot]);
  await tx.query("INSERT INTO personal_site.audit_events(id,created,action,actor) VALUES(1,$1,'fixture.import','admin')",[created]);
  await tx.query("SELECT pg_catalog.setval(pg_catalog.pg_get_serial_sequence('personal_site.versions','id'),43,true)");
  await tx.query("SELECT pg_catalog.setval(pg_catalog.pg_get_serial_sequence('personal_site.audit_events','id'),1,true)");
  await tx.query("INSERT INTO personal_site.installation(completed_at,source,schema_version) VALUES($1,'fixture',1)",[created]);
}
module.exports = {legacyBundle,seedLegacy};

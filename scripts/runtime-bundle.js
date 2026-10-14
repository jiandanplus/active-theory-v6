#!/usr/bin/env node
const path=require('node:path');
const {fail}=require('../admin-server/security');
const {readSource,createCAS}=require('../admin-server/delivery/cas');
const {assertRuntimeManifest}=require('../admin-server/delivery/contracts');
const {registerRuntime}=require('../admin-server/delivery/registration');
const {inspectInstallation}=require('../admin-server/migrations');
const defaults={loadOptions:require('../admin-server/options').loadOptions,
  openPostgres:require('../admin-server/postgres').openPostgres,registry:require('../admin-server/engine/registry')};
function parse(argv) {
  const result={};
  if(!Array.isArray(argv))throw fail(400,'登记参数无效');
  for(let i=0;i<argv.length;i+=2) {
    const key=argv[i],value=argv[i+1];
    if(!['--root','--manifest','--profile'].includes(key)||Object.hasOwn(result,key)
      ||typeof value!=='string'||!value||value.startsWith('--'))throw fail(400,'请明确指定运行包目录、清单和配置');
    result[key]=value;
  }
  if(Object.keys(result).length!==3||!path.isAbsolute(result['--root'])||!path.isAbsolute(result['--manifest']))
    throw fail(400,'请明确指定绝对目录、清单文件和配置');
  return result;
}
async function main(argv=process.argv.slice(2),{loadOptions=defaults.loadOptions,openPostgres=defaults.openPostgres,registry=defaults.registry}={}) {
  const args=parse(argv);
  // Bounded ordinary JSON file; never require/import/evaluate candidate input.
  let manifest;
  try {
    manifest=JSON.parse((await readSource(path.dirname(args['--manifest']),path.basename(args['--manifest']),2*1024*1024)).toString('utf8'));
    assertRuntimeManifest(manifest);
  } catch {throw fail(422,'运行包清单不可用或格式无效');}
  if(manifest.profileId!==args['--profile'])throw fail(422,'运行包配置与清单不符');
  const options=loadOptions();
  if(!options.databaseUrl)throw fail(503,'请先配置数据库并完成站点安装');
  const store=openPostgres({databaseUrl:options.databaseUrl});
  try {
    const state=await inspectInstallation(store);
    if(state.state!=='installed'||state.schemaVersion!==3)throw fail(503,'请先完成站点安装及显式结构升级');
    const admin=(await store.query('SELECT username FROM personal_site.admins WHERE id=true')).rows[0];
    if(!admin)throw fail(503,'站点管理员不可用');
    const result=await registerRuntime({store,cas:createCAS(options.dataDir),root:args['--root'],manifest,registry,actor:admin.username});
    console.log(JSON.stringify(result));
    return result;
  } finally {await store.close();}
}
if(require.main===module)main().catch(()=>{
  console.error('运行包登记失败，请检查服务器配置、清单和受支持的运行包。');
  process.exitCode=1;
});
module.exports={main};

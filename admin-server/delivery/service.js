const path=require('node:path');
const {createCAS}=require('./cas');
const {buildArtifact}=require('./builder');
const {registerRuntime,selectRuntime}=require('./registration');
const {assertActor}=require('./candidates');
const {fail}=require('../security');
function createDeliveryService({store,options={},registry=require('../engine/registry'),build=buildArtifact}){
  const origin=new URL(options.origin||'http://localhost:3000');
  if(origin.origin!==(options.origin||'http://localhost:3000').replace(/\/$/,''))throw fail(422,'交付来源无效');
  options=Object.freeze({...options,root:options.root||path.resolve(__dirname,'../..'),
    dataDir:path.resolve(options.dataDir||path.join(options.root||path.resolve(__dirname,'../..'),'data')),origin:origin.origin});
  const cas=createCAS(options.dataDir),dependencies={store,options,registry,cas,build};
  const unavailable=async()=>{throw fail(501,'交付操作尚未接入');};
  return Object.freeze({
    publish:({revision,actor,withWarnings=false})=>require('./publish').publish({...dependencies,revision,actor,withWarnings}),
    preview:({revision,actor})=>require('./preview').preview({...dependencies,revision,actor}),
    legacy:({versionId,expectedGeneration,actor})=>require('./legacy').legacy({...dependencies,versionId,expectedGeneration,actor}),
    read:unavailable,cas,
    register:input=>{assertActor(input.actor);return registerRuntime({...input,store,cas,registry,actor:input.actor.username});},
    select:input=>{assertActor(input.actor);return selectRuntime({...input,store,cas,registry,actor:input.actor.username});},
  });
}
module.exports={createDeliveryService};

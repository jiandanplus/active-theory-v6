const path=require('node:path');
const {testRuntime}=require('./runtime');
const {httpFixture}=require('./http');
async function deliveryFixture(t,{publish=false,build}={}) {
  const runtime=testRuntime(t);
  const serviceFactory=({store,options})=>require('../../admin-server/delivery/service').createDeliveryService({store,options,registry:runtime.registry,build});
  const fixture=await httpFixture(t,{serviceFactory});
  await fixture.createAdmin();
  const headers=await fixture.login();
  const actor=(await fixture.store.query('SELECT id,username FROM personal_site.sessions')).rows[0];
  const service=fixture.app.locals.deliveryService;
  const registered=await service.register({root:runtime.root,manifest:runtime.manifest,actor});
  await service.select({digest:registered.digest,expectedGeneration:0,actor});
  let published;
  if(publish)published=await service.publish({revision:3,actor});
  return {
    get app(){return fixture.app;},get store(){return fixture.store;},get base(){return fixture.base;},
    get service(){return fixture.app.locals.deliveryService;},get cas(){return this.service.cas;},
    root:fixture.root,bundle:fixture.bundle,headers,actor,published,runtime,
    runtimeAppPath:path.join(runtime.root,'app.js'),
    request:fixture.request,login:fixture.login,restart:fixture.restart,json:fixture.json,
  };
}
module.exports={deliveryFixture};

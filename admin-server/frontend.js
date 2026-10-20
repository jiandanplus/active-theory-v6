const {fail}=require('./security');
const {route}=require('./http');
const {resolveVersion,resolvePublishedResource,sendResource}=require('./frontend-resources');
const {resolveDelivery,readDeliveryFile}=require('./delivery/reader');
const {sendDelivery,noStore,privateDelivery}=require('./delivery/response');
const {resourceAsset}=require('./snapshots');

function mountFrontend(app,store,options,{cas}) {
  const resolve=req=>resolveDelivery({store,cas,options,version:req.params.version,preview:req.query.preview,admin:req.adminSession});
  const deliver=(lookup,{page=false}={})=>route(async(req,res)=>{
    try {
      const resolved=await resolve(req);
      sendDelivery(req,res,await readDeliveryFile(resolved,lookup(req),cas),resolved);
    } catch(error) {
      if(!page||error.status!==503)throw error;
      noStore(res,{error:true});
      const message=error.message==='网站尚未发布'?'网站尚未发布，请在管理后台发布内容。':'缺少前台运行资源或固定交付不可用，请由管理员检查交付状态。';
      res.status(503).type('html').end('<!doctype html><meta charset="utf-8"><title>网站暂时不可用</title><p>'+message+'</p><a href="/admin">管理后台</a>');
    }
  });
  async function resource(req,res,next,version,id,{explicitTarget=true}={}) {
    const live=await resolvePublishedResource(store,{version,id,admin:req.adminSession});
    if(live.deliveryTarget.type==='preview')privateDelivery(res);
    if(live.document) {
      if(!explicitTarget)throw fail(404,'资源文档需要明确版本');
      const resolved=await resolveDelivery({store,cas,options,version,admin:req.adminSession});
      return sendDelivery(req,res,await readDeliveryFile(resolved,{resourceId:id},cas),resolved);
    }
    return sendResource(req,res,next,live,options);
  }
  app.get('/api/site/:version/resources/:id/:fileName',route((req,res,next)=>resource(req,res,next,req.params.version,req.params.id)));
  app.get('/api/site/:version/runtime/:key',deliver(req=>({runtimeKey:req.params.key})));
  app.get('/api/site/:version/:file',deliver(req=>({endpoint:req.params.file})));
  app.get(['/','/work','/work/:slug','/contact','/basic','/basic/work','/basic/work/:slug','/basic/contact'],deliver(req=>({pagePath:req.path}),{page:true}));
  app.get('/unsupported.html',deliver(()=>({endpoint:'unsupported.html'})));
  app.get(['/assets/*','/room/*','/bush.bin/*'],route(async(req,res,next)=>{
    // Legacy media names are aliases only, never a static program fallback.
    if(/\.(?:js|css|wasm)$/i.test(req.path))throw fail(404,'资源不存在');
    const {id,snapshot}=await resolveVersion(store,{preview:req.query.preview,admin:req.adminSession});
    const asset=resourceAsset(snapshot,req.path);
    if(!asset)throw fail(404,'资源不存在');
    return resource(req,res,next,id,asset.resourceId,{explicitTarget:false});
  }));
}
module.exports={mountFrontend,
  patchAppSource:require('./engine/legacy-adapter').patchAppSource,
  patchShaders:require('./engine/legacy-adapter').patchShaders,
  versionedUIL:require('./engine/render').versionedUIL,
  bridgeSource:require('./engine/render').bridgeSource};

const {fail} = require('../../security');
const {renderPortfolio} = require('../../portfolio/render');
const programs = Object.freeze([
  ['index','examples/portfolio/index.html','html','4a5306859f5bac86f20ab236ea012c5a3ef1852ccf0d432f11f7218d26e35cef'],
  ['unsupported','examples/portfolio/unsupported.html','html','67b510a42a6d7da559e6ffaae5c49bedfc0f9e746097e31e5bfdcce5cd743b80'],
  ['app','examples/portfolio/app.js','program','d28152877e391d29924af7a40aa16862f663e09daad49312349b9b2f892f14d8'],
  ['compiled-shaders','examples/portfolio/compiled.vs','shader','76cbf70e49f0f03a08e324a2c0b3e12a22f49d0e28d958b26fa7820b4ad4cb34'],
].map(([key,path,role,sha256]) => Object.freeze({key,path,role,sha256})));
const dependencies = Object.freeze([
  Object.freeze({from:'index',to:'app',via:'script'}),
  Object.freeze({from:'index',to:'unsupported',via:'navigation'}),
]);
function validateSnapshot(snapshot) {
  if (!snapshot?.config?.site || !Array.isArray(snapshot.config.projects) || !snapshot.template)
    throw fail(422,'个人主页内容无效');
}
module.exports = Object.freeze({
  id:'portfolio-v1', templateId:'portfolio',
  policy:Object.freeze({inactiveLayouts:Object.freeze([])}),programs,dependencies,
  validateSnapshot,
  validateSources:files => {
    if (!files.get('index')?.toString().includes('FIRST_PARTY_PORTFOLIO')) throw fail(422,'个人主页模板无效');
    return [];
  },
  transformPrograms:files => ({files:new Map(files),report:[]}),
  transformApp:source => ({source,report:[]}),
  transformShaders:source => ({source,report:[]}),
  transformUIL:snapshot => ({data:structuredClone(snapshot.template.baseUIL || {}),report:[]}),
  transformHTML:({snapshot,target,pathname,programs}) => ({source:renderPortfolio({config:snapshot.config,target,pathname,programs}),report:[]}),
  transformUnsupportedHTML:({snapshot,target}) => ({source:renderPortfolio({config:snapshot.config,target,basic:true,scripts:false}),report:[]}),
});

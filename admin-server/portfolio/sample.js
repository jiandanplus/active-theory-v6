const fs = require('node:fs/promises');
const path = require('node:path');
const {normalizeSite} = require('../../shared/site-identity');
const {composeSnapshot} = require('../snapshots');
const {digestJSON,sha256} = require('../delivery/contracts');
async function demoBundle() {
  const config = {
    site:normalizeSite({title:'我的创作空间',description:'在设计与技术之间，探索想法的更多可能。这里记录作品、实践，以及正在发生的创造。',
      language:'zh-CN',navWork:'作品',navContact:'联系',contactTitle:'让下一个想法发生。',email:'hello@example.test',emailLink:'hello@example.test',
      cityLax:'设计',cityNyc:'开发',cityAms:'持续探索',labUrl:''}),
    projects:[
      {id:'sample-orbit',slug:'orbit-and-light',name:'轨道与光',description:'一项关于秩序、运动与视觉表达的示例探索。你可以在后台替换这段介绍，上传自己的作品图片。',tags:'视觉设计 · 示例',clientName:'个人探索',completionDate:'2026-01-01',priority:2,uiColor:'d4ad7a',projectURL:'',caseStudyURL:'',video:{url:'',thumbnail:'/media/sample-orbit'},image:{url:'/media/sample-orbit'},projectLogo:{url:''}},
      {id:'sample-landscape',slug:'layered-landscape',name:'层叠的风景',description:'将简单形状组合成有温度的数字风景。这些图形由项目自带的 SVG 绘制，不需要外部素材服务。',tags:'创意开发 · 示例',clientName:'自主创作',completionDate:'2026-02-01',priority:1,uiColor:'91aea2',projectURL:'',caseStudyURL:'',video:{url:'',thumbnail:'/media/sample-landscape'},image:{url:'/media/sample-landscape'},projectLogo:{url:''}},
    ],scenes:[],songs:[],
  };
  const resources = [], assets = {}, legacyMap = {};
  for (const name of ['orbit','landscape']) {
    const id = 'sample-' + name, file = 'examples/portfolio/' + name + '.svg';
    const bytes = await fs.readFile(path.join(__dirname,'../..',file));
    resources.push({id,source:'bundled',url:'/media/'+id,name:name+'.svg',kind:'image',mime:'image/svg+xml',
      path:file,size:bytes.length,checksum:sha256(bytes),status:'ready',trashed:false,created:'2026-01-01T00:00:00.000Z'});
    assets[id]={resourceId:id,fileName:name+'.svg',url:'/media/'+id,owner:'project'};
    legacyMap['/media/'+id]=id;
  }
  const template = {baseUIL:{},contact:{},metadata:{},fontCoverage:{},readiness:{ready:true,missingRequired:[]}};
  const report = {counts:{resources:resources.length,assets:resources.length,versions:0,projects:config.projects.length,songs:0,storages:1,audit:0},
    missingRequired:[],warnings:[],credentialsUnavailable:[],hasAdmin:false};
  const bundle = {draft:composeSnapshot({config,template,assets,legacyMap}),schema:structuredClone(config),versions:[],published:null,
    revision:0,resources,storages:[{id:'local',type:'local',name:'本地存储',available:true}],defaultStorage:'local',admin:null,audit:[],report};
  report.digest = digestJSON(bundle);
  return bundle;
}
module.exports = {demoBundle};

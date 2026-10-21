const {test}=require('node:test');
const assert=require('node:assert/strict');
const {httpFixture}=require('./helpers/http');
const {contentRepository}=require('../admin-server/repositories/content');
const {validatePublication}=require('../admin-server/publication');
test('page media publication rechecks the required image/video kind',async t=>{
 const f=await httpFixture(t), snapshot=(await contentRepository(f.store).getDraft()).snapshot;
 snapshot.config.site.heroVideo='/media/image';
 await assert.rejects(validatePublication(f.store,{root:f.root},snapshot),/视频/);
 delete snapshot.config.site.heroVideo;
 snapshot.config.site.contactQrImage='/media/audio';
 await assert.rejects(validatePublication(f.store,{root:f.root},snapshot),/图片/);
});
test('new contact GL labels fail clearly for unavailable original font glyphs',async t=>{
 const f=await httpFixture(t), snapshot=(await contentRepository(f.store).getDraft()).snapshot;
 snapshot.config.site.contactHomeText='中';
 snapshot.assets.bold={resourceId:'bold',fileName:'NBArchitektStd-Bold.json'};
 snapshot.legacyMap['assets/fonts/NBArchitektStd-Bold.json']='bold';
 snapshot.template.fontCoverage.bold='ABCDEFGHIJKLMNOPQRSTUVWXYZ[] ';
 await assert.rejects(validatePublication(f.store,{root:f.root},snapshot),/字形.*中/);
 snapshot.config.site.contactHomeText='HOME';snapshot.config.site.contactQrText='[ WECHAT ]';
 await validatePublication(f.store,{root:f.root},snapshot);
 snapshot.config.site.contactInstagramText='这是无障碍说明';
 await validatePublication(f.store,{root:f.root},snapshot);
});

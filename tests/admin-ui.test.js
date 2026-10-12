const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ui = require('../admin-ui/admin.js');
test('new projects have complete engine media objects and unique identity', () => {
  const p = ui.newProject('test-id');
  assert.equal(p.id, 'test-id');
  assert.equal(p.slug, 'new-project-test-id');
  assert.deepEqual(p.video, {url:'',thumbnail:''});
  assert.deepEqual(p.projectLogo, {url:''});
  assert.match(p.completionDate,/^\d{4}-\d{2}-\d{2}T/);
});
test('geometry picker rejects raw uploaded GLB and accepts only converted ready models', () => {
  assert.equal(ui.canPick({kind:'model',status:'uploaded',url:'/media/a'}, 'geometry'), false);
  assert.equal(ui.canPick({kind:'model',status:'ready',url:'/models/example.bin'}, 'geometry'), true);
  assert.equal(ui.canPick({kind:'model',status:'ready',url:'/models/example.bin',trashed:true}, 'geometry'), false);
  assert.equal(ui.canPick({kind:'model',status:'ready',url:'/media/raw-glb'}, 'geometry'), false);
});
test('resource picker limits audio and image slots to matching resources', () => {
  assert.equal(ui.canPick({kind:'image',status:'uploaded'}, 'audio'), false);
  assert.equal(ui.canPick({kind:'audio',status:'uploaded'}, 'audio'), true);
});
test('stored credentials are never reused as visible editor values', () => {
  assert.deepEqual(ui.storageBody({id:'s3',name:'Cloud',accessKeyId:'configured',secretAccessKey:'configured',sessionToken:'configured'}),{id:'s3',name:'Cloud',type:'s3'});
});
test('admin DOM has no HTML injection sinks and includes navigation and dirty guard', () => {
  const source = fs.readFileSync(require.resolve('../admin-ui/admin.js'),'utf8');
  assert.doesNotMatch(source,/\.innerHTML\s*=|insertAdjacentHTML|document\.write/);
  assert.match(source,/beforeunload/);
  for(const section of ['overview','site','scenes','projects','resources','storage','versions','security']) assert.ok(source.includes(section));
});

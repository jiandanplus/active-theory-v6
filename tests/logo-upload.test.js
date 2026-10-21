const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const helpers = require('../admin-ui/modules/helpers');

function deferred() {
  let resolve;
  const promise = new Promise(done => {resolve = done;});
  return {promise, resolve};
}
function fixture(settings = {}) {
  const {document, walk} = require('./helpers/admin-dom')();
  const state = {csrf: 'test', sessionEpoch: 1, resources: [], storages: [{id: 'local', name: 'Local'}], defaultStorage: 'local',
    config: {scenes: [{id: 'Home', label: '开场 · Logo', fields: [
      {key: 'INPUT_Config_8_ParticleTest_geometry', label: 'AT_logo.bin', type: 'geometry', value: 'assets/geometry/logo/AT_logo.bin'},
    ]}]}};
  const source = {id: 'uploaded-model', kind: 'model', source: settings.source || 'local', status: 'uploaded', name: 'Logo.glb', url: '/media/uploaded-model', ...settings.resource};
  const calls = [], messages = [], requests = [];
  let live = true, renders = 0, resources, available = [];
  const content = document.createElement('main'); document.body.append(content);
  const context = {state, document, crypto: require('node:crypto').webcrypto, content, ...helpers,
    pageContent: require('../shared/page-content'),
    captureView() {const epoch = state.sessionEpoch; return () => live && epoch === state.sessionEpoch;},
    notify: (message, error) => messages.push({message, error}),
    async api(route, method = 'GET', body) {
      calls.push({route, method, body});
      if (route === '/resources') return {resources: available.slice()};
      assert.equal(route, '/resources/uploaded-model/convert');
      if (settings.convertGate) await settings.convertGate;
      if (settings.convertError) throw new Error(settings.convertError);
      const resource = {...source, id: 'converted-model', status: 'ready', url: '/models/converted-model.bin', name: 'Logo.bin'};
      available.push(resource); return {resource};
    },
    async render() {renders++; content.replaceChildren(); await resources.resourcesView();},
  };
  Object.assign(context, require('../admin-ui/modules/dom').create(context));
  context.notify = (message, error) => messages.push({message, error});
  class XMLHttpRequest {
    constructor() {this.listeners = {}; this.upload = {addEventListener() {}}; requests.push(this);}
    open(method, url) {this.method = method; this.url = url;}
    setRequestHeader(name, value) {(this.headers ||= {})[name] = value;}
    addEventListener(name, callback) {this.listeners[name] = callback;}
    send(form) {
      this.form = form;
      Promise.resolve(settings.uploadGate).then(() => {
        this.status = settings.uploadError ? 400 : 201;
        this.responseText = JSON.stringify(settings.uploadError ? {error: settings.uploadError} : {resource: source});
        if (!settings.uploadError) available.push(source);
        this.listeners.load();
      });
    }
  }
  class FormData {constructor() {this.values = [];} append(...args) {this.values.push(args);}}
  const sandbox = {module: {exports: {}}, XMLHttpRequest, FormData};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../admin-ui/modules/resources.js'), 'utf8'), sandbox);
  resources = sandbox.module.exports.create(context);
  return {state, source, calls, messages, requests, walk, document, context, resources,
    invalidate() {live = false;}, replaceSession() {state.sessionEpoch++;},
    get renders() {return renders;},
    async upload() {
      await resources.resourcesView();
      walk().find(el => el.type === 'file').files = [{name: 'Logo.glb'}];
      return walk().find(el => el.textContent === '开始上传').dispatch('click');
    },
  };
}

test('top Logo has a friendly searchable label and safe adjacent Hunyuan link without changing data', async () => {
  const f = fixture(), before = JSON.stringify(f.state.config);
  require('../admin-ui/modules/scenes').create(f.context).scenesView();
  const label = f.walk().find(el => el.tagName === 'LABEL' && el.textContent === '顶部 3D Logo');
  assert.ok(label, 'explicit top Logo label');
  const link = f.walk().find(el => el.tagName === 'A' && el.href === 'https://3d.hunyuan.tencent.com/');
  assert.ok(link); assert.equal(link.target, '_blank');
  assert.match(link.rel, /noopener/); assert.match(link.rel, /noreferrer/);
  assert.equal(link.parent, label.parent, 'link is beside the field label');
  const search = f.walk().find(el => el.getAttribute('aria-label') === '搜索场景字段');
  search.value = '顶部 3D Logo'; await search.dispatch('input');
  assert.ok(f.walk().some(el => el.value === 'assets/geometry/logo/AT_logo.bin'));
  assert.ok(f.walk().some(el => el.textContent.includes('上传成功后会自动转换为 BIN')));
  assert.equal(JSON.stringify(f.state.config), before);
});

for (const source of ['local', 's3']) test(source + ' GLB upload automatically converts once without choosing or publishing it', async () => {
  const f = fixture({source}), before = JSON.stringify(f.state.config);
  await f.upload();
  const conversions = f.calls.filter(call => call.method === 'POST');
  assert.equal(conversions.length, 1, 'upload should start one conversion');
  assert.equal(conversions[0].route, '/resources/uploaded-model/convert');
  assert.equal(JSON.stringify(conversions[0].body), JSON.stringify({size: 0.8}));
  assert.ok(f.state.resources.some(r => r.id === f.source.id), 'keep original GLB');
  assert.ok(f.state.resources.some(r => helpers.canPick(r, 'geometry')), 'ready BIN selectable');
  assert.ok(f.messages.some(m => m.message.includes('自动转换完成')));
  assert.equal(JSON.stringify(f.state.config), before, 'never replace current Logo');
});

for (const resource of [{kind: 'image'}, {source: 'external'}, {status: 'ready'}]) test('upload does not convert an ineligible resource ' + JSON.stringify(resource), async () => {
  const f = fixture({resource}); await f.upload();
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
});

test('conversion failure keeps uploaded GLB, reports reason, restores controls and offers manual retry', async () => {
  const f = fixture({convertError: '模型包含动画，暂不支持'}); await f.upload();
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
  assert.ok(f.state.resources.some(r => r.id === f.source.id));
  assert.ok(f.messages.some(m => m.error && m.message.includes('原始 GLB 已保留') && m.message.includes('模型包含动画')));
  assert.ok(f.walk().some(el => el.textContent === '转换为 BIN'));
  assert.ok(!f.walk().some(el => el.tagName === 'BUTTON' && el.textContent === '开始上传' && el.disabled));
  assert.ok(!f.messages.some(m => m.message.includes('自动转换完成')));
});

test('upload error never starts conversion', async () => {
  const f = fixture({uploadError: '文件无效'}); await f.upload();
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
  assert.equal(f.document.getElementById('notice').textContent, '文件无效');
});

for (const transition of ['invalidate', 'replaceSession']) test('late upload does not start conversion after ' + transition, async () => {
  const gate = deferred(), f = fixture({uploadGate: gate.promise});
  const upload = f.upload(); await new Promise(resolve => setImmediate(resolve));
  f[transition](); gate.resolve(); await upload;
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
  assert.equal(f.renders, 0); assert.equal(f.messages.length, 0);
});

test('conversion shows pending state then cannot refresh or notify a newer view', async () => {
  const gate = deferred(), f = fixture({convertGate: gate.promise});
  const upload = f.upload(); await new Promise(resolve => setImmediate(resolve));
  assert.ok(f.walk().some(el => el.textContent.includes('自动转换中')));
  assert.ok(f.walk().some(el => el.type === 'file' && el.disabled));
  f.invalidate(); gate.resolve(); await upload;
  assert.equal(f.calls.filter(call => call.route === '/resources').length, 1);
  assert.equal(f.renders, 0); assert.equal(f.messages.length, 0);
});

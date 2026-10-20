const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '../admin-ui');
const names = ['helpers', 'state', 'api', 'dom', 'session', 'actions', 'overview', 'site', 'scenes', 'projects', 'resources', 'storage', 'versions', 'security'];
test('admin modules load deterministically before a compatible boot with one explicit shared state', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const files = [...html.matchAll(/<script defer src="([^"]+)"/g)].map(match => match[1]);
  assert.ok(files.includes('/admin/content-contract.js'));
  for (const name of names) {
    assert.ok(files.indexOf(`/admin/modules/${name}.js`) < files.indexOf('/admin/admin.js'), name);
    assert.ok(files.includes(`/admin/modules/${name}.js`), name);
  }
  const context = vm.createContext({});
  for (const name of names) vm.runInContext(fs.readFileSync(path.join(root, 'modules', `${name}.js`), 'utf8'), context);
  assert.deepEqual(Object.keys(context.SiteAdminModules).sort(), [...names].sort());
  const ui = require('../admin-ui/admin.js');
  assert.equal(typeof ui.startAdmin, 'function');
  assert.equal(ui.newProject('module-test').id, 'module-test');
  const state = context.SiteAdminModules.state.createState();
  assert.equal(state.section, 'overview');
  assert.equal(state.dirty, false);
  assert.equal(state.runtime.selection.digest, null);
});
test('API module sends same-origin CSRF only with mutations and invalidates expired sessions', async () => {
  const module = require('../admin-ui/modules/api');
  const calls = [], state = {csrf: 'csrf-test', config: {}, sessionEpoch: 4};
  let logins = 0;
  const {api} = module.create({state, login: () => logins++, fetch: async (url, options) => {
    calls.push({url, options});
    return {ok: calls.length < 3, status: calls.length < 3 ? 200 : 401, json: async () => ({error: '已过期'})};
  }});
  await api('/runtime');
  await api('/runtime/builtin', 'POST', {});
  assert.deepEqual(calls[0].options.headers, {});
  assert.equal(calls[1].options.headers['X-CSRF-Token'], 'csrf-test');
  assert.equal(calls[1].options.credentials, 'same-origin');
  assert.equal(calls[1].options.body, '{}');
  await assert.rejects(api('/config'), /已过期/);
  assert.equal(state.sessionEpoch, 5);
  assert.equal(state.config, null);
  assert.equal(logins, 1);
});
test('shared client validation rejects unsafe drafts before any save request', async () => {
  const module = require('../admin-ui/modules/actions');
  const state = {config: {site: {title: '<script>bad</script>', description: '', language: 'zh-CN', socialImage: ''}, projects: [], scenes: [], songs: []}, busy: false, sessionEpoch: 0, revision: 1};
  state.validationSchema = structuredClone(state.config);
  let requests = 0;
  const {save} = module.create({state, updateStatus() {}, window: {SiteContentContract: require('../shared/content-contract')}, api: async () => {requests++;}});
  await assert.rejects(save(), /文字内容不能包含 HTML/);
  assert.equal(requests, 0);
  assert.equal(state.busy, false);
});
test('built-in template registration is busy guarded, refreshes choices, and never selects implicitly', async () => {
  const overview = require('../admin-ui/modules/overview');
  const controls = [], calls = [];
  const state = {busy: false, sessionEpoch: 0, dirty: true, revision: 9, config: {title: '未保存'}, runtime: {selection: {digest: null, generation: 0}, bundles: []}};
  const node = () => ({append() {}, replaceChildren() {}, dataset: {}, isConnected: true});
  let release;
  const pending = new Promise(resolve => release = resolve);
  const ctx = {state, node, empty() {}, notify() {}, field() {throw Error('no registered bundles yet');},
    button(label, action, cls, busy) {const b = node(); Object.assign(b, {label, action, busy}); controls.push(b); return b;},
    building: async action => {if (state.busy) throw Error('正在处理'); state.busy = true; try {return await action();} finally {state.busy = false;}},
    refreshRuntime: async () => {calls.push('refresh');return true;},
    api: async (url, method, body) => {calls.push({url, method, body});return pending;}};
  overview.create(ctx).showRuntimePanel(node());
  const control = controls.find(b => b.label === '添加内置个人主页模板');
  assert.ok(control);
  assert.equal(control.busy, true);
  const request = control.action();
  assert.equal(state.busy, true);
  await assert.rejects(control.action(), /正在处理/);
  release({digest: 'a'.repeat(64), profileId: 'portfolio-v1', files: 3, bytes: 100});
  await request;
  assert.deepEqual(calls, [{url: '/runtime/builtin', method: 'POST', body: {}}, 'refresh']);
  assert.equal(state.runtime.selection.digest, null);
  assert.equal(state.revision, 9);
  assert.equal(state.dirty, true);
});
test('real module boot reaches all eight sections without duplicating or losing draft state', async () => {
  const {document, walk} = require('./helpers/admin-dom')();
  const calls = [], listeners = {};
  const draft = {site: {title: 'Fixture', description: '', language: 'zh-CN', socialImage: ''}, projects: [], scenes: [], songs: []};
  const responses = {
    '/api/setup/status': {state: 'installed'}, '/api/admin/session': {authenticated: true, csrfToken: 'boot-csrf'},
    '/api/admin/config': {config: draft, revision: 4}, '/api/admin/resources': {resources: []},
    '/api/admin/config/schema': {schema: structuredClone(draft)},
    '/api/admin/storages': {storages: [], defaultStorage: 'local'},
    '/api/admin/overview': {published: 1, resources: 0, audit: [], defaultStorage: 'local'},
    '/api/admin/runtime': {selection: {digest: null, generation: 0}, bundles: []}, '/api/admin/versions': {versions: []},
  };
  const environment = {document, crypto: require('node:crypto').webcrypto,
    SiteIdentity: require('../shared/site-identity'), SiteContentContract: require('../shared/content-contract'),
    addEventListener(type, fn) {listeners[type] = fn;},
    fetch: async url => {calls.push(url); assert.ok(responses[url], url); return {ok: true, json: async () => responses[url]};}};
  const app = require('../admin-ui/admin').startAdmin(environment);
  await app.ready;
  assert.equal(app.state.config, draft);
  assert.notEqual(app.state.validationSchema, draft);
  assert.ok(walk().some(element => element.textContent === '添加内置个人主页模板'));
  const state = app.state;
  for (const section of ['site', 'scenes', 'projects', 'resources', 'storage', 'versions', 'security', 'overview']) {
    await document.querySelectorAll('[data-section]').find(element => element.dataset.section === section).dispatch('click');
    assert.equal(app.state, state);
    assert.equal(app.state.section, section);
    assert.equal(document.querySelectorAll('[data-section]').find(element => element.dataset.section === section).getAttribute('aria-current'), 'page');
  }
  app.state.section = 'site'; await app.render();
  const input = walk().find(element => element.tagName === 'INPUT' && element.value === 'Fixture');
  input.value = '未保存修改'; await input.dispatch('input');
  assert.equal(state.config.site.title, '未保存修改');
  assert.equal(state.dirty, true);
  let prevented = false;
  listeners.beforeunload({preventDefault() {prevented = true;}});
  assert.equal(prevented, true);
  assert.equal(calls.filter(url => url === '/api/admin/session').length, 1);
});
test('DOM confirmation cancels asynchronously with safe initial focus and accessible labels', async () => {
  const {document, walk} = require('./helpers/admin-dom')();
  const dom = require('../admin-ui/modules/dom').create({document, state: {sessionEpoch: 0}, crypto: require('node:crypto').webcrypto});
  const request = dom.confirmAction('确认测试');
  const dialog = walk().find(element => element.tagName === 'DIALOG');
  assert.ok(dialog.getAttribute('aria-labelledby'));
  assert.ok(dialog.getAttribute('aria-describedby'));
  assert.equal(document.activeElement.textContent, '取消');
  await dialog.dispatch('cancel');
  assert.equal(await request, false);
  assert.equal(dialog.isConnected, false);
});
test('storage editor never populates configured or actual secret fields', () => {
  const {document, walk} = require('./helpers/admin-dom')();
  const context = {document, state: {}, crypto: require('node:crypto').webcrypto};
  const dom = require('../admin-ui/modules/dom').create(context);
  Object.assign(context, dom);
  require('../admin-ui/modules/storage').create(context).storageEditor({id: 's3', accessKeyId: 'ACTUAL-SECRET', secretAccessKey: 'configured', sessionToken: 'ACTUAL-TOKEN'});
  const secrets = walk().filter(element => element.tagName === 'INPUT' && element.type === 'password');
  assert.equal(secrets.length, 3);
  assert.ok(secrets.every(element => element.value === '' && element.autocomplete === 'off'));
  assert.ok(!walk().some(element => /ACTUAL-SECRET|ACTUAL-TOKEN/.test(element.value)));
});
test('save snapshot retains edits made while request is pending', async () => {
  const state = {busy: false, dirty: true, sessionEpoch: 0, revision: 4, config: {title: 'before'}};
  state.validationSchema = {title: 'canonical'};
  let release, sent;
  const pending = new Promise(resolve => release = resolve);
  const {save} = require('../admin-ui/modules/actions').create({state, window: {SiteContentContract: {validateConfig() {}}},
    updateStatus() {}, notify() {}, validRevision: Number.isSafeInteger,
    api: async (path, method, body) => {sent = body; return pending;}});
  const request = save(); state.config.title = 'new edit'; release({revision: 5}); await request;
  assert.equal(sent.config.title, 'before');
  assert.equal(state.config.title, 'new edit');
  assert.equal(state.revision, 5);
  assert.equal(state.dirty, true);
  assert.equal(state.busy, false);
});
function validationConfig() {
  return {site: {title: 'Fixture', description: '', language: 'zh-CN', socialImage: ''}, projects: [], songs: [],
    scenes: [{id: 'Home', label: 'Home', fields: [{key: 'image', label: 'Image', type: 'resource', value: 'http://legacy.invalid/image.png'}]}]};
}
async function validationAdmin(schemaResponse, currentURL = 'https://new.invalid/image.png') {
  const {document, walk} = require('./helpers/admin-dom')();
  const canonical = validationConfig(), current = structuredClone(canonical), calls = [];
  current.scenes[0].fields[0].value = currentURL;
  let draft = current, revision = 4;
  const responses = {
    '/api/setup/status': {state: 'installed'}, '/api/admin/session': {authenticated: true, csrfToken: 'test-csrf'},
    '/api/admin/resources': {resources: []}, '/api/admin/storages': {storages: [], defaultStorage: 'local'},
    '/api/admin/overview': {published: 1, resources: 0, audit: [], defaultStorage: 'local'},
    '/api/admin/runtime': {selection: {digest: null, generation: 0}, bundles: []},
    '/api/admin/versions': {published: 1, versions: [{id: 1, created: '2026-01-01'}]},
  };
  const environment = {document, crypto: require('node:crypto').webcrypto, addEventListener() {},
    SiteIdentity: require('../shared/site-identity'), SiteContentContract: require('../shared/content-contract'),
    fetch: async (url, options) => {
      calls.push({url, options});
      let result;
      if (url === '/api/admin/config/schema') result = schemaResponse === undefined ? {schema: canonical} : schemaResponse;
      else if (url === '/api/admin/versions/1/restore') {draft = structuredClone(canonical); result = {revision: ++revision};}
      else if (url === '/api/admin/config') {
        if (options.method === 'PUT') {
          const body = JSON.parse(options.body);
          require('../shared/content-contract').validateConfig(body.config, canonical);
          draft = body.config; result = {revision: ++revision};
        } else result = {config: draft, revision};
      } else result = responses[url];
      assert.notEqual(result, undefined, url);
      return {ok: true, json: async () => result};
    }};
  const app = require('../admin-ui/admin').startAdmin(environment);
  await app.ready;
  return {...app, document, walk, calls, canonical};
}
test('restoring canonical legacy HTTP after loading a newer HTTPS draft allows unrelated edits to save', async () => {
  const app = await validationAdmin();
  await app.document.querySelectorAll('[data-section]').find(element => element.dataset.section === 'versions').dispatch('click');
  const restore = app.walk().find(element => element.textContent === '恢复到草稿');
  const request = restore.dispatch('click');
  await app.walk().find(element => element.textContent === '确认继续').dispatch('click');
  await request;
  assert.equal(app.state.config.scenes[0].fields[0].value, 'http://legacy.invalid/image.png');
  app.state.config.site.title = 'An unrelated edit'; app.state.dirty = true;
  await app.actions.save();
  assert.equal(app.state.revision, 6);
  assert.equal(app.state.dirty, false);
  assert.equal(app.calls.filter(call => call.options?.method === 'PUT').length, 1);
  assert.deepEqual(app.state.validationSchema, app.canonical);
  assert.notEqual(app.state.validationSchema, app.canonical);
});
test('unknown legacy HTTP is rejected even if unchanged from the loaded draft', async () => {
  const app = await validationAdmin(undefined, 'http://unknown.invalid/image.png');
  await assert.rejects(app.actions.save(), /HTTPS/);
  assert.equal(app.calls.filter(call => call.options?.method === 'PUT').length, 0);
});
test('invalid canonical schema responses never fall back to the loaded draft or allow saves', async () => {
  for (const response of [{}, {schema: null}, {schema: {}}, {config: validationConfig()}, {schema: {site: {}, projects: [], scenes: [], songs: []}}]) {
    const app = await validationAdmin(response);
    assert.equal(app.state.config, null);
    assert.equal(app.state.validationSchema, null);
    assert.match(app.walk().map(element => element.textContent).join(' '), /校验结构响应无效/);
    await assert.rejects(app.actions.save(), /校验结构/);
    assert.equal(app.calls.filter(call => call.options?.method === 'PUT').length, 0);
  }
});
test('uncertain built-in registration never retries or claims success; stale sessions do not refresh', async () => {
  for (const outcome of ['malformed', 'network', 'logout']) {
    const controls = [], notices = [], state = {sessionEpoch: 0, busy: false, runtime: {selection: {digest: null}, bundles: []}};
    let posts = 0, refreshes = 0;
    const node = () => ({append() {}, replaceChildren() {}, isConnected: true});
    const context = {state, node, empty() {}, notify: value => notices.push(value),
      button(label, action) {controls.push({label, action}); return node();},
      building: async action => {state.busy = true; try {return await action();} finally {state.busy = false;}},
      refreshRuntime: async () => {refreshes++;}, api: async () => {posts++; if (outcome === 'network') throw Error('网络结果不明，请刷新后核对，不要自动重试'); if (outcome === 'logout') state.sessionEpoch++; return {};}};
    require('../admin-ui/modules/overview').create(context).showRuntimePanel(node());
    const request = controls[0].action();
    if (outcome === 'logout') await request;
    else await assert.rejects(request, /不要自动重试/);
    assert.equal(posts, 1); assert.equal(refreshes, 0); assert.equal(notices.length, 0); assert.equal(state.busy, false);
  }
});
test('load begun before logout cannot repopulate the new session or redraw its shell', async () => {
  const {document} = require('./helpers/admin-dom')();
  const state = {sessionEpoch: 0, config: null, section: 'site'};
  let release;
  const pending = new Promise(resolve => release = resolve);
  const context = {state, document, app: document.getElementById('app'), sections: [],
    invalidateRuntime() {}, updateStatus() {}, siteView() {},
    api: async route => route === '/config' ? pending : route === '/resources' ? {resources: []} : route === '/storages' ? {storages: []} : {}};
  Object.assign(context, require('../admin-ui/modules/dom').create({...context, crypto: require('node:crypto').webcrypto}));
  const request = require('../admin-ui/modules/session').create(context).load();
  state.sessionEpoch++;
  release({config: {site: {}}, revision: 7});
  await request;
  assert.equal(state.config, null);
  assert.equal(context.app.children.length, 0);
});
test('an old request unauthorized response cannot expire a newer authenticated session', async () => {
  const state = {csrf: 'old', config: {}, sessionEpoch: 0};
  let release, logins = 0;
  const pending = new Promise(resolve => release = resolve);
  const {api} = require('../admin-ui/modules/api').create({state, login() {logins++;}, fetch: () => pending});
  const request = api('/resources');
  const newer = {title: 'new session'};
  state.sessionEpoch++; state.config = newer; state.csrf = 'new';
  release({ok: false, status: 401, json: async () => ({error: '已过期'})});
  await assert.rejects(request, /已过期/);
  assert.equal(logins, 0);
  assert.equal(state.config, newer);
  assert.equal(state.sessionEpoch, 1);
});
test('canonical schema arriving after a session change cannot replace the newer session baseline', async () => {
  let release;
  const pending = new Promise(resolve => release = resolve);
  const canonical = validationConfig(), newer = structuredClone(canonical);
  const state = {sessionEpoch: 0, config: null, validationSchema: null};
  const {load} = require('../admin-ui/modules/session').create({state, invalidateRuntime() {},
    api: async path => path === '/config/schema' ? pending : {config: canonical}});
  const request = load();
  state.sessionEpoch++; state.config = newer; state.validationSchema = newer;
  release({schema: canonical});
  await request;
  assert.equal(state.config, newer);
  assert.equal(state.validationSchema, newer);
});

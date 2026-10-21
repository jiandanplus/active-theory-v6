const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pageContent = require('../shared/page-content');

async function fixture({injected = true} = {}) {
  const {document, walk} = require('./helpers/admin-dom')();
  const config = {site: {title: 'Fixture', description: '', language: 'zh-CN', socialImage: '', labUrl: 'https://example.test/lab'}, songs: [], projects: [], scenes: [
    {id: 'Home', label: 'Home', fields: [
      {key: 'home_text', label: '开场文案', type: 'text', value: 'HELLO'},
      {key: 'INPUT_Config_8_ParticleTest_geometry', label: 'AT_logo.bin', type: 'geometry', value: 'assets/geometry/logo/AT_logo.bin'},
      {key: 'fixed_number', label: '固定数值', type: 'number', value: 0.75},
      {key: 'fixed_texture', label: '固定纹理', type: 'resource', value: 'assets/images/fixed.webp'},
      {key: 'fixed_object', label: '固定对象', type: 'resource', value: {alpha: 1}},
    ]},
    {id: 'Contact', label: 'Contact', fields: [
      {key: 'contact_text', label: '联系文案', type: 'text', value: 'CONTACT'},
      {key: 'fixed_geometry', label: '固定模型', type: 'geometry', value: 'assets/geometry/background.bin'},
    ]},
  ]};
  const resources = [
    {id: 'fixed', source: 'bundled', kind: 'image', name: '系统纹理', url: 'assets/images/fixed.webp'},
    {id: 'hero', source: 'bundled', kind: 'video', name: '原版开场视频', url: 'assets/video/reel.mp4'},
    {id: 'poster', source: 'bundled', kind: 'image', name: '原版封面', url: 'assets/video/reel-frame.jpg'},
    {id: 'logo', source: 'bundled', kind: 'model', status: 'ready', name: '原版 Logo', url: 'assets/geometry/logo/AT_logo.bin'},
    {id: 'image', source: 'local', kind: 'image', name: '上传图片', url: '/media/image'},
    {id: 'video', source: 'external', kind: 'video', name: '外链视频', url: 'https://example.test/video.mp4'},
    {id: 'raw', source: 'local', kind: 'model', status: 'uploaded', name: '待转换 GLB', url: '/media/raw'},
  ];
  const calls = [];
  const responses = {
    '/config': {config, revision: 2}, '/config/schema': {schema: structuredClone(config)},
    '/resources': {resources}, '/storages': {storages: [{id: 'local', name: 'Local'}], defaultStorage: 'local'},
    '/overview': {published: 1, resources: resources.length, audit: [], defaultStorage: 'local'},
    '/runtime': {selection: {digest: null, generation: 0}, bundles: []},
  };
  const environment = {document, crypto: require('node:crypto').webcrypto, addEventListener() {},
    SiteIdentity: require('../shared/site-identity'), SiteContentContract: require('../shared/content-contract'),
    ...(injected ? {SitePageContent: pageContent} : {}),
    async fetch(url, options) {
      calls.push({url, options});
      if (url === '/api/setup/status') return {ok: true, json: async () => ({state: 'installed'})};
      const route = url.replace('/api/admin', '');
      const result = route === '/session' ? {authenticated: true, csrfToken: 'fixture'} : responses[route];
      assert.notEqual(result, undefined, url);
      return {ok: true, json: async () => result};
    },
  };
  const app = require('../admin-ui/admin').startAdmin(environment);
  await app.ready;
  const findField = label => {
    const labels = walk().filter(el => el.tagName === 'LABEL' && el.textContent === label);
    assert.equal(labels.length, 1, `unique accessible label: ${label}`);
    const input = walk().find(el => el.id === labels[0].htmlFor);
    assert.ok(input, `label points to input: ${label}`);
    return input;
  };
  return {app, walk, document, calls, config, resources, findField,
    async navigate(section) {app.state.section = section; await app.render();},
    async pick(label) {
      const input = findField(label);
      await input.parent.children.find(el => el.textContent === '选择资源').dispatch('click');
      return walk().find(el => el.tagName === 'DIALOG');
    },
  };
}

test('shared page-content policy loads before content-contract and admin modules', () => {
  const html = fs.readFileSync(path.join(__dirname, '../admin-ui/index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script defer src="([^"]+)"/g)].map(match => match[1]);
  assert.ok(scripts.includes('/admin/page-content.js'));
  assert.ok(scripts.indexOf('/admin/page-content.js') < scripts.indexOf('/admin/content-contract.js'));
});

for (const injected of [true, false]) test(`optional page fields render once without default writes (injected=${injected})`, async () => {
  const f = await fixture({injected}), before = JSON.stringify(f.config);
  await f.navigate('site');
  for (const group of ['开场与底部展示', '联系页面链接', '社交媒体', '微信二维码'])
    assert.ok(f.walk().some(el => el.tagName === 'H2' && el.textContent === group), group);
  for (const definitions of [pageContent.MEDIA_FIELDS, pageContent.TEXT_FIELDS, pageContent.LINK_FIELDS])
    for (const definition of Object.values(definitions)) assert.equal(f.findField(definition.label).value, '');
  assert.equal(f.findField('底部展示区跳转链接').value, 'https://example.test/lab');
  assert.equal(JSON.stringify(f.config), before, 'render must not materialize optional defaults');
  assert.equal(f.app.state.dirty, false);
  const help = f.walk().map(el => el.textContent).join('\n');
  for (const expected of [/留空.*原版/, /PNG.*WebP.*透明/, /方形.*原图/, /预览.*发布/, /字形/, /CORS/]) assert.match(help, expected);
});

test('existing optional values stay out of basic settings and edits preserve unrelated fields', async () => {
  const f = await fixture();
  f.config.site.heroPoster = '/media/image';
  f.config.site.contactInstagramText = 'FOLLOW';
  f.config.site.contactHomeURL = 'https://example.test/home';
  const hidden = structuredClone(f.config.scenes);
  await f.navigate('site');
  assert.equal(f.findField('开场视频封面').value, '/media/image');
  assert.equal(f.findField('Instagram 文字').value, 'FOLLOW');
  const link = f.findField('主页链接');
  link.value = 'https://example.test/new'; await link.dispatch('input');
  assert.equal(f.config.site.contactHomeURL, 'https://example.test/new');
  assert.equal(f.app.state.dirty, true);
  assert.deepEqual(f.config.scenes, hidden);
  assert.ok(!f.walk().some(el => el.tagName === 'LABEL' && pageContent.PAGE_KEYS.includes(el.textContent)));
});

test('scene rendering and search expose only text and top Logo while retaining fixed values', async () => {
  const f = await fixture(), before = structuredClone(f.config.scenes);
  await f.navigate('scenes');
  assert.equal(f.findField('开场文案').value, 'HELLO');
  assert.equal(f.findField('联系文案').value, 'CONTACT');
  assert.ok(f.findField('顶部 3D Logo'));
  for (const label of ['固定数值', '固定纹理', '固定对象', '固定模型'])
    assert.ok(!f.walk().some(el => el.tagName === 'LABEL' && el.textContent === label), label);
  const search = f.walk().find(el => el.getAttribute('aria-label') === '搜索场景字段');
  search.value = 'fixed_texture'; await search.dispatch('input');
  assert.ok(f.walk().some(el => el.textContent === '没有匹配的场景字段'));
  assert.deepEqual(f.config.scenes, before);
  search.value = ''; await search.dispatch('input');
  const input = f.findField('开场文案'); input.value = 'NEW'; await input.dispatch('input');
  assert.deepEqual(f.config.scenes[0].fields.slice(1), before[0].fields.slice(1));
});

test('page-media pickers use matching kinds and never expose bundled system resources', async () => {
  const f = await fixture(); await f.navigate('site');
  for (const [key, definition] of Object.entries(pageContent.MEDIA_FIELDS)) {
    const dialog = await f.pick(definition.label);
    const names = f.walk().filter(el => el.tagName === 'H3').map(el => el.textContent);
    assert.ok(!names.includes('系统纹理'), key);
    assert.ok(!names.includes('待转换 GLB'), key);
    assert.ok(names.includes(definition.kind === 'video' ? '外链视频' : '上传图片'), key);
    assert.ok(!names.includes(definition.kind === 'video' ? '上传图片' : '外链视频'), key);
    const select = f.walk().find(el => el.textContent === '使用此资源');
    await select.dispatch('click');
    assert.ok(f.config.site[key]);
    assert.ok(!f.walk().includes(dialog), 'picker closes after selection');
  }
});

test('resource library hides system originals in active, search and trash without deleting them', async () => {
  const f = await fixture(), before = structuredClone(f.resources);
  await f.navigate('resources');
  assert.ok(!f.walk().some(el => el.tagName === 'H3' && el.textContent === '系统纹理'));
  for (const name of ['原版开场视频', '原版封面', '原版 Logo', '上传图片', '待转换 GLB'])
    assert.ok(f.walk().some(el => el.tagName === 'H3' && el.textContent === name), name);
  const search = f.walk().find(el => el.getAttribute('aria-label') === '搜索资源');
  search.value = '系统纹理'; await search.dispatch('input');
  assert.ok(f.walk().some(el => el.textContent === '暂无匹配资源'));
  search.value = ''; f.resources[0].trashed = true;
  const filter = search.parent.children.find(el => el.tagName === 'SELECT');
  filter.value = 'trash'; await filter.dispatch('change');
  assert.ok(!f.walk().some(el => el.tagName === 'H3' && el.textContent === '系统纹理'));
  delete f.resources[0].trashed;
  assert.deepEqual(f.resources, before);
  assert.equal(f.app.state.resources.length, before.length, 'retain source resources in memory');
  assert.ok(f.calls.every(call => !call.options?.method || call.options.method === 'GET'), 'filtering is read-only');
});

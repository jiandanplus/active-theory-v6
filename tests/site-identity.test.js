const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeConfig, normalizeSite, validateIdentity } = require('../shared/site-identity');

test('legacy projection adds defaults without mutating history', () => {
  const old = {site:{title:'Old'}, projects:[], scenes:[], songs:[]};
  const before = JSON.stringify(old);
  const next = normalizeConfig(old);
  assert.deepEqual(next.site, {description:'',language:'en',socialImage:'',title:'Old'});
  assert.equal(JSON.stringify(old), before);
  assert.notEqual(next, old);
  assert.equal(normalizeSite({description:'',language:'zh-CN',socialImage:''}).language, 'zh-CN');
});

test('new identity values are explicit, not coerced', () => {
  const valid = normalizeSite({title:'Example'});
  assert.doesNotThrow(() => validateIdentity(valid));
  for (const patch of [{description:'x'.repeat(501)},{description:'<img src=x>'},
    {language:''},{language:'xx'},{socialImage:null}]) {
    assert.throws(() => validateIdentity({...valid,...patch}), {status:400});
  }
  assert.equal(normalizeSite({socialImage:undefined}).socialImage, undefined);
});

test('normalization independently deep-clones nested unknown configuration keys', () => {
  const old = {site:{title:'Old',extension:{nested:['original']}},extra:{items:[{value:1}]}};
  const next = normalizeConfig(old);
  next.site.extension.nested.push('new');
  next.extra.items[0].value = 2;
  assert.deepEqual(old.site.extension.nested,['original']);
  assert.equal(old.extra.items[0].value,1);
  old.extra.items.push({value:3});
  assert.equal(next.extra.items.length,1);
});

test('same contract runs as a browser script without DOM globals', () => {
  const vm = require('node:vm');
  const context = {structuredClone};
  vm.runInNewContext(require('node:fs').readFileSync('shared/site-identity.js','utf8'), context);
  assert.equal(context.SiteIdentity.normalizeSite({}).language,'en');
  assert.deepEqual(Array.from(context.SiteIdentity.LANGUAGES),['zh-CN','zh-TW','en']);
});

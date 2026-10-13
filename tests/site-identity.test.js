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

test('same contract runs as a browser script without DOM globals', () => {
  const vm = require('node:vm');
  const context = {structuredClone};
  vm.runInNewContext(require('node:fs').readFileSync('shared/site-identity.js','utf8'), context);
  assert.equal(context.SiteIdentity.normalizeSite({}).language,'en');
  assert.deepEqual(Array.from(context.SiteIdentity.LANGUAGES),['zh-CN','zh-TW','en']);
});

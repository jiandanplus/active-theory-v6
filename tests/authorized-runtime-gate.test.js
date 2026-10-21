const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {authorizedRuntimeFixture} = require('./helpers/authorized-runtime-fixture');

const repo = path.resolve(__dirname, '..');
const runGate = root => {
  const env = {...process.env};
  delete env.AUTHORIZED_RUNTIME_ROOT;
  delete env.NODE_TEST_CONTEXT;
  if (root !== undefined) env.AUTHORIZED_RUNTIME_ROOT = root;
  return spawnSync(process.execPath, ['scripts/test-authorized-runtime.js'], {
    cwd:repo, env, encoding:'utf8', timeout:60000,
  });
};

test('authorized gate refuses absent and relative roots explicitly', () => {
  for (const root of [undefined, 'relative-runtime']) {
    const result = runGate(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /explicit absolute AUTHORIZED_RUNTIME_ROOT/);
    assert.doesNotMatch(result.stdout, /authorized runtime:/);
  }
});

test('authorized gate accepts a portable fixed-input root and runs exactly nine cases', {
  skip:!process.env.AUTHORIZED_RUNTIME_ROOT,
}, async t => {
  const {root} = await authorizedRuntimeFixture(t, process.env.AUTHORIZED_RUNTIME_ROOT);
  const result = runGate(root);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal((result.stdout.match(/^ok \d+ - authorized runtime:/gm) || []).length, 9);
  assert.match(result.stdout, /# pass 9\b/);
  assert.doesNotMatch(result.stdout, /^not ok /m);
  // Exercise the same runner used by npm test with the relocated fixture.
  const env = {...process.env, AUTHORIZED_RUNTIME_ROOT:root};
  delete env.NODE_TEST_CONTEXT;
  const base = spawnSync(process.execPath, ['scripts/test-postgres.js',
    'tests/frontend.test.js', 'tests/runtime-profile.test.js', 'tests/delivery-builder.test.js'], {
    cwd:repo, env, encoding:'utf8', timeout:60000,
  });
  assert.equal(base.status, 0, base.stdout + base.stderr);
  assert.match(base.stdout, /runtime validates bytes, exact typed dependency closure/);
  assert.match(base.stdout, /fixed production profile builds original audited bytes/);
});

test('authorized gate rejects changed fixed bytes before compatibility execution', {
  skip:!process.env.AUTHORIZED_RUNTIME_ROOT,
}, async t => {
  const {root} = await authorizedRuntimeFixture(t, process.env.AUTHORIZED_RUNTIME_ROOT);
  await fs.appendFile(path.join(root, 'assets/js/app.1778129964370.js'), '\nthrow Error("MUST_NOT_EXECUTE");');
  const result = runGate(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /trusted profile hash/);
  assert.doesNotMatch(result.stdout + result.stderr, /MUST_NOT_EXECUTE|authorized runtime:/);
});

test('retired whole-project archive entry points stay absent from the repository', async () => {
  for (const entry of ['tools/legacy/archive-deploy.js', 'archive-deploy.js']) {
    await assert.rejects(fs.access(path.join(repo, entry)), {code:'ENOENT'});
  }
  const {scripts} = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8'));
  for (const command of Object.values(scripts)) assert.doesNotMatch(command, /archive-deploy|zip -r/);
  const deployment = await fs.readFile(path.join(repo, 'DEPLOYMENT.md'), 'utf8');
  assert.match(deployment, /不要递归压缩整个工程目录/);
});

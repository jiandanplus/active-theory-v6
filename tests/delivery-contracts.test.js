const { test } = require('node:test');
const assert = require('node:assert/strict');
const c = require('../admin-server/delivery/contracts');
const rejects = fn => assert.throws(fn, { status: 422, message: '运行包或交付清单无效' });

test('canonical identity sorts objects, preserves arrays, and hashes bytes', () => {
  assert.equal(c.canonicalJSON({ b: 2, a: [1, 2] }), '{"a":[1,2],"b":2}');
  assert.equal(c.digestJSON({ b: 2, a: 1 }), c.digestJSON({ a: 1, b: 2 }));
  assert.notEqual(c.digestJSON([1, 2]), c.digestJSON([2, 1]));
  assert.equal(c.sha256(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(c.canonicalJSON(Object.assign(Object.create(null), { a: 1 })), '{"a":1}');
});
test('canonical identity rejects non-JSON and hidden state without invoking toJSON', () => {
  const cycle = {}; cycle.self = cycle;
  const extra = [1]; extra.foo = 2;
  const hidden = {}; Object.defineProperty(hidden, 'secret', { value: 1 });
  for (const v of [undefined, NaN, Infinity, -Infinity, new Date(), { a: undefined }, 1n, () => 1,
    Symbol('x'), cycle, [, 1], extra, { [Symbol('x')]: 1 }, hidden,
    { toJSON() { throw new Error('must not invoke'); } }]) rejects(() => c.canonicalJSON(v));
});
test('logical keys and source paths reject traversal and encoded paths', () => {
  for (const k of ['../x', '/x', 'a/b', '%2e%2e', 'a\\b', '', 'a..b', 'a'.repeat(129)]) rejects(() => c.logicalKey(k));
  assert.equal(c.logicalKey('app.js'), 'app.js');
  for (const p of ['../a.js', 'a/../b.js', '/a.js', 'a//b.js', 'a/%2e%2e/b', 'a\\b', '.hidden/a',
    'a/./b', 'C:/a', 'a?b', 'a#b', 'a\0b', 'a'.repeat(1025)]) rejects(() => c.sourcePath(p));
  assert.equal(c.sourcePath('assets/js/app.js'), 'assets/js/app.js');
});
test('references normalize to sorted unique pairs and reject unexpected fields', () => {
  assert.deepEqual(c.normalizeReferences([{ resourceId: 'b', slot: 'x' }, { resourceId: 'a', slot: 'z' },
    { resourceId: 'b', slot: 'x' }]), [{ resourceId: 'a', slot: 'z' }, { resourceId: 'b', slot: 'x' }]);
  for (const refs of [null, {}, [null], [{ resourceId: '', slot: 'x' }], [{ resourceId: 'a', slot: 'x\0' }],
    [{ resourceId: 'a', slot: 'x', extra: true }]]) rejects(() => c.normalizeReferences(refs));
});

const digest = 'a'.repeat(64);
const file = (key, role = 'html', size = 1) => ({ key, role, mime: {
  html: 'text/html', program: 'text/javascript', stylesheet: 'text/css', wasm: 'application/wasm',
  shader: 'text/plain', data: 'application/json', 'resource-document': 'application/manifest+json',
}[role], size, sha256: digest });
const runtime = () => ({ manifestVersion: 1, profileId: 'legacy-six-scenes-v1', templateId: 'six-scenes',
  entryKey: 'index', files: [{ ...file('index'), path: 'index.html' },
    { ...file('app', 'program'), path: 'assets/app.js' }], dependencies: [{ from: 'index', to: 'app', via: 'src' }] });
const artifact = () => ({ manifestVersion: 1, kind: 'pinned', target: { type: 'version', id: '1' },
  runtimeDigest: digest, profileId: 'legacy-six-scenes-v1', templateId: 'six-scenes', selectionGeneration: 0,
  sourceSnapshotDigest: digest, projectionDigest: digest, referencesDigest: c.digestJSON([{ resourceId: 'r1', slot: 'hero' }]),
  adapterDigest: digest, origin: 'https://example.test', files: [file('index'), file('app', 'program'),
    file('config', 'data'), file('shader', 'shader'), file('doc', 'resource-document')],
  routes: { '/': 'index', '/work': 'index', '/work/project-1': 'index' },
  endpoints: { config: 'config', 'identity.js': 'app', 'bridge.js': 'app', 'app.js': 'app', 'uil.json': 'config',
    'projects.json': 'config', 'compiled.vs': 'shader', 'metadata.json': 'config', 'contact.json': 'config', 'unsupported.html': 'index' },
  runtime: { app: 'app' }, documents: { r1: 'doc' }, references: [{ resourceId: 'r1', slot: 'hero' }], patchReport: [] });
test('artifact accepts complete version and UUID preview manifests', () => {
  assert.doesNotThrow(() => c.assertArtifactManifest(artifact()));
  const value = artifact(); value.kind = 'legacy-render'; value.target = { type: 'preview', id: 'preview-12345678-1234-4234-8234-123456789abc' };
  assert.doesNotThrow(() => c.assertArtifactManifest(value));
});
test('artifact whitelists every structural field and requires complete mappings', () => {
  for (const locate of [v => v, v => v.target, v => v.files[0], v => v.references[0]]) {
    for (const key of Object.keys(locate(artifact()))) {
      const missing = artifact(); delete locate(missing)[key]; rejects(() => c.assertArtifactManifest(missing));
      const wrong = artifact(); locate(wrong)[key] = null; rejects(() => c.assertArtifactManifest(wrong));
    }
    const extra = artifact(); locate(extra).unexpected = 1; rejects(() => c.assertArtifactManifest(extra));
  }
  for (const name of Object.keys(artifact().endpoints)) {
    const value = artifact(); delete value.endpoints[name]; rejects(() => c.assertArtifactManifest(value));
    const wrong = artifact(); wrong.endpoints[name] = name === 'unsupported.html' ? 'app' : 'index'; rejects(() => c.assertArtifactManifest(wrong));
  }
});
test('artifact rejects invalid targets, origins, digests, generations and mappings', () => {
  const mutations = [v => v.kind = 'other', v => v.manifestVersion = 2,
    ...['0', '-1', '01', '1.5', '9007199254740992', '1e3'].map(id => v => v.target.id = id),
    v => v.target.type = 'other', v => v.target = { type: 'preview', id: 'preview-abc' },
    ...['https://example.test/', 'https://example.test/path', 'https://user@example.test', 'https://EXAMPLE.test',
      'ftp://example.test', 'https://example.test?x', 'https://example.test#x'].map(origin => v => v.origin = origin),
    ...['runtimeDigest', 'sourceSnapshotDigest', 'projectionDigest', 'referencesDigest', 'adapterDigest'].map(key => v => v[key] = 'b'),
    ...[-1, 0.5, Number.MAX_SAFE_INTEGER + 1].map(n => v => v.selectionGeneration = n),
    v => v.referencesDigest = 'b'.repeat(64), v => v.files[1].key = 'index',
    v => v.routes['/'] = 'app', v => delete v.routes['/'], v => delete v.routes['/work'],
    ...['/other', '/work/A', '/work/a%2fb', '/work/a?x', '/work/a#x', '/work/a/b'].map(route => v => v.routes[route] = 'index'),
    v => v.endpoints.extra = 'config', v => v.runtime.app = 'config', v => v.runtime['a/b'] = 'app',
    v => v.runtime.app = 'missing', v => v.documents.r1 = 'config', v => v.documents.r2 = 'doc',
    v => v.patchReport = {}, v => v.patchReport = [undefined],
    v => { v.files = Array.from({ length: 4097 }, (_, i) => file(`f${i}`)); },
    v => v.files[0].size = 256 * 1024 * 1024 + 1];
  for (const mutate of mutations) { const value = artifact(); mutate(value); rejects(() => c.assertArtifactManifest(value)); }
});
test('artifact normalizes references before comparing their digest and accepts output quota boundary', () => {
  const value = artifact(); value.references.push({ resourceId: 'r1', slot: 'hero' });
  value.files[0].size = 256 * 1024 * 1024 - 4;
  assert.doesNotThrow(() => c.assertArtifactManifest(value));
  value.files[0].size++; rejects(() => c.assertArtifactManifest(value));
});
test('manifest count boundaries and runtime MIME alternatives are accepted', () => {
  const input = runtime();
  input.files = Array.from({ length: 512 }, (_, i) => ({ ...file(`f${i}`), path: `f${i}` }));
  input.entryKey = 'f0'; input.dependencies = [];
  assert.doesNotThrow(() => c.assertRuntimeManifest(input));
  const output = artifact();
  output.files.push(file('css', 'stylesheet'), file('wasm', 'wasm'));
  output.runtime.css = 'css'; output.runtime.wasm = 'wasm';
  while (output.files.length < 4096) output.files.push(file(`f${output.files.length}`, 'data'));
  assert.doesNotThrow(() => c.assertArtifactManifest(output));
});
test('canonical serialization refuses getters and unusual arrays without executing them', () => {
  let called = false;
  const getter = { get a() { called = true; return 1; } };
  rejects(() => c.canonicalJSON(getter)); assert.equal(called, false);
  const array = [1]; Object.defineProperty(array, '0', { enumerable: false });
  rejects(() => c.canonicalJSON(array));
  const value = { a: { x: 1 } }; value.b = value.a;
  assert.equal(c.canonicalJSON(value), '{"a":{"x":1},"b":{"x":1}}');
});
test('patch reports permit only unique applied or not-applicable records', () => {
  const valid = artifact(); valid.patchReport = [{ id: 'patch-a', status: 'applied', matches: 2, expected: 2 },
    { id: 'patch-b', status: 'not-applicable' }];
  assert.doesNotThrow(() => c.assertArtifactManifest(valid));
  const invalid = [null, {}, { id: 'a', status: 'other' }, { id: 'a/b', status: 'not-applicable' },
    { id: 'a', status: 'not-applicable', source: '/secret' }, { id: 'a', status: 'applied', matches: 1, expected: 2 },
    { id: 'a', status: 'applied', matches: 0, expected: 0 }, { id: 'a', status: 'applied', matches: 1.5, expected: 1.5 },
    { id: 'a', status: 'applied', matches: Number.MAX_SAFE_INTEGER + 1, expected: Number.MAX_SAFE_INTEGER + 1 }];
  for (const entry of invalid) { const v = artifact(); v.patchReport = [entry]; rejects(() => c.assertArtifactManifest(v)); }
  for (const key of Object.keys(valid.patchReport[0])) {
    const v = artifact(); const entry = { ...valid.patchReport[0] }; delete entry[key]; v.patchReport = [entry]; rejects(() => c.assertArtifactManifest(v));
  }
  valid.patchReport.push({ id: 'patch-a', status: 'not-applicable' }); rejects(() => c.assertArtifactManifest(valid));
});
test('runtime accepts an explicit valid manifest and all fixed role MIME pairs', () => {
  const value = runtime();
  for (const role of ['stylesheet', 'wasm', 'shader', 'data', 'resource-document']) value.files.push({ ...file(role, role), path: `assets/${role}` });
  assert.doesNotThrow(() => c.assertRuntimeManifest(value));
});
test('runtime rejects missing, extra, and mistyped fields at every structural level', () => {
  for (const locate of [v => v, v => v.files[0], v => v.dependencies[0]]) {
    for (const key of Object.keys(locate(runtime()))) {
      const missing = runtime(); delete locate(missing)[key]; rejects(() => c.assertRuntimeManifest(missing));
      const wrong = runtime(); locate(wrong)[key] = null; rejects(() => c.assertRuntimeManifest(wrong));
    }
    const extra = runtime(); locate(extra).unexpected = 1; rejects(() => c.assertRuntimeManifest(extra));
  }
});
test('runtime rejects spoofed roles, duplicate identities, missing closure and quotas', () => {
  const mutations = [v => v.manifestVersion = 2, v => v.files[0].mime = 'text/javascript',
    v => v.files[0].role = 'unknown', v => v.entryKey = 'missing', v => v.entryKey = 'app',
    v => v.files[1].key = 'index', v => v.files[1].path = 'index.html',
    v => v.dependencies[0].from = 'missing', v => v.dependencies[0].to = 'missing',
    v => v.files[0].sha256 = 'A'.repeat(64), v => v.files[0].size = -1,
    v => v.files[0].size = 1.5, v => v.files[0].size = Number.MAX_SAFE_INTEGER + 1,
    v => v.files[0].size = 32 * 1024 * 1024 + 1,
    v => v.files = Array.from({ length: 513 }, (_, i) => ({ ...file(`f${i}`), path: `f${i}` })),
    v => { v.files = Array.from({ length: 5 }, (_, i) => ({ ...file(`f${i}`, 'html', 32 * 1024 * 1024), path: `f${i}` })); v.entryKey = 'f0'; v.dependencies = []; }];
  for (const mutate of mutations) { const value = runtime(); mutate(value); rejects(() => c.assertRuntimeManifest(value)); }
  const boundary = runtime(); boundary.files = Array.from({ length: 4 }, (_, i) => ({ ...file(`f${i}`, 'html', 32 * 1024 * 1024), path: `f${i}` }));
  boundary.entryKey = 'f0'; boundary.dependencies = []; assert.doesNotThrow(() => c.assertRuntimeManifest(boundary));
});
test('runtime and artifact reject array-valued file roles', () => {
  const runtimeValue = runtime(); runtimeValue.files[1].role = ['program'];
  rejects(() => c.assertRuntimeManifest(runtimeValue));
  const artifactValue = artifact(); artifactValue.files[1].role = ['program'];
  rejects(() => c.assertArtifactManifest(artifactValue));
});

const { createHash } = require('node:crypto');
const { fail } = require('../security');
const bad = () => fail(422, '运行包或交付清单无效');

function canonicalJSON(value) {
  const ancestors = new Set();
  function visit(v) {
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v);
    if (!v || typeof v !== 'object' || ancestors.has(v) || Object.getOwnPropertySymbols(v).length) throw bad();
    const array = Array.isArray(v);
    if (!array && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw bad();
    const names = Object.getOwnPropertyNames(v);
    if (array ? names.length !== v.length + 1 : names.length !== Object.keys(v).length) throw bad();
    for (const name of names) {
      if (array && name === 'length') continue;
      const d = Object.getOwnPropertyDescriptor(v, name);
      if (!d.enumerable || !Object.hasOwn(d, 'value')) throw bad();
    }
    if (array && Object.keys(v).some((k, i) => k !== String(i))) throw bad();
    ancestors.add(v);
    const result = array ? '[' + Array.from(v, visit).join(',') + ']'
      : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + visit(v[k])).join(',') + '}';
    ancestors.delete(v);
    return result;
  }
  return visit(value);
}
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const digestJSON = value => sha256(canonicalJSON(value));
function logicalKey(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) || value.includes('..')) throw bad();
  return value;
}
function sourcePath(value) {
  if (typeof value !== 'string' || value.length > 1024 || /[\\%?#\x00-\x1f\x7f]/.test(value)
    || value.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.')) || /^[A-Za-z]:/.test(value)) throw bad();
  return value;
}
function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== allowed.length || allowed.some(k => !Object.hasOwn(value, k))) throw bad();
}
function normalizeReferences(refs) {
  canonicalJSON(refs);
  if (!Array.isArray(refs)) throw bad();
  const found = new Map();
  for (const ref of refs) {
    fields(ref, ['resourceId', 'slot']);
    if (typeof ref.resourceId !== 'string' || !ref.resourceId || typeof ref.slot !== 'string' || !ref.slot
      || ref.resourceId.includes('\0') || ref.slot.includes('\0')) throw bad();
    found.set(ref.resourceId + '\0' + ref.slot, { resourceId: ref.resourceId, slot: ref.slot });
  }
  return [...found].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, v]) => v);
}
const ROLE_MIME = Object.freeze({ html: 'text/html', program: 'text/javascript', stylesheet: 'text/css',
  wasm: 'application/wasm', shader: 'text/plain', data: 'application/json', 'resource-document': 'application/manifest+json' });
const integer = v => Number.isSafeInteger(v) && v >= 0;
const digest = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
function fileIndex(files, registration) {
  if (!Array.isArray(files) || !files.length || files.length > (registration ? 512 : 4096)) throw bad();
  const found = new Map(), paths = new Set();
  let total = 0;
  for (const f of files) {
    fields(f, registration ? ['key', 'role', 'mime', 'size', 'sha256', 'path'] : ['key', 'role', 'mime', 'size', 'sha256']);
    logicalKey(f.key);
    if (typeof f.role !== 'string' || !Object.hasOwn(ROLE_MIME, f.role) || f.mime !== ROLE_MIME[f.role] || !integer(f.size) || !digest(f.sha256)
      || found.has(f.key) || (registration && f.size > 32 * 1024 * 1024)) throw bad();
    if (registration) { sourcePath(f.path); if (paths.has(f.path)) throw bad(); paths.add(f.path); }
    total += f.size;
    if (total > (registration ? 128 : 256) * 1024 * 1024) throw bad();
    found.set(f.key, f);
  }
  return found;
}
function assertRuntimeManifest(value) {
  canonicalJSON(value);
  fields(value, ['manifestVersion', 'profileId', 'templateId', 'entryKey', 'files', 'dependencies']);
  if (value.manifestVersion !== 1) throw bad();
  logicalKey(value.profileId); logicalKey(value.templateId); logicalKey(value.entryKey);
  const files = fileIndex(value.files, true);
  if (files.get(value.entryKey)?.role !== 'html' || !Array.isArray(value.dependencies)) throw bad();
  for (const d of value.dependencies) {
    fields(d, ['from', 'to', 'via']);
    if (!files.has(d.from) || !files.has(d.to) || typeof d.via !== 'string' || !d.via || d.via.includes('\0')) throw bad();
  }
}
const ENDPOINT_ROLES = Object.freeze({ config: 'data', 'identity.js': 'program', 'bridge.js': 'program',
  'app.js': 'program', 'uil.json': 'data', 'projects.json': 'data', 'compiled.vs': 'shader',
  'metadata.json': 'data', 'contact.json': 'data', 'unsupported.html': 'html' });
function mapping(value, files, validateKey, roles) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw bad();
  for (const [key, target] of Object.entries(value)) {
    validateKey(key);
    if (typeof target !== 'string' || !files.has(target) || !roles(key).includes(files.get(target).role)) throw bad();
  }
}
function assertArtifactManifest(value) {
  canonicalJSON(value);
  fields(value, ['manifestVersion', 'kind', 'target', 'runtimeDigest', 'profileId', 'templateId', 'selectionGeneration',
    'sourceSnapshotDigest', 'projectionDigest', 'referencesDigest', 'adapterDigest', 'origin', 'files', 'routes',
    'endpoints', 'runtime', 'documents', 'references', 'patchReport']);
  if (value.manifestVersion !== 1 || !['pinned', 'legacy-render'].includes(value.kind) || !integer(value.selectionGeneration)) throw bad();
  logicalKey(value.profileId); logicalKey(value.templateId);
  for (const key of ['runtimeDigest', 'sourceSnapshotDigest', 'projectionDigest', 'referencesDigest', 'adapterDigest']) {
    if (!digest(value[key])) throw bad();
  }
  fields(value.target, ['type', 'id']);
  const { type, id } = value.target;
  if (typeof id !== 'string' || (type === 'version'
    ? !/^[1-9][0-9]*$/.test(id) || !Number.isSafeInteger(Number(id))
    : type !== 'preview' || !/^preview-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))) throw bad();
  try {
    const url = new URL(value.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value.origin || url.username || url.password) throw bad();
  } catch { throw bad(); }
  const files = fileIndex(value.files, false);
  mapping(value.routes, files, key => {
    if (key !== '/' && key !== '/work' && !/^\/work\/[a-z0-9][a-z0-9-]{0,100}$/.test(key)) throw bad();
  }, () => ['html']);
  if (!Object.hasOwn(value.routes, '/') || !Object.hasOwn(value.routes, '/work')) throw bad();
  fields(value.endpoints, Object.keys(ENDPOINT_ROLES));
  mapping(value.endpoints, files, () => {}, key => [ENDPOINT_ROLES[key]]);
  mapping(value.runtime, files, logicalKey, () => ['program', 'stylesheet', 'wasm']);
  const refs = normalizeReferences(value.references);
  if (digestJSON(refs) !== value.referencesDigest) throw bad();
  const resources = new Set(refs.map(ref => ref.resourceId));
  mapping(value.documents, files, key => { if (!resources.has(key)) throw bad(); }, () => ['resource-document']);
  if (!Array.isArray(value.patchReport)) throw bad();
  const patches = new Set();
  for (const entry of value.patchReport) {
    if (!entry || !['applied', 'not-applicable'].includes(entry.status)) throw bad();
    fields(entry, entry.status === 'applied' ? ['id', 'status', 'matches', 'expected'] : ['id', 'status']);
    logicalKey(entry.id);
    if (patches.has(entry.id) || (entry.status === 'applied'
      && (!integer(entry.expected) || entry.expected === 0 || entry.matches !== entry.expected))) throw bad();
    patches.add(entry.id);
  }
}
module.exports = { canonicalJSON, sha256, digestJSON, logicalKey, sourcePath, normalizeReferences,
  assertRuntimeManifest, assertArtifactManifest };

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('production stack uses a required prebuilt image and HTTPS production settings', () => {
  const source = read('compose.production.yaml');
  assert.match(source, /image: \$\{SITE_IMAGE:\?/);
  assert.match(source, /NODE_ENV: production/);
  assert.match(source, /SITE_ORIGIN: \$\{SITE_ORIGIN:\?/);
  assert.match(source, /127\.0\.0\.1:\$\{SITE_PORT:-3302\}:3000/);
  assert.doesNotMatch(source, /\bbuild:|network_mode:|privileged:|NODE_ENV: development/);
});

test('production database is private, persistent, and initialized with a distinct application role', () => {
  const source = read('compose.production.yaml');
  const [site, database] = source.split('\n  db:\n');
  assert.ok(database, 'separate database service');
  assert.doesNotMatch(database, /\bports:/);
  assert.match(database, /image: postgres:18-alpine/);
  assert.match(database, /pg-data:\/var\/lib\/postgresql/);
  assert.match(database, /source: \.\/docker\/postgres-init\.sh/);
  assert.match(database, /create_host_path: false/);
  assert.match(database, /POSTGRES_USER: site_bootstrap/);
  assert.match(database, /POSTGRES_APP_USER: site_app/);
  assert.match(site, /DATABASE_URL: postgresql:\/\/site_app:\$\{POSTGRES_APP_PASSWORD:\?/);
  assert.doesNotMatch(site, /POSTGRES_PASSWORD/);
  assert.match(site, /condition: service_healthy/);
});

test('production data and secrets are explicit and never use default passwords', () => {
  const source = read('compose.production.yaml');
  assert.match(source, /site-data:\/app\/data/);
  assert.match(source, /SITE_MASTER_KEY: \$\{SITE_MASTER_KEY:\?/);
  assert.match(source, /POSTGRES_PASSWORD: \$\{POSTGRES_PASSWORD:\?/);
  assert.match(source, /POSTGRES_APP_PASSWORD: \$\{POSTGRES_APP_PASSWORD:\?/);
  const example = require('node:util').parseEnv(read('docker/production.env.example'));
  for (const key of ['SITE_IMAGE', 'POSTGRES_PASSWORD', 'POSTGRES_APP_PASSWORD', 'SITE_MASTER_KEY', 'SETUP_TOKEN'])
    assert.equal(example[key], '', `${key} must be configured privately`);
  assert.match(example.SITE_ORIGIN, /^https:\/\//);
});

test('production documentation distinguishes image delivery, v5 migration, and manual TLS setup', () => {
  const source = read('docs/PRODUCTION.md');
  for (const text of ['compose.production.yaml', 'docker image load', 'v5', 'SITE_ORIGIN', '1Panel', 'down -v'])
    assert.ok(source.includes(text), text);
  assert.match(source, /不包含.*(?:素材|assets)/);
});

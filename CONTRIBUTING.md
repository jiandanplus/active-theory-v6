# Contributing

Node.js 24+ and PostgreSQL 18 are required. Install exactly the lockfile with `npm ci`. Use a dedicated local test database, not DATABASE_URL for an existing installation. `compose.test.yaml` creates a disposable PostgreSQL service on loopback port 55432; check the port and existing containers first. If a test service already owns it, reuse that service rather than replacing it.

```sh
npm run lint
npm run format:check
npm run typecheck
npm run test:launcher
npm test
```

An explicit test database requires both `TEST_DATABASE_URL` and `TEST_DATABASE_CONFIRMED=yes`. The test role must be allowed to create/drop isolated test databases; it is not the application's production role. `npm test` excludes the named `authorized runtime:` group, while still exercising synthetic engine contracts, installer, resource and delivery tests. `test:authorized-runtime` is separate and fails when authorized bytes are not provided. Do not describe an unrun optional gate as passing.

Quality tooling has intentional incremental scope: ESLint checks the new deployment scripts, new admin browser modules, shared content validation and launcher tests; Prettier checks the deployment scripts/tests and tooling configs; TypeScript strict `checkJs` checks the launcher, shared content contract implementation and browser API boundary. Existing legacy engine/repository code is not claimed to be fully typed or globally reformatted. New typed boundaries use JSDoc and `unknown` for untrusted inputs, not blanket `any` or `ts-nocheck`.

Keep route handlers small and leave persistence in repositories. Put shared validation in `shared/`, not two different browser/server copies. Keep the composition root focused on middleware, lifecycle and route composition. Runtime packages are opaque approved bytes with manifests and hashes; never execute arbitrary server-side code from uploaded bundles.

Use failing regression tests before behavior changes. Test against owned fixtures. Do not download original assets, modify user experiments, reset `.env`, delete data volumes, or change real storage credentials to make tests pass. Never include setup tokens, passwords, session cookies, master keys, database URLs or full request bodies in reports. Preserve inherited migrations and checksums.

CI runs clean `npm ci`, scoped quality checks, isolated PostgreSQL tests, and a clean Docker image/health smoke check. Browser interaction, external providers, restore drills and production TLS still need explicitly recorded acceptance. Historical tools under `tools/legacy/` are manually invoked, potentially destructive acquisition/generation tools and are outside default CI execution.

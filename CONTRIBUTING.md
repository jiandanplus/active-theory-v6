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

Quality tooling scope:

- ESLint (`eslint .`) checks all server, admin, shared, script and test code with `@eslint/js` recommended rules plus `eqeqeq` and `no-unused-vars`.
- Prettier (`prettier --check .`) checks the repository except files listed in `.prettierignore`. Some files there are **byte-locked**: `shared/site-identity.js` and `shared/page-metadata-dom.js` are served verbatim as the public `identity.js`, `admin-server/engine/program-paths.js` is serialized with `Function#toString()` into public program bytes, and `examples/` feeds the sample runtime. Do not reformat them; type them through `.d.ts` files instead. The repo-wide formatting commit is listed in `.git-blame-ignore-revs`.
- TypeScript `checkJs` runs twice: `tsconfig.json` in strict mode for the launcher, shared content contract and admin API boundary; `tsconfig.server.json` in non-strict mode for `admin-server/delivery`, `admin-server/repositories`, `security.js`, `postgres.js`, `admin-ui/modules` and everything they import. Non-strict means implicit `any` is allowed there; it still catches wrong property access and call arity. New typed boundaries use JSDoc and `unknown` for untrusted inputs, not `ts-nocheck`.
- `tests/public-golden.test.js` pins status, key headers and body SHA-256 of every public route. Any change to public bytes must be intentional and regenerated with `UPDATE_PUBLIC_GOLDEN=1`. `tests/db-request-cost.test.js` pins per-request SQL budgets; lower them when an optimization lands.

The admin UI in `admin-ui/` is native ES modules (`admin-ui/package.json` sets `"type": "module"`; Node 24 `require()` of them works in tests). `index.html` loads one module entry, `admin.js`; the shared `shared/*.js` files stay plain scripts that set browser globals because Node also requires them. Each admin module lists the functions its `create()` adds to the shared context in `export const provides`; `modules/registry.js` wires them and fails at startup if a list and its `create()` disagree.

Keep route handlers small and leave persistence in repositories. Put shared validation in `shared/`, not two different browser/server copies. Keep the composition root focused on middleware, lifecycle and route composition. Runtime packages are opaque approved bytes with manifests and hashes; never execute arbitrary server-side code from uploaded bundles.

Use failing regression tests before behavior changes. Test against owned fixtures. Do not download original assets, modify user experiments, reset `.env`, delete data volumes, or change real storage credentials to make tests pass. Never include setup tokens, passwords, session cookies, master keys, database URLs or full request bodies in reports. Preserve inherited migrations and checksums.

CI runs clean `npm ci`, repository-wide quality checks, isolated PostgreSQL tests, and a clean Docker image/health smoke check. Browser interaction, external providers, restore drills and production TLS still need explicitly recorded acceptance.

Keep the repository focused on runtime code, tests, and maintained user/deployment/development documentation. Historical experiments, screenshots awaiting review, local reports and release archives belong in ignored local output folders, not the published source tree. Current frontend screenshots for the README live in `docs/screenshots/`; they illustrate the online Demo, not assets included in a clean installation. Historical implementation plans and retired acquisition/generation tools remain recoverable from Git history.

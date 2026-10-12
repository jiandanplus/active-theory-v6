# Personal Site Admin Implementation Plan

> **For agentic workers:** Use subagent-driven-development for isolated tasks and review gates. Checkboxes record execution status.

**Goal:** Deliver authenticated resource/configuration management with local uploads and generic S3-compatible storage, preserving the current 3D site.

**Architecture:** Keep the existing frontend and add a modular server under `admin-server/`, with a static admin client under `admin-ui/`. SQLite and uploads live under private `data/`; immutable published configuration snapshots feed the existing page through a version-aware adapter.

**Tech Stack:** Node 24+, Express, node:sqlite, node:crypto, AWS SDK v3, Busboy, browser-native HTML/CSS/JS and node:test.

## Global Constraints

- Single site, single administrator, no public registration.
- Local disk and generic S3-compatible storage; external URLs are references, not implicit downloads.
- Preserve the existing logo, black hole, CMS data and unrelated working-tree edits.
- Never expose the repository root, private database, backups or credentials through static hosting.
- S3 uses public media/CDN URLs; private signed-URL refresh and automatic migration are outside this version.
- No production fallback to the upstream website; missing runtime assets must be reported.
- Run all shell commands with `rtk`; use `apply_patch` for source changes.

## Task 1: Authentication and private persistence

Files: `admin-server/database.js`, `admin-server/security.js`, `admin-server/app.js`, `scripts/admin-account.js`, `tests/admin.test.js`.

Interface: `createApp({root, dataDir, production, origin, masterKey})` returns an Express application with `.locals.store`; store exposes `.db`, `.get(key, fallback)`, `.set(key, value)` and `.close()`. Security exports `createAccount(store, username, password, {reset})`.

- [x] Write HTTP tests asserting unauthenticated `/api/admin/config` returns 401, `/server.js` and `/data/site.db` return 404, login fails with wrong password, valid login issues an HttpOnly cookie, and a CSRF-less write returns 403.
- [x] Run `rtk proxy node --test tests/admin.test.js` and record expected failure before implementation.
- [x] Implement salted scrypt hashes, hashed random session identifiers, persisted idle/absolute expiration, origin/CSRF checks, bounded login rate limits and server-side account initialization.
- [x] Re-run tests for successful login/logout/change password, stale cookies and private path protection. CLI initialization accepts passwords through hidden terminal input, never command-line arguments.

## Task 2: Versioned configuration and compatibility adapter

Files: `admin-server/config.js`, `admin-server/frontend.js`, `tests/config.test.js`.

Interface: `config.initialConfig(root)` returns `{site, projects, scenes, songs}`; `scenes` has entries `{id,label,fields:[{key,label,type,value}]}` for known configuration slots. Store keys are `draft`, `published`, `revision`; snapshots record IDs. Public endpoints must never serialize storage configuration or secrets.

- [x] Write tests for importing live UIL/CMS values, optimistic revision conflicts, immutable versions and restore-to-draft, ensuring publish does not rewrite source assets.
- [x] Implement whitelisted configuration validation and versioned `/api/site/:version/config`, CMS, UIL and asset-reference mapping. Serve the current frontend with a pinned configuration version so all requests use the same snapshot.
- [x] Tests must assert malformed protocols/markup inputs are rejected or safely treated as text, existing data is retained, and public routes cannot fetch drafts.

## Task 3: Storage and resources

Files: `admin-server/storage.js`, `admin-server/resources.js`, `tests/storage.test.js`.

Interface: authenticated endpoints under `/api/admin`: GET/POST `storages`, POST `storages/:id/test`, GET `resources`, POST `resources/link`, POST `resources/upload` (multipart fields `storageId`, `file`), PATCH `resources/:id` for trash; responses are `{storages}`, `{resources}`, `{resource}`. S3 adapter uses registered configuration only; local adapter resolves generated object keys only.

- [x] Write failure tests for missing storage, invalid schemes, path traversal, spoofed file types, referenced-resource deletion and missing master key.
- [x] Implement encrypted S3 credentials (AES-GCM, deployment master key), redacted responses, fixed public URL encoding, HTTPS and DNS/IP checks, read-only connection checks, and no automatic bucket modification.
- [x] Implement bounded streaming multipart upload, byte-signature validation, UUID keys, safe media route and range requests, explicit external references. Upload failures remove temporary files without modifying published state.
- [x] Test compatible object operations against an isolated local S3 test server, separately recording that real cloud credentials are unavailable.

## Task 4: Admin UI

Files: `admin-ui/index.html`, `admin-ui/admin.css`, `admin-ui/admin.js`, `tests/admin-ui.test.js`.

- [x] Implement Chinese login and initialization guidance, sidebar, overview, website settings, scenes, works, resources, storage and versions, using only APIs from this plan.
- [x] Use safe DOM text creation for all user data, shared resource selector, direct upload progress and explicit S3 credentials behavior. Mark dirty state and distinguish save draft from publish.
- [x] Browser-test login failures, a temporary test account login, each section, draft save, file upload, storage validation and logout; no test credentials or changes to real scene content remain.

## Task 5: Integration, deployment and review

Files: `server.js`, `package.json`, `.env.example`, `.gitignore`, `docs/ADMIN.md`, `Dockerfile`, `compose.yaml`.

- [x] Replace legacy unprotected server entry with the new app, preserving `/` and `/work/*` routes; old write/build routes must not remain accessible.
- [x] Add account/test/start scripts, private data exclusions and single-instance persistent-volume deployment instructions.
- [x] Run all tests, syntax checks, npm audit, and browser previews against an isolated test instance before restarting the user-facing development server.
- [x] Review public/private path boundaries, CSRF, secret handling, upload cleanup and published asset resolution. Record actual limitations rather than claiming full spec completion without evidence.
- [x] Commit only task-owned files; leave prior user changes intact. Do not push GitHub or create a public deployment without user request.

## Progress

- Plan prepared after design approval. Implementation follows in the current checkout on `feat/authenticated-resource-admin`; existing ignored runtime assets remain available for visual regression checks.
- Local first-version implementation and review completed. Isolated browser testing used port 3001 and a temporary database, never the real site's administrator or published content.
- Verified browser login, all eight sections, draft-save isolation, publication, PNG/JPEG upload, local storage test, converted uploaded GLB rendering, empty-playlist rendering, original black-hole rendering and logout. API tests additionally cover password-session invalidation, malformed uploads, range reads, S3 protocol operations and revision conflicts.
- Review defects were fixed with regression tests: missing multipart filenames, virtual-host S3 DNS pinning, invalid public bases, model inverse-transpose normals, legacy model path prefixes/double slashes, required CMS fields, empty playlist handling, textarea initialization and native blocking confirmation dialogs.
- `docs/ADMIN.md` records first-version boundaries. Automatic font-atlas regeneration, full arbitrary shader/transform editing, private S3 signed-link renewal, multi-instance hosting and automatic storage migration are not implemented. Missing changed 3D glyphs are rejected explicitly instead of publishing broken text.
- Real cloud credentials were not provided; real provider, production HTTPS/CDN/CORS and Docker deployment remain deployment acceptance steps, not locally verified claims. Existing runtime assets/fonts require separate rights review and packaging before reusable public release. No GitHub push or public deployment was performed.

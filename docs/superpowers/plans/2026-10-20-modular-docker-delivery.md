# 阶段 C/D 与 Docker 一键交付 Implementation Plan

> **For agentic workers:** Use subagent-driven-development with independent file ownership and task reviews. The user has authorized completion through Docker deployment and browser verification; routine implementation choices do not require another approval.

**Goal:** Complete the approved C/D architecture scope and deliver a clean-checkout Docker launch that opens a usable personal website and authenticated management UI.

**Architecture:** Retain the modular monolith, PostgreSQL, version-bound CAS delivery and local/S3 storage. Split the existing admin and backend by responsibility, share content validation, and add a trusted first-party portfolio runtime with semantic HTML and optional procedural animation. Keep the audited six-scene runtime supported separately. Docker starts the application and its dedicated database; first-run account creation remains in the browser.

**Tech Stack:** Node.js 24+, Express, PostgreSQL 18, native browser JavaScript, Docker Compose, incremental JSDoc/checkJs.

**Status (2026-10-20):** Tasks 1–5 implemented and locally verified on application commit `c2391c6`; Docker home and admin are open for user review. Exact evidence and original-scene/cloud/production boundaries are recorded in [the verification report](../../verification/modular-docker-delivery.md). This is local delivery, not a GitHub push or production rollout.

## Global Constraints

- Preserve immutable migrations 001/002/003 and all existing authentication, CSRF/Origin, transaction, preview, resource revocation and history semantics.
- Preserve original project files and all visual work; work only in the dedicated `feat/modular-docker-delivery` worktree.
- Do not read real `.env`, private data/uploads, cloud credentials or real business databases. Tests use dedicated UUID PostgreSQL databases and owned temporary roots.
- New executable profiles remain trusted server code; uploaded programs cannot execute. The first-party portfolio is additional, not a replacement of the six-scene profile.
- Every published page derives from its immutable published snapshot; ordinary HTML, reduced motion and no-JS content share that snapshot. Drafts never become public through fallback.
- Public examples and procedural visuals contain no borrowed original-site assets or personal CMS content. Preserve existing license status; inventory third-party licenses and identify owner decisions explicitly.
- Docker acceptance must run the actual image/default entrypoint, browser install/login/preview/publish, local uploads, persistent restart and mobile/no-JS paths. Leave the final test deployment running and open it for the user.

## Task 1: Backend boundaries, shared validation, and operational health

**Files:** `admin-server/app.js`, `admin-server/config.js`, `admin-server/resources.js`; new `admin-server/routes/`, `admin-server/services/`, `admin-server/validation/`, `shared/content-contract.js`, `shared/content-contract.d.ts`; task tests.

**Interfaces:** `mountContentRoutes({admin,store,options,deliveryService})`; shared browser/CommonJS validation exports; `GET /health/live` returns only `{status:'ok'}` and `GET /health/ready` checks DB and installation without leaking secrets. Request IDs are validated/generated, returned as X-Request-ID and JSON request summaries omit query strings, credentials and bodies. Ready may accept an uninstalled compatible DB so the installer can run; upgrade-required/incompatible/unavailable is 503.

- [x] Capture existing content/resources API behavior through regression tests before extraction. Add shared validation parity and real health fault tests, then observe the expected failures for missing contracts/health.
- [x] Move handlers and use cases without weakening locking. Keep SQL in existing repositories; split resource/storage routes and resource services by responsibility. Keep public exports compatible where used by old tests.
- [x] Move validation rules into a browser/CommonJS shared module, separate generic site/project/song rules from template scene slot validation, and retain Chinese errors. Backend maps validation errors into the existing status contract; frontend can consume the same rules.
- [x] Run relevant content/config/resource/auth/installation/health tests against the dedicated test database. Record exact commands and results in `output/cd-reports/backend.md`.

## Task 2: Admin modules and accessible stateful interactions

**Files:** `admin-ui/admin.js`, `admin-ui/index.html`, `admin-ui/admin.css`, new `admin-ui/modules/`; `tests/admin-ui.test.js` and new module tests. Do not change setup.js (Task 3).

**Interfaces:** retain CommonJS helper exports and the boot function; browser modules load in deterministic order from index.html with no bundler requirement. Separate API client, state lifecycle, DOM/dialog helpers and overview/site/scenes/projects/resources/storage/versions/security views. Shared validation is served at `/admin/content-contract.js`. `POST /api/admin/runtime/builtin` returns `{digest,profileId,files,bytes}` and only registers the first-party package; user selection remains explicit. Add a clear UI action for it.

- [x] Add parity tests exercising module boot, stale responses, dirty edits, pending actions, confirmation/focus, storage secret masking, view switching and module loading. Preserve real behavior, update source-locator tests to inspect the new modules rather than freezing the old monolith shape.
- [x] Extract helpers and views into genuinely focused modules using an explicit injected context. Preserve API endpoints and all Chinese feedback. Keep API/session state owned once.
- [x] Add the first-party runtime registration control beside existing runtime choices, with busy and unknown-result semantics. Use shared content validation before save.
- [x] Run the admin UI tests and record commands/results in `output/cd-reports/admin.md`.

## Task 3: Semantic portfolio, first-party sample, and progressive 3D

**Files:** new `admin-server/engine/profiles/portfolio-v1.js`, `admin-server/portfolio/`, `examples/portfolio/`; modify registry, builder/identity as needed, setup UI, installation/bundle importer, delivery admin routes and focused tests.

**Interfaces:** trusted profile ID `portfolio-v1`, template ID `portfolio`; four explicit program roles compatible with the existing builder (`index`,`unsupported`,`app`,`compiled-shaders`) plus any declared stylesheet. No silent selection, no production hash learned from user uploads. `/api/admin/runtime/builtin` only registers known first-party program bytes. Setup gets a distinct `demo` source and the existing `empty/bundle/legacy` modes remain compatible.

- [x] Add tests for new profile closure and deterministic delivery, escaped semantic home/work/detail/contact content, stale draft protection, private preview access, origin changes and missing/corrupt program failure.
- [x] Implement first-party semantic HTML from the same projected snapshot with navigation, introduction, projects, contact, skip link and visible links to ordinary content. Render all essential content without JS. Make legacy 3D pages provide an ordinary-content entry and respond safely when WebGL initialization fails or reduced-motion is requested; never render draft as fallback.
- [x] Add an optional procedural WebGL black-hole accent for the sample, with reduced-motion, context loss, visibility, resize and dispose handling; show the semantic page when it cannot start. It is an original sample and does not claim visual parity with the user's jar.
- [x] Provide generic Chinese sample content and original generated SVG art under examples, with provenance. Install as draft only, register/select/publish through normal authenticated controls. Preserve schema validation and historical references.
- [x] Record focused protocol and actual browser/no-JS/mobile/keyboard results in `output/cd-reports/portfolio.md`.

## Task 4: One-command Docker, quality tools, CI and deployment docs

**Files:** Dockerfile, Compose files, `.dockerignore`, package.json/lock, `scripts/`, `docker/`, `.github/workflows/`, README and deployment/contributor/provenance docs; tooling config and deployment tests. Own these paths exclusively.

**Interfaces:** a documented one-command local launcher such as `npm run docker:up` generates fresh installation secrets in an owned ignored deployment directory (never overwrites existing config), validates port/origin, invokes Compose with an explicit env file and leaves persistent named volumes. Local HTTP binds loopback only; production keeps the HTTPS guard. Display the local URL and setup token only to the operator. Never bake operator secrets or original assets into images. Docker checks `/health/ready`. Add non-destructive status/stop commands and documented backup/recovery; do not provide automatic data deletion.

- [x] Add launch/config tests for repeat invocation preserving secrets, invalid origins/ports, separate DB roles, missing optional assets, readiness and image contents. Observe missing launcher/config failures before implementation.
- [x] Implement self-contained default sample deployment with DB role init and volume ownership. Avoid default public credentials; permit production configuration and external PG without claiming production TLS verified locally.
- [x] Add scoped lint/format/typecheck with JSDoc examples, base tests that do not need proprietary assets and a separate authorized-runtime check. CI runs clean npm ci and PostgreSQL tests, and fails rather than calling skipped proprietary checks complete.
- [x] Organize only tracked historical acquisition/generation tools under a documented tools/ location with compatibility where needed; leave original user experiments untouched. Add third-party inventory without assigning a new license to unknown inherited material.
- [x] Update README, Docker deployment and contribution docs for clean clone, install, first publish, storage config, upgrade, backup, restore and limitations. Run tool checks and deployment tests, record in `output/cd-reports/docker.md`.

## Task 5: Integrated acceptance, review and user handoff

- [x] Run all tests and scoped quality tools on the final code; run actual Docker build and deploy the default entrypoint to a new loopback port with owned volumes/database, no original private state.
- [x] Complete browser install with a test administrator, register/select the built-in runtime, preview and publish the demo. Verify public home/work/detail/contact, editing/publish history, local upload/retrieval, logout protection, restart persistence, mobile, keyboard, zoom, no-JS and WebGL-failure/reduced-motion. Run isolated S3 protocol tests; describe live cloud/TLS evidence separately.
- [x] Exercise consistent owned-data backup/restore into another dedicated instance; verify key content/account/history/media and CAS hashes. Keep final original test instance running for the user.
- [x] Perform fresh task and whole-change reviews, resolve findings and preserve evidence. Compare original dirty files before any integration. Integrate authorized finished work locally if safe, leaving user changes intact; no GitHub push is required by this goal.
- [x] Open the tested Docker site and its admin UI in Codex; provide URL and test login through local handoff with exact evidence and remaining owner license decisions. Mark the goal complete only after all required outcomes are proven.

Task reports were preserved at `output/cd-reports/` in the managed worktree and copied into the original project's `output/cd-docker-integration-20261020/reports/`. The cross-task browser/image/restore evidence and known limits are consolidated in the verification report; the early task reports are not final deployment claims.

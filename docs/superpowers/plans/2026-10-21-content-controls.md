# Content-only Administration Implementation Plan

> **For agentic workers:** Use subagent-driven-development with one implementation agent at a time and a scoped task review; main handles the independent runtime/resource integration. User approved the entire described scope. Do not ask again for routine implementation choices.

**Goal:** Expose business content and protect the original visual theme in UI and authenticated save APIs.

**Architecture:** Optional flat site fields flow through the existing draft, media catalog, immutable preview and publication pipeline. No schema migration or new frontend template. The old runtime is transformed through the existing audited adapter, not edited on disk.

**Tech Stack:** Existing JavaScript UMD modules, Node.js tests, Express/PostgreSQL, original Hydra runtime adapter.

## Global Constraints

- Preserve original program/assets bytes and locked current draft values. No user-draft mutations, automatic publication or external cloud actions during validation.
- Exact editable model: `Home / INPUT_Config_8_ParticleTest_geometry`; all text fields remain editable; other scene fields are locked and hidden.
- Optional media fields: heroVideo(video), heroPoster(image), labBackground(image), contactInstagramIcon(image), contactLinkedinIcon(image), contactXIcon(image), contactQrImage(image).
- Optional text fields: contactHomeText, contactJoinText, contactAboutText, contactInstagramText, contactLinkedinText, contactXText, contactQrText.
- Optional HTTPS links: contactHomeURL, contactJoinURL, contactAboutURL, contactInstagramURL, contactLinkedinURL, contactXURL.
- Empty/absent content overrides inherit original behavior. Old snapshot/config bytes remain untouched until a user saves. Uploaded QR image is displayed without changing its payload or applying invert effects.

### Task 1: Shared policy and save boundary

Own: `shared/page-content.js`, `shared/content-contract.js`, `shared/content-types.d.ts`, `admin-server/services/content.js`, `admin-server/routes/content.js`, focused tests. Do not edit snapshots/publication/adapter/UI (main and later task own them).

Interfaces in new UMD `SitePageContent` / CommonJS module:

```js
// MEDIA_FIELDS: Object.freeze({heroVideo:{label:'开场背景视频',kind:'video',default:'assets/video/reel.mp4'}, ...})
// TEXT_FIELDS and LINK_FIELDS: Object.freeze({key:{label,default}, ...})
// PAGE_KEYS: Object.freeze([...Object.keys(MEDIA_FIELDS),...Object.keys(TEXT_FIELDS),...Object.keys(LINK_FIELDS)])
// isEditableSceneField(scene,field): text || (scene.id==='Home' && field.key==='INPUT_Config_8_ParticleTest_geometry' && field.type==='geometry')
// lockSchema(schema,current): clone schema; copy current fixed field values, never mutate inputs.
// isSystemResource(resource,config): bundled engine resource except defaults/current business media (site, projects, songs, top Logo).
```

- [ ] Add focused failing contract/service tests, verify RED, then implement UMD helpers and acceptance of recognized optional site fields, safe media URLs, HTTPS-only navigation and plain text. Existing unknown fields remain rejected.
- [ ] Validate fixed fields against current draft values inside the save transaction; GET schema returns lockSchema; preview/publish checks use same policy. Restore historical content must retain current fixed values. Do not require a migration or write defaults on read.
- [ ] In save media selection use MEDIA_FIELDS to determine correct external/media kinds; enforce that referenced managed icons/QR/poster are image and heroVideo is video. Preserve existing revision, grants, registration and CSRF behavior.
- [ ] Run focused regression, typecheck; report RED/GREEN and exact changed files. Commit only owned files. Return DONE or specific concerns.

### Task 2: Content-only admin UI

Own: `admin-ui/modules/site.js`, `scenes.js`, `resources.js`, `admin-ui/admin.js`, `admin-ui/index.html`, relevant UI tests. Read Task 1's exported interface; do not change backend, shared helpers or runtime adapters.

- [ ] Add failing DOM tests for filtering fixed scene controls, page media/contact/social fields and selection kinds; verify RED.
- [ ] Load `/admin/page-content.js` before content-contract; inject pageContent via context (CommonJS fallback for tests). Existing navigation may remain to avoid unnecessary redesign. Website settings groups: 开场与底部展示, 联系页面链接, 社交媒体, 微信二维码. Existing labUrl label becomes 底部展示区跳转链接.
- [ ] Render optional fields from the shared definitions, without writing defaults to config on render. All media use correct existing picker. Help explains empty inherits, PNG/WebP transparent icons and square QR original image, preview then publish, glyph coverage and external CORS limits. Keep field labels distinct/accessibility intact.
- [ ] Scenes filter through isEditableSceneField before searching/rendering, preserve hidden fields unchanged in memory. Resource library/pickers filter through isSystemResource; source originals are not deleted. Keep GLB auto-conversion from prior feature and manual retry.
- [ ] Run new UI and existing admin-module tests; report RED/GREEN. Commit only owned files, no user state access.

### Task 3: Runtime and resource pipeline integration (main)

Own: admin app shared-script route, snapshots.js, resource-catalog.js as needed, delivery/projection.js, publication.js, engine/legacy-adapter.js and adapter-specific helper if needed, integration/adapter tests.

- [ ] Add failing exact runtime-patch, site-media reference/grant and projection tests. Verify missing optional fields leave old source semantics untouched.
- [ ] Preserve optional page keys in public config; select/map media by same MEDIA_FIELDS; collect/validate/freeze only selected resource identities. Add optional runtime patches for video/poster, HexagonGrid content, link text/URL, social icons/names, and custom QR image while preserving original layout and shaders. Patch failures fail closed with report; register patch IDs in existing contracts.
- [ ] Check labels against the original bitmap font coverage before preview/publish where required. No inline executable content or untrusted asset-to-program conversion.
- [ ] Full tests against dedicated site-pg-test DB with AUTHORIZED_RUNTIME_ROOT original only read-only. Review Task 1/2 and broad diff; fix actionable findings before release.
- [ ] Build image, validate separate synthetic preview/publish database clone, then update only 3302 app image while retaining DB/volumes/original assets/current published bytes. Reload admin only if no unsaved browser changes, open new content groups, capture screenshots. Do not auto-publish current user's site.
- [ ] Record evidence and remaining limits; integrate scoped source back to project preserving user dirty files. No push/PR or production switch.

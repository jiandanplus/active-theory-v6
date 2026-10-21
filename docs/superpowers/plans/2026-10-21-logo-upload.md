# 顶部 3D Logo 与自动转换 Implementation Plan

> **For agentic workers:** Use executing-plans for inline execution. The user approved option 1; do not pause for the already-selected behavior. Keep the existing isolated worktree and do not edit user-owned visual files.

**Goal:** Give the original top Logo an explicit label and Hunyuan link, and automatically convert uploaded GLB without changing current scene content.

**Architecture:** Keep changes in the existing scenes/resources browser modules. Reuse the authenticated upload and conversion APIs; do not add a worker, queue, dependency, schema or frontend template. Preserve captureView guards between asynchronous operations.

**Tech Stack:** Existing plain JavaScript DOM modules, Node.js tests, existing Express conversion endpoint.

## Global Constraints

- Link: `https://3d.hunyuan.tencent.com/`; label: `顶部 3D Logo`.
- Original key: `Home` / `INPUT_Config_8_ParticleTest_geometry`.
- Conversion size: `0.8`; no implicit selection, draft write, publish or retry.
- Preserve original GLB and existing manual converter after failure.

### Task 1: Label and automatic upload conversion

**Files:** modify `admin-ui/modules/scenes.js`, `admin-ui/modules/resources.js`, `admin-ui/modules/dom.js` (optional safe label link and description), `admin-ui/admin.css` (label row spacing); add `tests/logo-upload.test.js`. No visual asset edits.

**Interfaces:** consume upload result `{resource}` and `canConvert(resource)`; call `api('/resources/'+resource.id+'/convert', 'POST', {size:0.8})`. Existing `captureView()` must remain valid before every follow-up call and UI update.

- [ ] Add tests with the real scenes/resources modules and observable DOM, mocking only HTTP/XHR boundaries. Assert the top Logo label, exact link target/rel, unchanged draft and original field key; auto conversion local/S3 only; upload failure; conversion failure with original retained; stale-view/session guards.
- [ ] Run `node --test tests/logo-upload.test.js` and observe missing label/convert failures, not fixture errors.
- [ ] In scenes, identify the exact Home key, use the new display label for rendering/search, attach a safe external anchor beside its label, and append the approved guidance. Retain original config objects unchanged.
- [ ] In the upload handler, capture `const {resource} = await uploadFile(...)`; after `current()` succeeds, call conversion only for `resource && canConvert(resource)`. Set status before POST; catch conversion errors separately from upload failures. Refresh the library, notify success/failure, keep the original and manual retry. Recheck `current()` after every await; never call config/save/publish.
- [ ] Run `node --test tests/logo-upload.test.js tests/admin-ui.test.js tests/admin-modules.test.js`, then the repository quality checks. Review exact diff and commit only scoped changes.

### Task 2: Local runtime verification

**Files:** verification record `docs/verification/logo-upload.md`; owned evidence under ignored/private deployment or output folders only.

- [ ] Build an image containing the two module changes. Retain the existing original assets and 3302 data volumes, do not rerun setup or republish current content.
- [ ] Use a dedicated synthetic upload through normal authenticated APIs/UI to prove a new ready BIN exists while the GLB remains, without assigning it to a scene. Preserve user draft and publication.
- [ ] Reload the admin only after confirming no unsaved changes, open and filter the new top Logo field, verify the hyperlink and instructions. Inspect the original public frontend separately without changing it.
- [ ] Record executed test counts, browser/image identity and any remaining limits. Never claim a real cloud provider or Hunyuan generation was tested.

# Historical operator tools

`legacy/` contains tracked acquisition and generation scripts moved from the repository root. Compatibility entry points at the old root paths continue to load them, and `npm run download:core`, `download:assets`, and `download:cms` resolve to the grouped files. Paths inside moved implementations still target the repository root.

These tools may overwrite index.html, CMS JSON, models or other local assets and may contact the original site. They are not installation steps, are never automatically invoked by the default Docker workflow, and are excluded from images. Run only after confirming authorization, backing up operator data, and inspecting the source and target paths.

Only known tracked historical files were moved. Existing local experiments and user-owned files were not swept into tools/; in particular the original generate-o-obj.js and generate-o-particles.js paths are unchanged. Some older inspection/restoration scripts remain at their original paths pending separate owner review. Their presence is not part of the self-contained sample contract.

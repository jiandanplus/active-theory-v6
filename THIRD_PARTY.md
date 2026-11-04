# Third-party inventory boundary

This is an inventory guide, not a grant of rights or a complete legal clearance. No project-wide license is assigned by this change. The owner must review inherited material before distribution.

| Material | Source / inventory | Distribution boundary |
| --- | --- | --- |
| Runtime npm dependencies | Exact versions and integrity in package-lock.json; AWS SDK, Smithy handler, axios, busboy, draco3d, Express, file-type, pg and transitive dependencies | Individual package licenses apply; inspect installed package LICENSE/NOTICE before distributing images |
| Development tools | ESLint, Prettier, TypeScript, Node type declarations in package-lock.json | Development-only; omitted by production npm ci |
| Base images | node:24-bookworm-slim, postgres:18-alpine | Upstream Node, Debian, PostgreSQL, Alpine and bundled component terms apply; tags are updateable, not immutable digests |
| New portfolio sample | examples/portfolio/, trusted portfolio-v1 profile | Newly authored demonstration; no original artwork or proprietary runtime required |
| Inherited JS / HTML / CMS / transforms | Existing repository history, cms/ and admin-server/engine/ | Ownership and license not established by this task; do not assume MIT or original-site permission |
| Original runtime / models / fonts / media | Operator-provided assets/ or runtime manifest | Not bundled in default Docker or guaranteed by clean-clone tests; operator must hold rights |
| Frontend preview screenshots | docs/screenshots/, captured from the public Demo at agi.drawbookai.cn | Documentation previews only; they do not include or grant rights to original runtime assets |
| Historical acquisition / generation tools | Retired tools in Git history and any retained local experimental scripts | Tools are not licenses to acquire or redistribute upstream content; not invoked automatically |

For a distributable release, capture `npm ls --all`, preserve required notices from the installed production dependency tree and base images, pin reviewed image digests, scan dependencies and images, and obtain the owner's licensing decision. A zero-vulnerability npm audit is not a license audit or a production security certification.

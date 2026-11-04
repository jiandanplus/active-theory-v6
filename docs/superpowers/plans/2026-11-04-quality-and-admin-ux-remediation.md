# 代码质量与后台体验修复方案

> **已被取代：** 请以 [项目优化方案（最新版）](2026-11-04-optimization-plan.md) 为准。本文仅保留作详细依据参考。

> 来源：2026-11-04 代码质量评审。评审方式：放宽范围运行 ESLint / tsc / Prettier；在本机 Docker 栈（端口 3401）完成安装、登录，并逐页检查后台。本文为实施方案，尚未实施。

**目标：** 修复评审发现的缺陷；让静态检查真实覆盖服务端与后台代码；改善后台的信息展示与操作效率。

**约束（沿用既有计划）：**
- 不改变原站视觉、原素材字节、发布管线语义与数据库结构；不新增迁移。
- 所有修改走既有的草稿 → 预览 → 发布流程，不自动发布。
- 每个阶段结束时，`npm run lint`、`npm run format:check`、`npm run typecheck`、`npm run test:launcher`、`npm test` 必须全部通过。
- 修改 UI 文案时，同步更新依赖这些文案的测试：`tests/admin-modules.test.js`、`tests/content-controls-ui.test.js`。

**分阶段：**

| 阶段 | 内容 | 风险 | 预计 |
|---|---|---|---|
| P0 | 缺陷修复（A1–A3） | 低 | 0.5 天 |
| P1 | 工程门禁（B1–B4） | 低，改动量大但多为机械性修改 | 1 天 |
| P2 | 后台体验（C1–C10） | 中，涉及 UI 与测试文案 | 2–3 天 |
| P3 | 结构重构（D1–D5） | 中高，建议单独开 PR | 3–5 天 |

每阶段单独提交，P3 每项单独提交。

---

## P0 · 缺陷修复

### A1. 网站设置字段顺序错乱

- **问题：** 「基本信息」区按「邮箱显示文字、网站标题、地点三、地点一、地点二、作品导航文字、联系邮箱、联系导航文字、联系页标题」的顺序显示。
- **原因：** 草稿存放在 PostgreSQL 的 jsonb 中，jsonb 会按「键长度 → 字节序」重排对象的键。[site.js:14](../../../admin-ui/modules/site.js) 直接用 `Object.entries(state.config.site)` 遍历，所以页面顺序取决于数据库的存储顺序。
- **修复：**
  1. 在 `admin.js` 的 `labels` 中，按业务顺序定义字段：标题 → 导航 → 联系页标题 → 邮箱 → 地点。
  2. `siteView` 改为先遍历 `Object.keys(labels)`（跳过 `site` 中不存在的键），再按字母序追加 `labels` 里没有的未知键（保持向前兼容）。
  3. 把「地点一/二/三」改成能看出用途的标签，例如「地点一（原 LA）」，并加 help 说明这是联系页显示的城市文字。
- **验收：**
  - [ ] 新增单元测试：传入键顺序被打乱的 `site` 对象，渲染出的标签顺序与 `labels` 定义一致。
  - [ ] 在真实 PostgreSQL 环境中保存草稿、刷新页面后，字段顺序不变。
  - [ ] `site` 里有 `labels` 未定义的键时，该字段仍会显示在末尾，不会丢失。

### A2. `cas.js` 的 finally 中抛异常，覆盖原始错误

- **问题：** [cas.js:127-136](../../../admin-server/delivery/cas.js) 的 `finally` 在清理检查失败时直接 `throw unsafe()`。如果 `try` 块已经因为别的原因失败（例如 sha256 不匹配、磁盘写满），原始错误会被覆盖，日志里只剩次要错误。
- **修复：** 用变量记录主流程的错误。`finally` 中的清理异常只在主流程成功时抛出；主流程失败时，把清理异常挂到原始错误的 `cause`（或 `AggregateError`）上，再抛出原始错误。安全语义不变：目录身份变化仍然一定导致失败。
- **验收：**
  - [ ] 新增测试：模拟写入失败，同时让清理检查也失败。断言抛出的是原始错误，且清理错误可以通过 `cause` 拿到。
  - [ ] 现有的 `tests/delivery-*.test.js` 全部通过。
  - [ ] 扩大范围的 ESLint 不再报 `no-unsafe-finally`。

### A3. 静态检查报出的零散缺陷

- **问题与修复：**
  - [frontend-resources.js:13](../../../admin-server/frontend-resources.js)：`selected==null` 改成显式的 `selected === null || selected === undefined`，语义不变。
  - [importers/sqlite.js](../../../admin-server/importers/sqlite.js) 第 107、170 行附近的空 `catch {}`：确认是有意吞掉异常的，加注释说明原因；不应吞掉的，改为记录日志或抛出。
  - 13 处未使用变量：例如 `services/content.js:126 validatedDraft`、`delivery/reader.js:9 cas`、`engine/legacy-adapter.js` 的 `contract`、`importers/disk.js:121 otherwise`，以及 admin-ui 各模块从 context 解构出来却没用的 `dirty/load/preview/button`。逐个确认后删除。如果 `validatedDraft` 本应参与逻辑，就补上逻辑并加测试。
  - [engine/program-paths.js:42](../../../admin-server/engine/program-paths.js) 用到了 `Request` 全局对象：在 ESLint 的 globals 中声明（Node 24 自带）。
- **验收：**
  - [ ] 按 B1 的配置运行 ESLint，以上规则在全仓库零报错。
  - [ ] `npm test` 全部通过。

---

## P1 · 工程门禁

### B1. ESLint 覆盖全仓库

- **问题：** [eslint.config.js](../../../eslint.config.js) 只检查 6 组文件，只启用 4 条规则。CI 通过并不代表服务端代码检查过。
- **修复：**
  1. 新增开发依赖 `@eslint/js` 和 `globals`。
  2. 配置拆成三组：
     - `admin-server/**`、`scripts/**`、`shared/**`、`server.js`：commonjs + node globals。
     - `admin-ui/**`：browser globals + `module`/`require`，因为当前模块是 UMD 写法。
     - `tests/**`：node globals。
  3. 启用 `js.configs.recommended`，并加上 `eqeqeq`；`no-unused-vars` 设为 `["error", {argsIgnorePattern: "^_"}]`。
  4. 历史脚本（`tools/legacy/**` 和根目录历史脚本）暂时 `ignores`，并在注释中引用 D5。
  5. `package.json` 的 `lint` 改成 `eslint .`。
- **验收：**
  - [ ] `npm run lint` 用 `eslint .` 覆盖上述全部目录，零错误、零警告。
  - [ ] CI 的 lint 步骤不需要改动，照常通过。
  - [ ] 故意加一个未使用变量，lint 会失败（手工验证一次）。

### B2. Prettier 覆盖全仓库，并一次性格式化

- **问题：** 66 个文件不符合 Prettier；同一文件里混用压缩写法和展开写法（例如 `actions.js` 的 `building(async()=>{` 块缩进错乱）。
- **修复：**
  1. `format` 和 `format:check` 改成对整个仓库生效。在 `.prettierignore` 中排除 `cms/*.json`、`tools/legacy`、`index.html`、`editor.html`、`docs/**`、`package-lock.json`。
  2. 单独提交一次纯格式化（commit message 写 `style: apply prettier repo-wide`）。这个提交只能包含格式变化。
  3. 新增 `.git-blame-ignore-revs`，写入该提交的哈希，避免 `git blame` 被污染。
- **验收：**
  - [ ] `npm run format:check` 覆盖全仓库并通过。
  - [ ] 格式化提交的 `git diff -w --ignore-blank-lines` 中不含逻辑改动；`npm test` 全部通过。
  - [ ] `.git-blame-ignore-revs` 存在，且包含该提交。

### B3. 类型检查渐进扩大

- **问题：** tsc 只检查 3 个文件。对 `admin-server` 开启检查后有 85 个错误，主要是 `options = {}` 这类参数被推断为 `{}`。
- **修复：** 不追求一次到位，按目录推进：
  1. 先把 `shared/**`、`admin-ui/modules/**` 加入 `include`，为 `context` 等参数补 JSDoc `@typedef`。
  2. 再加入 `admin-server/delivery/**`、`admin-server/security.js`、`admin-server/repositories/**`，为 `options`、`store` 等公共参数补 `@param` 类型（`store` 用 `shared/content-types.d.ts` 中的类型或新建 `admin-server/types.d.ts`）。
  3. `security.js` 中 `promisify(crypto.scrypt)` 的重载误报，改用 `crypto.scrypt` 加手写 Promise 包装，或用 `/** @type */` 断言。
  4. 其余目录列入 TODO，不在本阶段强求。
- **验收：**
  - [ ] `tsconfig.json` 的 `include` 至少覆盖 shared、admin-ui/modules、admin-server/delivery、admin-server/repositories、admin-server/security.js。
  - [ ] `npm run typecheck` 零错误。
  - [ ] 本阶段不使用 `// @ts-ignore`；如确实需要 `@ts-expect-error`，必须附注释说明原因。

### B4. CI 与本地门禁对齐

- **修复：** CI 步骤保持不变（脚本已经扩大范围）。在 `CONTRIBUTING.md` 中更新「质量工具的精确覆盖」一节，写明新的覆盖范围和忽略列表。
- **验收：**
  - [ ] 推送分支后 CI 全绿。
  - [ ] CONTRIBUTING.md 中的覆盖描述与配置一致。

---

## P2 · 后台体验

### C1. 安装预检报告不可读

- **问题：** [setup.js:303-322](../../../admin-ui/setup.js) 把 `missingRequired`、`warnings` 原样逐条列出。实测有 12 条必需资源缺失和约 100 条英文警告，例如 `External resource is unverified (not fetched): project:659874dd…:video:url:…`。导入数量显示为英文键名：`resources 84，assets 93…`。
- **修复：**
  1. 按前缀把警告归类成中文：
     - `External resource is unverified` → 「外部资源未验证」
     - `Optional resource unavailable` → 「可选资源缺失」
     - `Unsupported resource URL` → 「不支持的资源地址」
  2. 顶部用摘要卡显示每类的条数；必需资源缺失用醒目的警告色。
  3. 每一类的明细放在 `<details>` 中，默认折叠；必需资源缺失默认展开。
  4. 导入数量的键名翻译成中文：resources → 资源记录，assets → 素材文件，projects → 作品，songs → 音乐，storages → 存储配置，versions → 历史版本，audit → 审计记录。
  5. 未知前缀的警告原样归入「其他」，避免信息丢失。
- **验收：**
  - [ ] 用评审时的原站内容包运行预检：首屏只显示摘要（不超过 6 行），明细默认折叠。
  - [ ] 摘要中各类条数之和等于原始警告总数（新增单元测试断言）。
  - [ ] 页面上不再出现英文键名的导入数量。

### C2. 安装令牌验证缺少加载反馈

- **问题：** 点击「验证安装令牌」后，输入框立即被清空，按钮变灰，约 2 秒没有任何提示。
- **修复：** 请求期间，按钮文字改成「正在验证…」，并设置 `aria-busy="true"`；输入框等请求失败后再清空（并提示错误），成功后直接进入下一步。
- **验收：**
  - [ ] 请求进行中，按钮显示「正在验证…」，且不能重复提交。
  - [ ] 令牌错误时出现错误提示，焦点回到输入框。

### C3. 网站设置的帮助文字大量重复

- **问题：** [site.js:39-46](../../../admin-ui/modules/site.js) 给每个可选字段都加了同一段 help。实测「留空继承原版。3D 文字受原有字体字形覆盖限制……」出现十几次，「可选内容留空则继承原版展示……」在每个分组都重复一次。
- **修复：**
  1. 每个分组顶部只放一条说明，提示留空会继承原版、需要预览确认。
  2. 字段级 help 只保留该字段特有的信息：链接字段写「使用 HTTPS 链接」，媒体字段写格式和尺寸建议。
  3. 「3D 文字受字形限制」只出现在会渲染为 3D 文字的字段所在分组。
- **验收：**
  - [ ] 网站设置页中，「留空继承原版」字样最多出现一次，所在分组标题下方。
  - [ ] `tests/content-controls-ui.test.js` 改为断言分组级说明存在，测试通过。

### C4. 网站设置页过长

- **修复：** 页面顶部增加分组锚点导航：基本信息 / 开场与底部 / 联系链接 / 社交媒体 / 微信二维码 / 搜索与分享 / 背景音乐。窄屏下，导航变成可横向滚动的条。
- **验收：**
  - [ ] 点击锚点能滚动到对应分组，分组标题不被顶栏遮挡（设置 `scroll-margin-top`）。
  - [ ] 375px 宽度下没有横向溢出。

### C5. 作品排序只能靠「排序权重」数字

- **问题：** [projects.js](../../../admin-ui/modules/projects.js) 只能手填 0–100 的 `priority`，16 个作品时难以调整顺序。
- **修复：**
  1. 每个作品标题行增加「上移」「下移」按钮。拖拽为可选项，键盘可操作优先。
  2. 移动后，按新顺序重新分配 `priority`，并且不能超出契约允许的 0–100 范围：作品数 ≤ 101 时按等差分配；超过时报错提示。
  3. 「排序权重」输入框保留，标为高级选项，并说明数值越大越靠前（需先确认原站的排序方向，以前台实际表现为准）。
  4. 列表按当前 `priority` 排序显示，与前台的展示顺序一致。
- **验收：**
  - [ ] 新增单元测试：上移、下移后数组顺序和 `priority` 都正确，且全部通过 `validateConfig`。
  - [ ] 在预览中，作品顺序和后台列表一致（手工验收，附截图）。
  - [ ] 只用键盘（Tab + Enter）就能完成移动。

### C6. 作品媒体只有 URL，看不到预览

- **修复：**
  - 视频、图片、标志字段的右侧加一个缩略图：图片用 `<img loading="lazy">`；视频优先显示封面，没有封面时用 `<video preload="metadata" muted>`。
  - 加载失败时显示「无法预览」占位，不阻止保存。
  - 预览地址通过已有的 `resourcePreviewURL` 解析。
  - 「界面颜色」改为 `<input type="color">`，并保留文本输入；两者双向同步，存储格式仍是不带 `#` 的 6 位十六进制。
- **验收：**
  - [ ] 有媒体的作品能显示缩略图；地址无效时显示占位，不报控制台错误。
  - [ ] 用取色器选色后，草稿中 `uiColor` 为 6 位小写十六进制且不带 `#`；文本框与取色器保持同步。
  - [ ] 后台 CSP（`img-src 'self' https: blob: data:`）不需要放宽。

### C7. 作品列表缺少搜索，局部修改会整页重绘

- **问题：** 新建或删除作品会调用 `render()` 重建整页，展开状态和滚动位置都会丢失。
- **修复：**
  1. 作品管理页顶部加搜索框，按名称、slug、客户、标签过滤。
  2. 新建、删除、移动只更新列表区域；用作品 id 记住每个 `<details>` 的展开状态，重绘后恢复。
  3. 新建的作品自动展开，并滚动到可见位置，焦点落在「作品名称」输入框。
- **验收：**
  - [ ] 展开第 5 个作品后新建一个作品：第 5 个仍然展开，新作品展开并获得焦点。
  - [ ] 搜索能实时过滤；清空后恢复全部；搜索不影响草稿数据。

### C8. 场景编辑的空状态有误导性

- **问题：** 没有运行包、场景为空时，搜索框为空也显示「没有匹配的场景字段」（[scenes.js:98](../../../admin-ui/modules/scenes.js)）。
- **修复：** 区分三种情况：
  - `state.config.scenes` 为空：显示「尚未加载场景。请先在服务器登记并选择运行包」，并给出跳转到「总览 › 运行包」的按钮。
  - 有场景但没有可编辑字段：显示「当前模板没有可编辑的场景文案」。
  - 有搜索词但没有命中：显示「没有匹配“xxx”的场景字段」。
- **验收：**
  - [ ] 三种情况分别有单元测试，断言提示文案。
  - [ ] 没有运行包时打开场景编辑，提示的是真实原因。

### C9. 无效操作没有禁用，保存栏常驻

- **问题：** 没有运行包时，「预览草稿」「发布网站」仍可点击，点了才报错。总览、资源库、发布版本、账号安全、存储设置这些页面与草稿编辑无关，底部保存栏仍然常驻。
- **修复：**
  1. `updateStatus()` 中，`runtime.selection.digest` 为空时禁用预览和发布按钮，并设置 `title` 及可见的提示文字：「需先选择运行包」。
  2. 保存栏只在「网站设置 / 场景编辑 / 作品管理」显示。在其他页面，如果 `state.dirty` 为真，只显示一条紧凑的提示「有未保存的修改」，并提供返回编辑页的入口。
  3. `actions.js` 中原有的运行时错误检查保留，作为兜底。
- **验收：**
  - [ ] 没有运行包时，预览和发布按钮为 `disabled`，并显示原因；选择运行包后自动恢复可用。
  - [ ] 在账号安全、发布版本页面看不到保存栏；有未保存修改时，能看到提示。
  - [ ] `beforeunload` 的未保存修改提醒行为不变。

### C10. 视觉细节

- **问题与修复：**
  - 总览统计卡片的「尚未发布」字号过大，会折成两行：非数字值改用较小字号，或加 `white-space: nowrap` 并调整字号。
  - 顶栏「退出」与侧栏「退出登录」重复：保留顶栏按钮；侧栏底部只保留身份信息「单管理员 · 用户名」。
  - 导航图标用的是 ◈ ▤ ◇ 等 Unicode 字符，不同系统上渲染不一致：改为内联 SVG 图标（同一套描边风格，`aria-hidden="true"`）。
  - 移动端保存栏约占 1/6 屏高：≤ 700px 时，状态文字和按钮改为一行，按钮只显示短文案（保存 / 预览 / 发布）。
- **验收：**
  - [ ] 在 1280px 和 375px 两种宽度下，总览统计卡片都不折行。
  - [ ] 全站只有一个退出入口。
  - [ ] macOS 与 Windows 下图标外观一致（截图对比）。
  - [ ] 375px 下保存栏高度不超过 64px，且没有横向溢出。

---

## P3 · 结构重构（建议分 PR）

### D1. 后台改用原生 ES Modules

- **问题：** [index.html](../../../admin-ui/index.html) 用 20 个 `<script defer>` 加载模块，每个模块都套一层 UMD 外壳。[admin.js](../../../admin-ui/admin.js) 里有约 50 行 `(...args) => services.x.y(...args)` 的转发样板代码。
- **修复：**
  - 改为 `<script type="module" src="/admin/admin.js">`，各模块用 `export` / `import`。
  - 循环依赖通过拆分职责解决：把 render 调度抽成独立的 `router.js`，用事件或回调注册视图，不再通过 context 转发全部函数。
  - shared 下的三个文件需要同时被 Node 和浏览器使用：保留 UMD 写法，另加一个薄的 ESM 包装（或由服务端提供 ESM 版本）。
  - 测试用 Node 24 的原生 ESM 和 jsdom/happy-dom 加载模块，或继续使用当前 `tests/helpers` 中的 DOM 桩。
- **验收：**
  - [ ] `index.html` 只引用一个入口模块；admin.js 中没有转发样板代码。
  - [ ] CSP 中的 `script-src 'self'` 不变。
  - [ ] `tests/admin-modules.test.js`、`tests/content-controls-ui.test.js` 等后台测试全部通过。
  - [ ] 用浏览器手工走一遍：登录 → 编辑三个页面 → 保存 → 预览 → 发布 → 退出，控制台无错误。

### D2. 视图局部更新

- **修复：** 在 D1 的基础上，为每个视图提供 `mount()` 和 `update(path)` 接口：字段修改不触发重绘，列表增删只重绘列表区域。C7 的局部更新是这一项的先行版本。
- **验收：**
  - [ ] 在任何编辑页修改字段时，焦点、滚动位置、展开状态都不变。
  - [ ] 切换页面仍然会调用 `invalidateView`，过期的异步结果不会写入新页面（现有测试覆盖）。

### D3. 拆分 `app.js` 的全局中间件

- **问题：** [app.js](../../../admin-server/app.js) 有一个中间件同时负责缓存策略、安全头、私有路由判断；路由中有内联 `require`；503 错误页的 HTML 硬编码了三份。
- **修复：**
  - 拆成 `middleware/security-headers.js`、`middleware/cache-policy.js`、`middleware/installation-gate.js`。
  - 内联 `require` 改为在文件顶部引入。
  - 错误页统一放进 `views/unavailable.js`，用状态值区分文案。
  - 私有路由判断（`/api/admin`、`/api/setup`、`preview-`、`?preview`）集中成一个 `isPrivateRequest(req)` 函数，并加单元测试。
- **验收：**
  - [ ] `app.js` 只负责组装，不超过 80 行。
  - [ ] 新增 `isPrivateRequest` 的单元测试，覆盖大小写和编码变体（例如 `/API/Admin`、`%70review-`）。
  - [ ] 现有的 `tests/frontend.test.js`、`tests/integration.test.js`、`tests/delivery-http.test.js` 全部通过，响应头逐项不变。

### D4. 公开请求不查 session

- **问题：** 认证中间件对每个带 Cookie 的请求都会查询一次数据库，公开页面和静态资源也不例外。
- **修复：** session 解析中间件只挂在 `/api/admin`、`/admin`，以及需要识别管理员身份的预览路由上；或者改为懒加载（第一次访问 `req.adminSession` 时才查询）。
- **验收：**
  - [ ] 新增测试：带 Cookie 访问公开页面时，store 不产生 session 查询（用计数桩断言）。
  - [ ] 预览路由仍然要求登录，现有预览私有性测试全部通过。

### D5. 清理根目录

- **问题：** 根目录有约 30 个历史脚本：其中 9 个是兼容入口，其余未经审查（例如 30KB 的 `patch-search-text.js`）。另有一个与本项目无关的 72KB 文件 `editor.html`，内容是「Zeta 卡片可视化编辑器」，没有任何地方引用。
- **修复：**
  1. 这一项需要仓库所有者逐个确认去留，不由实施者擅自删除。
  2. 确认保留的脚本移入 `tools/legacy/`，同时更新 `tools/README.md`。
  3. `package.json` 中 `download:*` 指向的兼容入口，在确认无人使用后删除。
  4. `editor.html` 移出仓库，或移入 `tools/legacy/`，并在 README 中说明。
- **验收：**
  - [ ] 根目录只剩配置文件、文档、`server.js`、`index.html`。
  - [ ] `tools/README.md` 列出每个保留脚本的用途和风险。
  - [ ] Docker 构建上下文和镜像内容不变（`.dockerignore` 已排除 `tools`）。

---

## 总体验收

- [ ] P0–P2 完成后，在本机 Docker 栈上走完整流程：安装（原站内容包）→ 登录 → 网站设置 / 场景 / 作品修改 → 保存 → 预览 → 发布 → 版本列表 → 修改密码 → 退出。全程控制台无错误。
- [ ] 1280px 与 375px 两种宽度下，各页面截图存档于 `docs/verification/quality-and-admin-ux.md`。
- [ ] CI 全绿；lint、format、typecheck 的覆盖范围与 CONTRIBUTING.md 描述一致。
- [ ] 验收记录明确区分已验证与未验证的项（原站 3D 视觉、生产 TLS、真实 S3 不在本方案范围内）。

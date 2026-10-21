# 运行包登记、固定交付与只读诊断

适用：Node.js >=24、PostgreSQL 18、schema 3、单站点/单管理员/单应用实例。内容 snapshot 仍是 format 2，程序/交付 manifestVersion 是 1，三者不能混用。这里是部署操作手册，不授权对现有生产环境执行命令。

## 先安装，再登记，再选择，再发布

新站允许先安装账号/配置内容。运行包是授权程序输入，媒体是资源库内容；二者缺一不能称完整 3D 网站。安装成功不自动登记或选择运行包。后台不能上传任意程序、指定服务器目录或注入 profile。

反过来也一样：登记 11 个程序不会创建或补齐数据库模板、UIL、字体图集、HTML 字体、模型、图片、音频或 manifest 图标。新安装必须在正常安装预检/来源导入阶段使用完整授权模板与媒体，再按报告处理缺失；空白安装仅清空业务内容，不等于自动生成可用六场景模板。验收用自建六场景和测试字体是明确的隔离协议夹具，不是生产初始化捷径。

在已核对目标环境配置 DATABASE_URL 与私有 SITE_DATA_DIR 后，明确指定服务器路径：

```sh
npm run runtime:register -- --root /srv/authorized-runtime --manifest /srv/runtime-manifest.json --profile legacy-six-scenes-v1
```

服务器 root 和 manifest 必须为绝对路径，路径及每一级祖先不能是符号链接。清单只允许安全相对路径；不扫描 latest、不下载、不运行包内安装程序。单文件 ≤32 MiB、包 ≤128 MiB、≤512 项；生成交付 ≤256 MiB、≤4096 项。失败不会产生可选择的部分包。

生产配置 `legacy-six-scenes-v1` 的完整程序集合与有限依赖边由受信代码 `admin-server/engine/profiles/legacy-six-scenes-v1.js` 定义。不要把媒体列表 `engine-assets.json` 当运行包清单。实际 11 项为 index HTML、unsupported HTML、app JS、modules JS、Hydra worker、Basis JS/WASM、Draco wrapper JS/WASM、QR JS、compiled shader。源文件名必须明确，不按时间猜测。

下面仅展示清单格式（省略其他项和依赖，不可直接登记）；完整清单须包含 profile 要求的全部程序/依赖，并逐项计算真实 size/SHA-256，不能复制占位摘要：

```json
{
  "manifestVersion": 1,
  "profileId": "legacy-six-scenes-v1",
  "templateId": "six-scenes",
  "entryKey": "index",
  "files": [{
    "key": "index", "path": "index.html", "role": "html",
    "mime": "text/html", "size": 123,
    "sha256": "REPLACE_WITH_64_LOWERCASE_HEX_FROM_THE_ACTUAL_FILE"
  }],
  "dependencies": []
}
```

角色/MIME 对应：html/`text/html`、program/`text/javascript`、stylesheet/`text/css`、wasm/`application/wasm`、shader/`text/plain`、data/`application/json`。不要把授权原始包、密钥或用户未跟踪素材提交到 Git。登记输出包 digest；同一内容去重，重复登记不会改选择。

对于本版本唯一生产 profile，可在**已核对的应用代码目录**用以下完整示例生成清单。它只枚举受信 profile 的确切 11 项，不执行候选 JS；缺文件/大小/摘要不匹配会失败，目标清单必须不存在（`wx` 防止覆盖）。先核对示例路径和使用权，不直接针对未知目录运行：

```sh
node - /srv/authorized-runtime /srv/runtime-manifest.json <<'NODE'
const fs = require('node:fs/promises');
const path = require('node:path');
const {readSource} = require('./admin-server/delivery/cas');
const {sha256, assertRuntimeManifest} = require('./admin-server/delivery/contracts');
const profile = require('./admin-server/engine/profiles/legacy-six-scenes-v1');
async function run() {
  const [root, destination] = process.argv.slice(2);
  if (!path.isAbsolute(root) || !path.isAbsolute(destination)) throw Error('absolute paths required');
  const mime = {html:'text/html', program:'text/javascript', wasm:'application/wasm', shader:'text/plain'};
  const files = [];
  for (const item of profile.programs) {
    const bytes = await readSource(root, item.path, 32 * 1024 * 1024);
    if (sha256(bytes) !== item.sha256) throw Error('input does not match supported profile');
    files.push({...item, mime:mime[item.role], size:bytes.length});
  }
  const manifest = {manifestVersion:1, profileId:profile.id, templateId:profile.templateId,
    entryKey:'index', files, dependencies:profile.dependencies};
  assertRuntimeManifest(manifest);
  await fs.writeFile(destination, JSON.stringify(manifest, null, 2)+'\n', {flag:'wx', mode:0o600});
}
run().catch(() => { console.error('Manifest creation failed; check declared inputs and destination.'); process.exitCode=1; });
NODE
```

这是清单生成示例，不替代登记验证，也不修复媒体缺失。维护窗口外不得顺手修改已有清单、替换受支持 hash 或重写包文件。

登记之后在后台刷新列表并选择。选择具有 generation 冲突检查，只影响以后构建；发布会锁外构建、校验闭包、短事务重查草稿 revision/selection/资源/会话，再原子切换。失败保留现有公开版本，序列空洞正常。网络结果未知时先查历史/审计，不自动重试。历史程序交付读取 CAS，不读当前 app/profile/源码；业务媒体仍受最新资源状态与存储授权约束。

## 容器和私有持久化

镜像复制应用代码、SQL 和 scripts，不内置授权 assets/运行包。默认非 root `node` 用户；`/app/data` 必须持久化且可写，禁止公开静态映射或 CDN 回源。程序登记后保存在私有 `delivery/objects/<sha256>`，临时写入位于 `delivery/staging`。这些路径不是 HTTP URL。

部署者可在已核对的 Compose override 中只读挂载授权程序目录和 manifest，再在同一应用环境执行上述登记命令。挂载使用 `read_only: true`、`bind.create_host_path: false`；不能把缺失源目录自动创建为空再当成有效包。登记工具需要同一数据库和持久 data，不能在未挂载 data 的一次性容器写出随容器消失的对象。媒体 assets 挂载与授权运行包挂载是两个不同用途；原始程序不需要通过静态服务器公开。

公开程序使用 ETag 与回源校验，不启用长期 immutable。后台、HTML、认证预览、普通媒体和错误响应不进入公共长期缓存；数据库断开时不能依靠旧 ETag 绕过授权返回 304。预览依赖 private/no-store/noindex，退出后延迟 worker/资源请求同样失效。

## 只读占用与完整性检查

```sh
npm run delivery:audit
```

仅已安装 schema 3 可运行；无参数、不迁移、不构建、不清理、不修复，finally 关闭数据库 pool。标准输出一行 JSON（npm 自身可能另输出脚本标题）；异常时 stderr 是不含路径/连接串的通用错误，退出码非零。缺失/损坏对象先输出诊断，再非零退出；无法完整扫描时不输出貌似完整的计数。返回字段：

| 字段 | 含义 |
| --- | --- |
| objectCount / totalBytes | 安全清点到的物理 digest 文件数及观察到的字节数 |
| referencedObjectCount | 物理清单中出现在所有已登记包/全部 artifact manifest 并集的 digest 数，损坏但存在的也计入 |
| unreferencedObjectCount | 物理清单减引用数；不是可删除许可 |
| missingObjects | manifest 引用但清点中不存在的 digest，单独列出，不计入物理数 |
| invalidObjects | 存在但摘要或声明大小不符的 digest，包括孤立对象；只输出摘要，不输出内容/绝对路径 |

全部 artifact 包括历史、无 binding 和已过期/已删除预览留下的 artifact。共享摘要只计一次；相同摘要声明不同大小、坏 manifest/身份、DB 错误、危险路径/目录/文件名、扫描中消失的对象均失败关闭。对象逐个读取并核验，单个文件大于 256 MiB 直接拒绝，避免无限内存分配。已有 dataDir 必须安全存在；新站没有 delivery/objects 时报告空，不创建任何目录，也不清理 staging。

数据库清单使用只读 repeatable-read 事务；文件清点和读取不是与 DB 同时的原子快照。结果只是瞬时诊断，正在发布/外部修改可导致失败，不能据此在线 GC。第一版没有删除命令和自动垃圾回收，所有清理属于另行确认的停机维护。

## 结构升级、恢复和换域名

结构 1/2→3 必须停应用写入及新构建，等在途结束，同一维护窗口备份 DB、完整私有 data（delivery、uploads）、授权 bundled 媒体、原运行包/清单和独立主密钥，再显式 `npm run db:migrate`。不重新安装或创建账号。旧公开指针/快照保留，旧交付标 legacy；没有兼容交付时维护 503。

登记/选择后，可为当前 legacy 版本一次性生成兼容交付，或恢复为草稿新发布。兼容交付不代表当年程序重放，不能覆盖已有绑定。改包、内容或 SITE_ORIGIN 都用新发布；换域名后旧交付不自动重写，后台仍可读取历史。数据库迁移成功不等于视觉恢复。

恢复到新专用库、新空私有目录及新隔离端口，绝不覆盖原库/目录。保持目录 0700、对象 0600 及实际运行用户权限；恢复同一备份的媒体和主密钥。核对表计数/manifest/CAS 摘要，运行只读 audit，再验证账号、历史、匿名权限、认证预览和发布字节。异域恢复应预期旧绑定 503，再明确新发布；不能修改历史 origin。完整 dump/restore 示例见[迁移指南](POSTGRESQL-MIGRATION.md#备份与独立恢复)。schema 3 不保证旧程序可直接回滚，应恢复完整已验证备份。

## 排错与验收边界

- 无包或未选择：服务器登记、后台刷新/选择，不能在磁盘放一个新 app 即完成。
- profile/补丁/未知依赖拒绝：核对原始输入 hash 和受支持配置；不放宽锚点数量、readiness 或资源授权来求通过。
- CAS 缺失/损坏：停机调查并从同一备份恢复，不回源当前 assets，不原地覆盖历史身份。
- 版本冲突/会话撤销：重新登录、刷新草稿/选择状态，再明确操作；不要自动重放长构建请求。
- HTTP 200、WASM 编译或 Worker 请求成功不等于实际模型解码/六场景视觉保真。原视觉需同素材基线/候选截图与网络/GPU 检查。
- S3 签名 URL、外链公网可读性/CORS、真实 CDN/生产 HTTPS 必须在授权目标另验，本地协议测试不能替代。

生产环境部署与检查步骤见 [生产部署指南](PRODUCTION.md)，日常备份与恢复见 [部署、升级与恢复](../DEPLOYMENT.md)。全量媒体归档、云产物库及自动 GC 不能由运行包登记自动完成。

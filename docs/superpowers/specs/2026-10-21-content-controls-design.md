# 个人站内容配置与固定视觉边界

用户已确认：原站视觉不变，材质/贴图/粒子/光照/内部场景模型不再开放编辑；开放顶部 Logo、文案、作品、音乐、开场视频/封面、底部六边形屏内容、联系链接、三个社媒图标/链接和微信二维码图片。图 2/3 联系页背景凹凸与反射仍是固定视觉，不当作普通背景图替换。

## 内容契约

新增可选的 `site` 字符串字段，不改数据库结构，不改旧快照，不给旧草稿写默认值。空值/未设置沿用原站内容，避免升级即改变画面；用户编辑后才保存。旧源码和签名运行包原字节不修改，使用已有确定性适配器生成新预览/发布产物。

媒体：`heroVideo`(video)、`heroPoster`(image)、`labBackground`(image)、`contactInstagramIcon`/`contactLinkedinIcon`/`contactXIcon`(image)、`contactQrImage`(image)。

文字：`contactHomeText`、`contactJoinText`、`contactAboutText`、`contactInstagramText`、`contactLinkedinText`、`contactXText`、`contactQrText`。

HTTPS 跳转：`contactHomeURL`、`contactJoinURL`、`contactAboutURL`、`contactInstagramURL`、`contactLinkedinURL`、`contactXURL`。已有 `labUrl` 显示为底部展示区跳转链接。媒体使用现有 Local/S3 上传/HTTPS 外链选择，检查资源种类，进入草稿引用、预览授权和发布快照；不自动选择/发布。

原来源：ViewController 的 `assets/video/reel.mp4` / `reel-frame.jpg`（相关视频使用共享源），HexagonGrid 的 `assets/images/lab.gif`，ContactUI 的三个图标和六个链接，QRCode 的网站网址动态码。自定义二维码显示上传图片，保留图像内容及留白、不附加作品编号，不再使用普通网站码冒充微信码。未设置时保持原来的二维码行为。

## 固定视觉

只允许原场景的 `text` 字段和 `Home / INPUT_Config_8_ParticleTest_geometry`；其他场景值仍完整保留在数据中，但不显示编辑控件。服务端比较当前草稿的锁定值，拒绝 PUT 篡改；不回滚用户已经保存的视觉值。恢复历史内容也保留当前锁定视觉。服务端 schema 由当前草稿固定值构成，以便客户端和服务端一致。纯现有合成测试字段需要按新边界更新测试意图，不绕开真实参数。

普通资源库不显示内置字体、系统贴图、引擎内部模型；保留当前作品/音乐/新增内容所引用的业务素材以及用户上传/外链。内置 bundled 素材不可通过回收接口删除。不更改文件，不删材质，不动公开站点。

## 验收

TDD：可选字段兼容、危险链接与错种媒体拒绝、当前固定值校验、恢复固定值、UI 不显示技术资源/参数、内容输入不损坏草稿、运行包替换精确且有 patch report、新资源进入目标版本 grants。专用 PostgreSQL 完整回归与原运行包授权兼容测试、独立审查、隔离预览使用合成图/视频验证，不在用户当前草稿测试写入。3302 更新不安装/发布/覆盖其内容；旧公开页面保持原样，后台显示新入口。S3/外链 CORS 不冒充云端实测。

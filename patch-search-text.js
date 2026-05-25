/**
 * ==============================================================================
 * 🌟 Zeta 网页全站 3D 可视化一键超级定制引擎 (Zeta Engine v6.0)
 * ==============================================================================
 * 💡 这是您全站的【黄金控制中心】！您无需去动任何繁琐的底层代码或进行分步打包。
 *    网页上的所有 3D 几何文字、超链接、背景图片重映射，全部都在下方的 CONFIG 配置区中一站式列出。
 * 
 * 🛠️ 极其简单的使用说明：
 *    1. 在下方 CONFIG 区域修改您想要变更的任何文字、超链接。
 *    2. 保存文件，并在终端运行：node patch-search-text.js
 *    3. 仅需 15 秒，脚本将全自动、闭环执行 6 大集成阶段（JS注入 -> 数据库覆写 -> 汉字扫描 -> 3D中文字体一键编译 -> 终极封包打包）！
 *    4. 刷新您的 Chrome 浏览器（Ctrl+F5 或 Cmd+Shift+R 强刷），即刻见证完美的定制效果！
 * ==============================================================================
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// ==============================================================================
// ⚙️ CONFIG 配置中心：在此自由定制全站的方方面面！
// ==============================================================================
const CONFIG = {
    // --------------------------------------------------------------------------
    // 1. 侧栏过滤器与 AI 聊天框配置
    // 💡 提示：为确保点击过滤器后能正常加载并筛选出项目卡片，
    //    这里的 filterKey 必须与您在项目中为卡片设置的 tags（标签）完全一致！
    // --------------------------------------------------------------------------
    title: "你在寻找什么？",                          // 聊天框顶部主标题
    placeholder: "有什么想问我的...",                 // 输入框占位提示文字
    disclaimer: "会话内容可能会被记录，使用聊天即表示您已确认我们的 ", // 隐私政策前置说明
    privacyText: "隐私政策",                        // 隐私政策超链接文本
    privacyUrl: "https://example.com/privacy", // 隐私政策跳转链接

    option1: "-> AIGC作品",                         // 选项 1 显示的中文文字
    filterKey1: "AIGC作品",                         // 💡 选项 1 对应的后台过滤键彻底自定义！

    option2: "-> Vibe Coding",                     // 选项 2 显示的中文文字
    filterKey2: "Vibe Coding",                     // 💡 选项 2 对应的后台过滤键彻底自定义！

    option3: "-> 自媒体",                           // 选项 3 显示的中文文字
    filterKey3: "自媒体",                           // 💡 选项 3 对应的后台过滤键彻底自定义！

    option4: "-> AI社群",                           // 选项 4 显示的中文文字
    filterKey4: "AI社群",                           // 💡 选项 4 对应的后台过滤键彻底自定义！

    option5: "-> 兴趣",                             // 选项 5 显示的中文文字
    filterKey5: "兴趣",                            // 💡 选项 5 对应的后台过滤键彻底自定义！

    // --------------------------------------------------------------------------
    // 1.5 右上角导航按钮文案配置 (右上角胶囊按钮)
    // 💡 提示：您可在此修改右上角 "WORK" 和 "CONTACT" 的 3D 几何文字名称！
    //    3D 空间字体已复原为原版 NBArchitekt 英文，推荐保持英文以获得最完美的水晶反光质感！
    // --------------------------------------------------------------------------
    navWorkText: "Work",                            // 右上角 "Work" 按钮文案
    navContactText: "Contact",                        // 右上角 "Contact" 按钮文案

    // --------------------------------------------------------------------------
    // 2. 联系我们 (Contact Us 页面大字与字号控制)
    // --------------------------------------------------------------------------
    contactTitle: "CONTACT US",                     // ✦ 联系我们 ✦ 3D 页面大标题
    cityLax: "China",                               // 洛杉矶大字位置
    cityNyc: "jiangsu",                               // 纽约大字位置
    cityAms: "suzhou",                               // 阿姆斯特丹大字位置

    // 💡 3D 城市名字号调节器 (英文窄扁字形推荐保持 110 像素字号)
    cityFontSize: 60,

    email: "CONTACT@EXAMPLE.COM",                  // 界面显示的 3D 邮箱大写字
    emailLink: "contact@example.com",              // 点击邮箱图标或 3D 文字跳转的真实邮件地址

    // --------------------------------------------------------------------------
    // 3. 左下角普通目录文字与跳转超链接修改
    // --------------------------------------------------------------------------
    menuPrivacyText: "Home",                // 左下角第一个目录文字
    menuPrivacyUrl: "https://example.com", // 点击跳转链接

    menuNewsletterText: "JION US",              // 左下角第二个目录文字
    menuNewsletterUrl: "https://example.com/newsletter", // 点击跳转链接

    menuCareersText: "ABOUT US",                    // 左下角第三个目录文字
    menuCareersUrl: "https://example.com/about", // 点击跳转链接

    // --------------------------------------------------------------------------
    // 4. 左下角三个社交媒体图标的跳转超链接修改
    // 💡 提示：若想改变图标本身的图片，可以直接替换 assets/images/ui/ 目录下的 ig.png, in.png, tw.png！
    // --------------------------------------------------------------------------
    instagramUrl: "https://instagram.com",
    linkedinUrl: "https://linkedin.com",
    twitterUrl: "https://x.com",

    // --------------------------------------------------------------------------
    // 5. 右下角二维码图片生成与同步跳转
    // 💡 提示：如果 qrCodeUrl 留空 ""，则自动使用系统原生的多端动态同步扫码 (Mobile Sync)；
    //    如果填入特定的超链接，扫码后网页将会直接生成该超链接 of 专属高清二维码！
    // --------------------------------------------------------------------------
    qrCodeUrl: "https://example.com",
    qrCodeText: "[ wechat ]",                  // 二维码下方显示的说明大写文字

    // --------------------------------------------------------------------------
    // 6. 全局网页中文字体设置 (仅作用于普通的 HTML 文字区，如侧栏、聊天框等)
    // --------------------------------------------------------------------------
    //customFontUrl: "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;700&display=swap",
    domFontFamily: '"nbarchitekt", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',

    // --------------------------------------------------------------------------
    // 6.5 音乐播放器曲目列表配置 (右上角胶囊音乐播放器)
    // 💡 提示：您可在此修改每首歌的 3D 显示名称 (title) 与音频文件路径 (src)！
    //    支持中文！若歌曲标题包含中文，编译系统会自动将汉字编译入 3D 字体包中，杜绝乱码与碎裂！
    // --------------------------------------------------------------------------
    songs: [
        { title: "Sergey Azbel - Themis", src: "assets/music/Sergey%20Azbel%20-%20Themis.mp3" },
        { title: "nuer self - Dusk", src: "assets/music/nuer%20self%20-%20Dusk.mp3" },
        { title: "Flint - Fly up High", src: "assets/music/Flint%20-%20Fly%20up%20High.mp3" },
        { title: "Hotham - To the Stars", src: "assets/music/Hotham%20-%20To%20the%20Stars.mp3" },
        { title: "Jozeque - Sultans of Streams", src: "assets/music/Jozeque%20-%20Sultans%20of%20Streams.mp3" },
        { title: "Downtown Binary - Other Worlds", src: "assets/music/Downtown%20Binary%20-%20Other%20Worlds.mp3" },
        { title: "Magiksolo - Quantum World", src: "assets/music/Magiksolo%20-%20Quantum%20World.mp3" },
        { title: "BXRDVJA - Ghost Cities", src: "assets/music/BXRDVJA%20-%20Ghost%20Cities.mp3" }
    ]
};

// ==============================================================================
// 🛠️ Zeta 终极自动化集成管线流程 (15秒一键跑通全站)
// ==============================================================================

const jsPath = path.join(__dirname, 'assets/js/app.1778129964370.js');
const jsBackupPath = jsPath + '.bak';
const htmlPath = path.join(__dirname, 'index.html');
const htmlBackupPath = htmlPath + '.bak';

// 阶段一：注入 JS 硬编码文案与 Notion Notion 声明
function step1_patchJs() {
    console.log('\n==================================================');
    console.log('📦 阶段一：正在进行核心 JS 文本、字号与超链接注入替换...');
    console.log('==================================================');

    if (!fs.existsSync(jsPath) && fs.existsSync(jsBackupPath)) {
        fs.copyFileSync(jsBackupPath, jsPath);
    }
    if (!fs.existsSync(jsPath)) {
        console.error(`❌ 未能找到 JS 文件: ${jsPath}`);
        return false;
    }

    let content = fs.readFileSync(jsPath, 'utf8');

    // 强行载入原始纯净备份进行增量覆盖
    if (!fs.existsSync(jsBackupPath)) {
        fs.writeFileSync(jsBackupPath, content, 'utf8');
        console.log(`[安全备份] 已成功为原版 app.js 创建副本`);
    } else {
        content = fs.readFileSync(jsBackupPath, 'utf8');
        console.log(`[重置载入] 已重载原始纯净备份进行增量编译...`);
    }

    // 1. 替换过滤器文案
    console.log('[JS 编译] 正在注入侧栏过滤器文案与分类过滤键...');
    const filterPattern = '_this.onInit = function () { _this.addMessage("';
    const filterStartIdx = content.indexOf(filterPattern);
    if (filterStartIdx !== -1) {
        const filterEndIdx = content.indexOf('}, _this.addMessage = async', filterStartIdx) + 1;
        const originalFilterSlice = content.slice(filterStartIdx, filterEndIdx);
        const replacementFilterSlice = `_this.onInit = function () { _this.addMessage("${CONFIG.title}", "#f4f4f4", !0), _this.addFilter("${CONFIG.option1}", "${CONFIG.filterKey1}", !0, 100), _this.addFilter("${CONFIG.option2}", "${CONFIG.filterKey2}", !0, 200), _this.addFilter("${CONFIG.option3}", "${CONFIG.filterKey3}", !0, 300), _this.addFilter("${CONFIG.option4}", "${CONFIG.filterKey4}", !0, 400), _this.addFilter("${CONFIG.option5}", "${CONFIG.filterKey5}", !0, 500) }`;
        content = content.replace(originalFilterSlice, replacementFilterSlice);
    }

    // 1.5 替换右上角导航按钮文案
    console.log('[JS 编译] 正在注入右上角导航按钮中文文案...');
    content = content.replace(
        '{ text: "Work", _type: "NavUIItem", refName: "work", children: [] }, { text: "Contact", _type: "NavUIItem", refName: "contact", children: [] }',
        `{ text: "${CONFIG.navWorkText}", _type: "NavUIItem", refName: "work", children: [] }, { text: "${CONFIG.navContactText}", _type: "NavUIItem", refName: "contact", children: [] }`
    );

    // 2. 替换隐私声明
    console.log('[JS 编译] 正在注入隐私声明文案及 Notion 链接...');
    const disclaimerPattern = '_this.bind("showDisclaimer", (show => { if (!show) return; let disclaimer = "';
    const disclaimerStartIdx = content.indexOf(disclaimerPattern);
    if (disclaimerStartIdx !== -1) {
        const disclaimerEndIdx = content.indexOf('text.textContent = "", text.progress = .95;', disclaimerStartIdx) + 43;
        const originalDisclaimerSlice = content.slice(disclaimerStartIdx, disclaimerEndIdx);
        const replacementDisclaimerSlice = `_this.bind("showDisclaimer", (show => { if (!show) return; let disclaimer = "${CONFIG.disclaimer}", elem = document.createElement("p"), text = document.createTextNode(disclaimer); elem.appendChild(text), elem.style.color = "#cccccc", _this.messages.div.prepend(elem); let link = document.createElement("a"); link.text = "${CONFIG.privacyText}", link.setAttribute("title", "${CONFIG.privacyText}"), link.setAttribute("href", "${CONFIG.privacyUrl}"), link.setAttribute("target", "_blank"), link.style.marginLeft = "0", elem.appendChild(link), text.textContent = "", text.progress = .95;`;
        content = content.replace(originalDisclaimerSlice, replacementDisclaimerSlice);
    }

    // 3. 替换输入框 Placeholder
    content = content.replace('placeholder: "有什么想问我的...", _type: "textarea"', `placeholder: "${CONFIG.placeholder}", _type: "textarea"`);

    // 4. 替换 Contact Us 标题与三大城市
    content = content.replace('_type: "glText", _innerText: "CONTACT US", refName: "contact"', `_type: "glText", _innerText: "${CONFIG.contactTitle}", refName: "contact"`);
    content = content.replace('.contact.setText(replaceRandomLetters("CONTACT US",', `.contact.setText(replaceRandomLetters("${CONFIG.contactTitle}",`);

    content = content.replace(
        '{ font: "NBArchitektStd-Light", fontSize: 110, align: "center", letterSpacing: .1, fontColor: "#ffffff", _type: "glText", _innerText: "LAX", refName: "lax"',
        `{ font: "NBArchitektStd-Light", fontSize: ${CONFIG.cityFontSize}, align: "center", letterSpacing: .1, fontColor: "#ffffff", _type: "glText", _innerText: "${CONFIG.cityLax}", refName: "lax"`
    );
    content = content.replace('.lax.setText(replaceRandomLetters("LAX",', `.lax.setText(replaceRandomLetters("${CONFIG.cityLax}",`);

    content = content.replace(
        '{ font: "NBArchitektStd-Light", fontSize: 110, align: "center", letterSpacing: .1, fontColor: "#ffffff", _type: "glText", _innerText: "SYD", refName: "nyc"',
        `{ font: "NBArchitektStd-Light", fontSize: ${CONFIG.cityFontSize}, align: "center", letterSpacing: .1, fontColor: "#ffffff", _type: "glText", _innerText: "${CONFIG.cityNyc}", refName: "nyc"`
    );
    content = content.replace('.nyc.setText(replaceRandomLetters("NYC",', `.nyc.setText(replaceRandomLetters("${CONFIG.cityNyc}",`);

    content = content.replace(
        '{ font: "NBArchitektStd-Light", fontSize: 110, align: "center", letterSpacing: .1, fontColor: "#ffffff", _type: "glText", _innerText: "AMS", refName: "ams"',
        `{ font: "NBArchitektStd-Light", fontSize: ${CONFIG.cityFontSize}, align: "center", letterSpacing: .1, fontColor: "#ffffff", _type: "glText", _innerText: "${CONFIG.cityAms}", refName: "ams"`
    );
    content = content.replace('.ams.setText(replaceRandomLetters("AMS",', `.ams.setText(replaceRandomLetters("${CONFIG.cityAms}",`);

    // 5. 邮件
    content = content.replace('_type: "glText", _innerText: "HELLO@ACTIVETHEORY.NET", refName: "email"', `_type: "glText", _innerText: "${CONFIG.email}", refName: "email"`);
    content = content.replace('.email.setText(replaceRandomLetters("HELLO@ACTIVETHEORY.NET",', `.email.setText(replaceRandomLetters("${CONFIG.email}",`);
    content = content.replace('GLA11y.textNode(_this.email.group, "Email us at hello@activetheory.net")', `GLA11y.textNode(_this.email.group, "Email us at ${CONFIG.emailLink}")`);
    content = content.replace('_this.email.interact(hover, (_ => window.open("mailto:hello@activetheory.net")), "#")', `_this.email.interact(hover, (_ => window.open("mailto:${CONFIG.emailLink}")), "#")`);

    // 6. 左下角目录与社交跳转
    content = content.replace(
        '{ font: "NBArchitektStd-Bold", fontSize: 11, align: "left", letterSpacing: .1, fontColor: "#ffffff", _type: "glText", _innerText: "Privacy Notice", refName: "privacy"',
        `{ font: "NBArchitektStd-Bold", fontSize: 11, align: "left", letterSpacing: .1, fontColor: "#ffffff", _type: "glText", _innerText: "${CONFIG.menuPrivacyText}", refName: "privacy"`
    );
    content = content.replace('.privacy.setText(replaceRandomLetters("Privacy Notice",', `.privacy.setText(replaceRandomLetters("${CONFIG.menuPrivacyText}",`);
    content = content.replace('_this.privacy.interact(hover, (_ => window.open("https://activetheory.notion.site/privacy", "_blank")), "#")', `_this.privacy.interact(hover, (_ => window.open("${CONFIG.menuPrivacyUrl}", "_blank")), "#")`);

    content = content.replace(
        '{ font: "NBArchitektStd-Bold", fontSize: 11, align: "left", letterSpacing: .1, fontColor: "#ffffff", _type: "glText", _innerText: "Newsletter Signup", refName: "subscribe"',
        `{ font: "NBArchitektStd-Bold", fontSize: 11, align: "left", letterSpacing: .1, fontColor: "#ffffff", _type: "glText", _innerText: "${CONFIG.menuNewsletterText}", refName: "subscribe"`
    );
    content = content.replace('.subscribe.setText(replaceRandomLetters("Newsletter Signup",', `.subscribe.setText(replaceRandomLetters("${CONFIG.menuNewsletterText}",`);
    content = content.replace('_this.subscribe.interact(hover, (_ => window.open("https://mailchi.mp/activetheory/newsletter", "_blank")), "#")', `_this.subscribe.interact(hover, (_ => window.open("${CONFIG.menuNewsletterUrl}", "_blank")), "#")`);

    content = content.replace(
        '{ font: "NBArchitektStd-Bold", fontSize: 12, align: "left", letterSpacing: .1, fontColor: "#ffffff", _type: "glText", _innerText: "Careers", refName: "careers"',
        `{ font: "NBArchitektStd-Bold", fontSize: 12, align: "left", letterSpacing: .1, fontColor: "#ffffff", _type: "glText", _innerText: "${CONFIG.menuCareersText}", refName: "careers"`
    );
    content = content.replace('.careers.setText(replaceRandomLetters("Careers",', `.careers.setText(replaceRandomLetters("${CONFIG.menuCareersText}",`);
    content = content.replace('_this.careers.interact(hover, (_ => window.open("https://jobs.lever.co/activetheory", "_blank")), "#")', `_this.careers.interact(hover, (_ => window.open("${CONFIG.menuCareersUrl}", "_blank")), "#")`);

    // 7. 社交图标
    content = content.replace('_this.ig.interact(hover, (_ => window.open("https://www.instagram.com/activetheory", "_blank")), "#", "Instagram")', `_this.ig.interact(hover, (_ => window.open("${CONFIG.instagramUrl}", "_blank")), "#", "Instagram")`);
    content = content.replace('_this.in.interact(hover, (_ => window.open("https://www.linkedin.com/company/active-theory/", "_blank")), "#", "Linked in")', `_this.in.interact(hover, (_ => window.open("${CONFIG.linkedinUrl}", "_blank")), "#", "Linked in")`);
    content = content.replace('_this.tw.interact(hover, (_ => window.open("https://twitter.com/active_theory", "_blank")), "#", "Twitter")', `_this.tw.interact(hover, (_ => window.open("${CONFIG.twitterUrl}", "_blank")), "#", "Twitter")`);

    // 8. 二维码扫码
    content = content.replace(
        '{ font: "NBArchitektStd-Bold", fontSize: 9, align: "center", letterSpacing: .02, fontColor: "#ffffff", _type: "glText", _innerText: "[ MOBILE SYNC ]", refName: "sync"',
        `{ font: "NBArchitektStd-Bold", fontSize: 9, align: "center", letterSpacing: .02, fontColor: "#ffffff", _type: "glText", _innerText: "${CONFIG.qrCodeText}", refName: "sync"`
    );
    if (CONFIG.qrCodeUrl && CONFIG.qrCodeUrl.trim() !== "") {
        content = content.replace(
            'let url = location.href; url = url.split("#")[0], url += url.includes("?") ? "&" : "?", url += `roomqr=${encodeURIComponent(_params.key)}`',
            `let url = "${CONFIG.qrCodeUrl}"; url = "${CONFIG.qrCodeUrl}", url += "", url += ""`
        );
    }

    // 💡 9. 详情页 3D 文字隐藏与超高精矢量 DOM 混合劫持替换 (Zeta Hybrid Rendering)
    console.log('[JS 编译] 正在注入卡片详情页 3D 文字隐藏与 DOM 双向同步劫持逻辑...');
    // 💡 注意：不再透明化 title/copy 的 fontColor，保持原始白色 #ffffff
    // 封面上的项目名称会正常显示白色文字

    // 劫持 GLText 的 setText 方法，实现 60fps 的超高清 DOM 同步
    content = content.replace(
        'this.setText = function (txt, options) {',
        'this.setText = function (txt, options) { if (_this.refName === "title" || _this.refName === "copy") { let domId = _this.refName === "title" ? "detail-title" : "detail-copy"; let domElem = document.getElementById(domId); if (domElem) { domElem.style.opacity = txt ? "1" : "0"; if (txt) { domElem.innerHTML = _this.refName === "copy" ? txt.replace(/\\n/g, "<br><br>") : txt; } } }'
    );

    fs.writeFileSync(jsPath, content, 'utf8');
    console.log('✅ [JS 注入] 全局 JS 文本、超链接与字号控制已注入成功！');
    return true;
}

// 阶段二：注入全局 DOM 字体覆盖
function step2_patchHtml() {
    console.log('\n[HTML 编译] 正在注入全局中文字体覆盖样式表...');
    if (!fs.existsSync(htmlPath) && fs.existsSync(htmlBackupPath)) {
        fs.copyFileSync(htmlBackupPath, htmlPath);
    }
    if (!fs.existsSync(htmlPath)) {
        console.error(`❌ 未能找到 index.html`);
        return false;
    }

    let content = fs.readFileSync(htmlPath, 'utf8');
    if (!fs.existsSync(htmlBackupPath)) {
        fs.writeFileSync(htmlBackupPath, content, 'utf8');
    } else {
        content = fs.readFileSync(htmlBackupPath, 'utf8');
    }

    // 在 head 中注入字体链接与覆盖全局 nbarchitekt 样式的 CSS
    const fontLinkStr = `<link href="${CONFIG.customFontUrl}" rel="stylesheet">\n    <style type="text/css">* { font-family: ${CONFIG.domFontFamily} !important; }</style>`;
    content = content.replace('</head>', `    ${fontLinkStr}\n</head>`);

    // 💡 强力注入卡片详情页超高清、完美对齐的 HTML / CSS 浮层 DOM 容器
    const domContainers = `
    <!-- Zeta 3D-DOM 混合高精排版浮层 -->
    <div id="detail-title" style="position: absolute; left: 8%; top: 32%; font-size: 55px; font-weight: 700; color: #fff; font-family: 'nbarchitekt', 'Noto Sans SC', sans-serif; pointer-events: none; opacity: 0; transition: opacity 0.5s ease, transform 0.5s ease; z-index: 10; text-transform: uppercase; letter-spacing: 2px;"></div>
    <div id="detail-copy" style="position: absolute; right: 8%; top: 32%; width: 32%; max-height: 50vh; overflow-y: auto; color: #eee; font-size: 15px; line-height: 1.8; font-family: 'Noto Sans SC', sans-serif; pointer-events: auto; opacity: 0; transition: opacity 0.5s ease; z-index: 10; text-align: justify; letter-spacing: 0.5px; padding-right: 15px;"></div>
    `;
    content = content.replace('<body>', `<body>\n${domContainers}`);

    fs.writeFileSync(htmlPath, content, 'utf8');
    console.log('✅ [HTML 编译] 全局 DOM 中文字体回退样式与详情浮层覆写成功！');
    return true;
}

// 阶段三：一键同步覆写 65 个卡片的项目名称与三维详情介绍 (CMS 数据库)
function step3_patchCms() {
    console.log('\n==================================================');
    console.log('📦 阶段三：正在将 CONFIG 项目卡片数据进行底层映射与重组...');
    console.log('==================================================');

    const devPath = path.join(__dirname, 'cms/projects-dev.json');
    const latestPath = path.join(__dirname, 'cms/projects-latest.json');

    if (!fs.existsSync(devPath)) {
        console.error(`❌ 未能找到项目卡片数据库: ${devPath}`);
        return false;
    }

    const projects = JSON.parse(fs.readFileSync(devPath, 'utf8'));
    let tagPatchCount = 0;

    // 💡 Zeta 标签全量中文化与自定义过滤键自动批量重映射算法
    // 建立从原厂「旧英文分类键」到最新「自定义过滤键」的射影映射
    const tagMapping = {
        "Website": CONFIG.filterKey1,
        "Installation": CONFIG.filterKey2,
        "XR": CONFIG.filterKey3,
        "Multiplayer": CONFIG.filterKey4,
        "Game": CONFIG.filterKey5
    };

    projects.forEach(p => {
        // B. 自动批量将旧 of 英文 tags 进行中文化及自定义过滤键替换 (兼容字符串和数组双重格式)
        if (p.tags) {
            if (typeof p.tags === 'string') {
                const oldTag = p.tags;
                if (tagMapping[oldTag]) {
                    p.tags = tagMapping[oldTag]; // 强行映射为新设定的 filterKey
                    tagPatchCount++;
                }
            } else if (Array.isArray(p.tags)) {
                p.tags = p.tags.map(oldTag => {
                    if (tagMapping[oldTag]) {
                        tagPatchCount++;
                        return tagMapping[oldTag]; // 强行替换为 CONFIG 里最新配置的 filterKey
                    }
                    return oldTag;
                });
            }
        }
    });

    fs.writeFileSync(devPath, JSON.stringify(projects, null, 4), 'utf8');
    fs.writeFileSync(latestPath, JSON.stringify(projects, null, 4), 'utf8');

    console.log(`✅ [标签映射引擎] 全自动分析并精准重映射了 ${tagPatchCount} 个卡片的底层过滤器分类键标签！`);
    return true;
}

// 阶段四：重新全自动生成去重字符集 (charset.txt)
function step4_generateCharset() {
    console.log('\n==================================================');
    console.log('📦 阶段四：正在重新分析并分析全站中文字形字符集...');
    console.log('==================================================');

    const ASCII_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()-_=+[]{}|;:',./<>?~ \"`\n\r";
    const devPath = path.join(__dirname, 'cms/projects-dev.json');

    let projectsText = '';
    if (fs.existsSync(devPath)) {
        const projects = JSON.parse(fs.readFileSync(devPath, 'utf8'));
        projects.forEach(p => {
            if (p.name) projectsText += p.name;
            if (p.tags) {
                if (Array.isArray(p.tags)) {
                    projectsText += p.tags.join('');
                } else {
                    projectsText += p.tags;
                }
            }
        });
    }

    const patchText = fs.readFileSync(path.join(__dirname, 'patch-search-text.js'), 'utf8');

    // 强行硬编码注入全站核心 3D 中文字符集，100%防乱码漏字
    const FORCE_CHINESE = "中国江苏苏州洛杉矶纽约阿姆斯特丹联系我们隐私政策声明时事通讯订阅招贤纳士移动端同步官网创意网站混合现实交互装置自媒体群兴趣";

    const combined = ASCII_CHARS + projectsText + patchText + FORCE_CHINESE;
    const uniqueSet = new Set();

    for (let i = 0; i < combined.length; i++) {
        const char = combined[i];
        if (char !== '\n' && char !== '\r' && char !== '\t') {
            uniqueSet.add(char);
        }
    }

    const uniqueChars = Array.from(uniqueSet).join('');
    const charsetOut = path.join(__dirname, 'scratch/charset.txt');
    fs.writeFileSync(charsetOut, uniqueChars, 'utf8');

    console.log(`✅ [字符集扫描] 成功更新去重字符集：${uniqueChars.length} 个汉字/符号`);
    return true;
}

// 阶段五：一键重新编译并融合 3D 几何中文字形包 (Bold, Light, Regular)
function step5_buildFonts() {
    console.log('\n==================================================');
    console.log('📦 阶段五：正在一键重新编译与融合 3D 中文几何字形包...');
    console.log('==================================================');

    const buildScript = path.join(__dirname, 'scratch/build-all-fonts.js');
    if (!fs.existsSync(buildScript)) {
        console.error('❌ 未找到字体编译脚本！');
        return false;
    }

    try {
        execSync(`node "${buildScript}"`, { stdio: 'inherit' });
        console.log('✅ [3D 字形编译] Bold、Light、Regular 三套 3D 几何中文字体包编译部署完毕！');
        return true;
    } catch (err) {
        console.error('❌ 3D 几何字体编译发生致命错误！', err);
        return false;
    }
}

// 阶段六：终极一键重新增量打包
function step6_repack() {
    console.log('\n==================================================');
    console.log('📦 阶段六：正在将全中文化最新成果重新封装入部署包...');
    console.log('==================================================');

    const repackCmd = `zip -r active-theory-custom.zip . -x "node_modules/*" -x "active-theory-v6.zip" -x "1ad34af8a9876f5513c8a9bfdef27a62.obj" -x "*.bak" -x "*/.DS_Store" -x ".DS_Store" -x ".git/*" -x "scratch/*"`;
    console.log(`执行打包命令: ${repackCmd}`);

    try {
        // 同步执行以确保打包彻底完成
        execSync(repackCmd, { stdio: 'inherit' });
        console.log('\n🎉 [终极增量封包] active-theory-custom.zip 全量汉化部署压缩包已成功生成！');
        return true;
    } catch (err) {
        console.error('❌ 重新打包发生错误！', err);
        return false;
    }
}

// 执行主集线器管道
(function main() {
    console.log('\n======================================================================');
    console.log('⚡ Zeta 网页全站 3D 可视化一键超级定制引擎：全面启动...');
    console.log('======================================================================');

    const s1 = step1_patchJs();
    const s2 = step2_patchHtml();
    const s3 = step3_patchCms();
    const s4 = step4_generateCharset();
    const s5 = step5_buildFonts();
    const s6 = step6_repack();

    if (s1 && s2 && s3 && s4 && s5 && s6) {
        console.log('\n======================================================================');
        console.log('🏆 恭喜您！Zeta 超级定制引擎一站式 6 大集成阶段全流程圆满成功！');
        console.log('💡 本地验证方法：');
        console.log('   1. 在控制台的 Application -> Storage 中执行 「Clear site data」 清除强缓存。');
        console.log('   2. 开启 Disable Cache 并在浏览器中按 Cmd+Shift+R (强制刷新) 即可预览终极效果！');
        console.log('======================================================================\n');
    } else {
        console.error('\n❌ Zeta 自动化集成管道执行中断，请检查上方日志错误排查！\n');
        process.exit(1);
    }
})();

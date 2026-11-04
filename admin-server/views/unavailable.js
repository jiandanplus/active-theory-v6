// Fixed maintenance pages for public routes. Bytes are pinned by the public
// golden test; keep the markup minimal and free of request data.
const PAGES = {
  unavailable: ["网站暂时不可用", "网站暂时不可用，请稍后重试。"],
  upgrade: [
    "网站需要维护升级",
    "网站需要维护升级，请由管理员在服务器备份后运行数据库升级命令",
  ],
  notReady: [
    "网站尚未就绪",
    "网站尚未完成安装或暂时不可用，请通过管理后台检查状态。",
  ],
};
/** @param {keyof typeof PAGES} kind */
function unavailablePage(kind) {
  const [title, message] = PAGES[kind];
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><p>${message}</p><a href="/admin">管理后台</a>`;
}
module.exports = { unavailablePage };

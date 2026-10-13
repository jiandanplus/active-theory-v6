(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SiteIdentity = api;
})(globalThis, function () {
  'use strict';
  const DEFAULTS = Object.freeze({description:'',language:'en',socialImage:''});
  const LANGUAGES = Object.freeze(['zh-CN','zh-TW','en']);
  const bad = message => Object.assign(new Error(message), {status:400});
  function normalizeSite(site = {}) {
    if (!site || typeof site !== 'object' || Array.isArray(site)) throw bad('网站配置字段无效');
    return {...DEFAULTS,...structuredClone(site)};
  }
  function normalizeConfig(config) {
    const copy = structuredClone(config);
    copy.site = normalizeSite(copy.site);
    return copy;
  }
  function validateIdentity(site) {
    if (typeof site.description !== 'string' || site.description.length > 500 ||
        /<\/?[a-z!]|\x00/i.test(site.description)) throw bad('网站描述须为不超过 500 字符的纯文本');
    if (!LANGUAGES.includes(site.language)) throw bad('网站语言无效');
    if (typeof site.socialImage !== 'string') throw bad('分享图片地址必须是文本');
    return site;
  }
  return {DEFAULTS,LANGUAGES,normalizeSite,normalizeConfig,validateIdentity};
});

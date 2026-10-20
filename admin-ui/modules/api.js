"use strict";
/** @typedef {{csrf: string, config: unknown, sessionEpoch: number}} ApiState */
/** @typedef {{state: ApiState, fetch: typeof globalThis.fetch, login: (initialized: boolean) => unknown}} ApiContext */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.SiteAdminModules ||= {})["api"] = factory();
})(/** @type {typeof globalThis & {SiteAdminModules?: Record<string, object>}} */ (globalThis), function () {
/** @param {ApiContext} context */
function create(context) {
  const { state, fetch, login } = context;
  /**
   * @param {string} path
   * @param {string} [method]
   * @param {unknown} [body]
   * @returns {Promise<unknown>}
   */
  async function api(path, method = "GET", body) {
    const epoch = state.sessionEpoch;
    let res;
    try { res = await fetch("/api/admin" + path, {
      method,
      credentials: "same-origin",
      headers:
        method === "GET"
          ? {}
          : { "Content-Type": "application/json", "X-CSRF-Token": state.csrf },
      body: body === undefined ? undefined : JSON.stringify(body),
    }); } catch { throw new Error(method === "GET" ? "网络请求失败，请刷新后重试" : "网络结果不明，请刷新版本和最近操作核对，不要自动重试"); }
    let data;
    try { data = await res.json(); }
    catch { if(res.ok) throw new Error(method === "GET" ? "服务器响应无效" : "服务器响应无效，结果可能已生效；请刷新版本和最近操作核对，不要自动重试"); }
    if (!res.ok) {
      if (res.status === 401 && epoch === state.sessionEpoch && state.config && path !== "/password") {
        state.sessionEpoch++;
        state.config = null;
        login(true);
      }
      throw new Error(data?.error || "请求失败");
    }
    return data;
  }
  return { api };
}
return { create };
});

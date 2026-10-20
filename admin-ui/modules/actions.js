"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.SiteAdminModules ||= {})["actions"] = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
function create(context) {
  const { state, window, node, notify, confirmAction, api, dirty, updateStatus, building, validRevision, panel, render } = context;
  async function save() {
    if (state.busy) throw new Error("正在处理，请稍后");
    state.busy = true;
    updateStatus();
    try {
      const epoch=state.sessionEpoch;
      if (!window.SiteContentContract?.validateConfig)
        throw new Error("内容校验模块加载失败，请刷新页面后重试");
      if (!state.validationSchema)
        throw new Error("内容校验结构未加载，请刷新页面后重试");
      window.SiteContentContract.validateConfig(state.config, state.validationSchema);
      const saved = JSON.stringify(state.config);
      const data = await api("/config", "PUT", {
        config: JSON.parse(saved),
        revision: state.revision,
      });
      if(epoch!==state.sessionEpoch)return;
      if(!validRevision(data?.revision))throw new Error('保存响应无效，请刷新草稿状态核对');
      state.revision = data.revision;
      state.dirty = JSON.stringify(state.config) !== saved;
      updateStatus();
      notify(
        state.dirty
          ? "草稿已保存；保存期间的新修改尚未保存。"
          : "草稿已保存。公开网站尚未改变。",
      );
    } finally {
      state.busy = false;
      updateStatus();
    }
  }
  async function preview() {
    if(state.busy)throw new Error('正在处理，请稍后');
    const epoch=state.sessionEpoch;
    if (state.dirty) await save();
    if(epoch!==state.sessionEpoch)return;
    if (state.dirty) throw new Error("保存期间内容已修改，请再次保存后预览");
    if(!state.runtime.selection.digest)throw new Error('服务器尚未选择运行包；请先在服务器登记并选择运行包');
    await building(async()=>{
    const data = await api("/preview", "POST", { revision: state.revision });
    if(epoch!==state.sessionEpoch)return;
    if(typeof data?.url!=='string'||!/^\/\?preview=preview-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(data.url))
      throw new Error('预览响应无效，结果可能已生效；请刷新版本和最近操作核对，不要自动重试');
    const link = node("a", "打开草稿预览 ↗");
    link.href = data.url;
    link.target = "_blank";
    link.rel = "noopener";
    const p = panel(context.content, "草稿预览已准备");
    p.append(link, node("p", "这是私有草稿预览，未发布到公开网站。", "muted"));
    p.scrollIntoView({ behavior: "smooth" });
    window.open(data.url, "_blank", "noopener");
    });
  }
  async function publish() {
    if(state.busy)throw new Error('正在处理，请稍后');
    const epoch=state.sessionEpoch;
    const selectionGeneration=state.runtime.selection.generation;
    if (
      !(await confirmAction(
        "确认发布当前草稿？网站的文案、作品和资源将在公开网站生效。只读 S3 测试不验证公开 URL 或 CORS；请先在前台预览资源，检查加载与跨域访问。",
      ))
    )
      return;
    if(epoch!==state.sessionEpoch)return;
    if(state.busy)throw new Error('正在处理，请稍后');
    if(selectionGeneration!==state.runtime.selection.generation)throw new Error('运行包选择已变化，请重新确认发布');
    if (state.dirty) await save();
    if(epoch!==state.sessionEpoch)return;
    if (state.dirty) throw new Error("保存期间内容已修改，请再次保存后发布");
    if(!state.runtime.selection.digest)throw new Error('服务器尚未选择运行包；请先在服务器登记并选择运行包');
    await building(async()=>{
    const result = await api("/publish", "POST", { revision: state.revision });
    if(epoch!==state.sessionEpoch)return;
    if(!Number.isSafeInteger(result?.version)||result.version<1)
      throw new Error('发布响应无效，结果可能已生效；请刷新版本和最近操作核对，不要自动重试');
    state.overview.published = result.version;
    notify("发布成功 · 版本 " + result.version);
    if (state.section === "versions" || state.section === "overview")
      await render();
    });
  }
  return { save, preview, publish };
}
return { create };
});

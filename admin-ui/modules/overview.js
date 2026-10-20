"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.SiteAdminModules ||= {})["overview"] = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
function create(context) {
  const { state, node, button, notify, run, api, building, validRevision, refreshRuntime, field, panel, heading, warning, empty } = context;
  async function overviewView() {
    const o = await api("/overview");
    state.overview = o;
    heading("网站总览", "从内容到发布，在这里管理每一个细节。");
    const runtimePanel=panel(context.content,'运行包');
    if(!await refreshRuntime()||state.section!=='overview'||!runtimePanel.isConnected)return;
    showRuntimePanel(runtimePanel);
    const metrics = node("div", undefined, "metrics");
    for (const [label, value, note] of [
      ["当前发布版本", o.published === null ? "尚未发布" : "v" + o.published, o.published === null ? "发布后即可访问公开网站" : "公开网站正在使用"],
      ["草稿修订", state.revision, "保存与发布互不影响"],
      ["作品数量", state.config.projects.length, "展示在作品空间"],
      ["资源数量", o.resources, "图片 / 视频 / 音乐 / 模型"],
    ]) {
      const p = panel(metrics);
      p.classList.add("metric");
      p.append(
        node("small", label),
        node("div", String(value), "number"),
        node("small", note),
      );
    }
    context.content.append(metrics);
    const grid = node("div", undefined, "grid");
    context.content.append(grid);
    const guide = panel(grid, "你的内容工作流");
    guide.append(
      node("p", "编辑内容 → 保存草稿 → 预览检查 → 发布网站"),
      node(
        "p",
        "保存只更新管理草稿；公开页面始终读取已发布版本。你可以在「发布版本」将历史版本恢复为草稿，再检查并发布。",
        "muted",
      ),
    );
    const storage = panel(grid, "资源与存储");
    storage.append(
      node(
        "p",
        "默认上传位置：" +
          (state.storages.find((s) => s.id === o.defaultStorage)?.name ||
            o.defaultStorage),
      ),
    );
    warning(
      storage,
      o.masterKeyConfigured
        ? "云存储凭证由服务器加密保存。只读连接测试不验证公开 URL 或 CORS，请在前台预览检查资源。"
        : "尚未配置 SITE_MASTER_KEY。可以使用本地存储；配置 S3 前需先设置服务器加密密钥。",
    );
    const audit = panel(context.content, "最近操作");
    if (!o.audit.length) empty(audit, "尚无操作记录");
    else
      for (const a of o.audit)
        audit.append(
          node(
            "p",
            new Date(a.created).toLocaleString("zh-CN") +
              " · " +
              a.action +
              " · " +
              (a.actor || "管理员"),
            "muted",
          ),
        );
  }
  function showRuntimePanel(p,restoreFocus=false) {
    const {selection,bundles}=state.runtime;
    p.replaceChildren(node('h2','运行包'));
    p.append(node('p','选择只影响之后的预览与发布；不会修改历史内容或当前草稿。','muted'));
    const register = button('添加内置个人主页模板', async () => {
      const epoch = state.sessionEpoch;
      let refreshed = false;
      await building(async () => {
        const result = await api('/runtime/builtin', 'POST', {});
        if (epoch !== state.sessionEpoch) return;
        if (!/^[a-f0-9]{64}$/.test(result?.digest || '') ||
            typeof result.profileId !== 'string' || !result.profileId ||
            !Number.isSafeInteger(result.files) || result.files < 1 ||
            !Number.isSafeInteger(result.bytes) || result.bytes < 1)
          throw new Error('添加模板响应无效，结果可能已生效；请刷新运行包状态核对，不要自动重试');
        refreshed = await refreshRuntime();
      });
      if (epoch !== state.sessionEpoch || !refreshed || !p.isConnected) return;
      showRuntimePanel(p);
      notify('内置个人主页模板已添加，请在下方明确选择后再预览或发布。');
    }, undefined, true);
    register.disabled = state.busy;
    p.append(register);
    if(!bundles.length){empty(p,'服务器尚未登记运行包；请由管理员在服务器登记。内容和账号仍可编辑。');return;}
    const chosen=bundles.find(bundle=>bundle.digest===selection.digest);
    p.append(node('p',chosen
      ? `当前：${chosen.digest.slice(0,12)}… · ${chosen.profileId} · ${chosen.bytes} 字节`
      : '尚未选择运行包；预览和发布前请从服务器登记的包中选择。'));
    const options=[{value:'',label:'请选择运行包'},...bundles.map(bundle=>({
      value:bundle.digest,label:`${bundle.digest.slice(0,12)}… · ${bundle.profileId} · ${bundle.bytes} 字节`,
    }))];
    const input=field(p,'用于之后预览与发布的运行包',selection.digest||'',value=>{
      if(!value||value===state.runtime.selection.digest){input.value=state.runtime.selection.digest||'';return;}
      run(async()=>{
        if(state.busy)throw new Error('正在处理，请稍后');
        const epoch=state.sessionEpoch;
        let refreshed=false;
        try {
          await building(async()=>{
            let result;
            try { result=await api('/runtime/selection','PUT',{digest:value,generation:state.runtime.selection.generation}); }
            catch(error) { if(epoch===state.sessionEpoch)await refreshRuntime(); throw error; }
            if(epoch!==state.sessionEpoch)return;
            if(result?.digest!==value||!validRevision(result.generation))
              throw new Error('选择响应无效，结果可能已生效；请刷新运行包状态核对，不要自动重试');
            refreshed=await refreshRuntime();
          });
        } catch(error) {
          if(epoch===state.sessionEpoch&&p.isConnected)showRuntimePanel(p,true);
          throw error;
        }
        if(epoch!==state.sessionEpoch||!refreshed||!p.isConnected)return;
        showRuntimePanel(p,true);
        notify('运行包选择已更新，仅影响之后的预览与发布。');
      });
    },{choices:options});
    input.dataset.busyAction='true';
    input.disabled=state.busy;
    if(restoreFocus)input.focus();
  }
  return { overviewView, showRuntimePanel };
}
return { create };
});

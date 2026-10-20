"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.SiteAdminModules ||= {})["versions"] = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
function create(context) {
  const { state, document, node, button, notify, confirmAction, api, dirty, updateStatus, building, validRevision, panel, heading, empty, render } = context;
  async function versionsView() {
    const current = context.captureView?.() || (() => true);
    const data = await api("/versions");
    if (!current()) return;
    heading(
      "发布版本",
      "每次发布都有快照。恢复只更新草稿，不会立即替换公开网站。",
    );
    const p = panel(context.content, "版本历史");
    if (!data.versions.length) {
      empty(p, "尚无发布版本");
      return;
    }
    const table = node("table"),
      head = node("tr");
    for (const label of ["版本", "发布时间", "状态", "交付", "操作"])
      head.append(node("th", label));
    const thead = node("thead");
    thead.append(head);
    table.append(thead);
    const body = node("tbody");
    for (const v of data.versions) {
      const row = node("tr");
      row.append(
        node("td", "v" + v.id),
        node("td", new Date(v.created).toLocaleString("zh-CN")),
        node("td", v.id === data.published ? "当前公开版本" : "历史版本"),
        node('td',`${v.status||'缺失/损坏'}${v.artifactDigest?' · '+v.artifactDigest.slice(0,12)+'…':''}`),
      );
      const td = node("td");
      td.append(
        button("恢复到草稿", async () => {
          if(state.busy)throw new Error('正在处理，请稍后');
          const epoch=state.sessionEpoch;
          if (
            !(await confirmAction(
              "将版本 v" +
                v.id +
                " 恢复为草稿？" +
                (state.dirty ? "未保存的修改会丢失。" : "") +
                "公开网站不会改变。",
            ))
          )
            return;
          if(epoch!==state.sessionEpoch||!current())return;
          if(state.busy)throw new Error('正在处理，请稍后');
          await building(async()=>{
          await api("/versions/" + v.id + "/restore", "POST", {
            revision: state.revision,
          });
          if(epoch!==state.sessionEpoch||!current())return;
          const cfg = await api("/config");
          if(epoch!==state.sessionEpoch||!current())return;
          if(!cfg||!validRevision(cfg.revision)||!cfg.config)throw new Error('恢复响应无效，请刷新草稿与版本核对');
          state.config = cfg.config;
          state.revision = cfg.revision;
          state.dirty = false;
          updateStatus();
          notify("已恢复为草稿。预览检查后可重新发布。");
          await render();
          });
        },undefined,true),
      );
      if(v.mode==='legacy'&&v.artifactDigest===null&&Number.isSafeInteger(v.generation))
        td.append(button('生成兼容交付',async()=>{
          if(state.busy)throw new Error('正在处理，请稍后');
          const epoch=state.sessionEpoch;
          if(!(await confirmAction('为版本 v'+v.id+' 生成兼容交付？历史内容不会改变，也不会替换已有交付。')))return;
          if(epoch!==state.sessionEpoch||!current())return;
          if(state.busy)throw new Error('正在处理，请稍后');
          await building(async()=>{
            const result=await api('/versions/'+v.id+'/delivery','POST',{generation:v.generation});
            if(epoch!==state.sessionEpoch||!current())return;
            if(result?.version!==v.id||typeof result.artifactDigest!=='string'||!/^[a-f0-9]{64}$/.test(result.artifactDigest))
              throw new Error('兼容交付响应无效，结果可能已生效；请刷新版本和最近操作核对，不要自动重试');
            notify('兼容交付已固定，历史内容未改变。');
            await render();
          });
          if(epoch!==state.sessionEpoch||state.section!=='versions')return;
          document.querySelector('[data-section="versions"]')?.focus();
        },undefined,true));
      row.append(td);
      body.append(row);
    }
    table.append(body);
    p.append(table);
  }
  return { versionsView };
}
return { create };
});

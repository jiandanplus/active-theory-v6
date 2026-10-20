"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.SiteAdminModules ||= {})["state"] = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
function createState() {
  return {
    csrf: "",
    config: null,
    validationSchema: null,
    revision: 0,
    dirty: false,
    busy: false,
    sessionEpoch: 0,
    runtime: {selection:{digest:null,generation:0},bundles:[]},
    section: "overview",
    resources: [],
    storages: [],
    defaultStorage: "local",
    overview: {},
  };
}
function create(context) {
  const { state, document, window, node, api } = context;
  let runtimeRequestSequence = 0;
  let viewSequence = 0;
  // A continuation belongs to one session, render, section and content mount.
  // Capturing only the section is insufficient when a user leaves and returns.
  function captureView() {
    const epoch = state.sessionEpoch, sequence = viewSequence;
    const section = state.section, content = context.content;
    return () => epoch === state.sessionEpoch && sequence === viewSequence &&
      section === state.section && content === context.content;
  }
  function invalidateView() {
    viewSequence++;
    invalidateRuntime();
    context.closeDialogs?.();
  }
  function invalidateRuntime() { runtimeRequestSequence++; }
  function dirty() {
    state.dirty = true;
    updateStatus();
  }
  function updateStatus() {
    if (!context.saveStatus) return;
    context.saveStatus.replaceChildren(
      node("span", "", "status-dot"),
      node(
        "span",
        state.busy ? "正在处理，请稍后" : state.dirty ? "有未保存的修改" : "草稿已保存 · 修订 " + state.revision,
      ),
    );
    context.saveStatus.className = state.dirty ? "is-dirty" : "";
    for(const control of document.querySelectorAll('[data-busy-action]')) control.disabled=state.busy;
  }
  async function building(action) {
    if(state.busy)throw new Error("正在处理，请稍后");
    const epoch=state.sessionEpoch;
    state.busy=true;updateStatus();
    try{return await action();}
    finally{if(epoch===state.sessionEpoch){state.busy=false;updateStatus();}}
  }
  function validRevision(value){return Number.isSafeInteger(value)&&value>=0;}
  function validRuntime(value){return value&&value.selection&&validRevision(value.selection.generation)&&
    (value.selection.digest===null||/^[a-f0-9]{64}$/.test(value.selection.digest))&&Array.isArray(value.bundles);}
  async function refreshRuntime(){
    const sequence=++runtimeRequestSequence,epoch=state.sessionEpoch;
    const current=context.captureView?.() || (()=>true);
    const result=await api('/runtime');
    if(sequence!==runtimeRequestSequence||epoch!==state.sessionEpoch||!current())return false;
    if(!validRuntime(result))throw new Error('运行包状态响应无效');
    state.runtime=result;
    return true;
  }
  window.addEventListener("beforeunload", (event) => {
    if (state.dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  return { dirty, updateStatus, building, validRevision, validRuntime, refreshRuntime, invalidateRuntime, captureView, invalidateView };
}
return { create, createState };
});

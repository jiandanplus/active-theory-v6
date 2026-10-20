"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.SiteAdminModules ||= {})["storage"] = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
function create(context) {
  const { state, document, node, button, notify, api, field, panel, heading, warning, check, render, storageBody } = context;
  async function storageView() {
    const result = await api("/storages");
    state.storages = result.storages;
    state.defaultStorage = result.defaultStorage;
    heading(
      "存储设置",
      "本地优先，或连接兼容 S3 的对象存储。存储操作会立即保存。",
    );
    warning(
      context.content,
      state.overview.masterKeyConfigured
        ? "凭证加密存储在服务器端。编辑时凭证保持空白；留空保留已配置值，不会回显原值。"
        : "配置 S3 前，请在服务器设置 64 位十六进制 SITE_MASTER_KEY 并重启。没有密钥时仍可正常使用本地存储。",
    );
    for (const store of state.storages) {
      const p = panel(
        context.content,
        store.name + (state.defaultStorage === store.id ? " · 默认" : ""),
      );
      p.append(
        node(
          "p",
          store.type === "local"
            ? "资源保存在服务器本地，需要纳入备份。"
            : store.bucket + " · " + store.endpoint,
          "muted",
        ),
      );
      const actions = node("div", undefined, "toolbar");
      actions.append(
        button("只读连接测试", async () => {
          const result = await api(
            "/storages/" + store.id + "/test",
            "POST",
            {},
          );
          notify(
            result.ok
              ? "连接测试通过（只读），不验证公开 URL 或 CORS。请在前台预览资源，检查加载与跨域访问。"
              : "连接测试未通过",
          );
        }),
      );
      if (state.defaultStorage !== store.id)
        actions.append(
          button("设为默认", async () => {
            if (store.id === "local")
              await api("/storages", "POST", { id: "local", isDefault: true });
            else
              await api("/storages", "POST", {
                ...storageBody(store),
                isDefault: true,
              });
            await render();
            notify("默认上传位置已更新。");
          }),
        );
      if (store.type === "s3")
        actions.append(button("编辑配置", () => storageEditor(store)));
      p.append(actions);
    }
    context.content.append(
      button("＋ 添加 S3 存储", () => storageEditor({}), "primary"),
    );
  }
  function storageEditor(existing) {
    const dialog = node("dialog", undefined, "modal"),
      head = node("div", undefined, "modal-head");
    head.append(
      node("h2", existing.id ? "编辑 S3 存储" : "添加 S3 存储"),
      button("关闭", () => dialog.close()),
    );
    dialog.append(head);
    warning(
      dialog,
      "凭证输入框始终为空。编辑已有配置时，留空保留旧凭证。使用最小权限凭证；连接测试为只读，不验证公开资源 URL 或 CORS；管理员需在前台预览检查资源加载与跨域访问。已有资源的存储位置不能更改。",
    );
    const values = {
      id: existing.id,
      name: existing.name || "",
      endpoint: existing.endpoint || "",
      region: existing.region || "us-east-1",
      bucket: existing.bucket || "",
      prefix: existing.prefix || "",
      publicBaseUrl: existing.publicBaseUrl || "",
      forcePathStyle: !!existing.forcePathStyle,
      isDefault: false,
    };
    const form = node("form"),
      grid = node("div", undefined, "grid");
    for (const [key, label] of [
      ["name", "配置名称"],
      ["endpoint", "S3 Endpoint（HTTPS）"],
      ["region", "区域"],
      ["bucket", "Bucket"],
      ["prefix", "对象前缀"],
      ["publicBaseUrl", "公开资源根地址（HTTPS）"],
      ["accessKeyId", "Access Key ID"],
      ["secretAccessKey", "Secret Access Key"],
      ["sessionToken", "Session Token（可选）"],
    ])
      field(grid, label, values[key] || "", (v) => (values[key] = v), {
        type: ["accessKeyId", "secretAccessKey", "sessionToken"].includes(key)
          ? "password"
          : "text",
        autocomplete: "off",
        placeholder:
          ["accessKeyId", "secretAccessKey", "sessionToken"].includes(key) &&
          existing.id
            ? "留空保留已配置值"
            : undefined,
      });
    form.append(grid);
    check(
      form,
      "使用 Path-style 地址",
      values.forcePathStyle,
      (v) => (values.forcePathStyle = v),
    );
    check(form, "设为默认上传位置", false, (v) => (values.isDefault = v));
    const actions = node("div", undefined, "form-actions");
    actions.append(
      button("取消", () => dialog.close()),
      button(
        "保存存储配置",
        async () => {
          await api("/storages", "POST", storageBody(values));
          dialog.close();
          await render();
          notify("存储配置已保存，请执行连接测试。");
        },
        "primary",
      ),
    );
    form.append(actions);
    dialog.append(form);
    document.body.append(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.showModal();
  }
  return { storageView, storageEditor };
}
return { create };
});

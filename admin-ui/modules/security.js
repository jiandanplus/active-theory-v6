"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.SiteAdminModules ||= {})["security"] = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
function create(context) {
  const { state, node, button, notify, confirmAction, run, api, dirty, field, panel, heading, warning, init } = context;
  function securityView() {
    heading("账号安全", "保护唯一管理员账号，定期更新密码。");
    const p = panel(context.content, "修改密码");
    warning(
      p,
      "修改密码成功后，当前登录和其他已有会话都会失效。请使用新密码重新登录。",
    );
    const form = node("form");
    let currentPassword = "",
      newPassword = "";
    const current = field(form, "当前密码", "", (v) => (currentPassword = v), {
        type: "password",
        autocomplete: "current-password",
      }),
      next = field(form, "新密码", "", (v) => (newPassword = v), {
        type: "password",
        autocomplete: "new-password",
        help: "至少 12 位，建议使用密码管理器生成独立密码。",
      });
    current.required = true;
    next.required = true;
    next.minLength = 12;
    const submit = node("button", "更新密码", "primary");
    submit.type = "submit";
    form.append(submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      run(async () => {
        const epoch = state.sessionEpoch;
        if (
          state.dirty &&
          !(await confirmAction(
            "修改密码会退出登录，未保存修改将丢失。继续吗？",
          ))
        )
          return;
        if (epoch !== state.sessionEpoch) return;
        await api("/password", "POST", { currentPassword, newPassword });
        if (epoch !== state.sessionEpoch) return;
        state.sessionEpoch++;
        context.invalidateView?.();
        state.config = null;
        state.dirty = false;
        state.csrf = "";
        notify("密码已更新，请重新登录。");
        await init();
      }, submit);
    });
    p.append(form);
  }
  return { securityView };
}
return { create };
});

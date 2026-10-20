"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.SiteAdminModules ||= {})["dom"] = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
function create(context) {
  const { state, document, crypto, picker } = context;
  let noticeTimer;
  function node(tag, text, cls) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (cls) el.className = cls;
    return el;
  }
  function button(text, action, cls, busyAction = false) {
    const b = node("button", text, cls);
    b.type = "button";
    if (busyAction) b.dataset.busyAction = "true";
    b.addEventListener("click", () => run(action, b));
    return b;
  }
  function notify(message, error = false) {
    const el = document.getElementById("notice");
    el.textContent = message;
    el.className = "visible" + (error ? " error" : "");
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => (el.className = ""), 6500);
  }
  function confirmAction(message) {
    return new Promise((resolve) => {
      const dialog = node("dialog", undefined, "modal");
      const title = node("h2", "确认操作"),
        description = node("p", message),
        actions = node("div", undefined, "form-actions");
      title.id = "confirmation-title-" + crypto.randomUUID();
      description.id = "confirmation-message-" + crypto.randomUUID();
      dialog.setAttribute("aria-labelledby", title.id);
      dialog.setAttribute("aria-describedby", description.id);
      let accepted = false;
      const cancel = button("取消", () => dialog.close());
      cancel.autofocus = true;
      const proceed = button(
        "确认继续",
        () => {
          accepted = true;
          dialog.close();
        },
        "primary",
      );
      actions.append(cancel, proceed);
      dialog.append(title, description, actions);
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        dialog.close();
      });
      dialog.addEventListener(
        "close",
        () => {
          dialog.remove();
          resolve(accepted);
        },
        { once: true },
      );
      document.body.append(dialog);
      dialog.showModal();
      cancel.focus();
    });
  }
  async function run(action, b) {
    const epoch = state.sessionEpoch, hadFocus = b && document.activeElement === b;
    let movedFocus = false;
    const watchFocus = (event) => {
      if (event.target !== b && !event.target.closest?.("dialog")) movedFocus = true;
    };
    if (hadFocus) document.addEventListener("focusin", watchFocus);
    if (b) b.disabled = true;
    try {
      await action();
    } catch (e) {
      notify(e.message, true);
    } finally {
      if (b) b.disabled = !!(state.busy && b.dataset.busyAction);
      if (hadFocus) document.removeEventListener("focusin", watchFocus);
      if (hadFocus && !movedFocus && epoch === state.sessionEpoch &&
          b.isConnected && !b.disabled && document.activeElement === document.body) b.focus();
    }
  }
  function field(parent, label, value, onChange, options = {}) {
    const wrap = node("div", undefined, "field"),
      id = "field-" + crypto.randomUUID();
    const l = node("label", label);
    l.htmlFor = id;
    wrap.append(l);
    const input = node(options.choices ? "select" : options.multiline ? "textarea" : "input");
    input.id = id;
    if (!options.choices && !options.multiline) input.type = options.type || "text";
    if (options.choices) for (const choice of options.choices) {
      const option = node("option", choice.label);
      option.value = choice.value;
      input.append(option);
    }
    if (options.maxLength !== undefined) input.maxLength = options.maxLength;
    input.value =
      options.type === "date"
        ? String(value || "").slice(0, 10)
        : (value ?? "");
    if (options.min !== undefined) input.min = options.min;
    if (options.max !== undefined) input.max = options.max;
    if (options.step) input.step = options.step;
    if (options.placeholder) input.placeholder = options.placeholder;
    if (options.readOnly) input.readOnly = true;
    if (options.autocomplete) input.autocomplete = options.autocomplete;
    input.addEventListener(options.choices ? "change" : "input", () =>
      onChange(options.type === "number" ? Number(input.value) : input.value),
    );
    if (options.pick) {
      const row = node("div", undefined, "field-row");
      row.append(
        input,
        button("选择资源", () =>
          picker(options.pick, (value) => {
            input.value = value;
            onChange(value);
          }),
        ),
      );
      wrap.append(row);
    } else wrap.append(input);
    if (options.help)
      wrap.append(node("small", options.help, options.key ? "field-key" : ""));
    parent.append(wrap);
    return input;
  }
  function panel(parent, title) {
    const p = node("section", undefined, "panel");
    if (title) p.append(node("h2", title));
    parent.append(p);
    return p;
  }
  function heading(title, description, action) {
    const h = node("div", undefined, "page-heading"),
      left = node("div");
    left.append(
      node("div", "CONTENT STUDIO", "eyebrow"),
      node("h1", title),
      node("p", description, "muted"),
    );
    h.append(left);
    if (action) h.append(action);
    context.content.append(h);
  }
  function warning(parent, text) {
    parent.append(node("div", text, "warning"));
  }
  function empty(parent, text) {
    parent.append(node("p", text, "empty"));
  }
  function check(parent, text, checked, onChange) {
    const row = node("div", undefined, "check-row"),
      input = node("input"),
      label = node("label", text);
    input.type = "checkbox";
    input.checked = checked;
    input.id = "check-" + crypto.randomUUID();
    label.htmlFor = input.id;
    input.addEventListener("change", () => onChange(input.checked));
    row.append(input, label);
    parent.append(row);
  }
  return { node, button, notify, confirmAction, run, field, panel, heading, warning, empty, check };
}
return { create };
});

// Section dispatch: which view owns the content area, and the matching
// navigation state. Views register through the shared context.
// Functions this module adds to the shared context (see registry.js).
export const provides = ["render"];

export function create(context) {
  const { state, document } = context;
  const views = {
    overview: context.overviewView,
    site: context.siteView,
    scenes: context.scenesView,
    projects: context.projectsView,
    resources: context.resourcesView,
    storage: context.storageView,
    versions: context.versionsView,
    security: context.securityView,
  };
  async function render() {
    if (!state.config) return;
    context.invalidateView?.();
    context.content.replaceChildren();
    context.updateStatus?.();
    for (const b of document.querySelectorAll("[data-section]")) {
      const active = b.dataset.section === state.section;
      b.classList.toggle("active", active);
      if (active) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    }
    await views[state.section]();
  }
  return { render };
}

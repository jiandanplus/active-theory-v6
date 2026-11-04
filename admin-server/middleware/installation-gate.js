const { route } = require("../http");
const { installationStatus } = require("../installation");
const { noStore } = require("../delivery/response");
const { isPublicPage } = require("./request-policy");
const { unavailablePage } = require("../views/unavailable");

// Every request after the admin shell needs an installed, current schema.
// Public pages get a human page; APIs get JSON. The answer is reused by later
// handlers in the same request (req.installationState).
function installationGate(store) {
  return route(async (req, res, next) => {
    const publicPage = isPublicPage(req);
    let state;
    try {
      state = await installationStatus(store);
    } catch (error) {
      if (!publicPage) throw error;
      noStore(res, { error: true });
      return res.status(503).type("html").send(unavailablePage("unavailable"));
    }
    if (state.state !== "installed") {
      noStore(res, { error: true });
      if (publicPage)
        return res
          .status(503)
          .type("html")
          .send(
            unavailablePage(
              state.state === "upgrade_required" ? "upgrade" : "notReady",
            ),
          );
      return res.status(503).json({
        error:
          state.state === "upgrade_required"
            ? "网站需要维护升级"
            : "网站尚未安装或暂时不可用",
        state: state.state,
      });
    }
    req.installationState = state;
    next();
  });
}
module.exports = { installationGate };

const { createApp } = require("./admin-server/app");
const { loadOptions } = require("./admin-server/options");
const options = loadOptions();
const app = createApp(options);
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, process.env.HOST || "127.0.0.1", () => {
  console.log("个人网站：" + options.origin + "/");
  console.log("管理后台：" + options.origin + "/admin/");
  if (!app.locals.store.db.prepare("SELECT 1 FROM admins LIMIT 1").get())
    console.log("尚未创建管理员，请在终端执行 npm run admin:init");
});
server.requestTimeout = 150000;
function shutdown() {
  server.close(() => {
    app.locals.store.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

const { createApp } = require("./admin-server/app");
const { loadOptions } = require("./admin-server/options");
const options = loadOptions();
const app = createApp(options);
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, process.env.HOST || "127.0.0.1", () => {
  console.log("个人网站：" + options.origin + "/");
  console.log("管理后台：" + options.origin + "/admin/");
  console.log("首次部署请访问管理后台完成网页安装");
});
server.requestTimeout = 150000;
function shutdown() {
  server.close(async () => {
    try {
      await app.locals.store.close();
      process.exit(0);
    } catch {
      console.error("数据库连接关闭失败");
      process.exit(1);
    }
  });
  setTimeout(() => process.exit(1), 10000).unref();
}
process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);

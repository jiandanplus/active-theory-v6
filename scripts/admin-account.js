const readline = require("node:readline");
const { createInterface } = require("node:readline/promises");
const { openPostgres } = require("../admin-server/postgres");
const { inspectInstallation } = require("../admin-server/migrations");
const { createAccount } = require("../admin-server/security");
const { loadOptions } = require("../admin-server/options");
async function secret(prompt) {
  if (!process.stdin.isTTY)
    throw new Error("请在交互式终端运行；密码不接受命令行参数");
  process.stdout.write(prompt);
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const done = (error) => {
      process.stdin.off("keypress", onKey);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      error ? reject(error) : resolve(value);
    };
    const onKey = (text, key = {}) => {
      if (key.ctrl && key.name === "c") return done(new Error("已取消"));
      if (key.name === "return") return done();
      if (key.name === "backspace") {
        value = value.slice(0, -1);
        return;
      }
      if (
        !key.ctrl &&
        !key.meta &&
        text &&
        !/[\x00-\x1f]/.test(text) &&
        value.length < 256
      )
        value += text;
    };
    process.stdin.on("keypress", onKey);
  });
}
async function main() {
  const options = loadOptions(),
    store = openPostgres({ databaseUrl: process.env.DATABASE_URL }),
    reset = process.argv.includes("--reset");
  try {
    if ((await inspectInstallation(store)).state !== "installed")
      throw new Error("请先完成网页安装，再使用本地管理员命令");
    if (!process.stdin.isTTY) throw new Error("请使用交互式终端创建管理员");
    const input = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    if (
      reset &&
      (await input.question(
        "重置管理员会使所有会话失效。输入 RESET 确认：",
      )) !== "RESET"
    ) {
      input.close();
      return;
    }
    const username = (await input.question("管理员用户名：")).trim();
    input.close();
    const password = await secret("密码（至少 12 字符，输入不回显）：");
    if (password !== (await secret("再次输入密码：")))
      throw new Error("两次密码不一致");
    await createAccount(store, username, password, { reset });
    console.log(
      `管理员已${reset ? "重置" : "创建"}。访问 ${options.origin}/admin/ 登录。`,
    );
  } finally {
    await store.close();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

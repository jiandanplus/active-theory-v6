const crypto = require("node:crypto");
const { promisify } = require("node:util");
const scrypt = promisify(crypto.scrypt);
const IDLE = 12 * 60 * 60 * 1000,
  ABSOLUTE = 7 * 24 * 60 * 60 * 1000;
const digest = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");
const token = () => crypto.randomBytes(32).toString("hex");
function fail(status, message) {
  return Object.assign(new Error(message), { status });
}
function equal(a, b) {
  return (
    typeof a === "string" &&
    typeof b === "string" &&
    Buffer.byteLength(a) === Buffer.byteLength(b) &&
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
function validatePassword(password) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    Buffer.byteLength(password) > 256
  )
    throw fail(400, "密码须为至少 12 个字符且不超过 256 字节");
}
async function hashPassword(password) {
  validatePassword(password);
  const salt = token();
  const result = await scrypt(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return `${salt}:${result.toString("hex")}`;
}
async function verifyPassword(password, hash) {
  if (typeof password !== "string" || Buffer.byteLength(password) > 256)
    return false;
  const [salt, expected] = (
    hash || `${"0".repeat(64)}:${"0".repeat(128)}`
  ).split(":");
  const actual = await scrypt(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
  return equal(actual.toString("hex"), expected);
}
async function createAccount(
  store,
  username,
  password,
  { reset = false } = {},
) {
  if (typeof username !== "string" || !/^[a-zA-Z0-9_.-]{3,64}$/.test(username))
    throw fail(400, "用户名须为 3–64 位字母、数字、点、下划线或短横线");
  if (store.db.prepare("SELECT 1 FROM admins LIMIT 1").get() && !reset)
    throw fail(409, "管理员已存在，请使用本地重置命令");
  const hash = await hashPassword(password);
  store.transaction(() => {
    store.db.exec("DELETE FROM admins; DELETE FROM sessions;");
    store.db.prepare("INSERT INTO admins VALUES(?,?)").run(username, hash);
    store.audit(reset ? "account.reset" : "account.create", username);
  });
}
function mountAuth(app, store, options) {
  const cookieName = options.production ? "__Host-site_admin" : "site_admin";
  const cookieOptions = {
    httpOnly: true,
    secure: !!options.production,
    sameSite: "strict",
    path: "/",
    maxAge: ABSOLUTE,
  };
  const origin = options.origin.replace(/\/$/, "");
  let activeLogins = 0;
  function trustedOrigin(req, res, next) {
    if (req.get("origin") !== origin)
      return next(fail(403, "请求来源不受信任"));
    next();
  }
  app.use((req, res, next) => {
    const cookies = (req.headers.cookie || "")
      .split(";")
      .map((v) => v.trim().split("="));
    const raw = cookies.find(([key]) => key === cookieName)?.[1];
    if (raw && /^[a-f0-9]{64}$/.test(raw)) {
      const id = digest(raw),
        now = Date.now();
      const row = store.db.prepare("SELECT * FROM sessions WHERE id=?").get(id);
      if (row && now - row.touched < IDLE && now - row.created < ABSOLUTE) {
        req.adminSession = { ...row, csrfToken: row.csrf };
        if (now - row.touched > 60000)
          store.db
            .prepare("UPDATE sessions SET touched=? WHERE id=?")
            .run(now, id);
      } else if (row)
        store.db.prepare("DELETE FROM sessions WHERE id=?").run(id);
    }
    next();
  });
  app.get("/api/admin/session", (req, res) =>
    res.json({
      authenticated: !!req.adminSession,
      initialized: !!store.db.prepare("SELECT 1 FROM admins LIMIT 1").get(),
      username: req.adminSession?.username,
      csrfToken: req.adminSession?.csrf,
    }),
  );
  app.post("/api/admin/login", trustedOrigin, async (req, res, next) => {
    let entered = false;
    try {
      const { username, password } = req.body || {};
      if (
        typeof username !== "string" ||
        username.length > 64 ||
        typeof password !== "string" ||
        Buffer.byteLength(password) > 256
      )
        throw fail(400, "登录信息格式无效");
      const now = Date.now();
      store.db.prepare("DELETE FROM attempts WHERE expires<?").run(now);
      const keys = [`ip:${req.ip}`, `user:${username.toLowerCase()}`].map(
        digest,
      );
      if (
        keys.some(
          (key) =>
            (store.db.prepare("SELECT count FROM attempts WHERE key=?").get(key)
              ?.count || 0) >= 10,
        ) ||
        activeLogins >= 4
      )
        throw fail(429, "尝试过于频繁，请稍后再试");
      for (const key of keys)
        store.db
          .prepare(
            "INSERT INTO attempts VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1",
          )
          .run(key, now + 15 * 60000);
      activeLogins++;
      entered = true;
      const account = store.db
        .prepare("SELECT * FROM admins WHERE username=?")
        .get(username);
      const valid = await verifyPassword(password, account?.hash);
      if (!valid || !account) throw fail(401, "用户名或密码不正确");
      for (const key of keys)
        store.db.prepare("DELETE FROM attempts WHERE key=?").run(key);
      if (req.adminSession)
        store.db
          .prepare("DELETE FROM sessions WHERE id=?")
          .run(req.adminSession.id);
      store.db
        .prepare("DELETE FROM sessions WHERE touched<? OR created<?")
        .run(now - IDLE, now - ABSOLUTE);
      const raw = token(),
        csrfToken = token();
      store.db
        .prepare("INSERT INTO sessions VALUES(?,?,?,?,?)")
        .run(digest(raw), username, csrfToken, now, now);
      store.audit("session.login", username);
      res.cookie(cookieName, raw, cookieOptions).json({ username, csrfToken });
    } catch (error) {
      next(error);
    } finally {
      if (entered) activeLogins--;
    }
  });
  const requireAuth = (req, res, next) =>
    req.adminSession ? next() : next(fail(401, "请先登录"));
  const csrfGuard = (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    if (
      req.get("origin") !== origin ||
      !equal(req.get("X-CSRF-Token"), req.adminSession?.csrf)
    )
      return next(fail(403, "安全校验失败，请刷新页面后重试"));
    next();
  };
  app.post("/api/admin/logout", requireAuth, csrfGuard, (req, res) => {
    store.db
      .prepare("DELETE FROM sessions WHERE id=?")
      .run(req.adminSession.id);
    res
      .clearCookie(cookieName, { ...cookieOptions, maxAge: undefined })
      .json({ ok: true });
  });
  app.post(
    "/api/admin/password",
    requireAuth,
    csrfGuard,
    async (req, res, next) => {
      try {
        const account = store.db
          .prepare("SELECT * FROM admins WHERE username=?")
          .get(req.adminSession.username);
        if (!(await verifyPassword(req.body?.currentPassword, account.hash)))
          throw fail(401, "当前密码不正确");
        const hash = await hashPassword(req.body?.newPassword);
        store.transaction(() => {
          store.db
            .prepare("UPDATE admins SET hash=? WHERE username=?")
            .run(hash, account.username);
          store.db.exec("DELETE FROM sessions");
          store.audit("account.password", account.username);
        });
        res
          .clearCookie(cookieName, { ...cookieOptions, maxAge: undefined })
          .json({ ok: true });
      } catch (error) {
        next(error);
      }
    },
  );
  return { requireAuth, csrfGuard };
}
module.exports = {
  mountAuth,
  createAccount,
  hashPassword,
  verifyPassword,
  fail,
};

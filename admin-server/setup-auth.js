const crypto = require("node:crypto");
const { fail } = require("./security");
const TTL = 15 * 60 * 1000;
const hash = (value) => crypto.createHash("sha256").update(value).digest();
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
function setupAuth(options) {
  const cookieName = options.production ? "__Host-site_setup" : "site_setup";
  const cookieOptions = {
    httpOnly: true,
    secure: !!options.production,
    sameSite: "strict",
    path: "/",
    maxAge: TTL,
  };
  const attempts = new Map();
  function configured() {
    return (
      typeof options.setupToken === "string" &&
      /^[a-f\d]{64,256}$/i.test(options.setupToken) &&
      options.setupToken.length % 2 === 0
    );
  }
  function sign(purpose, value) {
    const key = crypto
      .createHmac("sha256", options.setupToken)
      .update(`site-setup:${purpose}`)
      .digest();
    return crypto.createHmac("sha256", key).update(value).digest("hex");
  }
  function origin(req) {
    if (req.get("origin") !== options.origin)
      throw fail(403, "请求来源不受信任");
  }
  function authorize(req, res) {
    origin(req);
    const now = Date.now();
    for (const [key, row] of attempts)
      if (row.expires <= now) attempts.delete(key);
    const key = crypto
      .createHash("sha256")
      .update(req.ip || "")
      .digest("hex");
    let row = attempts.get(key);
    if (!row) {
      if (attempts.size >= 10000) throw fail(429, "尝试过于频繁，请稍后再试");
      row = { count: 0, expires: now + TTL };
      attempts.set(key, row);
    }
    if (++row.count > 10) throw fail(429, "尝试过于频繁，请稍后再试");
    const supplied = req.body?.token;
    if (!configured()) throw fail(503, "安装授权未配置");
    if (
      typeof supplied !== "string" ||
      supplied.length > 256 ||
      !crypto.timingSafeEqual(hash(supplied), hash(options.setupToken))
    )
      throw fail(401, "安装令牌无效");
    const value = `${crypto.randomBytes(32).toString("hex")}.${now + TTL}`;
    const cookie = `${value}.${sign("session", value)}`;
    res
      .cookie(cookieName, cookie, cookieOptions)
      .json({ csrfToken: sign("csrf", value) });
  }
  function requireSession(req, res, next) {
    if (!configured()) return next(fail(401, "请先授权安装"));
    const raw = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1);
    if (typeof raw !== "string" || raw.length > 256)
      return next(fail(401, "安装会话已失效"));
    const match = /^([a-f0-9]{64})\.(\d{13})\.([a-f0-9]{64})$/.exec(raw);
    if (!match) return next(fail(401, "安装会话已失效"));
    const value = `${match[1]}.${match[2]}`,
      expiry = Number(match[2]),
      now = Date.now();
    if (
      expiry <= now ||
      expiry > now + TTL ||
      !equal(match[3], sign("session", value))
    )
      return next(fail(401, "安装会话已失效"));
    req.setupSession = value;
    next();
  }
  function csrf(req, res, next) {
    try {
      origin(req);
      if (!equal(req.get("X-CSRF-Token"), sign("csrf", req.setupSession)))
        throw fail(403, "安装安全校验失败");
      next();
    } catch (error) {
      next(error);
    }
  }
  return {
    authorize,
    requireSession,
    csrf,
    clear: (res) =>
      res.clearCookie(cookieName, { ...cookieOptions, maxAge: undefined }),
  };
}
module.exports = { setupAuth };

const route = (fn) => (req, res, next) =>
  Promise.resolve()
    .then(() => fn(req, res, next))
    .catch(next);
function publicError(error) {
  if (error.status >= 400 && error.status < 500)
    return { status: error.status, message: error.message };
  const database =
    /^[A-Z0-9]{5}$/.test(error.code || "") ||
    ["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT"].includes(
      error.code,
    ) ||
    /connection|pool|query.*timeout/i.test(error.message || "");
  return {
    status: database || error.status === 503 ? 503 : 500,
    message:
      database || error.status === 503
        ? "数据库暂时不可用，请稍后重试"
        : "服务器处理失败，请查看服务端日志",
  };
}
module.exports = { route, publicError };

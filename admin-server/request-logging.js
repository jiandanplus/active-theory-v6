const { randomUUID } = require("node:crypto");

function requestLogging(options = {}) {
  const emit =
    typeof options.requestLog === "function"
      ? options.requestLog
      : options.requestLog === false || !options.production
        ? null
        : (entry) => process.stdout.write(JSON.stringify(entry) + "\n");
  return (req, res, next) => {
    const supplied = req.headers["x-request-id"];
    const requestId =
      typeof supplied === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(supplied)
        ? supplied
        : randomUUID();
    const started = process.hrtime.bigint();
    // Capture before nested routers rewrite req.url. Never use originalUrl,
    // headers, body, or raw query strings in the emitted allowlisted record.
    const pathname = req.path.replace(
      /^\/api\/site\/([^/]+)/i,
      (matched, target) => {
        try {
          return decodeURIComponent(target).startsWith("preview-")
            ? "/api/site/preview-[redacted]"
            : matched;
        } catch {
          return "/api/site/[invalid]";
        }
      },
    );
    req.requestId = requestId;
    res.set("X-Request-ID", requestId);
    res.once("finish", () => {
      if (!emit) return;
      const entry = {
        requestId,
        method: req.method,
        path: pathname,
        status: res.statusCode,
        durationMs: Number(process.hrtime.bigint() - started) / 1e6,
      };
      try {
        emit(entry);
      } catch {
        /* Logging must not change the HTTP result. */
      }
    });
    next();
  };
}
module.exports = { requestLogging };

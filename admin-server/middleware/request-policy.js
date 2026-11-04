// Request classification shared by the security headers, the installation
// gate and the session lookup. Express mount prefixes are case insensitive.
const PUBLIC_PAGE =
  /^(?:\/|\/(?:work(?:\/[^/]+)?|contact|basic(?:\/(?:work(?:\/[^/]+)?|contact))?|unsupported\.html)\/?)$/i;
const ADMIN_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: blob: data:; media-src 'self' https: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'";

const isAdminPage = (req) => /^\/admin(?:\/|$)/i.test(req.path);
const isPublicPage = (req) => PUBLIC_PAGE.test(req.path);

/** Responses that must never be cached publicly or indexed. */
function isPrivateRequest(req) {
  if (isAdminPage(req) || /^\/api\/(?:admin|setup)(?:\/|$)/i.test(req.path))
    return true;
  if (Object.hasOwn(req.query || {}, "preview")) return true;
  const target = /^\/api\/site\/([^/]+)(?:\/|$)/i.exec(req.path)?.[1];
  if (!target) return false;
  try {
    return decodeURIComponent(target).startsWith("preview-");
  } catch {
    // Invalid encoding remains a non-cacheable error, not a private target.
    return false;
  }
}

/** @param {{production?: boolean}} options */
function securityHeaders(options) {
  return (req, res, next) => {
    // Express res.send/json must never turn a non-program response into 304.
    Object.defineProperty(req, "fresh", { get: () => false });
    res.set("Cache-Control", "no-store");
    res.set("X-Content-Type-Options", "nosniff");
    res.set("Referrer-Policy", "same-origin");
    res.set("X-Frame-Options", "SAMEORIGIN");
    if (isAdminPage(req)) res.set("Content-Security-Policy", ADMIN_CSP);
    if (options.production)
      res.set("Strict-Transport-Security", "max-age=31536000");
    next();
  };
}

function privateCachePolicy() {
  return (req, res, next) => {
    if (isPrivateRequest(req))
      res
        .set("Cache-Control", "private, no-store")
        .set("X-Robots-Tag", "noindex, nofollow");
    next();
  };
}

module.exports = {
  PUBLIC_PAGE,
  isPublicPage,
  isPrivateRequest,
  securityHeaders,
  privateCachePolicy,
};

const fs = require("node:fs");
const path = require("node:path");
const { pipeline } = require("node:stream/promises");
const S = require("../storage");
const { resourceRepository } = require("../repositories/resources");
const { route } = require("../http");

function mountMediaRoutes({ app, store, options }) {
  app.get(
    "/media/:id",
    route(async (req, res, next) => {
      const r = await resourceRepository(store).get(req.params.id);
      if (
        !r ||
        r.trashed ||
        ["missing", "disabled", "failed"].includes(r.status) ||
        (!req.adminSession &&
          !(await resourceRepository(store).isPublished(r.id)))
      )
        throw S.fail("资源不存在", 404);
      res.set("X-Content-Type-Options", "nosniff");
      await require("../frontend-resources").assertLiveResource(store, r);
      await require("../frontend-resources").rejectTargetlessDocument(
        store,
        r.id,
      );
      require("../delivery/response").noStore(res);
      if (r.source === "external")
        return res.redirect(302, S.externalUrl(r.url));
      if (r.source === "s3")
        return res.redirect(302, S.externalUrl(r.publicUrl));
      if (r.source === "bundled")
        return require("../frontend-resources").sendResource(
          req,
          res,
          next,
          r,
          options,
        );
      let file, handle;
      try {
        file = await S.localFile(path.join(options.dataDir, "uploads"), r.key);
        handle = await fs.promises.open(
          file,
          fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
        );
      } catch {
        throw S.fail("资源不存在", 404);
      }
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) throw S.fail("资源不存在", 404);
        const size = stat.size;
        let start = 0,
          end = size - 1;
        res.set("Accept-Ranges", "bytes");
        res.set("Content-Type", r.mime);
        if (req.headers.range) {
          const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
          if (!m || (!m[1] && !m[2]))
            return res
              .status(416)
              .set("X-Robots-Tag", "noindex, nofollow")
              .set("Content-Range", `bytes */${size}`)
              .end();
          if (!m[1]) start = Math.max(0, size - Number(m[2]));
          else {
            start = Number(m[1]);
            if (m[2]) end = Math.min(end, Number(m[2]));
          }
          if (start > end || start >= size)
            return res
              .status(416)
              .set("X-Robots-Tag", "noindex, nofollow")
              .set("Content-Range", `bytes */${size}`)
              .end();
          res.status(206).set("Content-Range", `bytes ${start}-${end}/${size}`);
        }
        res.set("Content-Length", String(end - start + 1));
        await pipeline(
          handle.createReadStream({ start, end, autoClose: false }),
          res,
        );
      } finally {
        await handle.close();
      }
    }),
  );
}
module.exports = { mountMediaRoutes };

const { randomUUID } = require("node:crypto");
const {normalizeConfig} = require('../../shared/site-identity');
const { toSafeInteger } = require("../postgres");
const { composeSnapshot, collectReferences } = require("../snapshots");
const { resourceRepository } = require("./resources");
const { storageRepository } = require("./storages");
const { authRepository } = require("./auth");
const fail = (status, message) => Object.assign(new Error(message), { status });
const version = (r) =>
  r
    ? {
        id: toSafeInteger(r.id),
        created: r.created.toISOString(),
        snapshot: r.snapshot,
      }
    : null;
const preview = (r) =>
  r
    ? {
        id: r.id,
        owner: r.owner,
        expires: r.expires.toISOString(),
        snapshot: r.snapshot,
      }
    : null;
function contentRepository(db) {
  const resources = resourceRepository(db);
  async function writeLists(config) {
    const projects = (
      await db.query("SELECT id,slug FROM personal_site.projects")
    ).rows;
    const songs = (
      await db.query(
        "SELECT id,title,src FROM personal_site.songs ORDER BY ordinal",
      )
    ).rows;
    for (const table of ["scenes", "projects", "songs"])
      await db.query(`DELETE FROM personal_site.${table}`);
    for (const [ordinal, scene] of config.scenes.entries())
      await db.query(
        "INSERT INTO personal_site.scenes(id,ordinal,label,fields) VALUES($1,$2,$3,$4)",
        [
          scene.id || randomUUID(),
          ordinal,
          scene.label,
          JSON.stringify(scene.fields),
        ],
      );
    for (const [ordinal, project] of config.projects.entries()) {
      const id =
        project.id ||
        projects.find((p) => p.slug === project.slug)?.id ||
        randomUUID();
      await db.query(
        "INSERT INTO personal_site.projects(id,slug,ordinal,content) VALUES($1,$2,$3,$4)",
        [id, project.slug, ordinal, project],
      );
    }
    const used = new Set();
    for (const [ordinal, song] of config.songs.entries()) {
      const match =
        songs.find(
          (s) =>
            s.src === song.src && s.title === song.title && !used.has(s.id),
        ) || songs[ordinal];
      const id =
        song.id || (match && !used.has(match.id) ? match.id : randomUUID());
      used.add(id);
      await db.query(
        "INSERT INTO personal_site.songs(id,ordinal,title,src) VALUES($1,$2,$3,$4)",
        [id, ordinal, song.title, song.src],
      );
    }
  }
  async function draftSnapshot(config) {
    const row = (
      await db.query(
        "SELECT content FROM personal_site.templates WHERE id=(SELECT template_id FROM personal_site.site_settings WHERE id=true)",
      )
    ).rows[0];
    if (!row) throw fail(404, "网站不存在");
    return composeSnapshot({ config, ...row.content });
  }
  const repo = {
    async getDraft({ lock = false } = {}) {
      // A waiting FOR UPDATE statement retains its pre-wait MVCC snapshot for
      // subqueries. Acquire the lock first, then read all draft parts together.
      if (lock)
        await db.query(
          "SELECT id FROM personal_site.site_settings WHERE id=true FOR UPDATE",
        );
      const settings = (
        await db.query(
          `SELECT s.site,s.revision,s.published,t.content AS template_content,
            COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',id,'label',label,'fields',fields) ORDER BY ordinal) FROM personal_site.scenes),'[]'::jsonb) AS scenes,
            COALESCE((SELECT pg_catalog.jsonb_agg(content || pg_catalog.jsonb_build_object('id',id) ORDER BY ordinal) FROM personal_site.projects),'[]'::jsonb) AS projects,
            COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id',id,'title',title,'src',src) ORDER BY ordinal) FROM personal_site.songs),'[]'::jsonb) AS songs
            FROM personal_site.site_settings s JOIN personal_site.templates t ON t.id=s.template_id
            WHERE s.id=true`,
        )
      ).rows[0];
      if (!settings) return null;
      const { scenes, projects, songs } = settings;
      const config = { site: settings.site, projects, scenes, songs };
      return {
        config,
        revision: settings.revision,
        published:
          settings.published === null
            ? null
            : toSafeInteger(settings.published),
        snapshot: composeSnapshot({ config, ...settings.template_content }),
      };
    },
    async writeDraft(config, expectedRevision) {
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
        throw fail(400, "配置版本无效");
      if (
        !config ||
        Object.keys(config).some(
          (k) => !["site", "projects", "scenes", "songs"].includes(k),
        )
      )
        throw fail(400, "不支持的配置字段");
      const r = await db.query(
        "UPDATE personal_site.site_settings SET site=$1,revision=revision+1 WHERE id=true AND revision=$2 RETURNING revision",
        [config.site, expectedRevision],
      );
      if (!r.rowCount) throw fail(409, "配置版本冲突，请刷新后重新编辑");
      await writeLists(config);
      await resources.replaceReferences({
        ownerType: "draft",
        ownerId: "draft",
        references: collectReferences(await draftSnapshot(config)),
      });
      return r.rows[0].revision;
    },
    async getTemplate() {
      const row = (
        await db.query(
          "SELECT schema_config,content FROM personal_site.templates WHERE id=(SELECT template_id FROM personal_site.site_settings WHERE id=true)",
        )
      ).rows[0];
      return row ? { schema: row.schema_config, ...row.content } : null;
    },
    async importBundle(bundle) {
      if (
        (
          await db.query(
            "SELECT id FROM personal_site.site_settings WHERE id=true FOR UPDATE",
          )
        ).rowCount
      )
        throw fail(409, "内容已经存在");
      for (const s of bundle.storages) await storageRepository(db).upsert(s);
      const pending = [...bundle.resources];
      const inserted = new Set();
      while (pending.length) {
        const index = pending.findIndex(
          (r) => !r.originalId || inserted.has(r.originalId),
        );
        if (index < 0)
          throw fail(400, "Missing or cyclic original resource dependency");
        const [resource] = pending.splice(index, 1);
        await resources.insert(resource);
        inserted.add(resource.id);
      }
      const draft = {...bundle.draft,config:normalizeConfig(bundle.draft.config)};
      const schema = normalizeConfig(bundle.schema);
      const snapshot = composeSnapshot(draft);
      await db.query(
        "INSERT INTO personal_site.templates(id,schema_config,content) VALUES($1,$2,$3)",
        [
          "default",
          schema,
          {
            template: snapshot.template,
            assets: snapshot.assets,
            legacyMap: snapshot.legacyMap,
          },
        ],
      );
      for (const v of bundle.versions) {
        await db.query(
          "INSERT INTO personal_site.versions(id,created,snapshot) VALUES($1,$2,$3)",
          [v.id, v.created, composeSnapshot(v.snapshot)],
        );
        await db.query("INSERT INTO personal_site.delivery_bindings(version_id,mode) VALUES($1,'legacy')",[v.id]);
      }
      await db.query(
        "INSERT INTO personal_site.site_settings(id,site,revision,published,template_id,default_storage) VALUES(true,$1,$2,$3,$4,$5)",
        [
          snapshot.config.site,
          bundle.revision,
          bundle.published,
          "default",
          bundle.defaultStorage,
        ],
      );
      await writeLists(snapshot.config);
      await resources.replaceReferences({
        ownerType: "draft",
        ownerId: "draft",
        references: collectReferences(snapshot),
      });
      for (const v of bundle.versions)
        await resources.replaceReferences({
          ownerType: "version",
          ownerId: v.id,
          references: collectReferences(v.snapshot),
        });
      for (const r of bundle.resources)
        if (r.originalId)
          await resources.replaceReferences({
            ownerType: "resource",
            ownerId: r.id,
            references: [{ resourceId: r.originalId, slot: "original" }],
          });
      if (bundle.admin) await authRepository(db).replaceAdmin(bundle.admin);
      for (const a of bundle.audit)
        await db.query(
          "INSERT INTO personal_site.audit_events(created,action,actor) VALUES($1,$2,$3)",
          [a.created || new Date().toISOString(), a.action, a.actor || null],
        );
      // The sequence belongs to this fixed schema; values imported from old versions survive.
      await db.query(
        "SELECT pg_catalog.setval(pg_catalog.pg_get_serial_sequence('personal_site.versions','id'),GREATEST(COALESCE((SELECT MAX(id) FROM personal_site.versions),1),1),EXISTS(SELECT 1 FROM personal_site.versions))",
      );
      return repo.getDraft();
    },
    async getVersion(id) {
      return version(
        (
          await db.query("SELECT * FROM personal_site.versions WHERE id=$1", [
            id,
          ])
        ).rows[0],
      );
    },
    async listVersions() {
      return (
        await db.query("SELECT * FROM personal_site.versions ORDER BY id DESC")
      ).rows.map(version);
    },
    async insertVersion(
      snapshot,
      { id, created = new Date().toISOString() } = {},
    ) {
      await db.query(
        "SELECT id FROM personal_site.site_settings WHERE id=true FOR UPDATE",
      );
      const full = composeSnapshot(snapshot);
      const r =
        id === undefined
          ? await db.query(
              "INSERT INTO personal_site.versions(created,snapshot) VALUES($1,$2) RETURNING *",
              [created, full],
            )
          : await db.query(
              "INSERT INTO personal_site.versions(id,created,snapshot) VALUES($1,$2,$3) RETURNING *",
              [id, created, full],
            );
      const row = version(r.rows[0]);
      await resources.replaceReferences({
        ownerType: "version",
        ownerId: row.id,
        references: collectReferences(full),
      });
      return row;
    },
    async reserveVersionId() {
      return toSafeInteger((await db.query("SELECT nextval(pg_get_serial_sequence('personal_site.versions','id')) AS id")).rows[0].id);
    },
    async insertReservedVersion({id,snapshot,references}) {
      if (!Number.isSafeInteger(id) || id < 1) throw fail(400, '版本编号无效');
      await db.query('SELECT id FROM personal_site.site_settings WHERE id=true FOR UPDATE');
      const r=await db.query('INSERT INTO personal_site.versions(id,snapshot) VALUES($1,$2) RETURNING *',[id,snapshot]);
      await resources.replaceReferences({ownerType:'version',ownerId:id,references});
      return version(r.rows[0]);
    },
    async insertPreview({id,owner,expires,snapshot,references}) {
      await db.query('SELECT id FROM personal_site.site_settings WHERE id=true FOR UPDATE');
      const r=await db.query('INSERT INTO personal_site.previews(id,owner,expires,snapshot) VALUES($1,$2,$3,$4) RETURNING *',[id,owner,expires,snapshot]);
      await resources.replaceReferences({ownerType:'preview',ownerId:id,references});
      return preview(r.rows[0]);
    },
    async setPublished(id) {
      const r = await db.query(
        "UPDATE personal_site.site_settings SET published=$1 WHERE id=true RETURNING id",
        [id],
      );
      if (!r.rowCount) throw fail(404, "网站不存在");
    },
    async getPreview(id, owner, now) {
      return preview(
        (
          await db.query(
            "SELECT * FROM personal_site.previews WHERE id=$1 AND owner=$2 AND expires>$3",
            [id, owner, now],
          )
        ).rows[0],
      );
    },
    async prunePreviews(now) {
      await db.query(
        "SELECT id FROM personal_site.site_settings WHERE id=true FOR UPDATE",
      );
      const expired = (
        await db.query(
          "SELECT id FROM personal_site.previews WHERE expires <= $1 ORDER BY id FOR UPDATE",
          [now],
        )
      ).rows.map((r) => r.id);
      await db.query(
        "DELETE FROM personal_site.resource_references WHERE owner_type='preview' AND owner_id=ANY($1::text[])",
        [expired],
      );
      return (
        await db.query(
          "DELETE FROM personal_site.previews WHERE id=ANY($1::text[])",
          [expired],
        )
      ).rowCount;
    },
  };
  return repo;
}
module.exports = { contentRepository };

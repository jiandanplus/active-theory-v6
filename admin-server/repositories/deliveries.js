const { fail } = require("../security");
const { toSafeInteger } = require("../postgres");
const {
  canonicalJSON,
  digestJSON,
  assertArtifactManifest,
  assertRuntimeManifest,
  normalizeReferences,
} = require("../delivery/contracts");
const { resourceRepository } = require("./resources");
const validDigest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function targetValue(target) {
  if (
    !target ||
    Object.keys(target).length !== 2 ||
    typeof target.id !== "string" ||
    (target.type === "version"
      ? !/^[1-9][0-9]*$/.test(target.id) ||
        !Number.isSafeInteger(Number(target.id))
      : target.type !== "preview" ||
        !/^preview-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
          target.id,
        ))
  )
    throw fail(400, "交付目标无效");
  return { type: target.type, id: target.id };
}
const mismatch = () => fail(409, "交付身份不一致");
// Binding, artifact and runtime bundle for one or many targets in one statement.
const BINDING_CHAIN = `SELECT b.version_id, b.mode, b.artifact_digest, b.generation,
    a.digest AS a_digest, a.runtime_digest AS a_runtime_digest, a.kind AS a_kind,
    a.manifest AS a_manifest, a.created_at AS a_created_at,
    r.digest AS r_digest, r.profile_id AS r_profile_id, r.manifest AS r_manifest
  FROM personal_site.delivery_bindings b
  LEFT JOIN personal_site.delivery_artifacts a ON a.digest = b.artifact_digest
  LEFT JOIN personal_site.runtime_bundles r ON r.digest = a.manifest->>'runtimeDigest'`;
// Caller owns the transaction spanning content, references, artifact and binding.
function deliveryRepository(db) {
  const resources = resourceRepository(db);
  function verifyRuntimeRow(row, manifest) {
    if (!row) throw mismatch();
    assertRuntimeManifest(row.manifest);
    if (
      digestJSON(row.manifest) !== row.digest ||
      row.profile_id !== row.manifest.profileId ||
      row.profile_id !== manifest.profileId ||
      row.manifest.templateId !== manifest.templateId
    )
      throw mismatch();
  }
  async function checkRuntime(manifest) {
    const row = (
      await db.query(
        "SELECT * FROM personal_site.runtime_bundles WHERE digest=$1",
        [manifest.runtimeDigest],
      )
    ).rows[0];
    verifyRuntimeRow(row, manifest);
  }
  function verifyArtifactRow(row) {
    assertArtifactManifest(row.manifest);
    if (
      digestJSON(row.manifest) !== row.digest ||
      row.runtime_digest !== row.manifest.runtimeDigest ||
      row.kind !== row.manifest.kind
    )
      throw mismatch();
    return {
      digest: row.digest,
      manifest: row.manifest,
      runtimeDigest: row.runtime_digest,
      kind: row.kind,
      createdAt: row.created_at.toISOString(),
    };
  }
  function assertTargetIdentity(target, artifact, kind) {
    if (
      !artifact ||
      artifact.kind !== kind ||
      canonicalJSON(artifact.manifest.target) !== canonicalJSON(target)
    )
      throw mismatch();
  }
  async function checkTarget(target, artifact, kind) {
    assertTargetIdentity(target, artifact, kind);
    const table = target.type === "version" ? "versions" : "previews";
    const row = (
      await db.query(
        `SELECT snapshot FROM personal_site.${table} WHERE id=$1`,
        [target.id],
      )
    ).rows[0];
    if (
      !row ||
      digestJSON(row.snapshot) !== artifact.manifest.sourceSnapshotDigest ||
      digestJSON(await repo.references(target)) !==
        artifact.manifest.referencesDigest
    )
      throw mismatch();
  }
  function verifyChainHead(target, row) {
    const binding = {
      target,
      mode: row.mode,
      artifactDigest: row.artifact_digest,
      generation: toSafeInteger(row.generation),
    };
    if (!row.artifact_digest) {
      if (row.mode !== "legacy") throw mismatch();
      return { binding, artifact: null };
    }
    if (!validDigest(row.artifact_digest)) throw fail(400, "交付标识无效");
    if (!row.a_digest) throw mismatch();
    const artifact = verifyArtifactRow({
      digest: row.a_digest,
      runtime_digest: row.a_runtime_digest,
      kind: row.a_kind,
      manifest: row.a_manifest,
      created_at: row.a_created_at,
    });
    verifyRuntimeRow(
      row.r_digest
        ? {
            digest: row.r_digest,
            profile_id: row.r_profile_id,
            manifest: row.r_manifest,
          }
        : null,
      row.a_manifest,
    );
    assertTargetIdentity(
      target,
      artifact,
      row.mode === "pinned" ? "pinned" : "legacy-render",
    );
    return { binding, artifact };
  }
  function verifySource(artifact, snapshot, references) {
    if (
      !snapshot ||
      digestJSON(snapshot) !== artifact.manifest.sourceSnapshotDigest ||
      digestJSON(references) !== artifact.manifest.referencesDigest
    )
      throw mismatch();
  }
  const repo = {
    async references(target) {
      target = targetValue(target);
      return resources.referencesForOwner({
        ownerType: target.type,
        ownerId: target.id,
      });
    },
    async getArtifact(digest) {
      if (!validDigest(digest)) throw fail(400, "交付标识无效");
      const row = (
        await db.query(
          "SELECT * FROM personal_site.delivery_artifacts WHERE digest=$1",
          [digest],
        )
      ).rows[0];
      if (!row) return null;
      const artifact = verifyArtifactRow(row);
      await checkRuntime(row.manifest);
      return artifact;
    },
    /**
     * Read-only public path: the binding, its artifact and runtime in one
     * statement, verified with exactly the getBinding/getArtifact checks.
     * The caller passes the snapshot it already read for this request.
     * @param {{type: string, id: string}} target
     * @param {{snapshot: any}} source
     */
    async resolveTarget(target, { snapshot }) {
      target = targetValue(target);
      const column = target.type === "version" ? "version_id" : "preview_id";
      const row = (
        await db.query(`${BINDING_CHAIN} WHERE b.${column}=$1`, [target.id])
      ).rows[0];
      if (!row) return null;
      const head = verifyChainHead(target, row);
      if (!head.artifact) return head;
      verifySource(head.artifact, snapshot, await repo.references(target));
      return head;
    },
    /**
     * Verify many versions with three statements instead of several per
     * version. Each entry is the same verification resolveTarget performs.
     * @param {{id: number, snapshot: any}[]} versions
     * @returns {Promise<Map<number, {mode?: string, binding?: any, artifact?: any, error?: unknown}>>}
     */
    async verifyVersions(versions) {
      const ids = versions.map((version) => String(version.id));
      const rows = (
        await db.query(
          `${BINDING_CHAIN} WHERE b.version_id = ANY($1::bigint[])`,
          [ids],
        )
      ).rows;
      const references = new Map();
      for (const row of (
        await db.query(
          "SELECT owner_id,resource_id,slot FROM personal_site.resource_references WHERE owner_type='version' AND owner_id = ANY($1::text[])",
          [ids],
        )
      ).rows) {
        if (!references.has(row.owner_id)) references.set(row.owner_id, []);
        references
          .get(row.owner_id)
          .push({ resourceId: row.resource_id, slot: row.slot });
      }
      const byVersion = new Map(
        rows.map((row) => [String(row.version_id), row]),
      );
      const result = new Map();
      for (const version of versions) {
        const row = byVersion.get(String(version.id));
        if (!row) continue;
        try {
          const target = targetValue({
            type: "version",
            id: String(version.id),
          });
          const head = verifyChainHead(target, row);
          if (head.artifact)
            verifySource(
              head.artifact,
              version.snapshot,
              normalizeReferences(references.get(String(version.id)) || []),
            );
          result.set(version.id, { mode: row.mode, ...head });
        } catch (error) {
          result.set(version.id, { mode: row.mode, error });
        }
      }
      return result;
    },
    async putArtifact({ digest, manifest }) {
      assertArtifactManifest(manifest);
      const canonical = canonicalJSON(manifest),
        owned = JSON.parse(canonical);
      if (!validDigest(digest) || digestJSON(owned) !== digest)
        throw mismatch();
      await checkRuntime(owned);
      await db.query(
        "INSERT INTO personal_site.delivery_artifacts(digest,runtime_digest,kind,manifest) VALUES($1,$2,$3,$4) ON CONFLICT(digest) DO NOTHING",
        [digest, owned.runtimeDigest, owned.kind, canonical],
      );
      const current = await repo.getArtifact(digest);
      if (!current || canonicalJSON(current.manifest) !== canonical)
        throw mismatch();
      return current;
    },
    async getBinding(target, { lock = false } = {}) {
      target = targetValue(target);
      const column = target.type === "version" ? "version_id" : "preview_id";
      const row = (
        await db.query(
          `SELECT * FROM personal_site.delivery_bindings WHERE ${column}=$1${lock ? " FOR UPDATE" : ""}`,
          [target.id],
        )
      ).rows[0];
      if (!row) return null;
      if (row.artifact_digest)
        await checkTarget(
          target,
          await repo.getArtifact(row.artifact_digest),
          row.mode === "pinned" ? "pinned" : "legacy-render",
        );
      else if (row.mode !== "legacy") throw mismatch();
      return {
        target,
        mode: row.mode,
        artifactDigest: row.artifact_digest,
        generation: toSafeInteger(row.generation),
      };
    },
    async bindPinned(target, digest) {
      target = targetValue(target);
      await db.query(
        "SELECT id FROM personal_site.site_settings WHERE id=true FOR UPDATE",
      );
      await checkTarget(target, await repo.getArtifact(digest), "pinned");
      const column = target.type === "version" ? "version_id" : "preview_id";
      await db.query(
        `INSERT INTO personal_site.delivery_bindings(${column},mode,artifact_digest) VALUES($1,'pinned',$2)`,
        [target.id, digest],
      );
      return repo.getBinding(target);
    },
    async bindLegacyOnce(target, digest, expectedGeneration) {
      target = targetValue(target);
      if (
        target.type !== "version" ||
        !Number.isSafeInteger(expectedGeneration) ||
        expectedGeneration < 0
      )
        throw fail(400, "旧版交付绑定参数无效");
      await db.query(
        "SELECT id FROM personal_site.site_settings WHERE id=true FOR UPDATE",
      );
      await checkTarget(
        target,
        await repo.getArtifact(digest),
        "legacy-render",
      );
      const r = await db.query(
        "UPDATE personal_site.delivery_bindings SET artifact_digest=$1,generation=generation+1 WHERE version_id=$2 AND mode='legacy' AND artifact_digest IS NULL AND generation=$3 RETURNING id",
        [digest, target.id, expectedGeneration],
      );
      if (r.rowCount !== 1) throw fail(409, "旧版交付已绑定或发生变化");
      return repo.getBinding(target);
    },
    async summaries(versionIds) {
      if (!Array.isArray(versionIds)) throw fail(400, "版本编号无效");
      const result = [];
      for (const id of versionIds) {
        const binding = await repo.getBinding({
          type: "version",
          id: String(id),
        });
        if (binding) result.push(binding);
      }
      return result;
    },
  };
  return repo;
}
module.exports = { deliveryRepository };

-- Resources that a stored version or preview snapshot marks as a derived
-- document. Public media routes consult this instead of expanding every
-- historical snapshot on each request. Rows follow their snapshot owner.
CREATE TABLE personal_site.document_assets (
  version_id bigint REFERENCES personal_site.versions(id) ON DELETE CASCADE,
  preview_id text REFERENCES personal_site.previews(id) ON DELETE CASCADE,
  resource_id text NOT NULL,
  CHECK ((version_id IS NULL) <> (preview_id IS NULL))
);
CREATE INDEX document_assets_resource ON personal_site.document_assets(resource_id);
CREATE INDEX document_assets_version ON personal_site.document_assets(version_id);
CREATE INDEX document_assets_preview ON personal_site.document_assets(preview_id);
INSERT INTO personal_site.document_assets(version_id, resource_id)
SELECT DISTINCT v.id, a.value->>'resourceId'
FROM personal_site.versions v
CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(v.snapshot->'assets')='object' THEN v.snapshot->'assets' ELSE '{}'::jsonb END) a
WHERE a.value ? 'document' AND a.value->>'resourceId' IS NOT NULL;
INSERT INTO personal_site.document_assets(preview_id, resource_id)
SELECT DISTINCT p.id, a.value->>'resourceId'
FROM personal_site.previews p
CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(p.snapshot->'assets')='object' THEN p.snapshot->'assets' ELSE '{}'::jsonb END) a
WHERE a.value ? 'document' AND a.value->>'resourceId' IS NOT NULL;

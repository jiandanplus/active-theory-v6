DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM personal_site.site_settings WHERE jsonb_typeof(site) IS DISTINCT FROM 'object')
     OR EXISTS (SELECT 1 FROM personal_site.templates WHERE jsonb_typeof(schema_config->'site') IS DISTINCT FROM 'object') THEN
    RAISE EXCEPTION 'Invalid site identity document';
  END IF;
END $$;
UPDATE personal_site.site_settings
SET site='{"description":"","language":"en","socialImage":""}'::jsonb || site,
    revision=revision+1;
UPDATE personal_site.templates
SET schema_config=jsonb_set(schema_config,'{site}',
    '{"description":"","language":"en","socialImage":""}'::jsonb || (schema_config->'site'));

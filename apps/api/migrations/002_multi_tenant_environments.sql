CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE projects
  ADD COLUMN organization_id UUID,
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

INSERT INTO organizations (name, slug)
SELECT p.name || ' Organization', 'migrated-' || replace(p.id::text, '-', '')
FROM projects p;

UPDATE projects p
SET organization_id = o.id
FROM organizations o
WHERE o.slug = 'migrated-' || replace(p.id::text, '-', '');

ALTER TABLE projects
  ALTER COLUMN organization_id SET NOT NULL,
  ADD CONSTRAINT projects_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE projects DROP CONSTRAINT projects_slug_key;
ALTER TABLE projects ADD CONSTRAINT projects_organization_slug_key UNIQUE (organization_id, slug);
CREATE INDEX projects_organization_id_idx ON projects (organization_id);

ALTER TABLE memberships ADD COLUMN organization_id UUID;
UPDATE memberships m
SET organization_id = p.organization_id
FROM projects p
WHERE p.id = m.project_id;
UPDATE memberships SET role = 'member' WHERE role = 'viewer';
ALTER TABLE memberships DROP CONSTRAINT memberships_pkey;
ALTER TABLE memberships DROP CONSTRAINT memberships_role_check;
ALTER TABLE memberships DROP COLUMN project_id;
ALTER TABLE memberships
  ALTER COLUMN organization_id SET NOT NULL,
  ADD CONSTRAINT memberships_organization_id_fkey
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  ADD CONSTRAINT memberships_role_check CHECK (role IN ('owner', 'admin', 'member')),
  ADD PRIMARY KEY (user_id, organization_id);
CREATE INDEX memberships_organization_id_idx ON memberships (organization_id);

CREATE TABLE environments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  environment_type TEXT NOT NULL
    CHECK (environment_type IN ('development', 'staging', 'production', 'custom')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, slug)
);
CREATE INDEX environments_project_id_idx ON environments (project_id);

INSERT INTO environments (project_id, name, slug, environment_type)
SELECT id, 'Development', 'development', 'development'
FROM projects;

ALTER TABLE api_keys
  ADD COLUMN environment_id UUID,
  ADD COLUMN expires_at TIMESTAMPTZ;

UPDATE api_keys k
SET environment_id = e.id
FROM environments e
WHERE e.project_id = k.project_id AND e.slug = 'development';

ALTER TABLE api_keys DROP COLUMN project_id;
ALTER TABLE api_keys
  ALTER COLUMN environment_id SET NOT NULL,
  ADD CONSTRAINT api_keys_environment_id_fkey
    FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE;
CREATE INDEX api_keys_environment_id_idx ON api_keys (environment_id, created_at DESC);

ALTER TABLE events ADD COLUMN environment_id UUID;
UPDATE events event
SET environment_id = key.environment_id
FROM api_keys key
WHERE key.id = event.api_key_id;
UPDATE events event
SET environment_id = environment.id
FROM environments environment
WHERE event.environment_id IS NULL
  AND environment.project_id = event.project_id
  AND environment.slug = 'development';

ALTER TABLE events DROP CONSTRAINT events_project_id_event_id_key;
DROP INDEX events_project_time_idx;
DROP INDEX events_project_trace_idx;
DROP INDEX events_project_type_status_idx;
DROP INDEX events_project_queue_idx;
ALTER TABLE events DROP COLUMN project_id;
ALTER TABLE events
  ALTER COLUMN environment_id SET NOT NULL,
  ADD CONSTRAINT events_environment_id_fkey
    FOREIGN KEY (environment_id) REFERENCES environments(id) ON DELETE CASCADE,
  ADD CONSTRAINT events_environment_event_id_key UNIQUE (environment_id, event_id);

CREATE INDEX events_environment_time_idx
  ON events (environment_id, occurred_at DESC);
CREATE INDEX events_environment_trace_idx
  ON events (environment_id, trace_id, occurred_at ASC);
CREATE INDEX events_environment_type_status_idx
  ON events (environment_id, type, status, occurred_at DESC);
CREATE INDEX events_environment_queue_idx
  ON events (environment_id, queue_name, occurred_at DESC);

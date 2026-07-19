CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'owner'
    CHECK (role IN ('owner', 'member', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,

  event_id UUID NOT NULL,
  trace_id UUID,
  parent_event_id UUID,

  type TEXT NOT NULL CHECK (type IN (
    'http_request',
    'queue_job',
    'queue_retry',
    'queue_failed',
    'webhook_received'
  )),
  status TEXT NOT NULL CHECK (status IN (
    'success',
    'failure',
    'pending',
    'processing',
    'retrying'
  )),

  source TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  duration_ms INTEGER CHECK (duration_ms >= 0),

  http_method TEXT,
  http_route TEXT,
  http_status_code INTEGER,

  queue_name TEXT,
  job_id TEXT,
  job_name TEXT,
  attempt INTEGER,

  error_name TEXT,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (project_id, event_id)
);

CREATE INDEX IF NOT EXISTS events_project_time_idx
  ON events (project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS events_project_trace_idx
  ON events (project_id, trace_id, occurred_at ASC);

CREATE INDEX IF NOT EXISTS events_project_type_status_idx
  ON events (project_id, type, status, occurred_at DESC);

CREATE INDEX IF NOT EXISTS events_project_queue_idx
  ON events (project_id, queue_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS events_metadata_gin_idx
  ON events USING GIN (metadata);

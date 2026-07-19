-- Dedicated public demo workspace controls.
ALTER TABLE organizations ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE environments ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE api_keys ADD COLUMN is_internal BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX organizations_demo_idx ON organizations (id) WHERE is_demo;
CREATE INDEX environments_demo_idx ON environments (id) WHERE is_demo;
CREATE INDEX users_demo_idx ON users (id) WHERE is_demo;
CREATE INDEX api_keys_internal_idx ON api_keys (environment_id) WHERE is_internal;

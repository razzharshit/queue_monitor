-- Production security and SaaS operations control plane.

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  ip_address INET,
  user_agent TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_active_idx ON sessions (user_id, expires_at DESC) WHERE revoked_at IS NULL;

CREATE TABLE password_reset_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_tokens_active_idx
  ON password_reset_tokens (user_id, expires_at DESC) WHERE used_at IS NULL;

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID,
  actor_user_id UUID,
  ip_address INET,
  user_agent TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  result TEXT NOT NULL CHECK (result IN ('success', 'failure')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_organization_time_idx ON audit_logs (organization_id, created_at DESC);
CREATE INDEX audit_logs_actor_time_idx ON audit_logs (actor_user_id, created_at DESC);

CREATE FUNCTION prevent_audit_log_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit logs are immutable';
END;
$$;
CREATE TRIGGER audit_logs_immutable
BEFORE UPDATE OR DELETE ON audit_logs
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();

CREATE TABLE subscription_plans (
  plan_key TEXT PRIMARY KEY CHECK (plan_key IN ('free', 'team', 'business')),
  display_name TEXT NOT NULL,
  monthly_event_limit BIGINT NOT NULL CHECK (monthly_event_limit > 0),
  monthly_request_limit BIGINT NOT NULL CHECK (monthly_request_limit > 0),
  monthly_bandwidth_bytes BIGINT NOT NULL CHECK (monthly_bandwidth_bytes > 0),
  storage_limit_bytes BIGINT NOT NULL CHECK (storage_limit_bytes > 0),
  organization_rate_per_minute INTEGER NOT NULL CHECK (organization_rate_per_minute > 0),
  environment_rate_per_minute INTEGER NOT NULL CHECK (environment_rate_per_minute > 0),
  api_key_rate_per_minute INTEGER NOT NULL CHECK (api_key_rate_per_minute > 0),
  burst_multiplier NUMERIC(4,2) NOT NULL DEFAULT 2 CHECK (burst_multiplier >= 1),
  default_retention_days INTEGER NOT NULL CHECK (default_retention_days IN (7, 30, 90, 180, 365)),
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO subscription_plans (
  plan_key, display_name, monthly_event_limit, monthly_request_limit,
  monthly_bandwidth_bytes, storage_limit_bytes,
  organization_rate_per_minute, environment_rate_per_minute,
  api_key_rate_per_minute, burst_multiplier, default_retention_days, features
) VALUES
  ('free', 'Free', 100000, 50000, 1073741824, 1073741824, 600, 300, 180, 2, 7,
   '{"team":false,"auditLogs":false,"ipAllowlists":false,"customRetention":false,"support":"basic"}'),
  ('team', 'Team', 5000000, 1000000, 53687091200, 53687091200, 6000, 3000, 1800, 2, 90,
   '{"team":true,"auditLogs":true,"ipAllowlists":false,"customRetention":true,"support":"standard"}'),
  ('business', 'Business', 50000000, 10000000, 536870912000, 536870912000, 30000, 15000, 9000, 3, 365,
   '{"team":true,"auditLogs":true,"ipAllowlists":true,"customRetention":true,"support":"priority"}');

CREATE TABLE organization_subscriptions (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  plan_key TEXT NOT NULL REFERENCES subscription_plans(plan_key),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'trialing', 'past_due', 'suspended', 'canceled')),
  custom_limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  billing_provider_customer_id TEXT,
  billing_provider_subscription_id TEXT,
  current_period_started_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()),
  current_period_ends_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()) + interval '1 month',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO organization_subscriptions (organization_id, plan_key)
SELECT id, 'free' FROM organizations ON CONFLICT DO NOTHING;

CREATE TABLE usage_monthly (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  month_start DATE NOT NULL,
  ingestion_requests BIGINT NOT NULL DEFAULT 0,
  events_ingested BIGINT NOT NULL DEFAULT 0,
  events_stored BIGINT NOT NULL DEFAULT 0,
  bandwidth_bytes BIGINT NOT NULL DEFAULT 0,
  storage_bytes BIGINT NOT NULL DEFAULT 0,
  rate_limited_requests BIGINT NOT NULL DEFAULT 0,
  quota_rejected_requests BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, month_start)
);

-- Current retained storage is tracked separately from monthly billable ingestion.
-- The event trigger keeps this exact as retention and tenant deletion remove rows.
CREATE TABLE organization_storage (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  event_count BIGINT NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  storage_bytes BIGINT NOT NULL DEFAULT 0 CHECK (storage_bytes >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO organization_storage (organization_id, event_count, storage_bytes)
SELECT organization.id, count(event.id), COALESCE(sum(pg_column_size(event)), 0)
FROM organizations organization
LEFT JOIN projects project ON project.organization_id = organization.id
LEFT JOIN environments environment ON environment.project_id = project.id
LEFT JOIN events event ON event.environment_id = environment.id
GROUP BY organization.id;

CREATE FUNCTION account_organization_event_storage() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_organization_id UUID;
  event_size BIGINT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT project.organization_id INTO target_organization_id
    FROM environments environment
    JOIN projects project ON project.id = environment.project_id
    WHERE environment.id = NEW.environment_id;
  ELSE
    SELECT project.organization_id INTO target_organization_id
    FROM environments environment
    JOIN projects project ON project.id = environment.project_id
    WHERE environment.id = OLD.environment_id;
  END IF;
  IF target_organization_id IS NULL THEN
    IF TG_OP = 'INSERT' THEN RETURN NEW; ELSE RETURN OLD; END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    event_size := pg_column_size(NEW);
    INSERT INTO organization_storage (organization_id, event_count, storage_bytes)
    VALUES (target_organization_id, 1, event_size)
    ON CONFLICT (organization_id) DO UPDATE
      SET event_count = organization_storage.event_count + 1,
          storage_bytes = organization_storage.storage_bytes + EXCLUDED.storage_bytes,
          updated_at = now();
    RETURN NEW;
  END IF;

  event_size := pg_column_size(OLD);
  UPDATE organization_storage
     SET event_count = GREATEST(0, event_count - 1),
         storage_bytes = GREATEST(0, storage_bytes - event_size),
         updated_at = now()
   WHERE organization_id = target_organization_id;
  RETURN OLD;
END;
$$;
CREATE TRIGGER account_organization_event_storage_insert
AFTER INSERT ON events
FOR EACH ROW EXECUTE FUNCTION account_organization_event_storage();
CREATE TRIGGER account_organization_event_storage_delete
BEFORE DELETE ON events
FOR EACH ROW EXECUTE FUNCTION account_organization_event_storage();

CREATE TABLE rate_limit_buckets (
  scope_type TEXT NOT NULL CHECK (scope_type IN ('organization', 'environment', 'api_key')),
  scope_id UUID NOT NULL,
  tokens DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_type, scope_id)
);

CREATE TABLE organization_security_settings (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  retention_days INTEGER NOT NULL DEFAULT 30 CHECK (retention_days IN (7, 30, 90, 180, 365)),
  redact_emails BOOLEAN NOT NULL DEFAULT false,
  redact_phone_numbers BOOLEAN NOT NULL DEFAULT false,
  custom_redact_fields TEXT[] NOT NULL DEFAULT '{}',
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO organization_security_settings (organization_id, retention_days)
SELECT organization.id, plan.default_retention_days
FROM organizations organization
JOIN organization_subscriptions subscription ON subscription.organization_id = organization.id
JOIN subscription_plans plan ON plan.plan_key = subscription.plan_key
ON CONFLICT DO NOTHING;

CREATE TABLE environment_security_settings (
  environment_id UUID PRIMARY KEY REFERENCES environments(id) ON DELETE CASCADE,
  ip_allowlist_enabled BOOLEAN NOT NULL DEFAULT false,
  allowed_networks CIDR[] NOT NULL DEFAULT '{}',
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO environment_security_settings (environment_id)
SELECT id FROM environments ON CONFLICT DO NOTHING;

CREATE FUNCTION initialize_organization_operations() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO organization_subscriptions (organization_id, plan_key) VALUES (NEW.id, 'free');
  INSERT INTO organization_security_settings (organization_id, retention_days) VALUES (NEW.id, 7);
  INSERT INTO organization_storage (organization_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER initialize_organization_operations_trigger
AFTER INSERT ON organizations
FOR EACH ROW EXECUTE FUNCTION initialize_organization_operations();

CREATE FUNCTION initialize_environment_security() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO environment_security_settings (environment_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER initialize_environment_security_trigger
AFTER INSERT ON environments
FOR EACH ROW EXECUTE FUNCTION initialize_environment_security();

CREATE TABLE status_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('minor', 'major', 'critical')),
  status TEXT NOT NULL CHECK (status IN ('investigating', 'identified', 'monitoring', 'resolved')),
  message TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE maintenance_windows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

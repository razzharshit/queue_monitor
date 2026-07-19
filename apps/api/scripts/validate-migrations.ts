import process from "node:process";
import pg from "pg";
import { loadMigrationConfig } from "../src/config.js";

const { databaseUrl } = loadMigrationConfig(process.env);
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
try {
  const result = await pool.query<{ valid: boolean }>(`
    SELECT
      to_regclass('public.organizations') IS NOT NULL
      AND to_regclass('public.environments') IS NOT NULL
      AND to_regclass('public.invitations') IS NOT NULL
      AND to_regclass('public.onboarding_progress') IS NOT NULL
      AND to_regclass('public.sessions') IS NOT NULL
      AND to_regclass('public.audit_logs') IS NOT NULL
      AND to_regclass('public.subscription_plans') IS NOT NULL
      AND to_regclass('public.organization_subscriptions') IS NOT NULL
      AND to_regclass('public.usage_monthly') IS NOT NULL
      AND to_regclass('public.organization_storage') IS NOT NULL
      AND to_regclass('public.rate_limit_buckets') IS NOT NULL
      AND to_regclass('public.organization_security_settings') IS NOT NULL
      AND to_regclass('public.environment_security_settings') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'projects' AND column_name = 'organization_id' AND is_nullable = 'NO'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'events' AND column_name = 'environment_id' AND is_nullable = 'NO'
      )
      AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name IN ('events', 'api_keys', 'memberships') AND column_name = 'project_id'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'events' AND column_name = 'trace_id' AND data_type = 'text'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users' AND column_name = 'is_demo' AND is_nullable = 'NO'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'api_keys' AND column_name = 'is_internal' AND is_nullable = 'NO'
      )
      AND NOT EXISTS (
        SELECT 1 FROM events event
        LEFT JOIN environments environment ON environment.id = event.environment_id
        WHERE environment.id IS NULL
      )
      AND (SELECT count(*) = 3 FROM subscription_plans WHERE plan_key IN ('free', 'team', 'business'))
      AND NOT EXISTS (
        SELECT 1 FROM organizations organization
        LEFT JOIN organization_subscriptions subscription ON subscription.organization_id = organization.id
        LEFT JOIN organization_security_settings security ON security.organization_id = organization.id
        LEFT JOIN organization_storage storage ON storage.organization_id = organization.id
        WHERE subscription.organization_id IS NULL OR security.organization_id IS NULL OR storage.organization_id IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM environments environment
        LEFT JOIN environment_security_settings security ON security.environment_id = environment.id
        WHERE security.environment_id IS NULL
      )
      AND EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'audit_logs'::regclass AND tgname = 'audit_logs_immutable' AND NOT tgisinternal
      )
      AND EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'events'::regclass AND tgname = 'account_organization_event_storage_insert' AND NOT tgisinternal
      ) AS valid
  `);
  if (!result.rows[0]?.valid) throw new Error("database migration invariants are not satisfied");
  console.log(JSON.stringify({ level: "info", event: "migration_validation_passed" }));
} finally {
  await pool.end();
}

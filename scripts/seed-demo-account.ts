import { createHash, randomBytes } from "node:crypto";
import pg from "pg";
import { loadLocalEnvironment, requiredEnvironment, updateLocalEnvironment } from "./demo-support.js";

const INTERNAL_KEY_NAME = "Internal demo data generator";
const DEMO_ORGANIZATION_NAME = "Demo Organization";
const DEMO_ORGANIZATION_SLUG = "demo-workspace";
const DEMO_PROJECT_NAME = "Demo Project";
const DEMO_PROJECT_SLUG = "demo-project";
const DEMO_ENVIRONMENT_NAME = "Demo Environment";
const DEMO_ENVIRONMENT_SLUG = "demo";

function keyHash(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function usableKey(value: string | undefined): value is string {
  return Boolean(value && /^qmon_live_[A-Za-z0-9_-]{24,}$/.test(value));
}

export async function seedDemoAccount(): Promise<{ environmentId: string; reusedKey: boolean }> {
  loadLocalEnvironment();
  const databaseUrl = requiredEnvironment("DATABASE_URL");
  const email = process.env.DEMO_VIEWER_EMAIL?.trim() || "demo-viewer@queue-monitor.local";
  const configuredPassword = process.env.DEMO_VIEWER_PASSWORD?.trim();
  const password = configuredPassword && configuredPassword.length >= 12 ? configuredPassword : randomBytes(24).toString("base64url");
  const userName = "Demo Viewer";
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  let apiKey = process.env.DEMO_SEED_API_KEY;
  let reusedKey = false;
  let environmentId: string;
  try {
    await client.query("BEGIN");
    const existingOrganization = await client.query<{ is_demo: boolean }>("SELECT is_demo FROM organizations WHERE slug = $1", [DEMO_ORGANIZATION_SLUG]);
    if (existingOrganization.rows[0] && !existingOrganization.rows[0].is_demo) {
      throw new Error(`refusing to reuse non-demo organization slug ${DEMO_ORGANIZATION_SLUG}`);
    }
    const organization = await client.query<{ id: string }>(
      `INSERT INTO organizations (name, slug, is_demo) VALUES ($1, $2, true)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, is_demo = true, updated_at = now()
       RETURNING id`,
      [DEMO_ORGANIZATION_NAME, DEMO_ORGANIZATION_SLUG],
    );
    const organizationId = organization.rows[0]!.id;
    const project = await client.query<{ id: string }>(
      `INSERT INTO projects (organization_id, name, slug) VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
       RETURNING id`,
      [organizationId, DEMO_PROJECT_NAME, DEMO_PROJECT_SLUG],
    );
    const environment = await client.query<{ id: string }>(
      `INSERT INTO environments (project_id, name, slug, environment_type, is_demo) VALUES ($1, $2, $3, 'production', true)
       ON CONFLICT (project_id, slug) DO UPDATE
         SET name = EXCLUDED.name, environment_type = EXCLUDED.environment_type, is_demo = true, updated_at = now()
       RETURNING id`,
      [project.rows[0]!.id, DEMO_ENVIRONMENT_NAME, DEMO_ENVIRONMENT_SLUG],
    );
    environmentId = environment.rows[0]!.id;
    const existingUser = await client.query<{ is_demo: boolean }>("SELECT is_demo FROM users WHERE lower(email) = lower($1)", [email]);
    if (existingUser.rows[0] && !existingUser.rows[0].is_demo) {
      throw new Error("refusing to convert an existing non-demo user into the public demo viewer");
    }
    const user = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, is_demo)
       VALUES (lower($1), crypt($2, gen_salt('bf', 12)), $3, true)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, name = EXCLUDED.name, is_demo = true
       RETURNING id`,
      [email, password, userName],
    );
    const userId = user.rows[0]!.id;
    await client.query(
      `INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, 'viewer')
       ON CONFLICT (user_id, organization_id) DO UPDATE SET role = 'viewer'`,
      [userId, organizationId],
    );
    await client.query("DELETE FROM memberships WHERE user_id = $1 AND organization_id <> $2", [userId, organizationId]);
    await client.query("UPDATE sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1", [userId]);
    await client.query(
      `UPDATE organization_security_settings
          SET retention_days = 30, redact_emails = true, redact_phone_numbers = true, updated_at = now()
        WHERE organization_id = $1`,
      [organizationId],
    );

    if (usableKey(apiKey)) {
      const existing = await client.query(
        `SELECT 1 FROM api_keys
          WHERE environment_id = $1 AND key_hash = $2 AND revoked_at IS NULL
            AND (expires_at IS NULL OR expires_at > now())`,
        [environmentId, keyHash(apiKey)],
      );
      reusedKey = existing.rowCount === 1;
    }
    if (!reusedKey) {
      apiKey = `qmon_live_${randomBytes(32).toString("base64url")}`;
      await client.query(
        "UPDATE api_keys SET revoked_at = COALESCE(revoked_at, now()) WHERE environment_id = $1 AND name = $2",
        [environmentId, INTERNAL_KEY_NAME],
      );
      await client.query(
        `INSERT INTO api_keys (environment_id, name, key_prefix, key_hash, is_internal)
         VALUES ($1, $2, $3, $4, true)`,
        [environmentId, INTERNAL_KEY_NAME, apiKey.slice(0, 18), keyHash(apiKey)],
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  await updateLocalEnvironment({
    DEMO_VIEWER_EMAIL: email,
    DEMO_VIEWER_PASSWORD: password,
    DEMO_ENVIRONMENT_ID: environmentId,
    DEMO_SEED_API_KEY: apiKey!,
  });
  console.log(JSON.stringify({
    level: "info",
    event: "demo_account_seeded",
    organization: DEMO_ORGANIZATION_SLUG,
    project: DEMO_PROJECT_SLUG,
    environment: DEMO_ENVIRONMENT_SLUG,
    environmentId,
    viewerEmail: email,
    apiKey: reusedKey ? "reused" : "rotated",
  }));
  return { environmentId, reusedKey };
}

await seedDemoAccount();

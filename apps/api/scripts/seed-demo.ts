import process from "node:process";
import pg from "pg";
import { hashApiKey } from "../src/app.js";

function required(name: string, minimumLength = 1): string {
  const value = process.env[name]?.trim();
  if (!value || value.length < minimumLength) {
    throw new Error(`${name} is required and must contain at least ${minimumLength} characters`);
  }
  return value;
}

const databaseUrl = required("DATABASE_URL");
const email = required("DEMO_LOGIN_EMAIL");
const password = required("DEMO_LOGIN_PASSWORD", 12);
const userName = required("DEMO_LOGIN_NAME");
const organizationName = required("DEMO_ORGANIZATION_NAME");
const organizationSlug = required("DEMO_ORGANIZATION_SLUG");
const projectName = required("DEMO_PROJECT_NAME");
const projectSlug = required("DEMO_PROJECT_SLUG");
const environmentName = required("DEMO_ENVIRONMENT_NAME");
const environmentSlug = required("DEMO_ENVIRONMENT_SLUG");
const environmentType = required("DEMO_ENVIRONMENT_TYPE");
if (!["development", "staging", "production", "custom"].includes(environmentType)) {
  throw new Error("DEMO_ENVIRONMENT_TYPE must be development, staging, production, or custom");
}
const apiKey = required("DEMO_API_KEY", 24);
if (!apiKey.startsWith("qmon_live_")) throw new Error("DEMO_API_KEY must start with qmon_live_");

const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  await pool.query(
    `WITH demo_organization AS (
       INSERT INTO organizations (name, slug)
       VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
       RETURNING id
     ),
     demo_project AS (
       INSERT INTO projects (organization_id, name, slug)
       SELECT demo_organization.id, $3, $4 FROM demo_organization
       ON CONFLICT (organization_id, slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
       RETURNING id, organization_id
     ),
     demo_user AS (
       INSERT INTO users (email, password_hash, name)
       VALUES ($5, crypt($6, gen_salt('bf', 10)), $7)
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         name = EXCLUDED.name
       RETURNING id
     ),
     demo_membership AS (
       INSERT INTO memberships (user_id, organization_id, role)
       SELECT demo_user.id, demo_project.organization_id, 'owner'
       FROM demo_user CROSS JOIN demo_project
       ON CONFLICT (user_id, organization_id) DO UPDATE SET role = EXCLUDED.role
       RETURNING user_id
     ),
     demo_environment AS (
       INSERT INTO environments (project_id, name, slug, environment_type)
       SELECT demo_project.id, $8, $9, $10 FROM demo_project
       ON CONFLICT (project_id, slug) DO UPDATE SET
         name = EXCLUDED.name,
         environment_type = EXCLUDED.environment_type,
         updated_at = now()
       RETURNING id
     )
     INSERT INTO api_keys (environment_id, name, key_prefix, key_hash)
     SELECT demo_environment.id, $11, left($12, 18), $13
     FROM demo_environment CROSS JOIN demo_membership
     ON CONFLICT (key_hash) DO UPDATE SET revoked_at = NULL`,
    [
      organizationName,
      organizationSlug,
      projectName,
      projectSlug,
      email,
      password,
      userName,
      environmentName,
      environmentSlug,
      environmentType,
      "Demo SDK",
      apiKey,
      hashApiKey(apiKey),
    ],
  );
  console.log("Seeded the environment-configured demo organization, project, environment, user, and SDK key.");
} finally {
  await pool.end();
}

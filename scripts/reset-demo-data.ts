import pg from "pg";
import { generateDemoData } from "./generate-demo-data.js";
import { loadLocalEnvironment, requiredEnvironment } from "./demo-support.js";

export async function resetDemoData(): Promise<void> {
  loadLocalEnvironment();
  const databaseUrl = requiredEnvironment("DATABASE_URL");
  const environmentId = requiredEnvironment("DEMO_ENVIRONMENT_ID");
  const expectedOrganizationSlug = "demo-workspace";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(environmentId)) {
    throw new Error("DEMO_ENVIRONMENT_ID must be a UUID created by npm run demo:seed-account");
  }
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  let deletedEvents: number;
  try {
    await client.query("BEGIN");
    const target = await client.query<{ organization_id: string; organization_slug: string; environment_count: string }>(
      `SELECT project.organization_id, organization.slug AS organization_slug,
              (SELECT count(*)::text FROM environments candidate
                JOIN projects candidate_project ON candidate_project.id = candidate.project_id
               WHERE candidate_project.organization_id = project.organization_id) AS environment_count
         FROM environments environment
         JOIN projects project ON project.id = environment.project_id
         JOIN organizations organization ON organization.id = project.organization_id
        WHERE environment.id = $1
        FOR UPDATE OF environment`,
      [environmentId],
    );
    const demo = target.rows[0];
    if (!demo || demo.organization_slug !== expectedOrganizationSlug) {
      throw new Error("refusing reset: DEMO_ENVIRONMENT_ID does not belong to the configured demo organization");
    }
    if (Number(demo.environment_count) !== 1) {
      throw new Error("refusing reset: the demo organization must contain exactly one environment so organization usage remains isolated");
    }
    const deleted = await client.query("DELETE FROM events WHERE environment_id = $1", [environmentId]);
    deletedEvents = deleted.rowCount ?? 0;
    await client.query("DELETE FROM usage_monthly WHERE organization_id = $1", [demo.organization_id]);
    await client.query(
      `DELETE FROM rate_limit_buckets
        WHERE (scope_type = 'organization' AND scope_id = $1)
           OR (scope_type = 'environment' AND scope_id = $2)
           OR (scope_type = 'api_key' AND scope_id IN (SELECT id FROM api_keys WHERE environment_id = $2))`,
      [demo.organization_id, environmentId],
    );
    const storage = await client.query<{ event_count: string; storage_bytes: string }>(
      "SELECT event_count::text, storage_bytes::text FROM organization_storage WHERE organization_id = $1",
      [demo.organization_id],
    );
    if (Number(storage.rows[0]?.event_count ?? -1) !== 0 || Number(storage.rows[0]?.storage_bytes ?? -1) !== 0) {
      throw new Error("demo storage accounting did not reach zero; reset rolled back");
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
  console.log(JSON.stringify({ level: "info", event: "demo_environment_reset", environmentId, deletedEvents }));
  await generateDemoData();
}

await resetDemoData();

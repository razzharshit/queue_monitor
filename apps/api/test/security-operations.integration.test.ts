import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { PostgresEventStore } from "../src/store.js";

const databaseUrl = process.env.QMON_TEST_DATABASE_URL;
const sdk = { name: "security-test", version: "1.0.0", service: "security-test", environment: "production" };

test("security controls, metering, redaction, export, audit immutability, allowlists, and retention", {
  skip: databaseUrl ? false : "QMON_TEST_DATABASE_URL is not configured",
}, async () => {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 });
  const store = new PostgresEventStore(pool);
  const app = buildApp({ store, jwtSecret: "security-operations-integration-secret-over-32-characters" });
  const suffix = randomUUID().replaceAll("-", "");
  const email = `security-${suffix}@example.test`;
  let organizationId: string | null = null;
  try {
    const signup = await app.inject({ method: "POST", url: "/v1/auth/signup", payload: { name: "Security Owner", email, password: "security-owner-password" } });
    assert.equal(signup.statusCode, 201);
    const cookie = String(signup.headers["set-cookie"]).split(";")[0]!;
    const organization = await app.inject({ method: "POST", url: "/v1/organizations", headers: { cookie }, payload: { name: "Security Test", slug: `security-${suffix}` } });
    organizationId = organization.json().id as string;
    const project = await app.inject({ method: "POST", url: `/v1/organizations/${organizationId}/projects`, headers: { cookie }, payload: { name: "API", slug: "api" } });
    const environment = await app.inject({ method: "POST", url: `/v1/projects/${project.json().id}/environments`, headers: { cookie }, payload: { name: "Production", slug: "production", environmentType: "production" } });
    const environmentId = environment.json().id as string;
    const key = await app.inject({ method: "POST", url: `/v1/environments/${environmentId}/api-keys`, headers: { cookie }, payload: { name: "Security integration" } });
    const apiKey = key.json().apiKey as string;

    const eventId = randomUUID();
    const ingested = await app.inject({
      method: "POST", url: "/v1/events/batch", headers: { authorization: `Bearer ${apiKey}` },
      payload: { sdk, events: [{
        eventId, traceId: randomUUID(), parentEventId: null, type: "http_request", status: "success",
        source: "security-test", occurredAt: new Date().toISOString(), durationMs: 12,
        data: { method: "POST", route: "/secure", statusCode: 201, authorization: "Bearer plaintext", card: "4242 4242 4242 4242" },
      }] },
    });
    assert.equal(ingested.statusCode, 200);

    const usage = await app.inject({ method: "GET", url: `/v1/organizations/${organizationId}/usage`, headers: { cookie } });
    assert.equal(usage.statusCode, 200);
    assert.ok(usage.json().usage.eventsStored >= 1);
    assert.ok(usage.json().usage.storageBytes > 0);

    const exported = await app.inject({ method: "GET", url: `/v1/organizations/${organizationId}/export`, headers: { cookie } });
    assert.equal(exported.statusCode, 200);
    assert.equal(exported.json().telemetry[0].data.authorization, "[REDACTED]");
    assert.equal(exported.json().telemetry[0].data.card, "[REDACTED]");
    assert.ok(exported.json().apiKeys.every((item: Record<string, unknown>) => !("key_hash" in item)));

    await assert.rejects(
      pool.query("UPDATE audit_logs SET action = 'tampered' WHERE organization_id = $1", [organizationId]),
      /audit logs are immutable/,
    );

    await pool.query("UPDATE organization_subscriptions SET plan_key = 'business' WHERE organization_id = $1", [organizationId]);
    await pool.query(
      `UPDATE organization_subscriptions
          SET custom_limits = '{"organizationRatePerMinute":100000,"environmentRatePerMinute":100000,"apiKeyRatePerMinute":1,"burstMultiplier":1}'::jsonb
        WHERE organization_id = $1`,
      [organizationId],
    );
    await pool.query("DELETE FROM rate_limit_buckets WHERE scope_id IN ($1, $2, $3)", [organizationId, environmentId, key.json().id]);
    assert.equal((await app.inject({ method: "POST", url: "/v1/events/batch", headers: { authorization: `Bearer ${apiKey}` }, payload: { sdk, events: [] } })).statusCode, 200);
    const limited = await app.inject({ method: "POST", url: "/v1/events/batch", headers: { authorization: `Bearer ${apiKey}` }, payload: { sdk, events: [] } });
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.json().scope, "api_key");
    assert.ok(Number(limited.headers["retry-after"]) >= 1);

    await pool.query("UPDATE organization_subscriptions SET custom_limits = '{\"monthlyEventLimit\":1}'::jsonb WHERE organization_id = $1", [organizationId]);
    const quota = await app.inject({
      method: "POST", url: "/v1/events/batch", headers: { authorization: `Bearer ${apiKey}` },
      payload: { sdk, events: [{ ...exported.json().telemetry[0], id: undefined, eventId: randomUUID(), occurredAt: new Date().toISOString() }] },
    });
    assert.equal(quota.statusCode, 429);
    assert.equal(quota.json().code, "event_quota");
    await pool.query("UPDATE organization_subscriptions SET custom_limits = '{}'::jsonb WHERE organization_id = $1", [organizationId]);
    await pool.query("DELETE FROM rate_limit_buckets WHERE scope_id IN ($1, $2, $3)", [organizationId, environmentId, key.json().id]);

    const blockedPolicy = await app.inject({ method: "PATCH", url: `/v1/environments/${environmentId}/ip-allowlist`, headers: { cookie }, payload: { enabled: true, networks: ["192.0.2.0/24"] } });
    assert.equal(blockedPolicy.statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: "/v1/events/batch", headers: { authorization: `Bearer ${apiKey}` }, payload: { sdk, events: [] } })).statusCode, 403);
    await app.inject({ method: "PATCH", url: `/v1/environments/${environmentId}/ip-allowlist`, headers: { cookie }, payload: { enabled: true, networks: ["127.0.0.1/32"] } });
    assert.equal((await app.inject({ method: "POST", url: "/v1/events/batch", headers: { authorization: `Bearer ${apiKey}` }, payload: { sdk, events: [] } })).statusCode, 200);

    const beforeRetention = Number((await pool.query<{ storage_bytes: string }>("SELECT storage_bytes::text FROM organization_storage WHERE organization_id = $1", [organizationId])).rows[0]!.storage_bytes);
    const oldEventId = randomUUID();
    await pool.query(
      `INSERT INTO events (environment_id, event_id, trace_id, type, status, source, occurred_at, metadata, received_at)
       VALUES ($1, $2, $3, 'http_request', 'success', 'retention-test', now() - interval '10 days',
               '{"method":"GET","route":"/old","statusCode":200}'::jsonb, now() - interval '10 days')`,
      [environmentId, oldEventId, randomUUID()],
    );
    await pool.query("UPDATE organization_security_settings SET retention_days = 7 WHERE organization_id = $1", [organizationId]);
    const retention = await store.deleteExpiredEvents();
    assert.ok(retention.deleted >= 1);
    assert.equal(Number((await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM events WHERE event_id = $1", [oldEventId])).rows[0]!.count), 0);
    const afterRetention = Number((await pool.query<{ storage_bytes: string }>("SELECT storage_bytes::text FROM organization_storage WHERE organization_id = $1", [organizationId])).rows[0]!.storage_bytes);
    assert.ok(afterRetention <= beforeRetention);

    const deleted = await app.inject({ method: "DELETE", url: `/v1/organizations/${organizationId}/telemetry`, headers: { cookie }, payload: { confirmation: "DELETE TELEMETRY" } });
    assert.equal(deleted.statusCode, 200);
    assert.equal(Number((await pool.query<{ storage_bytes: string }>("SELECT storage_bytes::text FROM organization_storage WHERE organization_id = $1", [organizationId])).rows[0]!.storage_bytes), 0);
  } finally {
    await app.close();
    if (organizationId) await pool.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
    await pool.query("DELETE FROM users WHERE email = $1", [email]);
    await pool.end();
  }
});

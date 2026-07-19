import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import pg from "pg";
import { buildApp } from "../src/app.js";
import { PostgresEventStore } from "../src/store.js";

const databaseUrl = process.env.QMON_TEST_DATABASE_URL;

test("external beta account, invitation, role, isolation, onboarding, and key lifecycle", {
  skip: databaseUrl ? false : "QMON_TEST_DATABASE_URL is not configured",
}, async () => {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 3 });
  const app = buildApp({ store: new PostgresEventStore(pool), jwtSecret: "external-beta-integration-secret-over-32-characters" });
  const suffix = randomUUID().replaceAll("-", "");
  const ownerEmail = `owner-${suffix}@example.test`;
  const developerEmail = `developer-${suffix}@example.test`;
  let organizationId: string | null = null;
  const cookieFor = (response: { headers: Record<string, unknown> }) => String(response.headers["set-cookie"]).split(";")[0]!;
  try {
    const ownerSignup = await app.inject({ method: "POST", url: "/v1/auth/signup", payload: { name: "Beta Owner", email: ownerEmail, password: "external-beta-owner-password" } });
    assert.equal(ownerSignup.statusCode, 201);
    const ownerCookie = cookieFor(ownerSignup);
    const organization = await app.inject({ method: "POST", url: "/v1/organizations", headers: { cookie: ownerCookie }, payload: { name: "Beta Organization", slug: `beta-${suffix}` } });
    assert.equal(organization.statusCode, 201);
    organizationId = organization.json().id as string;
    const project = await app.inject({ method: "POST", url: `/v1/organizations/${organizationId}/projects`, headers: { cookie: ownerCookie }, payload: { name: "Production API", slug: "production-api" } });
    assert.equal(project.statusCode, 201);
    const environment = await app.inject({ method: "POST", url: `/v1/projects/${project.json().id}/environments`, headers: { cookie: ownerCookie }, payload: { name: "Production", slug: "production", environmentType: "production" } });
    assert.equal(environment.statusCode, 201);
    const environmentId = environment.json().id as string;

    const developerSignup = await app.inject({ method: "POST", url: "/v1/auth/signup", payload: { name: "Beta Developer", email: developerEmail, password: "external-beta-developer-password" } });
    assert.equal(developerSignup.statusCode, 201);
    const developerCookie = cookieFor(developerSignup);
    assert.equal((await app.inject({ method: "GET", url: "/v1/events", headers: { cookie: developerCookie, "x-environment-id": environmentId } })).statusCode, 403);

    const invitation = await app.inject({ method: "POST", url: `/v1/organizations/${organizationId}/invitations`, headers: { cookie: ownerCookie }, payload: { email: developerEmail, role: "developer" } });
    assert.equal(invitation.statusCode, 201);
    const token = invitation.json().inviteToken as string;
    assert.equal((await app.inject({ method: "POST", url: `/v1/invitations/${token}/accept`, headers: { cookie: developerCookie } })).statusCode, 204);
    assert.equal((await app.inject({ method: "GET", url: "/v1/events", headers: { cookie: developerCookie, "x-environment-id": environmentId } })).statusCode, 200);
    assert.equal((await app.inject({ method: "POST", url: `/v1/organizations/${organizationId}/projects`, headers: { cookie: developerCookie }, payload: { name: "Denied", slug: "denied" } })).statusCode, 403);

    const key = await app.inject({ method: "POST", url: `/v1/environments/${environmentId}/api-keys`, headers: { cookie: developerCookie }, payload: { name: "Rotatable SDK" } });
    assert.equal(key.statusCode, 201);
    const rawKey = key.json().apiKey as string;
    assert.equal((await app.inject({ method: "POST", url: "/v1/events/batch", headers: { authorization: `Bearer ${rawKey}` }, payload: { sdk: { name: "smoke", version: "1.0.0", service: "smoke", environment: "production" }, events: [] } })).statusCode, 200);
    assert.equal((await app.inject({ method: "DELETE", url: `/v1/environments/${environmentId}/api-keys/${key.json().id}`, headers: { cookie: developerCookie } })).statusCode, 204);
    assert.equal((await app.inject({ method: "POST", url: "/v1/events/batch", headers: { authorization: `Bearer ${rawKey}` }, payload: { sdk: { name: "smoke", version: "1.0.0", service: "smoke", environment: "production" }, events: [] } })).statusCode, 401);

    const me = await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: developerCookie } });
    const developerId = me.json().user.id as string;
    assert.equal((await app.inject({ method: "PATCH", url: `/v1/organizations/${organizationId}/members/${developerId}`, headers: { cookie: ownerCookie }, payload: { role: "viewer" } })).statusCode, 204);
    assert.equal((await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie: developerCookie } })).statusCode, 401);
    const viewerLogin = await app.inject({ method: "POST", url: "/v1/auth/login", payload: { email: developerEmail, password: "external-beta-developer-password" } });
    const viewerCookie = cookieFor(viewerLogin);
    assert.equal((await app.inject({ method: "POST", url: `/v1/environments/${environmentId}/api-keys`, headers: { cookie: viewerCookie }, payload: { name: "Denied key" } })).statusCode, 403);
    const progress = await app.inject({ method: "PATCH", url: `/v1/organizations/${organizationId}/onboarding`, headers: { cookie: ownerCookie }, payload: { step: "install_sdk" } });
    assert.equal(progress.statusCode, 200);
    assert.ok(progress.json().completedSteps.includes("install_sdk"));
  } finally {
    await app.close();
    if (organizationId) await pool.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
    await pool.query("DELETE FROM users WHERE email IN ($1, $2)", [ownerEmail, developerEmail]);
    await pool.end();
  }
});

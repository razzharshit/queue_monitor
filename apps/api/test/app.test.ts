import assert from "node:assert/strict";
import test from "node:test";
import type {
  AuthenticatedKey,
  IngestEvent,
} from "@queue-monitor/shared";
import { buildApp, hashApiKey } from "../src/app.js";
import type {
  ApiKeySummary,
  AuditInput,
  AuditRecord,
  EnvironmentAccess,
  EnvironmentSummary,
  EnvironmentType,
  EventFilters,
  EventInsertResult,
  EventPage,
  EventStore,
  InvitationAcceptResult,
  InvitationSummary,
  IngestionAuthorization,
  OnboardingProgress,
  OrganizationRole,
  OrganizationSummary,
  SecurityPolicy,
  OverviewMetrics,
  SessionRecord,
  SessionUser,
  TeamMember,
  UsageSummary,
  UserProject,
} from "../src/store.js";

const apiKey = "qmon_live_test-secret";
const testLogin = {
  email: "fixture-user@example.test",
  password: "fixture-password-only-for-memory-store",
};
const auth = {
  id: "9cfdba69-7dca-4c99-b00e-f82c30599fcb",
  projectId: "f47c709d-7e5d-4f2a-bfcc-a61e397ea2a1",
  organizationId: "11111111-1111-4111-8111-111111111111",
  environmentId: "22222222-2222-4222-8222-222222222222",
};

class MemoryStore implements EventStore {
  readonly seen = new Set<string>();
  readonly user: SessionUser = {
    id: "4aa6da85-c5a4-44e2-8890-e4b9cfd6416c",
    email: testLogin.email,
    name: "Fixture Operator",
    isDemo: false,
  };
  readonly projects: UserProject[] = [
    {
      id: auth.projectId,
      organizationId: auth.organizationId,
      organizationName: "Fixture Organization",
      name: "Demo",
      slug: "demo",
      role: "owner",
      environments: [{
        id: auth.environmentId,
        projectId: auth.projectId,
        name: "Development",
        slug: "development",
        environmentType: "development",
        createdAt: "2026-01-01T00:00:00.000Z",
      }],
    },
  ];
  lastReadEnvironmentId: string | null = null;
  lastInsertEnvironmentId: string | null = null;
  ready = true;
  readonly sessions = new Map<string, { userId: string; tokenHash: string; revoked: boolean }>();
  readonly audits: AuditInput[] = [];
  readonly insertedEvents: IngestEvent[] = [];
  ingestionAuthorization: IngestionAuthorization = { allowed: true };
  passwordResetTokenHash: string | null = null;

  async checkReady(): Promise<void> {
    if (!this.ready) throw new Error("database unavailable");
  }

  async findActiveApiKey(keyHash: string): Promise<AuthenticatedKey | null> {
    return keyHash === hashApiKey(apiKey)
      ? {
          id: auth.id,
          organizationId: auth.organizationId,
          projectId: auth.projectId,
          environmentId: auth.environmentId,
        }
      : null;
  }

  async createSession(sessionId: string, userId: string, tokenHash: string): Promise<void> {
    this.sessions.set(sessionId, { userId, tokenHash, revoked: false });
  }

  async isSessionActive(sessionId: string, userId: string, tokenHash: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    return Boolean(session && session.userId === userId && session.tokenHash === tokenHash && !session.revoked);
  }

  async revokeSession(userId: string, sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId) return false;
    session.revoked = true;
    return true;
  }

  async revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number> {
    let revoked = 0;
    for (const [id, session] of this.sessions) {
      if (session.userId === userId && id !== exceptSessionId && !session.revoked) { session.revoked = true; revoked += 1; }
    }
    return revoked;
  }

  async listSessions(userId: string): Promise<SessionRecord[]> {
    return [...this.sessions.entries()].filter(([, session]) => session.userId === userId).map(([id, session]) => ({
      id, userId, createdAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z", revokedAt: session.revoked ? "2026-01-02T00:00:00.000Z" : null,
      ipAddress: "127.0.0.1", userAgent: "test",
    }));
  }

  async insertEvents(key: AuthenticatedKey, events: IngestEvent[]): Promise<EventInsertResult> {
    this.lastInsertEnvironmentId = key.environmentId;
    let accepted = 0;
    const insertedEvents: IngestEvent[] = [];
    for (const event of events) {
      if (!this.seen.has(event.eventId)) {
        this.seen.add(event.eventId);
        accepted += 1;
        insertedEvents.push(event);
        this.insertedEvents.push(event);
      }
    }
    return { accepted, duplicates: events.length - accepted, insertedEvents };
  }

  async authenticateUser(email: string, password: string): Promise<SessionUser | null> {
    return email === this.user.email && password === testLogin.password ? this.user : null;
  }

  async createUser(email: string, _password: string, name: string): Promise<SessionUser> {
    return { id: this.user.id, email: email.toLowerCase(), name, isDemo: false };
  }

  async createPasswordReset(email: string, tokenHash: string, expiresAt: string) {
    if (email.toLowerCase() !== this.user.email.toLowerCase()) return null;
    this.passwordResetTokenHash = tokenHash;
    return { id: auth.id, userId: this.user.id, email: this.user.email, expiresAt };
  }

  async resetPassword(tokenHash: string, _password: string) {
    if (tokenHash !== this.passwordResetTokenHash) return { result: "invalid" as const };
    await this.revokeAllSessions(this.user.id);
    this.passwordResetTokenHash = null;
    return { result: "reset" as const, userId: this.user.id };
  }

  async listUserProjects(userId: string): Promise<UserProject[]> {
    return userId === this.user.id ? this.projects : [];
  }

  async getEnvironmentAccess(userId: string, environmentId: string): Promise<EnvironmentAccess | null> {
    return userId === this.user.id && environmentId === auth.environmentId
      ? { userId, organizationId: auth.organizationId, projectId: auth.projectId, environmentId, role: "owner" }
      : null;
  }

  async createOrganization(_userId: string, name: string, slug: string): Promise<OrganizationSummary> {
    return { id: auth.organizationId, name, slug, role: "owner", createdAt: "2026-01-01T00:00:00.000Z" };
  }

  async listOrganizations(userId: string): Promise<OrganizationSummary[]> {
    return userId === this.user.id
      ? [{ id: auth.organizationId, name: "Fixture Organization", slug: "fixture", role: "owner", createdAt: "2026-01-01T00:00:00.000Z" }]
      : [];
  }

  async createProject(userId: string, organizationId: string, name: string, slug: string): Promise<UserProject | null> {
    return userId === this.user.id && organizationId === auth.organizationId
      ? { ...this.projects[0]!, name, slug, environments: [] }
      : null;
  }

  async createEnvironment(
    userId: string,
    projectId: string,
    name: string,
    slug: string,
    environmentType: EnvironmentType,
  ): Promise<EnvironmentSummary | null> {
    return userId === this.user.id && projectId === auth.projectId
      ? { id: auth.environmentId, projectId, name, slug, environmentType, createdAt: "2026-01-01T00:00:00.000Z" }
      : null;
  }

  async listEnvironments(userId: string, projectId: string): Promise<EnvironmentSummary[] | null> {
    return userId === this.user.id && projectId === auth.projectId ? this.projects[0]!.environments : null;
  }

  async createApiKey(
    userId: string,
    environmentId: string,
    name: string,
    keyPrefix: string,
    _keyHash: string,
    expiresAt: string | null,
  ): Promise<ApiKeySummary | null> {
    return userId === this.user.id && environmentId === auth.environmentId
      ? { id: auth.id, environmentId, name, keyPrefix, createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: null, expiresAt, revokedAt: null }
      : null;
  }

  async listApiKeys(userId: string, environmentId: string): Promise<ApiKeySummary[] | null> {
    return userId === this.user.id && environmentId === auth.environmentId && this.projects[0]!.role !== "viewer" ? [] : null;
  }

  async revokeApiKey(userId: string, environmentId: string, apiKeyId: string): Promise<boolean | null> {
    return userId === this.user.id && environmentId === auth.environmentId ? apiKeyId === auth.id : null;
  }

  async listMembers(userId: string, organizationId: string): Promise<TeamMember[] | null> {
    return userId === this.user.id && organizationId === auth.organizationId
      ? [{ userId: this.user.id, email: this.user.email, name: this.user.name, role: "owner", joinedAt: "2026-01-01T00:00:00.000Z" }]
      : null;
  }

  async updateMemberRole(userId: string, organizationId: string, memberId: string, _role: OrganizationRole) {
    return userId === this.user.id && organizationId === auth.organizationId && memberId === this.user.id
      ? "updated" as const
      : "forbidden" as const;
  }

  async removeMember(userId: string, organizationId: string, memberId: string) {
    return userId === this.user.id && organizationId === auth.organizationId && memberId === this.user.id
      ? "last_owner" as const
      : "forbidden" as const;
  }

  async createInvitation(
    userId: string,
    organizationId: string,
    email: string,
    role: Exclude<OrganizationRole, "owner">,
    _tokenHash: string,
    expiresAt: string,
  ): Promise<InvitationSummary | null> {
    return userId === this.user.id && organizationId === auth.organizationId
      ? { id: auth.id, organizationId, organizationName: "Fixture Organization", email, role, expiresAt, acceptedAt: null, revokedAt: null, createdAt: "2026-01-01T00:00:00.000Z" }
      : null;
  }

  async listInvitations(userId: string, organizationId: string): Promise<InvitationSummary[] | null> {
    return userId === this.user.id && organizationId === auth.organizationId && ["owner", "admin"].includes(this.projects[0]!.role) ? [] : null;
  }

  async getInvitation(_tokenHash: string): Promise<InvitationSummary | null> {
    return null;
  }

  async acceptInvitation(_userId: string, _email: string, _tokenHash: string): Promise<InvitationAcceptResult> {
    return "invalid";
  }

  async revokeInvitation(userId: string, organizationId: string, invitationId: string): Promise<boolean | null> {
    return userId === this.user.id && organizationId === auth.organizationId ? invitationId === auth.id : null;
  }

  async getOnboarding(userId: string, organizationId: string): Promise<OnboardingProgress | null> {
    return userId === this.user.id && organizationId === auth.organizationId
      ? { organizationId, completedSteps: ["create_organization"], updatedAt: "2026-01-01T00:00:00.000Z" }
      : null;
  }

  async completeOnboardingStep(userId: string, organizationId: string, step: string): Promise<OnboardingProgress | null> {
    const progress = await this.getOnboarding(userId, organizationId);
    return progress ? { ...progress, completedSteps: [...new Set([...progress.completedSteps, step])] } : null;
  }

  async recordAudit(input: AuditInput): Promise<void> { this.audits.push(input); }

  async listAuditLogs(userId: string, organizationId: string, _limit: number): Promise<AuditRecord[] | null> {
    if (userId !== this.user.id || organizationId !== auth.organizationId) return null;
    return this.audits.map((item, index) => ({ ...item, id: `audit-${index}`, createdAt: "2026-01-01T00:00:00.000Z" }));
  }

  async getSecurityPolicy(_environmentId: string): Promise<SecurityPolicy> {
    return { retentionDays: 30, redactEmails: true, redactPhoneNumbers: true, customRedactFields: [], ipAllowlistEnabled: false, allowedNetworks: [] };
  }

  async updateOrganizationSecurity(userId: string, organizationId: string, settings: Pick<SecurityPolicy, "retentionDays" | "redactEmails" | "redactPhoneNumbers" | "customRedactFields">): Promise<SecurityPolicy | null> {
    return userId === this.user.id && organizationId === auth.organizationId
      ? { ...settings, ipAllowlistEnabled: false, allowedNetworks: [] }
      : null;
  }

  async updateEnvironmentAllowlist(userId: string, environmentId: string, enabled: boolean, networks: string[]): Promise<SecurityPolicy | null> {
    return userId === this.user.id && environmentId === auth.environmentId
      ? { ...(await this.getSecurityPolicy(environmentId)), ipAllowlistEnabled: enabled, allowedNetworks: networks }
      : null;
  }

  async authorizeIngestion(_key: AuthenticatedKey, _ipAddress: string, _requestBytes: number, _eventCount: number): Promise<IngestionAuthorization> {
    return this.ingestionAuthorization;
  }

  async recordStoredUsage(): Promise<void> {}

  async getUsage(userId: string, organizationId: string): Promise<UsageSummary | null> {
    return userId === this.user.id && organizationId === auth.organizationId ? {
      monthStart: "2026-07-01", plan: { key: "free", name: "Free", status: "active", limits: { events: 100, requests: 100, bandwidthBytes: 1000, storageBytes: 1000 }, features: {} },
      usage: { ingestionRequests: 1, eventsIngested: 1, eventsStored: 1, bandwidthBytes: 10, storageBytes: 10, rateLimitedRequests: 0, quotaRejectedRequests: 0, activeServices: 1, activeEnvironments: 1, activeApiKeys: 1 },
    } : null;
  }

  async listPlans(): Promise<UsageSummary["plan"][]> { return [(await this.getUsage(this.user.id, auth.organizationId))!.plan]; }

  async deleteExpiredEvents() { return { deleted: 0, organizations: 0 }; }

  async getPublicStatus() {
    return { status: "operational" as const, checkedAt: "2026-07-17T00:00:00.000Z", components: [{ name: "API", status: "operational" as const }], incidents: [], maintenance: [] };
  }

  async exportOrganization(userId: string, organizationId: string) {
    return userId === this.user.id && organizationId === auth.organizationId && ["owner", "admin"].includes(this.projects[0]!.role)
      ? { exportedAt: "2026-07-17T00:00:00.000Z", organization: { id: organizationId }, projects: [], environments: [], apiKeys: [], telemetry: [], auditLogs: [], truncated: false }
      : null;
  }

  async deleteProject(userId: string, projectId: string) { return userId === this.user.id && projectId === auth.projectId ? true : null; }
  async deleteEnvironment(userId: string, environmentId: string) { return userId === this.user.id && environmentId === auth.environmentId ? true : null; }
  async deleteOrganization(userId: string, organizationId: string) { return userId === this.user.id && organizationId === auth.organizationId ? true : null; }
  async deleteUser(userId: string) { return userId === this.user.id; }
  async deleteOrganizationTelemetry(userId: string, organizationId: string) { return userId === this.user.id && organizationId === auth.organizationId ? 0 : null; }

  async listEvents(environmentId: string, filters: EventFilters): Promise<EventPage> {
    this.lastReadEnvironmentId = environmentId;
    return { items: [], page: filters.page, limit: filters.limit, total: 0, pages: 1 };
  }

  async getTrace(environmentId: string, _traceId: string) {
    this.lastReadEnvironmentId = environmentId;
    return [];
  }

  async getOverview(environmentId: string, range: OverviewMetrics["range"]): Promise<OverviewMetrics> {
    this.lastReadEnvironmentId = environmentId;
    return {
      range,
      requestCount: 0,
      failedRequestCount: 0,
      failureRate: 0,
      averageLatencyMs: 0,
      p95LatencyMs: 0,
      queueStatusCounts: { pending: 0, processing: 0, retrying: 0, success: 0, failure: 0 },
      series: [],
    };
  }
}

const validEvent = {
  eventId: "a7a266f2-f4ee-4fa5-b974-0a2e0e6fa284",
  traceId: "7a9a3860-73fd-49cc-bf9c-58d5b2edbd5a",
  parentEventId: null,
  type: "http_request",
  status: "success",
  source: "order-api",
  occurredAt: "2026-07-16T12:30:15.185Z",
  durationMs: 42,
  data: { method: "POST", route: "/orders", statusCode: 201 },
};

const sdk = {
  name: "@queue-monitor/node",
  version: "0.1.0",
  service: "order-api",
  environment: "development",
};

test("requires a valid bearer token", async () => {
  const app = buildApp({ store: new MemoryStore() });
  const response = await app.inject({ method: "POST", url: "/v1/events/batch", payload: { sdk, events: [] } });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test("partially accepts a batch and reports per-event errors", async () => {
  const app = buildApp({ store: new MemoryStore() });
  const response = await app.inject({
    method: "POST",
    url: "/v1/events/batch",
    headers: { authorization: `Bearer ${apiKey}` },
    payload: { sdk, events: [validEvent, { ...validEvent, eventId: "bad", durationMs: -1 }] },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    accepted: 1,
    duplicates: 0,
    rejected: [{ eventId: "bad", reason: "eventId must be a UUID" }],
  });
  await app.close();
});

test("deduplicates deliveries by event ID", async () => {
  const app = buildApp({ store: new MemoryStore() });
  const request = {
    method: "POST" as const,
    url: "/v1/events/batch",
    headers: { authorization: `Bearer ${apiKey}` },
    payload: { sdk, events: [validEvent] },
  };
  assert.deepEqual((await app.inject(request)).json(), { accepted: 1, duplicates: 0, rejected: [] });
  assert.deepEqual((await app.inject(request)).json(), { accepted: 0, duplicates: 1, rejected: [] });
  await app.close();
});

test("rejects batches over 100 events", async () => {
  const app = buildApp({ store: new MemoryStore() });
  const response = await app.inject({
    method: "POST",
    url: "/v1/events/batch",
    headers: { authorization: `Bearer ${apiKey}` },
    payload: { sdk, events: Array.from({ length: 101 }, () => validEvent) },
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /at most 100/);
  await app.close();
});

test("rejects request bodies over 1 MiB", async () => {
  const app = buildApp({ store: new MemoryStore() });
  const response = await app.inject({
    method: "POST",
    url: "/v1/events/batch",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    payload: JSON.stringify({ sdk, events: [], padding: "x".repeat(1024 * 1024) }),
  });
  assert.equal(response.statusCode, 413);
  await app.close();
});

test("stores login sessions in an HttpOnly cookie", async () => {
  const app = buildApp({ store: new MemoryStore(), jwtSecret: "a-secure-test-secret-with-at-least-32-characters" });
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: testLogin,
  });
  assert.equal(response.statusCode, 200);
  const cookie = response.headers["set-cookie"];
  assert.equal(typeof cookie, "string");
  assert.match(cookie as string, /qmon_session=/);
  assert.match(cookie as string, /HttpOnly/);
  assert.match(cookie as string, /SameSite=Lax/);
  assert.equal(response.json().projects[0].id, auth.projectId);
  await app.close();
});

test("requires authentication and verified environment membership for reads", async () => {
  const store = new MemoryStore();
  const app = buildApp({ store, jwtSecret: "a-secure-test-secret-with-at-least-32-characters" });
  assert.equal((await app.inject({ method: "GET", url: "/v1/events" })).statusCode, 401);

  const login = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: testLogin,
  });
  const cookie = (login.headers["set-cookie"] as string).split(";")[0]!;
  const denied = await app.inject({
    method: "GET",
    url: "/v1/events",
    headers: { cookie, "x-environment-id": "b6e4417e-b887-4e0c-a494-359478090629" },
  });
  assert.equal(denied.statusCode, 403);

  const allowed = await app.inject({
    method: "GET",
    url: "/v1/events?status=failure&limit=25",
    headers: { cookie, "x-environment-id": auth.environmentId },
  });
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.json().limit, 25);
  assert.equal(store.lastReadEnvironmentId, auth.environmentId);
  await app.close();
});

test("exposes health, readiness, version, and propagated request IDs", async () => {
  const app = buildApp({
    store: new MemoryStore(),
    version: {
      version: "1.2.3",
      gitCommitSha: "abc123",
      buildTimestamp: "2026-07-17T00:00:00.000Z",
      environment: "test",
    },
  });
  const health = await app.inject({ method: "GET", url: "/health", headers: { "x-request-id": "fixture-request-1" } });
  assert.equal(health.statusCode, 200);
  assert.equal(health.headers["x-request-id"], "fixture-request-1");
  assert.equal((await app.inject({ method: "GET", url: "/ready" })).statusCode, 200);
  const version = await app.inject({ method: "GET", url: "/version" });
  assert.deepEqual(version.json(), {
    version: "1.2.3",
    gitCommitSha: "abc123",
    buildTimestamp: "2026-07-17T00:00:00.000Z",
    environment: "test",
  });
  await app.close();
});

test("creates environment API keys and revokes them only inside the authorized organization", async () => {
  const store = new MemoryStore();
  const app = buildApp({ store, jwtSecret: "a-secure-test-secret-with-at-least-32-characters" });
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: testLogin });
  const cookie = (login.headers["set-cookie"] as string).split(";")[0]!;

  const deniedProject = await app.inject({
    method: "POST",
    url: "/v1/organizations/b6e4417e-b887-4e0c-a494-359478090629/projects",
    headers: { cookie },
    payload: { name: "Other Project", slug: "other-project" },
  });
  assert.equal(deniedProject.statusCode, 403);

  const createdEnvironment = await app.inject({
    method: "POST",
    url: `/v1/projects/${auth.projectId}/environments`,
    headers: { cookie },
    payload: { name: "Production", slug: "production", environmentType: "production" },
  });
  assert.equal(createdEnvironment.statusCode, 201);
  assert.equal(createdEnvironment.json().environmentType, "production");

  const createdKey = await app.inject({
    method: "POST",
    url: `/v1/environments/${auth.environmentId}/api-keys`,
    headers: { cookie },
    payload: { name: "Production ingestion" },
  });
  assert.equal(createdKey.statusCode, 201);
  assert.match(createdKey.json().apiKey, /^qmon_live_/);

  const revoked = await app.inject({
    method: "DELETE",
    url: `/v1/environments/${auth.environmentId}/api-keys/${auth.id}`,
    headers: { cookie },
  });
  assert.equal(revoked.statusCode, 204);
  await app.close();
});

test("ingestion binds events to the API key environment", async () => {
  const store = new MemoryStore();
  const app = buildApp({ store });
  const response = await app.inject({
    method: "POST",
    url: "/v1/events/batch",
    headers: { authorization: `Bearer ${apiKey}` },
    payload: { sdk, events: [validEvent] },
  });
  assert.equal(response.statusCode, 200);
  assert.equal(store.lastInsertEnvironmentId, auth.environmentId);
  await app.close();
});

test("creates an account and stores the session in an HttpOnly cookie", async () => {
  const app = buildApp({ store: new MemoryStore(), jwtSecret: "a-secure-test-secret-with-at-least-32-characters" });
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/signup",
    payload: { name: "External Developer", email: "NEW@example.test", password: "a-long-unique-password" },
  });
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().user.email, "new@example.test");
  assert.deepEqual(response.json().projects, []);
  assert.match(String(response.headers["set-cookie"]), /HttpOnly/);
  await app.close();
});

test("supports team listing, invitations, and persisted onboarding", async () => {
  let deliveredUrl = "";
  const app = buildApp({
    store: new MemoryStore(),
    jwtSecret: "a-secure-test-secret-with-at-least-32-characters",
    inviteBaseUrl: "https://monitor.example.test",
    sendInvitation: async (_invitation, acceptUrl) => { deliveredUrl = acceptUrl; },
  });
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: testLogin });
  const cookie = (login.headers["set-cookie"] as string).split(";")[0]!;
  const headers = { cookie };

  const members = await app.inject({ method: "GET", url: `/v1/organizations/${auth.organizationId}/members`, headers });
  assert.equal(members.statusCode, 200);
  assert.equal(members.json().items[0].role, "owner");

  const invite = await app.inject({
    method: "POST",
    url: `/v1/organizations/${auth.organizationId}/invitations`,
    headers,
    payload: { email: "developer@example.test", role: "developer" },
  });
  assert.equal(invite.statusCode, 201);
  assert.match(invite.json().inviteToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(invite.json().role, "developer");
  assert.equal(invite.json().emailDelivery, "sent");
  assert.equal(deliveredUrl, `https://monitor.example.test${invite.json().acceptPath}`);

  const progress = await app.inject({
    method: "PATCH",
    url: `/v1/organizations/${auth.organizationId}/onboarding`,
    headers,
    payload: { step: "install_sdk" },
  });
  assert.equal(progress.statusCode, 200);
  assert.deepEqual(progress.json().completedSteps, ["create_organization", "install_sdk"]);
  await app.close();
});

test("accepts W3C trace IDs through ingestion and read filters", async () => {
  const store = new MemoryStore();
  const app = buildApp({ store, jwtSecret: "a-secure-test-secret-with-at-least-32-characters" });
  const traceId = "0af7651916cd43dd8448eb211c80319c";
  const ingested = await app.inject({
    method: "POST",
    url: "/v1/events/batch",
    headers: { authorization: `Bearer ${apiKey}` },
    payload: { sdk, events: [{ ...validEvent, traceId }] },
  });
  assert.equal(ingested.statusCode, 200);
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: testLogin });
  const cookie = (login.headers["set-cookie"] as string).split(";")[0]!;
  const events = await app.inject({
    method: "GET",
    url: `/v1/events?traceId=${traceId}`,
    headers: { cookie, "x-environment-id": auth.environmentId },
  });
  assert.equal(events.statusCode, 200);
  await app.close();
});

test("redacts sensitive telemetry before persistence", async () => {
  const store = new MemoryStore();
  const app = buildApp({ store });
  const response = await app.inject({
    method: "POST",
    url: "/v1/events/batch",
    headers: { authorization: `Bearer ${apiKey}` },
    payload: {
      sdk,
      events: [{
        ...validEvent,
        data: {
          ...validEvent.data,
          headers: { authorization: "Bearer customer-token" },
          customerEmail: "customer@example.test",
          phone: "+1 415 555 2671",
          paymentCard: "4242 4242 4242 4242",
        },
      }],
    },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(store.insertedEvents[0]?.data, {
    ...validEvent.data,
    headers: { authorization: "[REDACTED]" },
    customerEmail: "[REDACTED]",
    phone: "[REDACTED]",
    paymentCard: "[REDACTED]",
  });
  await app.close();
});

test("returns retry metadata for hierarchical rate limits and blocks disallowed IPs", async () => {
  const store = new MemoryStore();
  const app = buildApp({ store });
  store.ingestionAuthorization = { allowed: false, reason: "rate_limit", scope: "api_key", retryAfterSeconds: 3 };
  const limited = await app.inject({
    method: "POST", url: "/v1/events/batch",
    headers: { authorization: `Bearer ${apiKey}` }, payload: { sdk, events: [validEvent] },
  });
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.headers["retry-after"], "3");
  assert.equal(limited.json().scope, "api_key");

  store.ingestionAuthorization = { allowed: false, reason: "ip_allowlist" };
  const denied = await app.inject({
    method: "POST", url: "/v1/events/batch",
    headers: { authorization: `Bearer ${apiKey}` }, payload: { sdk, events: [validEvent] },
  });
  assert.equal(denied.statusCode, 403);
  assert.equal(denied.json().code, "ip_allowlist");
  await app.close();
});

test("revalidates and revokes persistent sessions", async () => {
  const store = new MemoryStore();
  const app = buildApp({ store, jwtSecret: "a-secure-test-secret-with-at-least-32-characters" });
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: testLogin });
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  assert.equal((await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: "/v1/auth/logout-all", headers: { cookie } })).statusCode, 204);
  assert.equal((await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } })).statusCode, 401);
  assert.ok(store.audits.some((item) => item.action === "session.revoke_all"));
  await app.close();
});

test("sets secure response headers and can enforce HTTPS behind a trusted proxy", async () => {
  const app = buildApp({ store: new MemoryStore(), enforceHttps: true, trustProxy: true });
  const redirected = await app.inject({ method: "GET", url: "/health", headers: { host: "monitor.example.test" } });
  assert.equal(redirected.statusCode, 308);
  assert.equal(redirected.headers.location, "https://monitor.example.test/health");
  const secure = await app.inject({ method: "GET", url: "/health", headers: { host: "monitor.example.test", "x-forwarded-proto": "https" } });
  assert.equal(secure.statusCode, 200);
  assert.match(String(secure.headers["strict-transport-security"]), /max-age=31536000/);
  assert.equal(secure.headers["x-frame-options"], "DENY");
  assert.equal(secure.headers["x-content-type-options"], "nosniff");
  await app.close();
});

test("uses single-use password reset links and revokes existing sessions", async () => {
  const store = new MemoryStore();
  let resetUrl = "";
  const app = buildApp({
    store,
    jwtSecret: "a-secure-test-secret-with-at-least-32-characters",
    inviteBaseUrl: "https://monitor.example.test",
    sendPasswordReset: async (_request, url) => { resetUrl = url; },
  });
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: testLogin });
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  const requested = await app.inject({ method: "POST", url: "/v1/auth/password-reset/request", payload: { email: testLogin.email } });
  assert.equal(requested.statusCode, 202);
  assert.match(resetUrl, /^https:\/\/monitor\.example\.test\/reset-password\?token=/);
  const token = new URL(resetUrl).searchParams.get("token")!;
  const confirmed = await app.inject({ method: "POST", url: "/v1/auth/password-reset/confirm", payload: { token, password: "a-new-unique-password" } });
  assert.equal(confirmed.statusCode, 204);
  assert.equal((await app.inject({ method: "GET", url: "/v1/auth/me", headers: { cookie } })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: "/v1/auth/password-reset/confirm", payload: { token, password: "another-unique-password" } })).statusCode, 400);
  assert.ok(store.audits.some((item) => item.action === "password_reset.complete" && item.result === "success"));
  await app.close();
});

test("demo viewer sessions can read telemetry but cannot reach administrative or destructive actions", async () => {
  const store = new MemoryStore();
  store.user.isDemo = true;
  store.projects[0]!.role = "viewer";
  const app = buildApp({ store, jwtSecret: "a-secure-test-secret-with-at-least-32-characters" });
  const login = await app.inject({ method: "POST", url: "/v1/auth/login", payload: testLogin });
  const cookie = String(login.headers["set-cookie"]).split(";")[0]!;
  assert.equal(login.json().user.isDemo, true);
  assert.equal((await app.inject({ method: "GET", url: "/v1/events", headers: { cookie, "x-environment-id": auth.environmentId } })).statusCode, 200);
  assert.equal((await app.inject({ method: "GET", url: `/v1/environments/${auth.environmentId}/api-keys`, headers: { cookie } })).statusCode, 403);
  assert.equal((await app.inject({ method: "GET", url: `/v1/organizations/${auth.organizationId}/invitations`, headers: { cookie } })).statusCode, 403);
  assert.equal((await app.inject({ method: "GET", url: `/v1/organizations/${auth.organizationId}/security`, headers: { cookie } })).statusCode, 403);
  assert.equal((await app.inject({ method: "GET", url: `/v1/organizations/${auth.organizationId}/export`, headers: { cookie } })).statusCode, 403);
  const mutations = [
    app.inject({ method: "POST", url: "/v1/organizations", headers: { cookie }, payload: { name: "Denied", slug: "denied" } }),
    app.inject({ method: "POST", url: `/v1/environments/${auth.environmentId}/api-keys`, headers: { cookie }, payload: { name: "Denied" } }),
    app.inject({ method: "DELETE", url: `/v1/organizations/${auth.organizationId}/telemetry`, headers: { cookie }, payload: { confirmation: "DELETE TELEMETRY" } }),
    app.inject({ method: "DELETE", url: "/v1/account", headers: { cookie }, payload: { confirmation: testLogin.email } }),
  ];
  for (const response of await Promise.all(mutations)) {
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error, "demo workspace is read-only");
  }
  assert.equal((await app.inject({ method: "POST", url: "/v1/auth/logout", headers: { cookie } })).statusCode, 204);
  await app.close();
});

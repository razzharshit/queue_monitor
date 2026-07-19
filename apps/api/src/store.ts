import type { Pool, PoolClient } from "pg";
import type {
  AuthenticatedKey,
  EventStatus,
  EventType,
  IngestEvent,
  InsertResult,
} from "@queue-monitor/shared";

export type OrganizationRole = "owner" | "admin" | "developer" | "viewer";
export type EnvironmentType = "development" | "staging" | "production" | "custom";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  isDemo: boolean;
}

export interface EnvironmentSummary {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  environmentType: EnvironmentType;
  createdAt: string;
}

export interface UserProject {
  id: string;
  organizationId: string;
  organizationName: string;
  name: string;
  slug: string;
  role: OrganizationRole;
  environments: EnvironmentSummary[];
}

export interface OrganizationSummary {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
  createdAt: string;
}

export interface ApiKeySummary {
  id: string;
  environmentId: string;
  name: string;
  keyPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface TeamMember {
  userId: string;
  email: string;
  name: string | null;
  role: OrganizationRole;
  joinedAt: string;
}

export interface InvitationSummary {
  id: string;
  organizationId: string;
  organizationName: string;
  email: string;
  role: Exclude<OrganizationRole, "owner">;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export type InvitationAcceptResult = "accepted" | "invalid" | "expired" | "email_mismatch";
export type PasswordResetResult = "reset" | "invalid" | "expired";

export interface PasswordResetRequest {
  id: string;
  userId: string;
  email: string;
  expiresAt: string;
}

export interface OnboardingProgress {
  organizationId: string;
  completedSteps: string[];
  updatedAt: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  revokedAt: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  current?: boolean;
}

export interface AuditInput {
  organizationId: string | null;
  actorUserId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  result: "success" | "failure";
  metadata?: Record<string, unknown>;
}

export interface AuditRecord extends AuditInput {
  id: string;
  createdAt: string;
}

export interface SecurityPolicy {
  retentionDays: 7 | 30 | 90 | 180 | 365;
  redactEmails: boolean;
  redactPhoneNumbers: boolean;
  customRedactFields: string[];
  ipAllowlistEnabled: boolean;
  allowedNetworks: string[];
}

export interface IngestionAuthorization {
  allowed: boolean;
  reason?: "rate_limit" | "event_quota" | "request_quota" | "bandwidth_quota" | "storage_quota" | "ip_allowlist" | "subscription_inactive";
  scope?: "organization" | "environment" | "api_key";
  retryAfterSeconds?: number;
}

export interface UsageSummary {
  monthStart: string;
  plan: {
    key: "free" | "team" | "business";
    name: string;
    status: string;
    limits: { events: number; requests: number; bandwidthBytes: number; storageBytes: number };
    features: Record<string, unknown>;
  };
  usage: {
    ingestionRequests: number;
    eventsIngested: number;
    eventsStored: number;
    bandwidthBytes: number;
    storageBytes: number;
    rateLimitedRequests: number;
    quotaRejectedRequests: number;
    activeServices: number;
    activeEnvironments: number;
    activeApiKeys: number;
  };
}

export interface PublicStatus {
  status: "operational" | "degraded" | "outage";
  checkedAt: string;
  components: Array<{ name: string; status: "operational" | "degraded" | "outage" }>;
  incidents: Array<{ id: string; title: string; severity: string; status: string; message: string; startedAt: string; resolvedAt: string | null }>;
  maintenance: Array<{ id: string; title: string; message: string; startsAt: string; endsAt: string }>;
}

export interface OrganizationExport {
  exportedAt: string;
  organization: Record<string, unknown>;
  projects: Array<Record<string, unknown>>;
  environments: Array<Record<string, unknown>>;
  apiKeys: Array<Record<string, unknown>>;
  telemetry: DashboardEvent[];
  auditLogs: AuditRecord[];
  truncated: boolean;
}

export interface EnvironmentAccess {
  userId: string;
  organizationId: string;
  projectId: string;
  environmentId: string;
  role: OrganizationRole;
}

export interface DashboardEvent {
  id: string;
  eventId: string;
  traceId: string | null;
  parentEventId: string | null;
  type: EventType;
  status: EventStatus;
  source: string;
  occurredAt: string;
  receivedAt: string;
  durationMs: number | null;
  http: {
    method: string | null;
    route: string | null;
    statusCode: number | null;
  } | null;
  queue: {
    name: string | null;
    jobId: string | null;
    jobName: string | null;
    attempt: number | null;
  } | null;
  error: { name: string; message: string } | null;
  data: Record<string, unknown>;
}

export interface EventFilters {
  page: number;
  limit: number;
  type?: EventType;
  status?: EventStatus;
  source?: string;
  traceId?: string;
  queueName?: string;
  search?: string;
  from?: string;
  to?: string;
}

export interface EventPage {
  items: DashboardEvent[];
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface OverviewMetrics {
  range: "24h" | "7d" | "30d";
  requestCount: number;
  failedRequestCount: number;
  failureRate: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  queueStatusCounts: Record<"pending" | "processing" | "retrying" | "success" | "failure", number>;
  series: Array<{
    bucket: string;
    requests: number;
    failures: number;
    averageLatencyMs: number;
    p95LatencyMs: number;
  }>;
}

export interface EventInsertResult extends InsertResult {
  insertedEvents: IngestEvent[];
}

export interface EventStore {
  checkReady(): Promise<void>;
  findActiveApiKey(keyHash: string): Promise<AuthenticatedKey | null>;
  insertEvents(auth: AuthenticatedKey, events: IngestEvent[]): Promise<EventInsertResult>;
  createSession(sessionId: string, userId: string, tokenHash: string, expiresAt: string, ipAddress: string | null, userAgent: string | null): Promise<void>;
  isSessionActive(sessionId: string, userId: string, tokenHash: string): Promise<boolean>;
  revokeSession(userId: string, sessionId: string): Promise<boolean>;
  revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number>;
  listSessions(userId: string): Promise<SessionRecord[]>;
  createUser(email: string, password: string, name: string): Promise<SessionUser>;
  authenticateUser(email: string, password: string): Promise<SessionUser | null>;
  createPasswordReset(email: string, tokenHash: string, expiresAt: string): Promise<PasswordResetRequest | null>;
  resetPassword(tokenHash: string, password: string): Promise<{ result: PasswordResetResult; userId?: string }>;
  listUserProjects(userId: string): Promise<UserProject[]>;
  getEnvironmentAccess(userId: string, environmentId: string): Promise<EnvironmentAccess | null>;
  createOrganization(userId: string, name: string, slug: string): Promise<OrganizationSummary>;
  listOrganizations(userId: string): Promise<OrganizationSummary[]>;
  createProject(userId: string, organizationId: string, name: string, slug: string): Promise<UserProject | null>;
  createEnvironment(
    userId: string,
    projectId: string,
    name: string,
    slug: string,
    environmentType: EnvironmentType,
  ): Promise<EnvironmentSummary | null>;
  listEnvironments(userId: string, projectId: string): Promise<EnvironmentSummary[] | null>;
  createApiKey(
    userId: string,
    environmentId: string,
    name: string,
    keyPrefix: string,
    keyHash: string,
    expiresAt: string | null,
  ): Promise<ApiKeySummary | null>;
  listApiKeys(userId: string, environmentId: string): Promise<ApiKeySummary[] | null>;
  revokeApiKey(userId: string, environmentId: string, apiKeyId: string): Promise<boolean | null>;
  listMembers(userId: string, organizationId: string): Promise<TeamMember[] | null>;
  updateMemberRole(userId: string, organizationId: string, memberId: string, role: OrganizationRole): Promise<"updated" | "forbidden" | "not_found" | "last_owner">;
  removeMember(userId: string, organizationId: string, memberId: string): Promise<"removed" | "forbidden" | "not_found" | "last_owner">;
  createInvitation(userId: string, organizationId: string, email: string, role: Exclude<OrganizationRole, "owner">, tokenHash: string, expiresAt: string): Promise<InvitationSummary | null>;
  listInvitations(userId: string, organizationId: string): Promise<InvitationSummary[] | null>;
  getInvitation(tokenHash: string): Promise<InvitationSummary | null>;
  acceptInvitation(userId: string, email: string, tokenHash: string): Promise<InvitationAcceptResult>;
  revokeInvitation(userId: string, organizationId: string, invitationId: string): Promise<boolean | null>;
  getOnboarding(userId: string, organizationId: string): Promise<OnboardingProgress | null>;
  completeOnboardingStep(userId: string, organizationId: string, step: string): Promise<OnboardingProgress | null>;
  recordAudit(input: AuditInput): Promise<void>;
  listAuditLogs(userId: string, organizationId: string, limit: number): Promise<AuditRecord[] | null>;
  getSecurityPolicy(environmentId: string): Promise<SecurityPolicy>;
  updateOrganizationSecurity(userId: string, organizationId: string, settings: Pick<SecurityPolicy, "retentionDays" | "redactEmails" | "redactPhoneNumbers" | "customRedactFields">): Promise<SecurityPolicy | null>;
  updateEnvironmentAllowlist(userId: string, environmentId: string, enabled: boolean, networks: string[]): Promise<SecurityPolicy | null>;
  authorizeIngestion(auth: AuthenticatedKey, ipAddress: string, requestBytes: number, eventCount: number): Promise<IngestionAuthorization>;
  recordStoredUsage(auth: AuthenticatedKey, eventsStored: number, storageBytes: number): Promise<void>;
  getUsage(userId: string, organizationId: string): Promise<UsageSummary | null>;
  listPlans(): Promise<UsageSummary["plan"][]>;
  deleteExpiredEvents(): Promise<{ deleted: number; organizations: number }>;
  getPublicStatus(): Promise<PublicStatus>;
  exportOrganization(userId: string, organizationId: string, eventLimit: number): Promise<OrganizationExport | null>;
  deleteProject(userId: string, projectId: string): Promise<boolean | null>;
  deleteEnvironment(userId: string, environmentId: string): Promise<boolean | null>;
  deleteOrganization(userId: string, organizationId: string): Promise<boolean | null>;
  deleteUser(userId: string): Promise<boolean>;
  deleteOrganizationTelemetry(userId: string, organizationId: string): Promise<number | null>;
  listEvents(environmentId: string, filters: EventFilters): Promise<EventPage>;
  getTrace(environmentId: string, traceId: string): Promise<DashboardEvent[]>;
  getOverview(environmentId: string, range: OverviewMetrics["range"]): Promise<OverviewMetrics>;
}

const INSERT_COLUMNS = [
  "environment_id",
  "api_key_id",
  "event_id",
  "trace_id",
  "parent_event_id",
  "type",
  "status",
  "source",
  "occurred_at",
  "duration_ms",
  "http_method",
  "http_route",
  "http_status_code",
  "queue_name",
  "job_id",
  "job_name",
  "attempt",
  "error_name",
  "error_message",
  "metadata",
] as const;

interface EventRow {
  id: string;
  event_id: string;
  trace_id: string | null;
  parent_event_id: string | null;
  type: EventType;
  status: EventStatus;
  source: string;
  occurred_at: Date | string;
  received_at: Date | string;
  duration_ms: number | null;
  http_method: string | null;
  http_route: string | null;
  http_status_code: number | null;
  queue_name: string | null;
  job_id: string | null;
  job_name: string | null;
  attempt: number | null;
  error_name: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
}

const EVENT_SELECT = `id,
  event_id,
  trace_id,
  parent_event_id,
  type,
  status,
  source,
  occurred_at,
  received_at,
  duration_ms,
  http_method,
  http_route,
  http_status_code,
  queue_name,
  job_id,
  job_name,
  attempt,
  error_name,
  error_message,
  metadata`;

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: Date | string | null): string | null {
  return value === null ? null : iso(value);
}

function eventFromRow(row: EventRow): DashboardEvent {
  const isHttp = row.type === "http_request";
  const isQueue = row.type.startsWith("queue_");
  return {
    id: row.id,
    eventId: row.event_id,
    traceId: row.trace_id,
    parentEventId: row.parent_event_id,
    type: row.type,
    status: row.status,
    source: row.source,
    occurredAt: iso(row.occurred_at),
    receivedAt: iso(row.received_at),
    durationMs: row.duration_ms,
    http: isHttp
      ? { method: row.http_method, route: row.http_route, statusCode: row.http_status_code }
      : null,
    queue: isQueue
      ? { name: row.queue_name, jobId: row.job_id, jobName: row.job_name, attempt: row.attempt }
      : null,
    error: row.error_name && row.error_message
      ? { name: row.error_name, message: row.error_message }
      : null,
    data: row.metadata ?? {},
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function integerOrNull(value: unknown): number | null {
  return Number.isInteger(value) ? (value as number) : null;
}

function eventValues(auth: AuthenticatedKey, event: IngestEvent): unknown[] {
  const data = event.data;
  const error = typeof data.error === "object" && data.error !== null && !Array.isArray(data.error)
    ? (data.error as Record<string, unknown>)
    : {};
  const isHttp = event.type === "http_request";
  const isQueue = event.type.startsWith("queue_");
  return [
    auth.environmentId,
    auth.id,
    event.eventId,
    event.traceId,
    event.parentEventId,
    event.type,
    event.status,
    event.source,
    event.occurredAt,
    event.durationMs,
    isHttp ? stringOrNull(data.method) : null,
    isHttp ? stringOrNull(data.route) : null,
    isHttp ? integerOrNull(data.statusCode) : null,
    isQueue ? stringOrNull(data.queueName) : null,
    isQueue ? stringOrNull(data.jobId) : null,
    isQueue ? stringOrNull(data.jobName) : null,
    isQueue ? integerOrNull(data.attempt) : null,
    stringOrNull(error.name),
    stringOrNull(error.message),
    JSON.stringify(data),
  ];
}

function orderTraceByParent(events: DashboardEvent[]): DashboardEvent[] {
  const byId = new Map(events.map((event) => [event.eventId, event]));
  const children = new Map<string, DashboardEvent[]>();
  const roots: DashboardEvent[] = [];
  for (const event of events) {
    if (!event.parentEventId || !byId.has(event.parentEventId)) {
      roots.push(event);
      continue;
    }
    const list = children.get(event.parentEventId) ?? [];
    list.push(event);
    children.set(event.parentEventId, list);
  }
  const chronological = (a: DashboardEvent, b: DashboardEvent) =>
    Date.parse(a.occurredAt) - Date.parse(b.occurredAt);
  roots.sort(chronological);
  children.forEach((items) => items.sort(chronological));
  const result: DashboardEvent[] = [];
  const seen = new Set<string>();
  const visit = (event: DashboardEvent): void => {
    if (seen.has(event.eventId)) return;
    seen.add(event.eventId);
    result.push(event);
    for (const child of children.get(event.eventId) ?? []) visit(child);
  };
  roots.forEach(visit);
  [...events].sort(chronological).forEach(visit);
  return result;
}

interface EnvironmentRow {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  environment_type: EnvironmentType;
  created_at: Date | string;
}

function environmentFromRow(row: EnvironmentRow): EnvironmentSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    slug: row.slug,
    environmentType: row.environment_type,
    createdAt: iso(row.created_at),
  };
}

interface ApiKeyRow {
  id: string;
  environment_id: string;
  name: string;
  key_prefix: string;
  created_at: Date | string;
  last_used_at: Date | string | null;
  expires_at: Date | string | null;
  revoked_at: Date | string | null;
}

function apiKeyFromRow(row: ApiKeyRow): ApiKeySummary {
  return {
    id: row.id,
    environmentId: row.environment_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    createdAt: iso(row.created_at),
    lastUsedAt: nullableIso(row.last_used_at),
    expiresAt: nullableIso(row.expires_at),
    revokedAt: nullableIso(row.revoked_at),
  };
}

interface InvitationRow {
  id: string;
  organization_id: string;
  organization_name: string;
  email: string;
  role: Exclude<OrganizationRole, "owner">;
  expires_at: Date | string;
  accepted_at: Date | string | null;
  revoked_at: Date | string | null;
  created_at: Date | string;
}

function invitationFromRow(row: InvitationRow): InvitationSummary {
  return {
    id: row.id,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    email: row.email,
    role: row.role,
    expiresAt: iso(row.expires_at),
    acceptedAt: nullableIso(row.accepted_at),
    revokedAt: nullableIso(row.revoked_at),
    createdAt: iso(row.created_at),
  };
}

const INVITATION_SELECT = `i.id, i.organization_id, o.name AS organization_name, i.email,
  i.role, i.expires_at, i.accepted_at, i.revoked_at, i.created_at`;

interface AuditRow {
  id: string;
  organization_id: string | null;
  actor_user_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  result: "success" | "failure";
  metadata: Record<string, unknown>;
  created_at: Date | string;
}

function auditFromRow(row: AuditRow): AuditRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    actorUserId: row.actor_user_id,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    result: row.result,
    metadata: row.metadata,
    createdAt: iso(row.created_at),
  };
}

export class PostgresEventStore implements EventStore {
  constructor(private readonly pool: Pool) {}

  async checkReady(): Promise<void> {
    await this.pool.query("SELECT 1");
  }

  async createSession(
    sessionId: string,
    userId: string,
    tokenHash: string,
    expiresAt: string,
    ipAddress: string | null,
    userAgent: string | null,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sessionId, userId, tokenHash, expiresAt, ipAddress, userAgent],
    );
  }

  async isSessionActive(sessionId: string, userId: string, tokenHash: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE sessions SET last_seen_at = now()
        WHERE id = $1 AND user_id = $2 AND token_hash = $3
          AND revoked_at IS NULL AND expires_at > now()`,
      [sessionId, userId, tokenHash],
    );
    return result.rowCount === 1;
  }

  async revokeSession(userId: string, sessionId: string): Promise<boolean> {
    const result = await this.pool.query(
      "UPDATE sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 AND user_id = $2",
      [sessionId, userId],
    );
    return result.rowCount === 1;
  }

  async revokeAllSessions(userId: string, exceptSessionId?: string): Promise<number> {
    const result = await this.pool.query(
      `UPDATE sessions SET revoked_at = COALESCE(revoked_at, now())
        WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2)`,
      [userId, exceptSessionId ?? null],
    );
    return result.rowCount ?? 0;
  }

  async listSessions(userId: string): Promise<SessionRecord[]> {
    const result = await this.pool.query<{
      id: string; user_id: string; created_at: Date | string; last_seen_at: Date | string;
      expires_at: Date | string; revoked_at: Date | string | null; ip_address: string | null; user_agent: string | null;
    }>(
      `SELECT id, user_id, created_at, last_seen_at, expires_at, revoked_at,
              host(ip_address) AS ip_address, user_agent
         FROM sessions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [userId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      createdAt: iso(row.created_at),
      lastSeenAt: iso(row.last_seen_at),
      expiresAt: iso(row.expires_at),
      revokedAt: nullableIso(row.revoked_at),
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
    }));
  }

  async findActiveApiKey(keyHash: string): Promise<AuthenticatedKey | null> {
    const result = await this.pool.query<{
      id: string;
      organization_id: string;
      project_id: string;
      environment_id: string;
    }>(
      `SELECT key.id, project.organization_id, environment.project_id, key.environment_id
         FROM api_keys key
         JOIN environments environment ON environment.id = key.environment_id
         JOIN projects project ON project.id = environment.project_id
        WHERE key.key_hash = $1
          AND key.revoked_at IS NULL
          AND (key.expires_at IS NULL OR key.expires_at > now())
        LIMIT 1`,
      [keyHash],
    );
    const row = result.rows[0];
    return row ? {
      id: row.id,
      organizationId: row.organization_id,
      projectId: row.project_id,
      environmentId: row.environment_id,
    } : null;
  }

  async insertEvents(auth: AuthenticatedKey, events: IngestEvent[]): Promise<EventInsertResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const insertedIds = events.length === 0 ? new Set<string>() : await this.insertRows(client, auth, events);
      await client.query("UPDATE api_keys SET last_used_at = now() WHERE id = $1", [auth.id]);
      await client.query("COMMIT");
      const insertedEvents = events.filter((event) => insertedIds.has(event.eventId));
      return { accepted: insertedEvents.length, duplicates: events.length - insertedEvents.length, insertedEvents };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async authenticateUser(email: string, password: string): Promise<SessionUser | null> {
    const result = await this.pool.query<SessionUser>(
      `SELECT id, email, name, is_demo AS "isDemo" FROM users
        WHERE lower(email) = lower($1)
          AND password_hash = crypt($2, password_hash)
        LIMIT 1`,
      [email, password],
    );
    return result.rows[0] ?? null;
  }

  async createUser(email: string, password: string, name: string): Promise<SessionUser> {
    const result = await this.pool.query<SessionUser>(
      `INSERT INTO users (email, password_hash, name)
       VALUES (lower($1), crypt($2, gen_salt('bf', 12)), $3)
       RETURNING id, email, name, is_demo AS "isDemo"`,
      [email, password, name],
    );
    return result.rows[0]!;
  }

  async createPasswordReset(email: string, tokenHash: string, expiresAt: string): Promise<PasswordResetRequest | null> {
    const result = await this.pool.query<{
      id: string; user_id: string; email: string; expires_at: Date | string;
    }>(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       SELECT id, $2, $3 FROM users WHERE lower(email) = lower($1)
       RETURNING id, user_id,
         (SELECT user_account.email FROM users user_account WHERE user_account.id = password_reset_tokens.user_id) AS email,
         expires_at`,
      [email, tokenHash, expiresAt],
    );
    const row = result.rows[0];
    return row ? { id: row.id, userId: row.user_id, email: row.email, expiresAt: iso(row.expires_at) } : null;
  }

  async resetPassword(tokenHash: string, password: string): Promise<{ result: PasswordResetResult; userId?: string }> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const token = await client.query<{ id: string; user_id: string; expires_at: Date | string }>(
        "SELECT id, user_id, expires_at FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL FOR UPDATE",
        [tokenHash],
      );
      const row = token.rows[0];
      if (!row) { await client.query("ROLLBACK"); return { result: "invalid" }; }
      if (new Date(row.expires_at).getTime() <= Date.now()) {
        await client.query("UPDATE password_reset_tokens SET used_at = now() WHERE id = $1", [row.id]);
        await client.query("COMMIT");
        return { result: "expired" };
      }
      await client.query("UPDATE users SET password_hash = crypt($2, gen_salt('bf', 12)) WHERE id = $1", [row.user_id, password]);
      await client.query("UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [row.user_id]);
      await client.query("UPDATE sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1", [row.user_id]);
      await client.query("COMMIT");
      return { result: "reset", userId: row.user_id };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listUserProjects(userId: string): Promise<UserProject[]> {
    const result = await this.pool.query<{
      id: string;
      organization_id: string;
      organization_name: string;
      name: string;
      slug: string;
      role: OrganizationRole;
      environment_id: string | null;
      environment_name: string | null;
      environment_slug: string | null;
      environment_type: EnvironmentType | null;
      environment_created_at: Date | string | null;
    }>(
      `SELECT p.id, o.id AS organization_id, o.name AS organization_name,
              p.name, p.slug, m.role,
              e.id AS environment_id, e.name AS environment_name,
              e.slug AS environment_slug, e.environment_type,
              e.created_at AS environment_created_at
         FROM memberships m
         JOIN organizations o ON o.id = m.organization_id
         JOIN projects p ON p.organization_id = o.id
         LEFT JOIN environments e ON e.project_id = p.id
        WHERE m.user_id = $1
        ORDER BY o.name, p.name, e.name`,
      [userId],
    );
    const projects = new Map<string, UserProject>();
    for (const row of result.rows) {
      const project = projects.get(row.id) ?? {
        id: row.id,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        name: row.name,
        slug: row.slug,
        role: row.role,
        environments: [],
      };
      if (row.environment_id && row.environment_name && row.environment_slug && row.environment_type && row.environment_created_at) {
        project.environments.push({
          id: row.environment_id,
          projectId: row.id,
          name: row.environment_name,
          slug: row.environment_slug,
          environmentType: row.environment_type,
          createdAt: iso(row.environment_created_at),
        });
      }
      projects.set(row.id, project);
    }
    return [...projects.values()];
  }

  async getEnvironmentAccess(userId: string, environmentId: string): Promise<EnvironmentAccess | null> {
    const result = await this.pool.query<{
      organization_id: string;
      project_id: string;
      environment_id: string;
      role: OrganizationRole;
    }>(
      `SELECT o.id AS organization_id, p.id AS project_id, e.id AS environment_id, m.role
         FROM environments e
         JOIN projects p ON p.id = e.project_id
         JOIN organizations o ON o.id = p.organization_id
         JOIN memberships m ON m.organization_id = o.id AND m.user_id = $1
        WHERE e.id = $2
        LIMIT 1`,
      [userId, environmentId],
    );
    const row = result.rows[0];
    return row ? { userId, organizationId: row.organization_id, projectId: row.project_id, environmentId: row.environment_id, role: row.role } : null;
  }

  async createOrganization(userId: string, name: string, slug: string): Promise<OrganizationSummary> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{ id: string; name: string; slug: string; created_at: Date | string }>(
        "INSERT INTO organizations (name, slug) VALUES ($1, $2) RETURNING id, name, slug, created_at",
        [name, slug],
      );
      const row = result.rows[0]!;
      await client.query(
        "INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, 'owner')",
        [userId, row.id],
      );
      await client.query("COMMIT");
      return { id: row.id, name: row.name, slug: row.slug, role: "owner", createdAt: iso(row.created_at) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listOrganizations(userId: string): Promise<OrganizationSummary[]> {
    const result = await this.pool.query<{
      id: string;
      name: string;
      slug: string;
      role: OrganizationRole;
      created_at: Date | string;
    }>(
      `SELECT o.id, o.name, o.slug, m.role, o.created_at
         FROM memberships m JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = $1 ORDER BY o.name`,
      [userId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      role: row.role,
      createdAt: iso(row.created_at),
    }));
  }

  async createProject(userId: string, organizationId: string, name: string, slug: string): Promise<UserProject | null> {
    const result = await this.pool.query<{
      id: string;
      organization_id: string;
      organization_name: string;
      name: string;
      slug: string;
      role: OrganizationRole;
    }>(
      `INSERT INTO projects (organization_id, name, slug)
       SELECT m.organization_id, $3, $4
         FROM memberships m
        WHERE m.user_id = $1 AND m.organization_id = $2 AND m.role IN ('owner', 'admin')
       RETURNING id, organization_id,
         (SELECT name FROM organizations WHERE id = organization_id) AS organization_name,
         name, slug,
         (SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2) AS role`,
      [userId, organizationId, name, slug],
    );
    const row = result.rows[0];
    return row ? {
      id: row.id,
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      name: row.name,
      slug: row.slug,
      role: row.role,
      environments: [],
    } : null;
  }

  async createEnvironment(
    userId: string,
    projectId: string,
    name: string,
    slug: string,
    environmentType: EnvironmentType,
  ): Promise<EnvironmentSummary | null> {
    const result = await this.pool.query<EnvironmentRow>(
      `INSERT INTO environments (project_id, name, slug, environment_type)
       SELECT p.id, $3, $4, $5
         FROM projects p
         JOIN memberships m ON m.organization_id = p.organization_id
        WHERE m.user_id = $1 AND p.id = $2 AND m.role IN ('owner', 'admin')
       RETURNING id, project_id, name, slug, environment_type, created_at`,
      [userId, projectId, name, slug, environmentType],
    );
    return result.rows[0] ? environmentFromRow(result.rows[0]) : null;
  }

  async listEnvironments(userId: string, projectId: string): Promise<EnvironmentSummary[] | null> {
    const access = await this.pool.query(
      `SELECT 1 FROM projects p JOIN memberships m ON m.organization_id = p.organization_id
        WHERE m.user_id = $1 AND p.id = $2 LIMIT 1`,
      [userId, projectId],
    );
    if (access.rowCount !== 1) return null;
    const result = await this.pool.query<EnvironmentRow>(
      `SELECT id, project_id, name, slug, environment_type, created_at
         FROM environments WHERE project_id = $1 ORDER BY name`,
      [projectId],
    );
    return result.rows.map(environmentFromRow);
  }

  async createApiKey(
    userId: string,
    environmentId: string,
    name: string,
    keyPrefix: string,
    keyHash: string,
    expiresAt: string | null,
  ): Promise<ApiKeySummary | null> {
    const result = await this.pool.query<ApiKeyRow>(
      `INSERT INTO api_keys (environment_id, name, key_prefix, key_hash, expires_at)
       SELECT e.id, $3, $4, $5, $6
         FROM environments e
         JOIN projects p ON p.id = e.project_id
         JOIN memberships m ON m.organization_id = p.organization_id
        WHERE m.user_id = $1 AND e.id = $2 AND m.role IN ('owner', 'admin', 'developer')
       RETURNING id, environment_id, name, key_prefix, created_at, last_used_at, expires_at, revoked_at`,
      [userId, environmentId, name, keyPrefix, keyHash, expiresAt],
    );
    return result.rows[0] ? apiKeyFromRow(result.rows[0]) : null;
  }

  async listApiKeys(userId: string, environmentId: string): Promise<ApiKeySummary[] | null> {
    const access = await this.getEnvironmentAccess(userId, environmentId);
    if (!access || access.role === "viewer") return null;
    const result = await this.pool.query<ApiKeyRow>(
      `SELECT id, environment_id, name, key_prefix, created_at, last_used_at, expires_at, revoked_at
         FROM api_keys WHERE environment_id = $1 AND NOT is_internal ORDER BY created_at DESC`,
      [environmentId],
    );
    return result.rows.map(apiKeyFromRow);
  }

  async revokeApiKey(userId: string, environmentId: string, apiKeyId: string): Promise<boolean | null> {
    const access = await this.getEnvironmentAccess(userId, environmentId);
    if (!access) return null;
    if (access.role === "viewer") return false;
    const result = await this.pool.query(
      `UPDATE api_keys SET revoked_at = COALESCE(revoked_at, now())
        WHERE id = $1 AND environment_id = $2`,
      [apiKeyId, environmentId],
    );
    return result.rowCount === 1;
  }

  async listMembers(userId: string, organizationId: string): Promise<TeamMember[] | null> {
    const access = await this.pool.query(
      "SELECT 1 FROM memberships WHERE user_id = $1 AND organization_id = $2",
      [userId, organizationId],
    );
    if (access.rowCount !== 1) return null;
    const result = await this.pool.query<{
      user_id: string; email: string; name: string | null; role: OrganizationRole; created_at: Date | string;
    }>(
      `SELECT u.id AS user_id, u.email, u.name, m.role, m.created_at
         FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = $1
        ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'developer' THEN 3 ELSE 4 END, u.email`,
      [organizationId],
    );
    return result.rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      name: row.name,
      role: row.role,
      joinedAt: iso(row.created_at),
    }));
  }

  async updateMemberRole(
    userId: string,
    organizationId: string,
    memberId: string,
    role: OrganizationRole,
  ): Promise<"updated" | "forbidden" | "not_found" | "last_owner"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const requester = await client.query<{ role: OrganizationRole }>(
        "SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2 FOR UPDATE",
        [userId, organizationId],
      );
      if (requester.rows[0]?.role !== "owner") {
        await client.query("ROLLBACK");
        return "forbidden";
      }
      const target = await client.query<{ role: OrganizationRole }>(
        "SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2 FOR UPDATE",
        [memberId, organizationId],
      );
      if (!target.rows[0]) {
        await client.query("ROLLBACK");
        return "not_found";
      }
      if (target.rows[0].role === "owner" && role !== "owner") {
        const owners = await client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM memberships WHERE organization_id = $1 AND role = 'owner'",
          [organizationId],
        );
        if (Number(owners.rows[0]?.count) <= 1) {
          await client.query("ROLLBACK");
          return "last_owner";
        }
      }
      await client.query(
        "UPDATE memberships SET role = $3 WHERE user_id = $1 AND organization_id = $2",
        [memberId, organizationId, role],
      );
      await client.query("COMMIT");
      return "updated";
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async removeMember(
    userId: string,
    organizationId: string,
    memberId: string,
  ): Promise<"removed" | "forbidden" | "not_found" | "last_owner"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const roles = await client.query<{ user_id: string; role: OrganizationRole }>(
        `SELECT user_id, role FROM memberships
          WHERE organization_id = $1 AND user_id IN ($2, $3) FOR UPDATE`,
        [organizationId, userId, memberId],
      );
      const requester = roles.rows.find((row) => row.user_id === userId);
      const target = roles.rows.find((row) => row.user_id === memberId);
      if (!requester || !["owner", "admin"].includes(requester.role)) {
        await client.query("ROLLBACK");
        return "forbidden";
      }
      if (!target) {
        await client.query("ROLLBACK");
        return "not_found";
      }
      if (requester.role === "admin" && ["owner", "admin"].includes(target.role)) {
        await client.query("ROLLBACK");
        return "forbidden";
      }
      if (target.role === "owner") {
        const owners = await client.query<{ count: string }>(
          "SELECT count(*)::text AS count FROM memberships WHERE organization_id = $1 AND role = 'owner'",
          [organizationId],
        );
        if (Number(owners.rows[0]?.count) <= 1) {
          await client.query("ROLLBACK");
          return "last_owner";
        }
      }
      await client.query("DELETE FROM memberships WHERE user_id = $1 AND organization_id = $2", [memberId, organizationId]);
      await client.query("COMMIT");
      return "removed";
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async createInvitation(
    userId: string,
    organizationId: string,
    email: string,
    role: Exclude<OrganizationRole, "owner">,
    tokenHash: string,
    expiresAt: string,
  ): Promise<InvitationSummary | null> {
    const result = await this.pool.query<InvitationRow>(
      `INSERT INTO invitations (organization_id, email, role, token_hash, invited_by, expires_at)
       SELECT m.organization_id, lower($3), $4, $5, $1, $6
         FROM memberships m
        WHERE m.user_id = $1 AND m.organization_id = $2 AND m.role IN ('owner', 'admin')
       RETURNING id, organization_id,
         (SELECT name FROM organizations WHERE id = organization_id) AS organization_name,
         email, role, expires_at, accepted_at, revoked_at, created_at`,
      [userId, organizationId, email, role, tokenHash, expiresAt],
    );
    return result.rows[0] ? invitationFromRow(result.rows[0]) : null;
  }

  async listInvitations(userId: string, organizationId: string): Promise<InvitationSummary[] | null> {
    const access = await this.pool.query<{ role: OrganizationRole }>(
      "SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2",
      [userId, organizationId],
    );
    if (!access.rows[0] || !["owner", "admin"].includes(access.rows[0].role)) return null;
    const result = await this.pool.query<InvitationRow>(
      `SELECT ${INVITATION_SELECT} FROM invitations i
       JOIN organizations o ON o.id = i.organization_id
       WHERE i.organization_id = $1 ORDER BY i.created_at DESC`,
      [organizationId],
    );
    return result.rows.map(invitationFromRow);
  }

  async getInvitation(tokenHash: string): Promise<InvitationSummary | null> {
    const result = await this.pool.query<InvitationRow>(
      `SELECT ${INVITATION_SELECT} FROM invitations i
       JOIN organizations o ON o.id = i.organization_id
       WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL LIMIT 1`,
      [tokenHash],
    );
    return result.rows[0] ? invitationFromRow(result.rows[0]) : null;
  }

  async acceptInvitation(userId: string, email: string, tokenHash: string): Promise<InvitationAcceptResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<{
        id: string; organization_id: string; email: string; role: OrganizationRole; expires_at: Date | string;
      }>(
        `SELECT id, organization_id, email, role, expires_at FROM invitations
          WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL FOR UPDATE`,
        [tokenHash],
      );
      const invitation = result.rows[0];
      if (!invitation) {
        await client.query("ROLLBACK");
        return "invalid";
      }
      if (Date.parse(String(invitation.expires_at)) <= Date.now()) {
        await client.query("ROLLBACK");
        return "expired";
      }
      if (invitation.email.toLowerCase() !== email.toLowerCase()) {
        await client.query("ROLLBACK");
        return "email_mismatch";
      }
      await client.query(
        `INSERT INTO memberships (user_id, organization_id, role) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, organization_id) DO NOTHING`,
        [userId, invitation.organization_id, invitation.role],
      );
      await client.query("UPDATE invitations SET accepted_at = now() WHERE id = $1", [invitation.id]);
      await client.query("COMMIT");
      return "accepted";
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async revokeInvitation(userId: string, organizationId: string, invitationId: string): Promise<boolean | null> {
    const access = await this.pool.query<{ role: OrganizationRole }>(
      "SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2",
      [userId, organizationId],
    );
    if (!access.rows[0]) return null;
    if (!["owner", "admin"].includes(access.rows[0].role)) return false;
    const result = await this.pool.query(
      `UPDATE invitations SET revoked_at = COALESCE(revoked_at, now())
        WHERE id = $1 AND organization_id = $2 AND accepted_at IS NULL`,
      [invitationId, organizationId],
    );
    return result.rowCount === 1;
  }

  async getOnboarding(userId: string, organizationId: string): Promise<OnboardingProgress | null> {
    const result = await this.pool.query<{ organization_id: string; completed_steps: string[]; updated_at: Date | string }>(
      `INSERT INTO onboarding_progress (user_id, organization_id)
       SELECT $1, $2 FROM memberships WHERE user_id = $1 AND organization_id = $2
       ON CONFLICT (user_id, organization_id) DO UPDATE SET user_id = EXCLUDED.user_id
       RETURNING organization_id, completed_steps, updated_at`,
      [userId, organizationId],
    );
    const row = result.rows[0];
    return row ? { organizationId: row.organization_id, completedSteps: row.completed_steps, updatedAt: iso(row.updated_at) } : null;
  }

  async completeOnboardingStep(userId: string, organizationId: string, step: string): Promise<OnboardingProgress | null> {
    const access = await this.getOnboarding(userId, organizationId);
    if (!access) return null;
    const result = await this.pool.query<{ organization_id: string; completed_steps: string[]; updated_at: Date | string }>(
      `UPDATE onboarding_progress
          SET completed_steps = CASE WHEN $3 = ANY(completed_steps) THEN completed_steps ELSE array_append(completed_steps, $3) END,
              updated_at = now()
        WHERE user_id = $1 AND organization_id = $2
        RETURNING organization_id, completed_steps, updated_at`,
      [userId, organizationId, step],
    );
    const row = result.rows[0]!;
    return { organizationId: row.organization_id, completedSteps: row.completed_steps, updatedAt: iso(row.updated_at) };
  }

  async recordAudit(input: AuditInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_logs (
        organization_id, actor_user_id, ip_address, user_agent,
        action, target_type, target_id, result, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        input.organizationId,
        input.actorUserId,
        input.ipAddress,
        input.userAgent,
        input.action,
        input.targetType,
        input.targetId,
        input.result,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  }

  async listAuditLogs(userId: string, organizationId: string, limit: number): Promise<AuditRecord[] | null> {
    const access = await this.pool.query<{ role: OrganizationRole }>(
      "SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2",
      [userId, organizationId],
    );
    if (!access.rows[0] || !["owner", "admin"].includes(access.rows[0].role)) return null;
    const result = await this.pool.query<AuditRow>(
      `SELECT id, organization_id, actor_user_id, host(ip_address) AS ip_address,
              user_agent, action, target_type, target_id, result, metadata, created_at
         FROM audit_logs WHERE organization_id = $1
        ORDER BY created_at DESC LIMIT $2`,
      [organizationId, limit],
    );
    return result.rows.map(auditFromRow);
  }

  async getSecurityPolicy(environmentId: string): Promise<SecurityPolicy> {
    const result = await this.pool.query<{
      retention_days: SecurityPolicy["retentionDays"];
      redact_emails: boolean;
      redact_phone_numbers: boolean;
      custom_redact_fields: string[];
      ip_allowlist_enabled: boolean;
      allowed_networks: string[];
    }>(
      `SELECT organization_settings.retention_days, organization_settings.redact_emails,
              organization_settings.redact_phone_numbers, organization_settings.custom_redact_fields,
              environment_settings.ip_allowlist_enabled,
              environment_settings.allowed_networks::text[] AS allowed_networks
         FROM environments environment
         JOIN projects project ON project.id = environment.project_id
         JOIN organization_security_settings organization_settings
           ON organization_settings.organization_id = project.organization_id
         JOIN environment_security_settings environment_settings
           ON environment_settings.environment_id = environment.id
        WHERE environment.id = $1`,
      [environmentId],
    );
    const row = result.rows[0];
    if (!row) throw new Error("environment security policy is missing");
    return {
      retentionDays: row.retention_days,
      redactEmails: row.redact_emails,
      redactPhoneNumbers: row.redact_phone_numbers,
      customRedactFields: row.custom_redact_fields,
      ipAllowlistEnabled: row.ip_allowlist_enabled,
      allowedNetworks: row.allowed_networks,
    };
  }

  async updateOrganizationSecurity(
    userId: string,
    organizationId: string,
    settings: Pick<SecurityPolicy, "retentionDays" | "redactEmails" | "redactPhoneNumbers" | "customRedactFields">,
  ): Promise<SecurityPolicy | null> {
    const result = await this.pool.query<{ environment_id: string }>(
      `UPDATE organization_security_settings security
          SET retention_days = $3, redact_emails = $4, redact_phone_numbers = $5,
              custom_redact_fields = $6, updated_by = $1, updated_at = now()
         FROM memberships membership
        WHERE membership.user_id = $1 AND membership.organization_id = $2
          AND membership.role IN ('owner', 'admin')
          AND security.organization_id = membership.organization_id
        RETURNING (
          SELECT environment.id FROM environments environment
          JOIN projects project ON project.id = environment.project_id
          WHERE project.organization_id = $2 LIMIT 1
        ) AS environment_id`,
      [userId, organizationId, settings.retentionDays, settings.redactEmails, settings.redactPhoneNumbers, settings.customRedactFields],
    );
    const environmentId = result.rows[0]?.environment_id;
    return environmentId ? this.getSecurityPolicy(environmentId) : null;
  }

  async updateEnvironmentAllowlist(
    userId: string,
    environmentId: string,
    enabled: boolean,
    networks: string[],
  ): Promise<SecurityPolicy | null> {
    const result = await this.pool.query<{ environment_id: string }>(
      `UPDATE environment_security_settings security
          SET ip_allowlist_enabled = $3, allowed_networks = $4::cidr[],
              updated_by = $1, updated_at = now()
         FROM environments environment
         JOIN projects project ON project.id = environment.project_id
         JOIN memberships membership ON membership.organization_id = project.organization_id
         JOIN organization_subscriptions subscription ON subscription.organization_id = project.organization_id
         JOIN subscription_plans plan ON plan.plan_key = subscription.plan_key
        WHERE membership.user_id = $1 AND environment.id = $2
          AND membership.role IN ('owner', 'admin')
          AND security.environment_id = environment.id
          AND COALESCE((plan.features->>'ipAllowlists')::boolean, false)
        RETURNING security.environment_id`,
      [userId, environmentId, enabled, networks],
    );
    return result.rows[0] ? this.getSecurityPolicy(result.rows[0].environment_id) : null;
  }

  async authorizeIngestion(
    auth: AuthenticatedKey,
    ipAddress: string,
    requestBytes: number,
    eventCount: number,
  ): Promise<IngestionAuthorization> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const subscriptionResult = await client.query<{
        status: string;
        monthly_event_limit: string;
        monthly_request_limit: string;
        monthly_bandwidth_bytes: string;
        storage_limit_bytes: string;
        organization_rate_per_minute: number;
        environment_rate_per_minute: number;
        api_key_rate_per_minute: number;
        burst_multiplier: string;
      }>(
        `SELECT subscription.status,
                COALESCE((subscription.custom_limits->>'monthlyEventLimit')::bigint, plan.monthly_event_limit)::text AS monthly_event_limit,
                COALESCE((subscription.custom_limits->>'monthlyRequestLimit')::bigint, plan.monthly_request_limit)::text AS monthly_request_limit,
                COALESCE((subscription.custom_limits->>'monthlyBandwidthBytes')::bigint, plan.monthly_bandwidth_bytes)::text AS monthly_bandwidth_bytes,
                COALESCE((subscription.custom_limits->>'storageLimitBytes')::bigint, plan.storage_limit_bytes)::text AS storage_limit_bytes,
                COALESCE((subscription.custom_limits->>'organizationRatePerMinute')::integer, plan.organization_rate_per_minute) AS organization_rate_per_minute,
                COALESCE((subscription.custom_limits->>'environmentRatePerMinute')::integer, plan.environment_rate_per_minute) AS environment_rate_per_minute,
                COALESCE((subscription.custom_limits->>'apiKeyRatePerMinute')::integer, plan.api_key_rate_per_minute) AS api_key_rate_per_minute,
                COALESCE((subscription.custom_limits->>'burstMultiplier')::numeric, plan.burst_multiplier)::text AS burst_multiplier
           FROM organization_subscriptions subscription
           JOIN subscription_plans plan ON plan.plan_key = subscription.plan_key
          WHERE subscription.organization_id = $1 FOR UPDATE OF subscription`,
        [auth.organizationId],
      );
      const limits = subscriptionResult.rows[0];
      if (!limits) throw new Error("organization subscription is missing");

      await client.query(
        `INSERT INTO usage_monthly (organization_id, month_start, ingestion_requests, bandwidth_bytes)
         VALUES ($1, date_trunc('month', now())::date, 1, $2)
         ON CONFLICT (organization_id, month_start) DO UPDATE
           SET ingestion_requests = usage_monthly.ingestion_requests + 1,
               bandwidth_bytes = usage_monthly.bandwidth_bytes + EXCLUDED.bandwidth_bytes,
               updated_at = now()`,
        [auth.organizationId, requestBytes],
      );
      const usageResult = await client.query<{
        ingestion_requests: string; events_ingested: string; bandwidth_bytes: string; storage_bytes: string;
      }>(
        `SELECT usage.ingestion_requests::text, usage.events_ingested::text,
                usage.bandwidth_bytes::text, COALESCE(storage.storage_bytes, 0)::text AS storage_bytes
           FROM usage_monthly usage
           LEFT JOIN organization_storage storage ON storage.organization_id = usage.organization_id
          WHERE usage.organization_id = $1 AND usage.month_start = date_trunc('month', now())::date
          FOR UPDATE OF usage`,
        [auth.organizationId],
      );
      const usage = usageResult.rows[0]!;
      const denyQuota = async (reason: IngestionAuthorization["reason"]): Promise<IngestionAuthorization> => {
        await client.query(
          `UPDATE usage_monthly SET quota_rejected_requests = quota_rejected_requests + 1, updated_at = now()
            WHERE organization_id = $1 AND month_start = date_trunc('month', now())::date`,
          [auth.organizationId],
        );
        await client.query("COMMIT");
        const secondsToNextMonth = Math.max(1, Math.ceil((Date.parse(new Date(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1).toISOString()) - Date.now()) / 1000));
        return { allowed: false, reason, retryAfterSeconds: secondsToNextMonth };
      };
      if (limits.status !== "active" && limits.status !== "trialing") return await denyQuota("subscription_inactive");

      const allowlist = await client.query<{ allowed: boolean; enabled: boolean }>(
        `SELECT settings.ip_allowlist_enabled AS enabled,
                NOT settings.ip_allowlist_enabled OR $2::inet <<= ANY(settings.allowed_networks) AS allowed
           FROM environment_security_settings settings WHERE settings.environment_id = $1`,
        [auth.environmentId, ipAddress],
      );
      if (allowlist.rows[0]?.enabled && !allowlist.rows[0].allowed) {
        await client.query("COMMIT");
        return { allowed: false, reason: "ip_allowlist" };
      }
      if (Number(usage.ingestion_requests) > Number(limits.monthly_request_limit)) return await denyQuota("request_quota");
      if (Number(usage.bandwidth_bytes) > Number(limits.monthly_bandwidth_bytes)) return await denyQuota("bandwidth_quota");
      if (eventCount > 0 && Number(usage.storage_bytes) + requestBytes > Number(limits.storage_limit_bytes)) {
        return await denyQuota("storage_quota");
      }
      if (Number(usage.events_ingested) + eventCount > Number(limits.monthly_event_limit)) return await denyQuota("event_quota");

      const scopes: Array<{ type: "organization" | "environment" | "api_key"; id: string; rate: number }> = [
        { type: "organization", id: auth.organizationId, rate: limits.organization_rate_per_minute },
        { type: "environment", id: auth.environmentId, rate: limits.environment_rate_per_minute },
        { type: "api_key", id: auth.id, rate: limits.api_key_rate_per_minute },
      ];
      for (const scope of scopes) {
        const bucket = await client.query<{ tokens: number; updated_at: Date | string }>(
          "SELECT tokens, updated_at FROM rate_limit_buckets WHERE scope_type = $1 AND scope_id = $2 FOR UPDATE",
          [scope.type, scope.id],
        );
        const capacity = scope.rate * Number(limits.burst_multiplier);
        const elapsedSeconds = bucket.rows[0] ? Math.max(0, (Date.now() - Date.parse(String(bucket.rows[0].updated_at))) / 1000) : 0;
        const available = bucket.rows[0] ? Math.min(capacity, bucket.rows[0].tokens + elapsedSeconds * scope.rate / 60) : capacity;
        if (available < 1) {
          await client.query(
            `UPDATE usage_monthly SET rate_limited_requests = rate_limited_requests + 1, updated_at = now()
              WHERE organization_id = $1 AND month_start = date_trunc('month', now())::date`,
            [auth.organizationId],
          );
          await client.query("COMMIT");
          return { allowed: false, reason: "rate_limit", scope: scope.type, retryAfterSeconds: Math.max(1, Math.ceil((1 - available) / (scope.rate / 60))) };
        }
        await client.query(
          `INSERT INTO rate_limit_buckets (scope_type, scope_id, tokens, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (scope_type, scope_id) DO UPDATE SET tokens = EXCLUDED.tokens, updated_at = now()`,
          [scope.type, scope.id, available - 1],
        );
      }
      await client.query(
        `UPDATE usage_monthly SET events_ingested = events_ingested + $2, updated_at = now()
          WHERE organization_id = $1 AND month_start = date_trunc('month', now())::date`,
        [auth.organizationId, eventCount],
      );
      await client.query("COMMIT");
      return { allowed: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordStoredUsage(auth: AuthenticatedKey, eventsStored: number, storageBytes: number): Promise<void> {
    await this.pool.query(
      `UPDATE usage_monthly
          SET events_stored = events_stored + $2, storage_bytes = storage_bytes + $3, updated_at = now()
        WHERE organization_id = $1 AND month_start = date_trunc('month', now())::date`,
      [auth.organizationId, eventsStored, storageBytes],
    );
  }

  async getUsage(userId: string, organizationId: string): Promise<UsageSummary | null> {
    const result = await this.pool.query<{
      plan_key: UsageSummary["plan"]["key"]; display_name: string; status: string;
      monthly_event_limit: string; monthly_request_limit: string; monthly_bandwidth_bytes: string; storage_limit_bytes: string;
      features: Record<string, unknown>; ingestion_requests: string; events_ingested: string; events_stored: string;
      bandwidth_bytes: string; storage_bytes: string; rate_limited_requests: string; quota_rejected_requests: string;
      active_services: string; active_environments: string; active_api_keys: string;
    }>(
      `SELECT plan.plan_key, plan.display_name, subscription.status,
              COALESCE((subscription.custom_limits->>'monthlyEventLimit')::bigint, plan.monthly_event_limit)::text AS monthly_event_limit,
              COALESCE((subscription.custom_limits->>'monthlyRequestLimit')::bigint, plan.monthly_request_limit)::text AS monthly_request_limit,
              COALESCE((subscription.custom_limits->>'monthlyBandwidthBytes')::bigint, plan.monthly_bandwidth_bytes)::text AS monthly_bandwidth_bytes,
              COALESCE((subscription.custom_limits->>'storageLimitBytes')::bigint, plan.storage_limit_bytes)::text AS storage_limit_bytes,
              plan.features,
              COALESCE(usage.ingestion_requests, 0)::text AS ingestion_requests,
              COALESCE(usage.events_ingested, 0)::text AS events_ingested,
              COALESCE(usage.events_stored, 0)::text AS events_stored,
              COALESCE(usage.bandwidth_bytes, 0)::text AS bandwidth_bytes,
              COALESCE(storage.storage_bytes, 0)::text AS storage_bytes,
              COALESCE(usage.rate_limited_requests, 0)::text AS rate_limited_requests,
              COALESCE(usage.quota_rejected_requests, 0)::text AS quota_rejected_requests,
              (SELECT count(DISTINCT event.source) FROM events event
                JOIN environments environment ON environment.id = event.environment_id
                JOIN projects project ON project.id = environment.project_id
               WHERE project.organization_id = $2 AND event.received_at >= date_trunc('month', now()))::text AS active_services,
              (SELECT count(*) FROM environments environment JOIN projects project ON project.id = environment.project_id
               WHERE project.organization_id = $2)::text AS active_environments,
              (SELECT count(*) FROM api_keys key JOIN environments environment ON environment.id = key.environment_id
                JOIN projects project ON project.id = environment.project_id
               WHERE project.organization_id = $2 AND key.revoked_at IS NULL)::text AS active_api_keys
         FROM memberships membership
         JOIN organization_subscriptions subscription ON subscription.organization_id = membership.organization_id
         JOIN subscription_plans plan ON plan.plan_key = subscription.plan_key
         LEFT JOIN usage_monthly usage ON usage.organization_id = membership.organization_id
           AND usage.month_start = date_trunc('month', now())::date
         LEFT JOIN organization_storage storage ON storage.organization_id = membership.organization_id
        WHERE membership.user_id = $1 AND membership.organization_id = $2`,
      [userId, organizationId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      monthStart: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10),
      plan: {
        key: row.plan_key, name: row.display_name, status: row.status,
        limits: { events: Number(row.monthly_event_limit), requests: Number(row.monthly_request_limit), bandwidthBytes: Number(row.monthly_bandwidth_bytes), storageBytes: Number(row.storage_limit_bytes) },
        features: row.features,
      },
      usage: {
        ingestionRequests: Number(row.ingestion_requests), eventsIngested: Number(row.events_ingested),
        eventsStored: Number(row.events_stored), bandwidthBytes: Number(row.bandwidth_bytes), storageBytes: Number(row.storage_bytes),
        rateLimitedRequests: Number(row.rate_limited_requests), quotaRejectedRequests: Number(row.quota_rejected_requests),
        activeServices: Number(row.active_services), activeEnvironments: Number(row.active_environments), activeApiKeys: Number(row.active_api_keys),
      },
    };
  }

  async listPlans(): Promise<UsageSummary["plan"][]> {
    const result = await this.pool.query<{
      plan_key: UsageSummary["plan"]["key"]; display_name: string; monthly_event_limit: string;
      monthly_request_limit: string; monthly_bandwidth_bytes: string; storage_limit_bytes: string; features: Record<string, unknown>;
    }>("SELECT plan_key, display_name, monthly_event_limit::text, monthly_request_limit::text, monthly_bandwidth_bytes::text, storage_limit_bytes::text, features FROM subscription_plans ORDER BY monthly_event_limit");
    return result.rows.map((row) => ({
      key: row.plan_key, name: row.display_name, status: "available",
      limits: { events: Number(row.monthly_event_limit), requests: Number(row.monthly_request_limit), bandwidthBytes: Number(row.monthly_bandwidth_bytes), storageBytes: Number(row.storage_limit_bytes) },
      features: row.features,
    }));
  }

  async deleteExpiredEvents(): Promise<{ deleted: number; organizations: number }> {
    const result = await this.pool.query<{ organization_id: string }>(
      `DELETE FROM events event USING environments environment, projects project, organization_security_settings settings
        WHERE event.environment_id = environment.id AND environment.project_id = project.id
          AND settings.organization_id = project.organization_id
          AND event.received_at < now() - make_interval(days => settings.retention_days)
        RETURNING project.organization_id`,
    );
    return { deleted: result.rowCount ?? 0, organizations: new Set(result.rows.map((row) => row.organization_id)).size };
  }

  async getPublicStatus(): Promise<PublicStatus> {
    await this.checkReady();
    const incidents = await this.pool.query<{
      id: string; title: string; severity: string; status: string; message: string;
      started_at: Date | string; resolved_at: Date | string | null;
    }>("SELECT id, title, severity, status, message, started_at, resolved_at FROM status_incidents ORDER BY started_at DESC LIMIT 20");
    const maintenance = await this.pool.query<{
      id: string; title: string; message: string; starts_at: Date | string; ends_at: Date | string;
    }>("SELECT id, title, message, starts_at, ends_at FROM maintenance_windows WHERE ends_at >= now() - interval '30 days' ORDER BY starts_at DESC LIMIT 20");
    const active = incidents.rows.some((item) => item.status !== "resolved");
    return {
      status: active ? "degraded" : "operational",
      checkedAt: new Date().toISOString(),
      components: ["API", "Ingestion", "Dashboard"].map((name) => ({ name, status: active ? "degraded" as const : "operational" as const })),
      incidents: incidents.rows.map((item) => ({
        id: item.id, title: item.title, severity: item.severity, status: item.status,
        message: item.message, startedAt: iso(item.started_at), resolvedAt: nullableIso(item.resolved_at),
      })),
      maintenance: maintenance.rows.map((item) => ({
        id: item.id, title: item.title, message: item.message, startsAt: iso(item.starts_at), endsAt: iso(item.ends_at),
      })),
    };
  }

  async exportOrganization(userId: string, organizationId: string, eventLimit: number): Promise<OrganizationExport | null> {
    const access = await this.pool.query<{ role: OrganizationRole }>(
      "SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2",
      [userId, organizationId],
    );
    if (!access.rows[0] || !["owner", "admin"].includes(access.rows[0].role)) return null;
    const [organization, projects, environments, keys, telemetry, total, audits] = await Promise.all([
      this.pool.query<Record<string, unknown>>(
        "SELECT id, name, slug, created_at, updated_at FROM organizations WHERE id = $1", [organizationId],
      ),
      this.pool.query<Record<string, unknown>>(
        "SELECT id, organization_id, name, slug, created_at, updated_at FROM projects WHERE organization_id = $1 ORDER BY created_at", [organizationId],
      ),
      this.pool.query<Record<string, unknown>>(
        `SELECT environment.id, environment.project_id, environment.name, environment.slug,
                environment.environment_type, environment.created_at, environment.updated_at
           FROM environments environment JOIN projects project ON project.id = environment.project_id
          WHERE project.organization_id = $1 ORDER BY environment.created_at`, [organizationId],
      ),
      this.pool.query<Record<string, unknown>>(
        `SELECT key.id, key.environment_id, key.name, key.key_prefix, key.last_used_at,
                key.expires_at, key.revoked_at, key.created_at
           FROM api_keys key JOIN environments environment ON environment.id = key.environment_id
           JOIN projects project ON project.id = environment.project_id
          WHERE project.organization_id = $1 AND NOT key.is_internal ORDER BY key.created_at`, [organizationId],
      ),
      this.pool.query<EventRow>(
        `SELECT ${EVENT_SELECT} FROM events
         WHERE environment_id IN (
           SELECT environment.id FROM environments environment
           JOIN projects project ON project.id = environment.project_id
           WHERE project.organization_id = $1
         ) ORDER BY received_at LIMIT $2`, [organizationId, eventLimit],
      ),
      this.pool.query<{ total: string }>(
        `SELECT count(*)::text AS total FROM events event
         JOIN environments environment ON environment.id = event.environment_id
         JOIN projects project ON project.id = environment.project_id
         WHERE project.organization_id = $1`, [organizationId],
      ),
      this.pool.query<AuditRow>(
        `SELECT id, organization_id, actor_user_id, host(ip_address) AS ip_address,
                user_agent, action, target_type, target_id, result, metadata, created_at
           FROM audit_logs WHERE organization_id = $1 ORDER BY created_at LIMIT 5000`, [organizationId],
      ),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      organization: organization.rows[0] ?? {},
      projects: projects.rows,
      environments: environments.rows,
      apiKeys: keys.rows,
      telemetry: telemetry.rows.map(eventFromRow),
      auditLogs: audits.rows.map(auditFromRow),
      truncated: Number(total.rows[0]?.total ?? 0) > eventLimit,
    };
  }

  async deleteProject(userId: string, projectId: string): Promise<boolean | null> {
    const access = await this.pool.query<{ role: OrganizationRole }>(
      `SELECT membership.role FROM projects project
       JOIN memberships membership ON membership.organization_id = project.organization_id
       WHERE membership.user_id = $1 AND project.id = $2`, [userId, projectId],
    );
    if (!access.rows[0]) return null;
    if (!["owner", "admin"].includes(access.rows[0].role)) return false;
    const result = await this.pool.query("DELETE FROM projects WHERE id = $1", [projectId]);
    return result.rowCount === 1;
  }

  async deleteEnvironment(userId: string, environmentId: string): Promise<boolean | null> {
    const access = await this.getEnvironmentAccess(userId, environmentId);
    if (!access) return null;
    if (!["owner", "admin"].includes(access.role)) return false;
    const result = await this.pool.query("DELETE FROM environments WHERE id = $1", [environmentId]);
    return result.rowCount === 1;
  }

  async deleteOrganization(userId: string, organizationId: string): Promise<boolean | null> {
    const access = await this.pool.query<{ role: OrganizationRole }>(
      "SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2", [userId, organizationId],
    );
    if (!access.rows[0]) return null;
    if (access.rows[0].role !== "owner") return false;
    const result = await this.pool.query("DELETE FROM organizations WHERE id = $1", [organizationId]);
    return result.rowCount === 1;
  }

  async deleteUser(userId: string): Promise<boolean> {
    const result = await this.pool.query(
      `DELETE FROM users target
        WHERE target.id = $1
          AND NOT target.is_demo
          AND NOT EXISTS (
            SELECT 1 FROM memberships owned
            WHERE owned.user_id = target.id AND owned.role = 'owner'
              AND NOT EXISTS (
                SELECT 1 FROM memberships replacement
                WHERE replacement.organization_id = owned.organization_id
                  AND replacement.user_id <> target.id AND replacement.role = 'owner'
              )
          )`,
      [userId],
    );
    return result.rowCount === 1;
  }

  async deleteOrganizationTelemetry(userId: string, organizationId: string): Promise<number | null> {
    const access = await this.pool.query<{ role: OrganizationRole }>(
      "SELECT role FROM memberships WHERE user_id = $1 AND organization_id = $2", [userId, organizationId],
    );
    if (!access.rows[0] || !["owner", "admin"].includes(access.rows[0].role)) return null;
    const result = await this.pool.query(
      `DELETE FROM events event USING environments environment, projects project
        WHERE event.environment_id = environment.id AND environment.project_id = project.id
          AND project.organization_id = $1`, [organizationId],
    );
    return result.rowCount ?? 0;
  }

  async listEvents(environmentId: string, filters: EventFilters): Promise<EventPage> {
    const values: unknown[] = [environmentId];
    const clauses = ["environment_id = $1"];
    const add = (sql: string, value: unknown): void => {
      values.push(value);
      clauses.push(sql.replace("?", `$${values.length}`));
    };
    if (filters.type) add("type = ?", filters.type);
    if (filters.status) add("status = ?", filters.status);
    if (filters.source) add("source = ?", filters.source);
    if (filters.traceId) add("trace_id = ?", filters.traceId);
    if (filters.queueName) add("queue_name = ?", filters.queueName);
    if (filters.from) add("occurred_at >= ?", filters.from);
    if (filters.to) add("occurred_at <= ?", filters.to);
    if (filters.search) {
      values.push(`%${filters.search}%`);
      const position = values.length;
      clauses.push(`(source ILIKE $${position} OR COALESCE(http_route, '') ILIKE $${position} OR COALESCE(job_name, '') ILIKE $${position} OR COALESCE(error_message, '') ILIKE $${position})`);
    }
    const where = clauses.join(" AND ");
    const count = await this.pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM events WHERE ${where}`,
      values,
    );
    values.push(filters.limit, (filters.page - 1) * filters.limit);
    const rows = await this.pool.query<EventRow>(
      `SELECT ${EVENT_SELECT} FROM events WHERE ${where}
        ORDER BY occurred_at DESC, received_at DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values,
    );
    const total = Number(count.rows[0]?.total ?? 0);
    return { items: rows.rows.map(eventFromRow), page: filters.page, limit: filters.limit, total, pages: Math.max(1, Math.ceil(total / filters.limit)) };
  }

  async getTrace(environmentId: string, traceId: string): Promise<DashboardEvent[]> {
    const result = await this.pool.query<EventRow>(
      `SELECT ${EVENT_SELECT} FROM events
        WHERE environment_id = $1 AND trace_id = $2
        ORDER BY occurred_at, received_at`,
      [environmentId, traceId],
    );
    return orderTraceByParent(result.rows.map(eventFromRow));
  }

  async getOverview(environmentId: string, range: OverviewMetrics["range"]): Promise<OverviewMetrics> {
    const interval = { "24h": "24 hours", "7d": "7 days", "30d": "30 days" }[range];
    const grain = range === "24h" ? "hour" : "day";
    const totals = await this.pool.query<{
      request_count: string;
      failed_request_count: string;
      average_latency_ms: string | null;
      p95_latency_ms: string | null;
      queue_pending: string;
      queue_processing: string;
      queue_retrying: string;
      queue_success: string;
      queue_failure: string;
    }>(
      `SELECT
         count(*) FILTER (WHERE type = 'http_request')::text AS request_count,
         count(*) FILTER (WHERE type = 'http_request' AND status = 'failure')::text AS failed_request_count,
         avg(duration_ms) FILTER (WHERE type = 'http_request')::text AS average_latency_ms,
         percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)
           FILTER (WHERE type = 'http_request' AND duration_ms IS NOT NULL)::text AS p95_latency_ms,
         count(*) FILTER (WHERE type = 'queue_job' AND status = 'pending')::text AS queue_pending,
         count(*) FILTER (WHERE type = 'queue_job' AND status = 'processing')::text AS queue_processing,
         count(*) FILTER (WHERE type = 'queue_retry')::text AS queue_retrying,
         count(*) FILTER (WHERE type = 'queue_job' AND status = 'success')::text AS queue_success,
         count(*) FILTER (WHERE type = 'queue_failed')::text AS queue_failure
       FROM events WHERE environment_id = $1 AND occurred_at >= now() - $2::interval`,
      [environmentId, interval],
    );
    const series = await this.pool.query<{
      bucket: Date | string;
      requests: string;
      failures: string;
      average_latency_ms: string | null;
      p95_latency_ms: string | null;
    }>(
      `SELECT date_trunc($3, occurred_at) AS bucket,
              count(*)::text AS requests,
              count(*) FILTER (WHERE status = 'failure')::text AS failures,
              avg(duration_ms)::text AS average_latency_ms,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)
                FILTER (WHERE duration_ms IS NOT NULL)::text AS p95_latency_ms
         FROM events
        WHERE environment_id = $1 AND type = 'http_request'
          AND occurred_at >= now() - $2::interval
        GROUP BY 1 ORDER BY 1`,
      [environmentId, interval, grain],
    );
    const row = totals.rows[0]!;
    const requestCount = Number(row.request_count);
    const failedRequestCount = Number(row.failed_request_count);
    const numeric = (value: string | null): number => Math.round(Number(value ?? 0) * 10) / 10;
    return {
      range,
      requestCount,
      failedRequestCount,
      failureRate: requestCount === 0 ? 0 : Math.round((failedRequestCount / requestCount) * 10_000) / 100,
      averageLatencyMs: numeric(row.average_latency_ms),
      p95LatencyMs: numeric(row.p95_latency_ms),
      queueStatusCounts: {
        pending: Number(row.queue_pending),
        processing: Number(row.queue_processing),
        retrying: Number(row.queue_retrying),
        success: Number(row.queue_success),
        failure: Number(row.queue_failure),
      },
      series: series.rows.map((item) => ({
        bucket: iso(item.bucket),
        requests: Number(item.requests),
        failures: Number(item.failures),
        averageLatencyMs: numeric(item.average_latency_ms),
        p95LatencyMs: numeric(item.p95_latency_ms),
      })),
    };
  }

  private async insertRows(client: PoolClient, auth: AuthenticatedKey, events: IngestEvent[]): Promise<Set<string>> {
    const values: unknown[] = [];
    const tuples = events.map((event) => {
      const row = eventValues(auth, event);
      const offset = values.length;
      values.push(...row);
      return `(${row.map((_, index) => `$${offset + index + 1}`).join(", ")})`;
    });
    const result = await client.query<{ event_id: string }>(
      `INSERT INTO events (${INSERT_COLUMNS.join(", ")}) VALUES ${tuples.join(", ")}
       ON CONFLICT (environment_id, event_id) DO NOTHING RETURNING event_id`,
      values,
    );
    return new Set(result.rows.map((row) => row.event_id));
  }
}

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import Fastify, { LogController, type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import {
  BatchValidationError,
  EVENT_STATUSES,
  EVENT_TYPES,
  parseAllowlist,
  redactTelemetryData,
  rejectionFor,
  validateBatchShape,
  validateEvent,
  type EventStatus,
  type EventType,
  type IngestEvent,
  type RejectedEvent,
} from "@queue-monitor/shared";
import {
  createSessionToken,
  expiredSessionCookie,
  parseCookies,
  SESSION_COOKIE,
  sessionCookie,
  verifySessionToken,
  type SessionClaims,
} from "./auth.js";
import type {
  EnvironmentAccess,
  EnvironmentType,
  EventFilters,
  EventStore,
  OrganizationRole,
  OverviewMetrics,
} from "./store.js";
import type { InvitationSender, PasswordResetSender } from "./email.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRACE_ID_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|(?!0{32})[0-9a-f]{32})$/i;
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const slugSchema = z.string().min(2).max(64).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const namedResourceSchema = z.object({ name: z.string().trim().min(2).max(120), slug: slugSchema });
const environmentSchema = namedResourceSchema.extend({
  environmentType: z.enum(["development", "staging", "production", "custom"]),
});
const apiKeySchema = z.object({
  name: z.string().trim().min(2).max(120),
  expiresAt: z.string().datetime().nullable().optional(),
});
const signupSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(320),
  password: z.string().min(12).max(200),
});
const passwordResetRequestSchema = z.object({ email: z.string().trim().email().max(320) });
const passwordResetConfirmSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{40,64}$/),
  password: z.string().min(12).max(200),
});
const invitationSchema = z.object({
  email: z.string().trim().email().max(320),
  role: z.enum(["admin", "developer", "viewer"]),
});
const memberRoleSchema = z.object({ role: z.enum(["owner", "admin", "developer", "viewer"]) });
const ONBOARDING_STEPS = [
  "create_organization", "create_project", "create_production_environment", "generate_api_key",
  "install_sdk", "send_first_event", "view_telemetry", "invite_teammate",
] as const;
const onboardingSchema = z.object({ step: z.enum(ONBOARDING_STEPS) });
const retentionSchema = z.object({
  retentionDays: z.union([z.literal(7), z.literal(30), z.literal(90), z.literal(180), z.literal(365)]),
  redactEmails: z.boolean(),
  redactPhoneNumbers: z.boolean(),
  customRedactFields: z.array(z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_.-]+$/)).max(50),
});
const networkSchema = z.string().trim().refine((value) => {
  const [address, prefix, extra] = value.split("/");
  if (!address || extra !== undefined || isIP(address) === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d+$/.test(prefix)) return false;
  const maximum = isIP(address) === 4 ? 32 : 128;
  return Number(prefix) >= 0 && Number(prefix) <= maximum;
}, "must be an IP address or CIDR range");
const allowlistSchema = z.object({ enabled: z.boolean(), networks: z.array(networkSchema).max(100) });
const deletionSchema = z.object({ confirmation: z.string().min(1).max(200) });

interface RequestLogContext {
  userId: string | null;
  organizationId: string | null;
  projectId: string | null;
  environmentId: string | null;
}

export interface AppOptions {
  store: EventStore;
  logger?: boolean | Record<string, unknown>;
  telemetryDataAllowlist?: string;
  jwtSecret?: string;
  secureCookies?: boolean;
  version?: { version: string; gitCommitSha: string; buildTimestamp: string; environment: string };
  onEventsAccepted?: (environmentId: string, events: IngestEvent[]) => void;
  inviteBaseUrl?: string;
  sendInvitation?: InvitationSender;
  sendPasswordReset?: PasswordResetSender;
  enforceHttps?: boolean;
  trustProxy?: boolean;
  maxRequestBytes?: number;
  maxEventBytes?: number;
  maxBatchSize?: number;
  maxNestingDepth?: number;
}

function bearerToken(value: string | string[] | undefined): string | null {
  if (typeof value !== "string") return null;
  return /^Bearer\s+([^\s]+)$/i.exec(value)?.[1] ?? null;
}

function stringQuery(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function positiveInteger(value: unknown, fallback: number, max: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return parsed >= 1 && parsed <= max ? parsed : null;
}

function validDate(value: string | undefined): string | undefined | null {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 2)}${"•".repeat(Math.max(2, Math.min(8, local.length - 2)))}@${domain}`;
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown, reply: FastifyReply): T | null {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  void reply.code(400).send({
    error: "invalid request body",
    details: result.error.issues.map((issue) => ({ field: issue.path.join("."), message: issue.message })),
  });
  return null;
}

export function hashApiKey(apiKey: string): string {
  return createHash("sha256").update(apiKey, "utf8").digest("hex");
}

export function buildApp(options: AppOptions): FastifyInstance {
  const requestContext = new WeakMap<FastifyRequest, RequestLogContext>();
  const requestSessions = new WeakMap<FastifyRequest, SessionClaims>();
  const app = Fastify({
    logger: options.logger ?? false,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: options.maxRequestBytes ?? 1024 * 1024,
    trustProxy: options.trustProxy ?? false,
    genReqId(request) {
      const supplied = request.headers["x-request-id"];
      return typeof supplied === "string" && REQUEST_ID_RE.test(supplied) ? supplied : randomUUID();
    },
  });
  const allowlist = parseAllowlist(options.telemetryDataAllowlist);
  const jwtSecret = options.jwtSecret ?? "test-only-jwt-secret-change-before-running";
  const secureCookies = options.secureCookies ?? false;
  const version = options.version ?? {
    version: "0.1.0-test",
    gitCommitSha: "unknown",
    buildTimestamp: new Date(0).toISOString(),
    environment: "test",
  };

  const contextFor = (request: FastifyRequest): RequestLogContext => {
    const existing = requestContext.get(request);
    if (existing) return existing;
    const created = { userId: null, organizationId: null, projectId: null, environmentId: null };
    requestContext.set(request, created);
    return created;
  };

  app.addHook("onRequest", async (request, reply) => {
    contextFor(request);
    reply.header("x-request-id", request.id);
    reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    reply.header("x-frame-options", "DENY");
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()");
    if (options.enforceHttps) {
      reply.header("strict-transport-security", "max-age=31536000; includeSubDomains; preload");
      if (request.protocol !== "https") {
        const host = request.headers.host;
        if (!host) return reply.code(400).send({ error: "host header is required" });
        return reply.redirect(`https://${host}${request.url}`, 308);
      }
    }
    const rawToken = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    const claims = rawToken ? verifySessionToken(rawToken, jwtSecret) : null;
    if (rawToken && claims && await options.store.isSessionActive(claims.sid, claims.sub, hashApiKey(rawToken))) {
      requestSessions.set(request, claims);
      const readOnlyMethod = ["GET", "HEAD", "OPTIONS"].includes(request.method);
      const allowedSessionAction = request.url === "/v1/auth/logout" || request.url === "/v1/auth/logout-all" ||
        (request.method === "DELETE" && request.url.startsWith("/v1/auth/sessions/"));
      if (claims.demo && !readOnlyMethod && !allowedSessionAction) {
        return reply.code(403).send({ error: "demo workspace is read-only" });
      }
    }
  });
  app.addHook("onResponse", async (request, reply) => {
    const context = contextFor(request);
    request.log.info({
      requestId: request.id,
      ...context,
      method: request.method,
      route: request.routeOptions.url,
      statusCode: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime * 100) / 100,
    }, "request_completed");
  });
  app.setErrorHandler((error, request, reply) => {
    request.log.error({
      err: error,
      requestId: request.id,
      ...contextFor(request),
      method: request.method,
      route: request.routeOptions.url,
    }, "request_failed");
    const postgresCode = (error as { code?: string }).code;
    if (postgresCode === "23505") {
      void reply.code(409).send({ error: "resource slug or key already exists", requestId: request.id });
      return;
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (statusCode && statusCode >= 400 && statusCode < 500) {
      void reply.code(statusCode).send({
        error: statusCode === 413 ? "request body too large" : "invalid request",
        requestId: request.id,
      });
      return;
    }
    void reply.code(500).send({ error: "internal server error", requestId: request.id });
  });

  const sessionFor = (request: FastifyRequest): SessionClaims | null => requestSessions.get(request) ?? null;

  const requestIdentity = (request: FastifyRequest) => ({
    ipAddress: request.ip || null,
    userAgent: typeof request.headers["user-agent"] === "string" ? request.headers["user-agent"].slice(0, 512) : null,
  });

  const audit = (request: FastifyRequest, input: Omit<Parameters<EventStore["recordAudit"]>[0], "ipAddress" | "userAgent">) =>
    options.store.recordAudit({ ...input, ...requestIdentity(request) });

  const createLoginSession = async (request: FastifyRequest, user: { id: string; email: string; isDemo?: boolean }): Promise<string> => {
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1_000).toISOString();
    const token = createSessionToken(user, jwtSecret, sessionId);
    const identity = requestIdentity(request);
    await options.store.createSession(sessionId, user.id, hashApiKey(token), expiresAt, identity.ipAddress, identity.userAgent);
    return token;
  };

  const requireSession = (request: FastifyRequest, reply: FastifyReply): SessionClaims | null => {
    const session = sessionFor(request);
    if (!session) {
      void reply.code(401).send({ error: "authentication required" });
      return null;
    }
    contextFor(request).userId = session.sub;
    return session;
  };

  const requireEnvironment = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<{ session: SessionClaims; access: EnvironmentAccess } | null> => {
    const session = requireSession(request, reply);
    if (!session) return null;
    const environmentId = request.headers["x-environment-id"];
    if (typeof environmentId !== "string" || !UUID_RE.test(environmentId)) {
      await reply.code(400).send({ error: "x-environment-id must be an environment UUID" });
      return null;
    }
    const access = await options.store.getEnvironmentAccess(session.sub, environmentId);
    if (!access) {
      await reply.code(403).send({ error: "environment access denied" });
      return null;
    }
    Object.assign(contextFor(request), {
      organizationId: access.organizationId,
      projectId: access.projectId,
      environmentId: access.environmentId,
    });
    return { session, access };
  };

  app.get("/health", async () => ({ status: "ok" }));
  app.get("/ready", async (_request, reply) => {
    try {
      await options.store.checkReady();
      return reply.send({ status: "ready", checks: { database: "ok" } });
    } catch {
      return reply.code(503).send({ status: "not_ready", checks: { database: "unavailable" } });
    }
  });
  app.get("/version", async () => version);
  app.get("/v1/status", async (_request, reply) => {
    try {
      return reply.send(await options.store.getPublicStatus());
    } catch {
      return reply.code(503).send({
        status: "outage", checkedAt: new Date().toISOString(),
        components: ["API", "Ingestion", "Dashboard"].map((name) => ({ name, status: "outage" })),
        incidents: [], maintenance: [],
      });
    }
  });
  app.get("/v1/billing/plans", async () => ({ items: await options.store.listPlans() }));

  app.post("/v1/auth/signup", async (request, reply) => {
    const body = parseBody(signupSchema, request.body, reply);
    if (!body) return;
    const user = await options.store.createUser(body.email, body.password, body.name);
    contextFor(request).userId = user.id;
    const token = await createLoginSession(request, user);
    await audit(request, { organizationId: null, actorUserId: user.id, action: "user.signup", targetType: "user", targetId: user.id, result: "success" });
    reply.header("set-cookie", sessionCookie(token, secureCookies));
    reply.header("cache-control", "no-store");
    return reply.code(201).send({ user, projects: [] });
  });

  app.post("/v1/auth/login", async (request, reply) => {
    const body = request.body as Record<string, unknown> | null;
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!email || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || password.length > 200) {
      return reply.code(400).send({ error: "valid email and password are required" });
    }
    const user = await options.store.authenticateUser(email, password);
    if (!user) {
      await audit(request, { organizationId: null, actorUserId: null, action: "user.login", targetType: "user", targetId: null, result: "failure", metadata: { emailHash: hashApiKey(email.toLowerCase()).slice(0, 16) } });
      return reply.code(401).send({ error: "invalid email or password" });
    }
    contextFor(request).userId = user.id;
    const projects = await options.store.listUserProjects(user.id);
    const token = await createLoginSession(request, user);
    await audit(request, { organizationId: null, actorUserId: user.id, action: "user.login", targetType: "session", targetId: null, result: "success" });
    reply.header("set-cookie", sessionCookie(token, secureCookies));
    reply.header("cache-control", "no-store");
    return reply.send({ user, projects });
  });

  app.post("/v1/auth/password-reset/request", async (request, reply) => {
    const body = parseBody(passwordResetRequestSchema, request.body, reply);
    if (!body) return;
    const resetToken = randomBytes(32).toString("base64url");
    const reset = await options.store.createPasswordReset(
      body.email,
      hashApiKey(resetToken),
      new Date(Date.now() + 30 * 60 * 1_000).toISOString(),
    );
    let delivery: "not_found" | "unconfigured" | "sent" | "failed" = reset ? "unconfigured" : "not_found";
    if (reset && options.sendPasswordReset) {
      try {
        await options.sendPasswordReset(reset, `${options.inviteBaseUrl ?? "http://localhost:5173"}/reset-password?token=${resetToken}`);
        delivery = "sent";
      } catch (error) {
        delivery = "failed";
        request.log.error({ err: error, resetId: reset.id }, "password_reset_email_failed");
      }
    }
    await audit(request, {
      organizationId: null, actorUserId: reset?.userId ?? null, action: "password_reset.request",
      targetType: "user", targetId: reset?.userId ?? null, result: "success",
      metadata: { delivery, emailHash: hashApiKey(body.email.toLowerCase()).slice(0, 16) },
    });
    return reply.code(202).send({ message: "If the account exists, password reset instructions will be sent." });
  });

  app.post("/v1/auth/password-reset/confirm", async (request, reply) => {
    const body = parseBody(passwordResetConfirmSchema, request.body, reply);
    if (!body) return;
    const reset = await options.store.resetPassword(hashApiKey(body.token), body.password);
    if (reset.result !== "reset") {
      await audit(request, { organizationId: null, actorUserId: null, action: "password_reset.complete", targetType: "user", targetId: null, result: "failure", metadata: { reason: reset.result } });
      return reply.code(reset.result === "expired" ? 410 : 400).send({ error: "password reset token is invalid or expired" });
    }
    await audit(request, { organizationId: null, actorUserId: reset.userId ?? null, action: "password_reset.complete", targetType: "user", targetId: reset.userId ?? null, result: "success" });
    reply.header("set-cookie", expiredSessionCookie(secureCookies));
    return reply.code(204).send();
  });

  app.post("/v1/auth/logout", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    await options.store.revokeSession(session.sub, session.sid);
    await audit(request, { organizationId: null, actorUserId: session.sub, action: "user.logout", targetType: "session", targetId: session.sid, result: "success" });
    reply.header("set-cookie", expiredSessionCookie(secureCookies));
    reply.header("cache-control", "no-store");
    return reply.code(204).send();
  });

  app.get("/v1/auth/me", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const projects = await options.store.listUserProjects(session.sub);
    reply.header("cache-control", "no-store");
    return reply.send({ user: { id: session.sub, email: session.email, isDemo: session.demo }, projects });
  });

  app.get("/v1/auth/sessions", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const sessions = await options.store.listSessions(session.sub);
    return reply.send({ items: sessions.map((item) => ({ ...item, current: item.id === session.sid })) });
  });

  app.delete("/v1/auth/sessions/:sessionId", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { sessionId } = request.params as { sessionId: string };
    if (!UUID_RE.test(sessionId)) return reply.code(400).send({ error: "sessionId must be a UUID" });
    const revoked = await options.store.revokeSession(session.sub, sessionId);
    if (!revoked) return reply.code(404).send({ error: "session not found" });
    await audit(request, { organizationId: null, actorUserId: session.sub, action: "session.revoke", targetType: "session", targetId: sessionId, result: "success" });
    if (sessionId === session.sid) reply.header("set-cookie", expiredSessionCookie(secureCookies));
    return reply.code(204).send();
  });

  app.post("/v1/auth/logout-all", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const revoked = await options.store.revokeAllSessions(session.sub);
    await audit(request, { organizationId: null, actorUserId: session.sub, action: "session.revoke_all", targetType: "user", targetId: session.sub, result: "success", metadata: { revoked } });
    reply.header("set-cookie", expiredSessionCookie(secureCookies));
    return reply.code(204).send();
  });

  app.get("/v1/organizations", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    return reply.send({ items: await options.store.listOrganizations(session.sub) });
  });

  app.post("/v1/organizations", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const body = parseBody(namedResourceSchema, request.body, reply);
    if (!body) return;
    const organization = await options.store.createOrganization(session.sub, body.name, body.slug);
    contextFor(request).organizationId = organization.id;
    await audit(request, { organizationId: organization.id, actorUserId: session.sub, action: "organization.create", targetType: "organization", targetId: organization.id, result: "success" });
    return reply.code(201).send(organization);
  });

  app.post("/v1/organizations/:organizationId/projects", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { organizationId } = request.params as { organizationId: string };
    if (!UUID_RE.test(organizationId)) return reply.code(400).send({ error: "organizationId must be a UUID" });
    const body = parseBody(namedResourceSchema, request.body, reply);
    if (!body) return;
    const project = await options.store.createProject(session.sub, organizationId, body.name, body.slug);
    if (!project) return reply.code(403).send({ error: "organization admin access required" });
    Object.assign(contextFor(request), { organizationId, projectId: project.id });
    await audit(request, { organizationId, actorUserId: session.sub, action: "project.create", targetType: "project", targetId: project.id, result: "success" });
    return reply.code(201).send(project);
  });

  app.get("/v1/organizations/:organizationId/usage", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { organizationId } = request.params as { organizationId: string };
    if (!UUID_RE.test(organizationId)) return reply.code(400).send({ error: "organizationId must be a UUID" });
    const usage = await options.store.getUsage(session.sub, organizationId);
    if (!usage) return reply.code(403).send({ error: "organization access denied" });
    return reply.send(usage);
  });

  app.get("/v1/organizations/:organizationId/audit-logs", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { organizationId } = request.params as { organizationId: string };
    const limit = positiveInteger((request.query as Record<string, unknown>).limit, 100, 500);
    if (!UUID_RE.test(organizationId) || limit === null) return reply.code(400).send({ error: "invalid audit log request" });
    const logs = await options.store.listAuditLogs(session.sub, organizationId, limit);
    if (!logs) return reply.code(403).send({ error: "organization admin access required" });
    reply.header("cache-control", "no-store");
    return reply.send({ items: logs });
  });

  app.get("/v1/organizations/:organizationId/security", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { organizationId } = request.params as { organizationId: string };
    if (!UUID_RE.test(organizationId)) return reply.code(400).send({ error: "organizationId must be a UUID" });
    const projects = await options.store.listUserProjects(session.sub);
    const project = projects.find((item) => item.organizationId === organizationId);
    const environment = project?.environments[0];
    if (!project || !environment || !["owner", "admin"].includes(project.role)) {
      return reply.code(403).send({ error: "organization admin access required" });
    }
    return reply.send(await options.store.getSecurityPolicy(environment.id));
  });

  app.patch("/v1/organizations/:organizationId/security", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { organizationId } = request.params as { organizationId: string };
    if (!UUID_RE.test(organizationId)) return reply.code(400).send({ error: "organizationId must be a UUID" });
    const body = parseBody(retentionSchema, request.body, reply);
    if (!body) return;
    const policy = await options.store.updateOrganizationSecurity(session.sub, organizationId, body);
    if (!policy) return reply.code(403).send({ error: "organization admin access required" });
    await audit(request, { organizationId, actorUserId: session.sub, action: "security.settings_update", targetType: "organization", targetId: organizationId, result: "success", metadata: { retentionDays: body.retentionDays, redactEmails: body.redactEmails, redactPhoneNumbers: body.redactPhoneNumbers, customFieldCount: body.customRedactFields.length } });
    return reply.send(policy);
  });

  app.patch("/v1/environments/:environmentId/ip-allowlist", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { environmentId } = request.params as { environmentId: string };
    if (!UUID_RE.test(environmentId)) return reply.code(400).send({ error: "environmentId must be a UUID" });
    const body = parseBody(allowlistSchema, request.body, reply);
    if (!body) return;
    if (body.enabled && body.networks.length === 0) return reply.code(400).send({ error: "at least one network is required when the allowlist is enabled" });
    const policy = await options.store.updateEnvironmentAllowlist(session.sub, environmentId, body.enabled, body.networks);
    if (!policy) return reply.code(403).send({ error: "Business plan and organization admin access are required" });
    const access = await options.store.getEnvironmentAccess(session.sub, environmentId);
    await audit(request, { organizationId: access?.organizationId ?? null, actorUserId: session.sub, action: "security.ip_allowlist_update", targetType: "environment", targetId: environmentId, result: "success", metadata: { enabled: body.enabled, networkCount: body.networks.length } });
    return reply.send(policy);
  });

  app.get("/v1/organizations/:organizationId/export", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { organizationId } = request.params as { organizationId: string };
    const format = stringQuery((request.query as Record<string, unknown>).format) ?? "json";
    if (!UUID_RE.test(organizationId) || !["json", "csv"].includes(format)) return reply.code(400).send({ error: "format must be json or csv" });
    const exported = await options.store.exportOrganization(session.sub, organizationId, 50_000);
    if (!exported) return reply.code(403).send({ error: "organization admin access required" });
    await audit(request, { organizationId, actorUserId: session.sub, action: "data.export", targetType: "organization", targetId: organizationId, result: "success", metadata: { format, telemetryEvents: exported.telemetry.length, truncated: exported.truncated } });
    reply.header("cache-control", "no-store");
    reply.header("content-disposition", `attachment; filename="queue-monitor-${organizationId}.${format}"`);
    if (exported.truncated) reply.header("x-export-truncated", "true");
    if (format === "csv") {
      reply.type("text/csv; charset=utf-8");
      const header = ["event_id", "trace_id", "parent_event_id", "type", "status", "source", "occurred_at", "received_at", "duration_ms", "error_name", "error_message"];
      const rows = exported.telemetry.map((event) => [
        event.eventId, event.traceId, event.parentEventId, event.type, event.status, event.source,
        event.occurredAt, event.receivedAt, event.durationMs, event.error?.name, event.error?.message,
      ].map(csvCell).join(","));
      return reply.send([header.map(csvCell).join(","), ...rows].join("\n"));
    }
    return reply.send(exported);
  });

  app.delete("/v1/organizations/:organizationId/telemetry", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { organizationId } = request.params as { organizationId: string };
    const body = parseBody(deletionSchema, request.body, reply);
    if (!body) return;
    if (!UUID_RE.test(organizationId)) return reply.code(400).send({ error: "organizationId must be a UUID" });
    if (body.confirmation !== "DELETE TELEMETRY") return reply.code(400).send({ error: "confirmation must be DELETE TELEMETRY" });
    const deleted = await options.store.deleteOrganizationTelemetry(session.sub, organizationId);
    if (deleted === null) return reply.code(403).send({ error: "organization admin access required" });
    await audit(request, { organizationId, actorUserId: session.sub, action: "data.telemetry_delete", targetType: "organization", targetId: organizationId, result: "success", metadata: { deletedEvents: deleted } });
    return reply.send({ deletedEvents: deleted });
  });

  app.delete("/v1/projects/:projectId", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { projectId } = request.params as { projectId: string };
    const body = parseBody(deletionSchema, request.body, reply);
    if (!body) return;
    if (!UUID_RE.test(projectId)) return reply.code(400).send({ error: "projectId must be a UUID" });
    if (body.confirmation !== "DELETE") return reply.code(400).send({ error: "confirmation must be DELETE" });
    const project = (await options.store.listUserProjects(session.sub)).find((item) => item.id === projectId);
    const deleted = await options.store.deleteProject(session.sub, projectId);
    if (deleted === null || !deleted) return reply.code(403).send({ error: "organization admin access required" });
    await audit(request, { organizationId: project?.organizationId ?? null, actorUserId: session.sub, action: "data.project_delete", targetType: "project", targetId: projectId, result: "success" });
    return reply.code(204).send();
  });

  app.delete("/v1/environments/:environmentId", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { environmentId } = request.params as { environmentId: string };
    const body = parseBody(deletionSchema, request.body, reply);
    if (!body) return;
    if (!UUID_RE.test(environmentId)) return reply.code(400).send({ error: "environmentId must be a UUID" });
    if (body.confirmation !== "DELETE") return reply.code(400).send({ error: "confirmation must be DELETE" });
    const access = await options.store.getEnvironmentAccess(session.sub, environmentId);
    const deleted = await options.store.deleteEnvironment(session.sub, environmentId);
    if (deleted === null || !deleted) return reply.code(403).send({ error: "organization admin access required" });
    await audit(request, { organizationId: access?.organizationId ?? null, actorUserId: session.sub, action: "data.environment_delete", targetType: "environment", targetId: environmentId, result: "success" });
    return reply.code(204).send();
  });

  app.delete("/v1/organizations/:organizationId", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { organizationId } = request.params as { organizationId: string };
    const body = parseBody(deletionSchema, request.body, reply);
    if (!body) return;
    if (!UUID_RE.test(organizationId)) return reply.code(400).send({ error: "organizationId must be a UUID" });
    const organization = (await options.store.listOrganizations(session.sub)).find((item) => item.id === organizationId);
    if (!organization) return reply.code(403).send({ error: "organization access denied" });
    if (body.confirmation !== organization.slug) return reply.code(400).send({ error: "confirmation must match the organization slug" });
    const deleted = await options.store.deleteOrganization(session.sub, organizationId);
    if (!deleted) return reply.code(403).send({ error: "organization owner access required" });
    await audit(request, { organizationId, actorUserId: session.sub, action: "data.organization_delete", targetType: "organization", targetId: organizationId, result: "success", metadata: { slug: organization.slug } });
    return reply.code(204).send();
  });

  app.delete("/v1/account", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const body = parseBody(deletionSchema, request.body, reply);
    if (!body) return;
    if (body.confirmation.toLowerCase() !== session.email.toLowerCase()) return reply.code(400).send({ error: "confirmation must match the account email" });
    const deleted = await options.store.deleteUser(session.sub);
    if (!deleted) return reply.code(409).send({ error: "transfer or delete organizations where you are the only owner first" });
    await audit(request, { organizationId: null, actorUserId: session.sub, action: "data.user_delete", targetType: "user", targetId: session.sub, result: "success" });
    reply.header("set-cookie", expiredSessionCookie(secureCookies));
    return reply.code(204).send();
  });

  app.get("/v1/organizations/:organizationId/members", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { organizationId } = request.params as { organizationId: string };
    if (!UUID_RE.test(organizationId)) return reply.code(400).send({ error: "organizationId must be a UUID" });
    const members = await options.store.listMembers(session.sub, organizationId);
    if (!members) return reply.code(403).send({ error: "organization access denied" });
    return reply.send({ items: members });
  });

  app.patch("/v1/organizations/:organizationId/members/:memberId", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { organizationId, memberId } = request.params as { organizationId: string; memberId: string };
    if (!UUID_RE.test(organizationId) || !UUID_RE.test(memberId)) return reply.code(400).send({ error: "organizationId and memberId must be UUIDs" });
    const body = parseBody(memberRoleSchema, request.body, reply);
    if (!body) return;
    const result = await options.store.updateMemberRole(session.sub, organizationId, memberId, body.role as OrganizationRole);
    if (result === "forbidden") return reply.code(403).send({ error: "only an owner can manage roles" });
    if (result === "not_found") return reply.code(404).send({ error: "member not found" });
    if (result === "last_owner") return reply.code(409).send({ error: "an organization must retain at least one owner" });
    await options.store.revokeAllSessions(memberId);
    await audit(request, { organizationId, actorUserId: session.sub, action: "membership.role_change", targetType: "user", targetId: memberId, result: "success", metadata: { role: body.role } });
    return reply.code(204).send();
  });

  app.delete("/v1/organizations/:organizationId/members/:memberId", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { organizationId, memberId } = request.params as { organizationId: string; memberId: string };
    if (!UUID_RE.test(organizationId) || !UUID_RE.test(memberId)) return reply.code(400).send({ error: "organizationId and memberId must be UUIDs" });
    const result = await options.store.removeMember(session.sub, organizationId, memberId);
    if (result === "forbidden") return reply.code(403).send({ error: "member removal is not permitted" });
    if (result === "not_found") return reply.code(404).send({ error: "member not found" });
    if (result === "last_owner") return reply.code(409).send({ error: "an organization must retain at least one owner" });
    await options.store.revokeAllSessions(memberId);
    await audit(request, { organizationId, actorUserId: session.sub, action: "membership.remove", targetType: "user", targetId: memberId, result: "success" });
    return reply.code(204).send();
  });

  app.get("/v1/organizations/:organizationId/invitations", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { organizationId } = request.params as { organizationId: string };
    if (!UUID_RE.test(organizationId)) return reply.code(400).send({ error: "organizationId must be a UUID" });
    const invitations = await options.store.listInvitations(session.sub, organizationId);
    if (!invitations) return reply.code(403).send({ error: "organization access denied" });
    return reply.send({ items: invitations });
  });

  app.post("/v1/organizations/:organizationId/invitations", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { organizationId } = request.params as { organizationId: string };
    if (!UUID_RE.test(organizationId)) return reply.code(400).send({ error: "organizationId must be a UUID" });
    const body = parseBody(invitationSchema, request.body, reply);
    if (!body) return;
    const inviteToken = randomBytes(32).toString("base64url");
    const invitation = await options.store.createInvitation(
      session.sub,
      organizationId,
      body.email,
      body.role,
      hashApiKey(inviteToken),
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
    );
    if (!invitation) return reply.code(403).send({ error: "organization admin access required" });
    await audit(request, { organizationId, actorUserId: session.sub, action: "invitation.create", targetType: "invitation", targetId: invitation.id, result: "success", metadata: { role: body.role, emailHash: hashApiKey(body.email.toLowerCase()).slice(0, 16) } });
    const acceptPath = `/accept-invite?token=${inviteToken}`;
    let emailDelivery: "sent" | "copy_link" | "failed" = options.sendInvitation ? "sent" : "copy_link";
    if (options.sendInvitation) {
      try {
        await options.sendInvitation(invitation, `${options.inviteBaseUrl ?? "http://localhost:5173"}${acceptPath}`);
      } catch (error) {
        emailDelivery = "failed";
        request.log.error({ err: error, invitationId: invitation.id, organizationId }, "invitation_email_failed");
      }
    }
    return reply.code(201).send({ ...invitation, inviteToken, acceptPath, emailDelivery });
  });

  app.delete("/v1/organizations/:organizationId/invitations/:invitationId", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { organizationId, invitationId } = request.params as { organizationId: string; invitationId: string };
    if (!UUID_RE.test(organizationId) || !UUID_RE.test(invitationId)) return reply.code(400).send({ error: "organizationId and invitationId must be UUIDs" });
    const revoked = await options.store.revokeInvitation(session.sub, organizationId, invitationId);
    if (revoked === null) return reply.code(403).send({ error: "organization access denied" });
    if (!revoked) return reply.code(404).send({ error: "invitation not found or admin access required" });
    await audit(request, { organizationId, actorUserId: session.sub, action: "invitation.revoke", targetType: "invitation", targetId: invitationId, result: "success" });
    return reply.code(204).send();
  });

  app.get("/v1/invitations/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return reply.code(404).send({ error: "invitation not found" });
    const invitation = await options.store.getInvitation(hashApiKey(token));
    if (!invitation) return reply.code(404).send({ error: "invitation not found" });
    if (Date.parse(invitation.expiresAt) <= Date.now()) return reply.code(410).send({ error: "invitation has expired" });
    return reply.send({ ...invitation, email: maskEmail(invitation.email) });
  });

  app.post("/v1/invitations/:token/accept", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { token } = request.params as { token: string };
    if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return reply.code(404).send({ error: "invitation not found" });
    const acceptedInvitation = await options.store.getInvitation(hashApiKey(token));
    const result = await options.store.acceptInvitation(session.sub, session.email, hashApiKey(token));
    if (result === "invalid") return reply.code(404).send({ error: "invitation not found or already used" });
    if (result === "expired") return reply.code(410).send({ error: "invitation has expired" });
    if (result === "email_mismatch") return reply.code(403).send({ error: "sign in with the invited email address" });
    await audit(request, { organizationId: acceptedInvitation?.organizationId ?? null, actorUserId: session.sub, action: "invitation.accept", targetType: "invitation", targetId: acceptedInvitation?.id ?? null, result: "success" });
    return reply.code(204).send();
  });

  app.get("/v1/organizations/:organizationId/onboarding", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { organizationId } = request.params as { organizationId: string };
    if (!UUID_RE.test(organizationId)) return reply.code(400).send({ error: "organizationId must be a UUID" });
    const progress = await options.store.getOnboarding(session.sub, organizationId);
    if (!progress) return reply.code(403).send({ error: "organization access denied" });
    return reply.send({ ...progress, steps: ONBOARDING_STEPS });
  });

  app.patch("/v1/organizations/:organizationId/onboarding", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { organizationId } = request.params as { organizationId: string };
    if (!UUID_RE.test(organizationId)) return reply.code(400).send({ error: "organizationId must be a UUID" });
    const body = parseBody(onboardingSchema, request.body, reply);
    if (!body) return;
    const progress = await options.store.completeOnboardingStep(session.sub, organizationId, body.step);
    if (!progress) return reply.code(403).send({ error: "organization access denied" });
    return reply.send({ ...progress, steps: ONBOARDING_STEPS });
  });

  app.get("/v1/projects/:projectId/environments", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { projectId } = request.params as { projectId: string };
    if (!UUID_RE.test(projectId)) return reply.code(400).send({ error: "projectId must be a UUID" });
    const environments = await options.store.listEnvironments(session.sub, projectId);
    if (!environments) return reply.code(403).send({ error: "project access denied" });
    contextFor(request).projectId = projectId;
    return reply.send({ items: environments });
  });

  app.post("/v1/projects/:projectId/environments", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { projectId } = request.params as { projectId: string };
    if (!UUID_RE.test(projectId)) return reply.code(400).send({ error: "projectId must be a UUID" });
    const body = parseBody(environmentSchema, request.body, reply);
    if (!body) return;
    const environment = await options.store.createEnvironment(
      session.sub,
      projectId,
      body.name,
      body.slug,
      body.environmentType as EnvironmentType,
    );
    if (!environment) return reply.code(403).send({ error: "organization admin access required" });
    Object.assign(contextFor(request), { projectId, environmentId: environment.id });
    const access = await options.store.getEnvironmentAccess(session.sub, environment.id);
    await audit(request, { organizationId: access?.organizationId ?? null, actorUserId: session.sub, action: "environment.create", targetType: "environment", targetId: environment.id, result: "success", metadata: { environmentType: environment.environmentType } });
    return reply.code(201).send(environment);
  });

  app.get("/v1/environments/:environmentId/api-keys", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { environmentId } = request.params as { environmentId: string };
    if (!UUID_RE.test(environmentId)) return reply.code(400).send({ error: "environmentId must be a UUID" });
    const keys = await options.store.listApiKeys(session.sub, environmentId);
    if (!keys) return reply.code(403).send({ error: "environment access denied" });
    contextFor(request).environmentId = environmentId;
    return reply.send({ items: keys });
  });

  app.post("/v1/environments/:environmentId/api-keys", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { environmentId } = request.params as { environmentId: string };
    if (!UUID_RE.test(environmentId)) return reply.code(400).send({ error: "environmentId must be a UUID" });
    const body = parseBody(apiKeySchema, request.body, reply);
    if (!body) return;
    const expiresAt = body.expiresAt ?? null;
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
      return reply.code(400).send({ error: "expiresAt must be in the future" });
    }
    const apiKey = `qmon_live_${randomBytes(32).toString("base64url")}`;
    const created = await options.store.createApiKey(
      session.sub,
      environmentId,
      body.name,
      apiKey.slice(0, 18),
      hashApiKey(apiKey),
      expiresAt,
    );
    if (!created) return reply.code(403).send({ error: "developer API-key access required" });
    contextFor(request).environmentId = environmentId;
    const keyAccess = await options.store.getEnvironmentAccess(session.sub, environmentId);
    await audit(request, { organizationId: keyAccess?.organizationId ?? null, actorUserId: session.sub, action: "api_key.create", targetType: "api_key", targetId: created.id, result: "success", metadata: { environmentId, keyPrefix: created.keyPrefix } });
    return reply.code(201).send({ ...created, apiKey });
  });

  app.delete("/v1/environments/:environmentId/api-keys/:apiKeyId", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return;
    const { environmentId, apiKeyId } = request.params as { environmentId: string; apiKeyId: string };
    if (!UUID_RE.test(environmentId) || !UUID_RE.test(apiKeyId)) {
      return reply.code(400).send({ error: "environmentId and apiKeyId must be UUIDs" });
    }
    const revoked = await options.store.revokeApiKey(session.sub, environmentId, apiKeyId);
    if (revoked === null) return reply.code(403).send({ error: "environment access denied" });
    if (!revoked) return reply.code(404).send({ error: "API key not found or developer access required" });
    contextFor(request).environmentId = environmentId;
    const revokeAccess = await options.store.getEnvironmentAccess(session.sub, environmentId);
    await audit(request, { organizationId: revokeAccess?.organizationId ?? null, actorUserId: session.sub, action: "api_key.revoke", targetType: "api_key", targetId: apiKeyId, result: "success", metadata: { environmentId } });
    return reply.code(204).send();
  });

  app.get("/v1/events", async (request, reply) => {
    const context = await requireEnvironment(request, reply);
    if (!context) return;
    const query = request.query as Record<string, unknown>;
    const page = positiveInteger(query.page, 1, 1_000_000);
    const limit = positiveInteger(query.limit, 50, 100);
    const type = stringQuery(query.type);
    const status = stringQuery(query.status);
    const traceId = stringQuery(query.traceId);
    const from = validDate(stringQuery(query.from));
    const to = validDate(stringQuery(query.to));
    if (page === null || limit === null ||
      (type && !EVENT_TYPES.includes(type as EventType)) ||
      (status && !EVENT_STATUSES.includes(status as EventStatus)) ||
      (traceId && !TRACE_ID_RE.test(traceId)) || from === null || to === null) {
      return reply.code(400).send({ error: "invalid event filters" });
    }
    const filters: EventFilters = {
      page,
      limit,
      type: type as EventType | undefined,
      status: status as EventStatus | undefined,
      source: stringQuery(query.source),
      traceId,
      queueName: stringQuery(query.queueName),
      search: stringQuery(query.search),
      from,
      to,
    };
    reply.header("cache-control", "no-store");
    return reply.send(await options.store.listEvents(context.access.environmentId, filters));
  });

  app.get("/v1/traces/:traceId", async (request, reply) => {
    const context = await requireEnvironment(request, reply);
    if (!context) return;
    const { traceId } = request.params as { traceId: string };
    if (!TRACE_ID_RE.test(traceId)) return reply.code(400).send({ error: "traceId must be a UUID or W3C trace ID" });
    const events = await options.store.getTrace(context.access.environmentId, traceId);
    if (events.length === 0) return reply.code(404).send({ error: "trace not found" });
    reply.header("cache-control", "no-store");
    return reply.send({ traceId, events });
  });

  app.get("/v1/metrics/overview", async (request, reply) => {
    const context = await requireEnvironment(request, reply);
    if (!context) return;
    const query = request.query as Record<string, unknown>;
    const range = (stringQuery(query.range) ?? "24h") as OverviewMetrics["range"];
    if (!["24h", "7d", "30d"].includes(range)) {
      return reply.code(400).send({ error: "range must be one of: 24h, 7d, 30d" });
    }
    reply.header("cache-control", "no-store");
    return reply.send(await options.store.getOverview(context.access.environmentId, range));
  });

  app.post("/v1/events/batch", async (request, reply) => {
    const token = bearerToken(request.headers.authorization);
    if (!token || !token.startsWith("qmon_live_")) {
      return reply.code(401).send({ error: "invalid or missing bearer token" });
    }
    const auth = await options.store.findActiveApiKey(hashApiKey(token));
    if (!auth) return reply.code(401).send({ error: "invalid, expired, or revoked API key" });
    Object.assign(contextFor(request), {
      organizationId: auth.organizationId,
      projectId: auth.projectId,
      environmentId: auth.environmentId,
    });
    let events: unknown[];
    try {
      ({ events } = validateBatchShape(request.body, options.maxBatchSize ?? 100));
    } catch (error) {
      if (error instanceof BatchValidationError) return reply.code(400).send({ error: error.message });
      throw error;
    }
    const valid: IngestEvent[] = [];
    const rejected: RejectedEvent[] = [];
    const policy = await options.store.getSecurityPolicy(auth.environmentId);
    for (const event of events) {
      try {
        // Server-side redaction runs before validation while preserving schema-critical timestamp fields.
        const candidate = typeof event === "object" && event !== null && !Array.isArray(event)
          ? { ...event, data: redactTelemetryData((event as Record<string, unknown>).data, {
              customFields: policy.customRedactFields,
              redactEmails: policy.redactEmails,
              redactPhoneNumbers: policy.redactPhoneNumbers,
            }) }
          : event;
        valid.push(validateEvent(candidate, allowlist, {
          maxEventBytes: options.maxEventBytes ?? 16 * 1024,
          maxNestingDepth: options.maxNestingDepth ?? 12,
        }));
      } catch (error) {
        rejected.push(rejectionFor(event, error));
      }
    }
    const requestBytes = Buffer.byteLength(JSON.stringify(request.body), "utf8");
    const authorized = await options.store.authorizeIngestion(auth, request.ip, requestBytes, valid.length);
    if (!authorized.allowed) {
      if (authorized.retryAfterSeconds) reply.header("retry-after", String(authorized.retryAfterSeconds));
      const status = authorized.reason === "ip_allowlist" ? 403 : 429;
      return reply.code(status).send({
        error: authorized.reason === "ip_allowlist"
          ? "ingestion source IP is not allowed"
          : `ingestion rejected: ${authorized.reason?.replaceAll("_", " ")}`,
        code: authorized.reason,
        scope: authorized.scope,
      });
    }
    const inserted = await options.store.insertEvents(auth, valid);
    await options.store.recordStoredUsage(
      auth,
      inserted.accepted,
      inserted.insertedEvents.reduce((total, event) => total + Buffer.byteLength(JSON.stringify(event), "utf8"), 0),
    );
    if (inserted.insertedEvents.length > 0) {
      options.onEventsAccepted?.(auth.environmentId, inserted.insertedEvents);
    }
    return reply.send({ accepted: inserted.accepted, duplicates: inserted.duplicates, rejected });
  });

  return app;
}

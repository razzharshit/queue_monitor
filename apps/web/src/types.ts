export type EventType =
  | "http_request"
  | "queue_job"
  | "queue_retry"
  | "queue_failed"
  | "webhook_received";

export type EventStatus = "success" | "failure" | "pending" | "processing" | "retrying";

export interface User {
  id: string;
  email: string;
  name?: string | null;
  isDemo?: boolean;
}

export interface Project {
  id: string;
  organizationId: string;
  organizationName: string;
  name: string;
  slug: string;
  role: OrganizationRole;
  environments: Environment[];
}

export type OrganizationRole = "owner" | "admin" | "developer" | "viewer";

export interface Organization {
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
  apiKey?: string;
}

export interface TeamMember {
  userId: string;
  email: string;
  name: string | null;
  role: OrganizationRole;
  joinedAt: string;
}

export interface Invitation {
  id: string;
  organizationId: string;
  organizationName: string;
  email: string;
  role: Exclude<OrganizationRole, "owner">;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  inviteToken?: string;
  acceptPath?: string;
}

export interface OnboardingProgress {
  organizationId: string;
  completedSteps: string[];
  steps: string[];
  updatedAt: string;
}

export interface PublicStatus {
  status: "operational" | "degraded" | "outage";
  checkedAt: string;
  components: Array<{ name: string; status: "operational" | "degraded" | "outage" }>;
  incidents: Array<{ id: string; title: string; severity: string; status: string; message: string; startedAt: string; resolvedAt: string | null }>;
  maintenance: Array<{ id: string; title: string; message: string; startsAt: string; endsAt: string }>;
}

export interface SecurityPolicy {
  retentionDays: 7 | 30 | 90 | 180 | 365;
  redactEmails: boolean;
  redactPhoneNumbers: boolean;
  customRedactFields: string[];
  ipAllowlistEnabled: boolean;
  allowedNetworks: string[];
}

export interface UsageSummary {
  monthStart: string;
  plan: { key: "free" | "team" | "business"; name: string; status: string; limits: { events: number; requests: number; bandwidthBytes: number; storageBytes: number }; features: Record<string, unknown> };
  usage: { ingestionRequests: number; eventsIngested: number; eventsStored: number; bandwidthBytes: number; storageBytes: number; rateLimitedRequests: number; quotaRejectedRequests: number; activeServices: number; activeEnvironments: number; activeApiKeys: number };
}

export interface Environment {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  environmentType: "development" | "staging" | "production" | "custom";
  createdAt: string;
}

export interface AuthResponse {
  user: User;
  projects: Project[];
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
  http: { method: string | null; route: string | null; statusCode: number | null } | null;
  queue: { name: string | null; jobId: string | null; jobName: string | null; attempt: number | null } | null;
  error: { name: string; message: string } | null;
  data: Record<string, unknown>;
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

export interface TraceResponse {
  traceId: string;
  events: DashboardEvent[];
}

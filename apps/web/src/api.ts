import type {
  ApiKeySummary, AuthResponse, Environment, EventPage, Invitation, OnboardingProgress,
  Organization, OrganizationRole, OverviewMetrics, Project, TeamMember, TraceResponse,
  PublicStatus, SecurityPolicy, UsageSummary,
} from "./types.js";
import { webEnvironment } from "./env.js";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions extends RequestInit {
  environmentId?: string;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (options.environmentId) headers.set("x-environment-id", options.environmentId);
  const response = await fetch(`${webEnvironment.apiUrl}${path}`, { ...options, headers, credentials: "include" });
  if (!response.ok) {
    let message = `Request failed with HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Preserve the status-based fallback when a proxy returns a non-JSON error page.
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  status: () => request<PublicStatus>("/v1/status"),
  login: (email: string, password: string) =>
    request<AuthResponse>("/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  signup: (name: string, email: string, password: string) =>
    request<AuthResponse>("/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    }),
  requestPasswordReset: (email: string) => request<{ message: string }>("/v1/auth/password-reset/request", {
    method: "POST", body: JSON.stringify({ email }),
  }),
  confirmPasswordReset: (token: string, password: string) => request<void>("/v1/auth/password-reset/confirm", {
    method: "POST", body: JSON.stringify({ token, password }),
  }),
  logout: () => request<void>("/v1/auth/logout", { method: "POST" }),
  me: () => request<AuthResponse>("/v1/auth/me"),
  organizations: () => request<{ items: Organization[] }>("/v1/organizations"),
  usage: (organizationId: string) => request<UsageSummary>(`/v1/organizations/${organizationId}/usage`),
  security: (organizationId: string) => request<SecurityPolicy>(`/v1/organizations/${organizationId}/security`),
  updateSecurity: (organizationId: string, policy: Pick<SecurityPolicy, "retentionDays" | "redactEmails" | "redactPhoneNumbers" | "customRedactFields">) => request<SecurityPolicy>(`/v1/organizations/${organizationId}/security`, { method: "PATCH", body: JSON.stringify(policy) }),
  updateAllowlist: (environmentId: string, enabled: boolean, networks: string[]) => request<SecurityPolicy>(`/v1/environments/${environmentId}/ip-allowlist`, { method: "PATCH", body: JSON.stringify({ enabled, networks }) }),
  createOrganization: (name: string, slug: string) => request<Organization>("/v1/organizations", {
    method: "POST", body: JSON.stringify({ name, slug }),
  }),
  createProject: (organizationId: string, name: string, slug: string) => request<Project>(`/v1/organizations/${organizationId}/projects`, {
    method: "POST", body: JSON.stringify({ name, slug }),
  }),
  createEnvironment: (projectId: string, name: string, slug: string, environmentType: Environment["environmentType"]) => request<Environment>(`/v1/projects/${projectId}/environments`, {
    method: "POST", body: JSON.stringify({ name, slug, environmentType }),
  }),
  keys: (environmentId: string) => request<{ items: ApiKeySummary[] }>(`/v1/environments/${environmentId}/api-keys`),
  createKey: (environmentId: string, name: string) => request<ApiKeySummary>(`/v1/environments/${environmentId}/api-keys`, {
    method: "POST", body: JSON.stringify({ name }),
  }),
  revokeKey: (environmentId: string, keyId: string) => request<void>(`/v1/environments/${environmentId}/api-keys/${keyId}`, { method: "DELETE" }),
  members: (organizationId: string) => request<{ items: TeamMember[] }>(`/v1/organizations/${organizationId}/members`),
  updateMember: (organizationId: string, memberId: string, role: OrganizationRole) => request<void>(`/v1/organizations/${organizationId}/members/${memberId}`, {
    method: "PATCH", body: JSON.stringify({ role }),
  }),
  removeMember: (organizationId: string, memberId: string) => request<void>(`/v1/organizations/${organizationId}/members/${memberId}`, { method: "DELETE" }),
  invitations: (organizationId: string) => request<{ items: Invitation[] }>(`/v1/organizations/${organizationId}/invitations`),
  invite: (organizationId: string, email: string, role: Exclude<OrganizationRole, "owner">) => request<Invitation>(`/v1/organizations/${organizationId}/invitations`, {
    method: "POST", body: JSON.stringify({ email, role }),
  }),
  invitation: (token: string) => request<Invitation>(`/v1/invitations/${encodeURIComponent(token)}`),
  acceptInvitation: (token: string) => request<void>(`/v1/invitations/${encodeURIComponent(token)}/accept`, { method: "POST" }),
  onboarding: (organizationId: string) => request<OnboardingProgress>(`/v1/organizations/${organizationId}/onboarding`),
  completeOnboarding: (organizationId: string, step: string) => request<OnboardingProgress>(`/v1/organizations/${organizationId}/onboarding`, {
    method: "PATCH", body: JSON.stringify({ step }),
  }),
  events: (environmentId: string, query: URLSearchParams, signal?: AbortSignal) =>
    request<EventPage>(`/v1/events?${query.toString()}`, { environmentId, signal }),
  trace: (environmentId: string, traceId: string, signal?: AbortSignal) =>
    request<TraceResponse>(`/v1/traces/${encodeURIComponent(traceId)}`, { environmentId, signal }),
  overview: (environmentId: string, range: OverviewMetrics["range"], signal?: AbortSignal) =>
    request<OverviewMetrics>(`/v1/metrics/overview?range=${range}`, { environmentId, signal }),
};

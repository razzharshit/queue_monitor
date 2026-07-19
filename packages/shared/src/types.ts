export const EVENT_TYPES = [
  "http_request",
  "queue_job",
  "queue_retry",
  "queue_failed",
  "webhook_received",
] as const;

export const EVENT_STATUSES = [
  "success",
  "failure",
  "pending",
  "processing",
  "retrying",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];
export type EventStatus = (typeof EVENT_STATUSES)[number];

export interface SdkInfo {
  name: string;
  version: string;
  service: string;
  environment: string;
}

export interface IngestEvent {
  eventId: string;
  traceId: string | null;
  parentEventId: string | null;
  type: EventType;
  status: EventStatus;
  source: string;
  occurredAt: string;
  durationMs: number | null;
  data: Record<string, unknown>;
}

export interface AuthenticatedKey {
  id: string;
  organizationId: string;
  projectId: string;
  environmentId: string;
}

export interface RejectedEvent {
  eventId: string | null;
  reason: string;
}

export interface InsertResult {
  accepted: number;
  duplicates: number;
}

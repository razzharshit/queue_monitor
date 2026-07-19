import {
  EVENT_STATUSES,
  EVENT_TYPES,
  type EventStatus,
  type EventType,
  type IngestEvent,
  type RejectedEvent,
  type SdkInfo,
} from "./types.js";

export const MAX_EVENTS_PER_BATCH = 100;
export const MAX_METADATA_BYTES = 10 * 1024;
export const MAX_EVENT_BYTES = 16 * 1024;
export const MAX_NESTING_DEPTH = 12;

export interface EventValidationLimits {
  maxEventBytes?: number;
  maxMetadataBytes?: number;
  maxNestingDepth?: number;
}

export interface RedactionOptions {
  customFields?: string[];
  redactEmails?: boolean;
  redactPhoneNumbers?: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const OTEL_TRACE_ID_RE = /^(?!0{32}$)[0-9a-f]{32}$/i;
const UTC_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const DEFAULT_SENSITIVE_FIELDS = new Set([
  "body",
  "rawbody",
  "requestbody",
  "responsebody",
]);

const ALLOWED_STATUSES: Record<EventType, ReadonlySet<EventStatus>> = {
  http_request: new Set(["success", "failure"]),
  queue_job: new Set(["pending", "processing", "success"]),
  queue_retry: new Set(["retrying"]),
  queue_failed: new Set(["failure"]),
  webhook_received: new Set(["success", "failure"]),
};

export class BatchValidationError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const REDACTED = "[REDACTED]";
const DEFAULT_REDACT_FIELDS = new Set([
  "authorization", "cookie", "password", "passwd", "passcode", "token", "accesstoken",
  "refreshtoken", "apikey", "apisecret", "secret", "clientsecret", "cardnumber", "cvv", "cvc", "ssn",
]);
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_RE = /(?<!\d)(?:\+?\d[\d ()-]{7,}\d)(?!\d)/g;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/g;
const CARD_CANDIDATE_RE = /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g;

function validCardNumber(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let digit = Number(digits[index]);
    if (double) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

function redactString(value: string, options: RedactionOptions): string {
  if (/^(?:bearer|basic)\s+\S+/i.test(value)) return REDACTED;
  if (UTC_ISO_RE.test(value) && !Number.isNaN(Date.parse(value))) return value;
  let result = value.replace(SSN_RE, REDACTED).replace(CARD_CANDIDATE_RE, (candidate) => validCardNumber(candidate) ? REDACTED : candidate);
  if (options.redactEmails) result = result.replace(EMAIL_RE, REDACTED);
  if (options.redactPhoneNumbers) result = result.replace(PHONE_RE, REDACTED);
  return result;
}

export function redactTelemetryData(value: unknown, options: RedactionOptions = {}): unknown {
  const keys = new Set([...DEFAULT_REDACT_FIELDS, ...(options.customFields ?? []).map((field) => field.toLowerCase().replace(/[_-]/g, ""))]);
  const visit = (current: unknown): unknown => {
    if (typeof current === "string") return redactString(current, options);
    if (Array.isArray(current)) return current.map(visit);
    if (!isRecord(current)) return current;
    return Object.fromEntries(Object.entries(current).map(([key, nested]) => [
      key,
      keys.has(key.toLowerCase().replace(/[_-]/g, "")) ? REDACTED : visit(nested),
    ]));
  };
  return visit(value);
}

function nestingDepth(value: unknown, depth = 0): number {
  if (Array.isArray(value)) return value.length === 0 ? depth : Math.max(...value.map((item) => nestingDepth(item, depth + 1)));
  if (!isRecord(value)) return depth;
  const values = Object.values(value);
  return values.length === 0 ? depth : Math.max(...values.map((item) => nestingDepth(item, depth + 1)));
}

function requiredString(
  object: Record<string, unknown>,
  field: string,
  path = field,
): string {
  const value = object[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string`);
  }
  return value;
}

function optionalUuid(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new Error(`${field} must be a UUID or null`);
  }
  return value;
}

function optionalTraceId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || (!UUID_RE.test(value) && !OTEL_TRACE_ID_RE.test(value))) {
    throw new Error("traceId must be a UUID, a W3C 32-character trace ID, or null");
  }
  return value.toLowerCase();
}

function requiredInteger(
  object: Record<string, unknown>,
  field: string,
  options: { min?: number; max?: number } = {},
): number {
  const value = object[field];
  if (!Number.isInteger(value)) throw new Error(`data.${field} must be an integer`);
  const number = value as number;
  if (options.min !== undefined && number < options.min) {
    throw new Error(`data.${field} must be greater than or equal to ${options.min}`);
  }
  if (options.max !== undefined && number > options.max) {
    throw new Error(`data.${field} must be less than or equal to ${options.max}`);
  }
  return number;
}

function validateError(data: Record<string, unknown>, required: boolean): void {
  const value = data.error;
  if (value === undefined && !required) return;
  if (!isRecord(value)) throw new Error("data.error must be an object");
  requiredString(value, "name", "data.error.name");
  requiredString(value, "message", "data.error.message");
  if (value.stack !== undefined && typeof value.stack !== "string") {
    throw new Error("data.error.stack must be a string");
  }
}

function validateHttp(data: Record<string, unknown>, status: EventStatus): void {
  requiredString(data, "method", "data.method");
  const route = requiredString(data, "route", "data.route");
  if (/^https?:\/\//i.test(route) || /[?#]/.test(route)) {
    throw new Error("data.route must be a route template, not a URL with query or fragment");
  }
  const hasLikelyIdentifier = route
    .split("/")
    .some((part) => /^\d{4,}$/.test(part) || UUID_RE.test(part));
  if (hasLikelyIdentifier) {
    throw new Error("data.route must use parameter placeholders instead of high-cardinality IDs");
  }
  requiredInteger(data, "statusCode", { min: 100, max: 599 });
  validateError(data, status === "failure");
}

function validateQueueBase(data: Record<string, unknown>): void {
  requiredString(data, "queueName", "data.queueName");
  requiredString(data, "jobId", "data.jobId");
  requiredString(data, "jobName", "data.jobName");
  requiredInteger(data, "attempt", { min: 0 });
}

function validateTypeData(
  type: EventType,
  status: EventStatus,
  data: Record<string, unknown>,
): void {
  switch (type) {
    case "http_request":
      validateHttp(data, status);
      break;
    case "queue_job":
      validateQueueBase(data);
      validateError(data, status === "failure");
      break;
    case "queue_retry": {
      validateQueueBase(data);
      const maxAttempts = requiredInteger(data, "maxAttempts", { min: 1 });
      const attempt = data.attempt as number;
      if (attempt > maxAttempts) throw new Error("data.attempt must not exceed data.maxAttempts");
      const nextRetryAt = requiredString(data, "nextRetryAt", "data.nextRetryAt");
      if (!UTC_ISO_RE.test(nextRetryAt) || Number.isNaN(Date.parse(nextRetryAt))) {
        throw new Error("data.nextRetryAt must be an ISO-8601 UTC timestamp");
      }
      validateError(data, true);
      break;
    }
    case "queue_failed": {
      validateQueueBase(data);
      const maxAttempts = requiredInteger(data, "maxAttempts", { min: 1 });
      const attempt = data.attempt as number;
      if (attempt > maxAttempts) throw new Error("data.attempt must not exceed data.maxAttempts");
      validateError(data, true);
      break;
    }
    case "webhook_received":
      requiredString(data, "provider", "data.provider");
      requiredString(data, "eventType", "data.eventType");
      requiredString(data, "providerEventId", "data.providerEventId");
      requiredInteger(data, "statusCode", { min: 100, max: 599 });
      validateError(data, status === "failure");
      break;
  }
}

function rejectSensitiveFields(
  value: unknown,
  allowlist: ReadonlySet<string>,
  path = "data",
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSensitiveFields(item, allowlist, `${path}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, nested] of Object.entries(value)) {
    const normalized = key.toLowerCase();
    if (DEFAULT_SENSITIVE_FIELDS.has(normalized) && !allowlist.has(normalized)) {
      throw new Error(`${path}.${key} is not allowed`);
    }
    rejectSensitiveFields(nested, allowlist, `${path}.${key}`);
  }
}

export function parseAllowlist(value: string | undefined): ReadonlySet<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function validateSdk(value: unknown): SdkInfo {
  if (!isRecord(value)) throw new BatchValidationError("sdk must be an object");
  try {
    return {
      name: requiredString(value, "name", "sdk.name"),
      version: requiredString(value, "version", "sdk.version"),
      service: requiredString(value, "service", "sdk.service"),
      environment: requiredString(value, "environment", "sdk.environment"),
    };
  } catch (error) {
    throw new BatchValidationError((error as Error).message);
  }
}

export function validateEvent(
  value: unknown,
  allowlist: ReadonlySet<string> = new Set(),
  limits: EventValidationLimits = {},
): IngestEvent {
  if (!isRecord(value)) throw new Error("event must be an object");
  const eventBytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  if (eventBytes > (limits.maxEventBytes ?? MAX_EVENT_BYTES)) {
    throw new Error(`event must not exceed ${limits.maxEventBytes ?? MAX_EVENT_BYTES} bytes`);
  }

  const eventId = requiredString(value, "eventId");
  if (!UUID_RE.test(eventId)) throw new Error("eventId must be a UUID");
  const traceId = optionalTraceId(value.traceId);
  const parentEventId = optionalUuid(value.parentEventId, "parentEventId");

  if (!EVENT_TYPES.includes(value.type as EventType)) {
    throw new Error(`type must be one of: ${EVENT_TYPES.join(", ")}`);
  }
  if (!EVENT_STATUSES.includes(value.status as EventStatus)) {
    throw new Error(`status must be one of: ${EVENT_STATUSES.join(", ")}`);
  }
  const type = value.type as EventType;
  const status = value.status as EventStatus;
  if (!ALLOWED_STATUSES[type].has(status)) {
    throw new Error(`status ${status} is not valid for type ${type}`);
  }
  const source = requiredString(value, "source");
  const occurredAt = requiredString(value, "occurredAt");
  if (!UTC_ISO_RE.test(occurredAt) || Number.isNaN(Date.parse(occurredAt))) {
    throw new Error("occurredAt must be an ISO-8601 UTC timestamp");
  }

  let durationMs: number | null = null;
  if (value.durationMs !== undefined && value.durationMs !== null) {
    if (!Number.isInteger(value.durationMs)) throw new Error("durationMs must be an integer");
    durationMs = value.durationMs as number;
    if (durationMs < 0) throw new Error("durationMs must be greater than or equal to 0");
  }

  if (!isRecord(value.data)) throw new Error("data must be an object");
  const metadataBytes = Buffer.byteLength(JSON.stringify(value.data), "utf8");
  const maxMetadataBytes = limits.maxMetadataBytes ?? MAX_METADATA_BYTES;
  if (metadataBytes > maxMetadataBytes) {
    throw new Error(`data must not exceed ${maxMetadataBytes} bytes`);
  }
  const maxNestingDepth = limits.maxNestingDepth ?? MAX_NESTING_DEPTH;
  if (nestingDepth(value.data) > maxNestingDepth) throw new Error(`data must not exceed ${maxNestingDepth} nested levels`);
  rejectSensitiveFields(value.data, allowlist);
  validateTypeData(type, status, value.data);

  return {
    eventId,
    traceId,
    parentEventId,
    type,
    status,
    source,
    occurredAt,
    durationMs,
    data: value.data,
  };
}

export function validateBatchShape(value: unknown, maxEvents = MAX_EVENTS_PER_BATCH): {
  sdk: SdkInfo;
  events: unknown[];
} {
  if (!isRecord(value)) throw new BatchValidationError("request body must be an object");
  const sdk = validateSdk(value.sdk);
  if (!Array.isArray(value.events)) throw new BatchValidationError("events must be an array");
  if (value.events.length > maxEvents) {
    throw new BatchValidationError(`events must contain at most ${maxEvents} items`);
  }
  return { sdk, events: value.events };
}

export function rejectionFor(value: unknown, error: unknown): RejectedEvent {
  const eventId = isRecord(value) && typeof value.eventId === "string" ? value.eventId : null;
  return { eventId, reason: error instanceof Error ? error.message : "invalid event" };
}

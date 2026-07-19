import { randomUUID } from "node:crypto";
import type { EventStatus, EventType, IngestEvent, SdkInfo } from "@queue-monitor/shared";

export interface TelemetryEmitter {
  readonly service: string;
  emit(event: IngestEvent): void;
}

export type OverflowStrategy = "drop-oldest" | "drop-newest";
export type SdkLogLevel = "debug" | "info" | "warn" | "error";

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  jitter?: boolean;
}

export interface QueueMonitorOptions extends Omit<SdkInfo, "name" | "version"> {
  apiKey: string | undefined;
  endpoint: string;
  sampleRate?: number;
  redact?: string[];
  batchSize?: number;
  flushIntervalMs?: number;
  maxBufferSize?: number;
  overflowStrategy?: OverflowStrategy;
  requestTimeoutMs?: number;
  retry?: RetryOptions;
  debug?: boolean;
  logger?: (level: SdkLogLevel, message: string, context?: Record<string, unknown>) => void;
  fetch?: typeof globalThis.fetch;
  onError?: (error: Error) => void;
  /** Primarily useful for deterministic tests. */
  random?: () => number;
}

export interface SdkDiagnostics {
  eventsQueued: number;
  eventsSent: number;
  eventsDropped: number;
  retryCount: number;
  bufferedEvents: number;
  lastError: string | null;
  lastFlushAt: string | null;
}

export interface CaptureEvent {
  type: EventType;
  status: EventStatus;
  data: Record<string, unknown>;
  traceId?: string | null;
  parentEventId?: string | null;
  source?: string;
  occurredAt?: string;
  durationMs?: number | null;
  eventId?: string;
}

interface BatchResponse {
  accepted: number;
  duplicates: number;
  rejected: Array<{ eventId: string | null; reason: string }>;
}

interface ValidatedConfig {
  apiKey: string;
  endpoint: string;
  service: string;
  environment: string;
  sampleRate: number;
  redact: string[];
  batchSize: number;
  flushIntervalMs: number;
  maxBufferSize: number;
  overflowStrategy: OverflowStrategy;
  requestTimeoutMs: number;
  retry: Required<RetryOptions>;
  debug: boolean;
}

const DEFAULT_REDACT = ["authorization", "cookie", "password", "token", "apiKey", "cardNumber"];

function boundedInteger(value: number | undefined, fallback: number, minimum: number, maximum: number, name: string): number {
  const candidate = value ?? fallback;
  if (!Number.isInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return candidate;
}

export function validateMonitorConfig(options: QueueMonitorOptions): ValidatedConfig {
  if (!options || typeof options !== "object") throw new Error("monitor.init configuration is required");
  if (typeof options.apiKey !== "string" || !/^qmon_live_[A-Za-z0-9_-]{8,}$/.test(options.apiKey)) {
    throw new Error("apiKey is required and must start with qmon_live_");
  }
  let endpoint: URL;
  try {
    endpoint = new URL(options.endpoint);
  } catch {
    throw new Error("endpoint must be a valid absolute URL");
  }
  if (!["http:", "https:"].includes(endpoint.protocol)) throw new Error("endpoint must use http:// or https://");
  if (!options.service?.trim()) throw new Error("service is required");
  if (!options.environment?.trim()) throw new Error("environment is required");
  const sampleRate = options.sampleRate ?? 1;
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1) {
    throw new Error("sampleRate must be between 0 and 1");
  }
  if (options.redact && (!Array.isArray(options.redact) || options.redact.some((key) => typeof key !== "string" || !key.trim()))) {
    throw new Error("redact must be an array of non-empty field names");
  }
  const batchSize = boundedInteger(options.batchSize, 25, 1, 100, "batchSize");
  const maxBufferSize = boundedInteger(options.maxBufferSize, 1_000, 1, 100_000, "maxBufferSize");
  if (options.overflowStrategy && !["drop-oldest", "drop-newest"].includes(options.overflowStrategy)) {
    throw new Error("overflowStrategy must be drop-oldest or drop-newest");
  }
  const initialDelayMs = boundedInteger(options.retry?.initialDelayMs, 200, 0, 60_000, "retry.initialDelayMs");
  const maxDelayMs = boundedInteger(options.retry?.maxDelayMs, 5_000, initialDelayMs, 300_000, "retry.maxDelayMs");
  return {
    apiKey: options.apiKey,
    endpoint: endpoint.toString().replace(/\/$/, ""),
    service: options.service.trim(),
    environment: options.environment.trim(),
    sampleRate,
    redact: [...new Set([...DEFAULT_REDACT, ...(options.redact ?? [])].map((key) => key.toLowerCase()))],
    batchSize,
    flushIntervalMs: boundedInteger(options.flushIntervalMs, 500, 50, 60_000, "flushIntervalMs"),
    maxBufferSize,
    overflowStrategy: options.overflowStrategy ?? "drop-oldest",
    requestTimeoutMs: boundedInteger(options.requestTimeoutMs, 5_000, 100, 120_000, "requestTimeoutMs"),
    retry: {
      maxAttempts: boundedInteger(options.retry?.maxAttempts, 3, 1, 10, "retry.maxAttempts"),
      initialDelayMs,
      maxDelayMs,
      jitter: options.retry?.jitter ?? true,
    },
    debug: options.debug ?? false,
  };
}

function redactValue(value: unknown, keys: ReadonlySet<string>): unknown {
  if (Array.isArray(value)) return value.map((item) => redactValue(item, keys));
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    keys.has(key.toLowerCase()) ? "[REDACTED]" : redactValue(item, keys),
  ]));
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class QueueMonitorClient implements TelemetryEmitter {
  readonly service: string;
  private readonly apiKey: string;
  private readonly batchUrl: string;
  private readonly sdk: SdkInfo;
  private readonly config: ValidatedConfig;
  private readonly redactedKeys: ReadonlySet<string>;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly onError?: (error: Error) => void;
  private readonly logger?: QueueMonitorOptions["logger"];
  private readonly random: () => number;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly buffer: IngestEvent[] = [];
  private readonly metrics: Omit<SdkDiagnostics, "bufferedEvents"> = {
    eventsQueued: 0,
    eventsSent: 0,
    eventsDropped: 0,
    retryCount: 0,
    lastError: null,
    lastFlushAt: null,
  };
  private flushing: Promise<void> | null = null;
  private closed = false;

  constructor(options: QueueMonitorOptions) {
    this.config = validateMonitorConfig(options);
    this.service = this.config.service;
    this.apiKey = this.config.apiKey;
    this.batchUrl = `${this.config.endpoint}/v1/events/batch`;
    this.sdk = {
      name: "@queue-monitor/node",
      version: "1.0.0",
      service: this.config.service,
      environment: this.config.environment,
    };
    this.redactedKeys = new Set(this.config.redact);
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) throw new Error("global fetch is unavailable; provide the fetch option");
    this.onError = options.onError;
    this.logger = options.logger;
    this.random = options.random ?? Math.random;
    this.timer = setInterval(() => void this.flush(), this.config.flushIntervalMs);
    this.timer.unref?.();
    this.log("debug", "sdk_initialized", {
      endpoint: this.config.endpoint,
      service: this.config.service,
      environment: this.config.environment,
      maxBufferSize: this.config.maxBufferSize,
    });
  }

  emit(event: IngestEvent): void {
    if (this.closed) {
      this.recordDrop(1, "client_closed");
      return;
    }
    if (this.random() > this.config.sampleRate) {
      this.recordDrop(1, "sampled_out");
      return;
    }
    const safeEvent = { ...event, data: redactValue(event.data, this.redactedKeys) as Record<string, unknown> };
    if (this.buffer.length >= this.config.maxBufferSize) {
      if (this.config.overflowStrategy === "drop-newest") {
        this.recordDrop(1, "buffer_full_drop_newest");
        return;
      }
      this.buffer.shift();
      this.recordDrop(1, "buffer_full_drop_oldest");
    }
    this.buffer.push(safeEvent);
    this.metrics.eventsQueued += 1;
    this.log("debug", "event_queued", { eventId: safeEvent.eventId, bufferedEvents: this.buffer.length });
    if (this.buffer.length >= this.config.batchSize) void this.flush();
  }

  capture(event: CaptureEvent): string {
    const eventId = event.eventId ?? randomUUID();
    this.emit({
      eventId,
      traceId: event.traceId ?? null,
      parentEventId: event.parentEventId ?? null,
      type: event.type,
      status: event.status,
      source: event.source ?? this.service,
      occurredAt: event.occurredAt ?? new Date().toISOString(),
      durationMs: event.durationMs ?? null,
      data: event.data,
    });
    return eventId;
  }

  diagnostics(): Readonly<SdkDiagnostics> {
    return Object.freeze({ ...this.metrics, bufferedEvents: this.buffer.length });
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (this.buffer.length === 0) return;
    this.flushing = this.sendNextBatch().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.timer);
    if (this.flushing) await this.flushing;
    while (this.buffer.length > 0) await this.flush();
  }

  private async sendNextBatch(): Promise<void> {
    const events = this.buffer.splice(0, this.config.batchSize);
    for (let attempt = 1; attempt <= this.config.retry.maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
      try {
        const response = await this.fetchImpl(this.batchUrl, {
          method: "POST",
          headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify({ sdk: this.sdk, events }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const error = new Error(`ingestion returned HTTP ${response.status}`);
          if (!retryableStatus(response.status) || attempt === this.config.retry.maxAttempts) {
            this.recordError(error);
            this.recordDrop(events.length, retryableStatus(response.status) ? "retries_exhausted" : "non_retryable_response");
            return;
          }
          await this.waitForRetry(attempt, response.headers.get("retry-after"));
          continue;
        }
        const result = (await response.json()) as BatchResponse;
        this.metrics.eventsSent += result.accepted + result.duplicates;
        this.metrics.lastFlushAt = new Date().toISOString();
        if (result.rejected.length > 0) {
          this.recordDrop(result.rejected.length, "server_rejected");
          for (const rejected of result.rejected) {
            this.recordError(new Error(`event ${rejected.eventId ?? "unknown"} rejected: ${rejected.reason}`));
          }
        }
        this.log("debug", "batch_sent", { events: events.length, accepted: result.accepted, duplicates: result.duplicates });
        return;
      } catch (value) {
        const error = value instanceof Error ? value : new Error("failed to send telemetry batch");
        if (attempt === this.config.retry.maxAttempts) {
          this.recordError(error);
          this.recordDrop(events.length, "retries_exhausted");
          return;
        }
        await this.waitForRetry(attempt, null);
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  private async waitForRetry(attempt: number, retryAfter: string | null): Promise<void> {
    this.metrics.retryCount += 1;
    const serverDelay = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter) ? Number(retryAfter) * 1_000 : 0;
    const exponential = Math.min(
      this.config.retry.initialDelayMs * (2 ** (attempt - 1)),
      this.config.retry.maxDelayMs,
    );
    const base = Math.max(serverDelay, exponential);
    const durationMs = this.config.retry.jitter ? Math.round(base * (0.5 + this.random() * 0.5)) : base;
    this.log("warn", "batch_retry_scheduled", { attempt: attempt + 1, delayMs: durationMs });
    if (durationMs > 0) await delay(durationMs);
  }

  private recordDrop(count: number, reason: string): void {
    this.metrics.eventsDropped += count;
    this.log("warn", "events_dropped", { count, reason, bufferedEvents: this.buffer.length });
  }

  private recordError(error: Error): void {
    this.metrics.lastError = error.message;
    this.log("error", "sdk_delivery_error", { message: error.message });
    try { this.onError?.(error); } catch { /* User callbacks cannot destabilize the host process. */ }
  }

  private log(level: SdkLogLevel, message: string, context?: Record<string, unknown>): void {
    try {
      if (this.logger) this.logger(level, message, context);
      else if (this.config.debug) console[level === "debug" ? "log" : level](JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        component: "queue-monitor-sdk",
        message,
        ...context,
      }));
    } catch {
      // Logging is diagnostic-only and must never affect the host application.
    }
  }
}

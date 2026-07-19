import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import type { IngestEvent } from "@queue-monitor/shared";
import { ingestionEndpoint, loadLocalEnvironment, requiredEnvironment } from "./demo-support.js";

const DAY_MS = 24 * 60 * 60 * 1_000;
const FIXTURE_SEED = "queue-monitor-demo-workspace-v1";

interface IngestionResponse {
  accepted: number;
  duplicates: number;
  rejected: Array<{ eventId: string | null; reason: string }>;
}

export interface DemoFixtureSummary {
  events: IngestEvent[];
  standaloneHttp: number;
  successTraces: number;
  retryTraces: number;
  failureTraces: number;
}

function deterministicUuid(label: string): string {
  const bytes = Buffer.from(createHash("sha256").update(`${FIXTURE_SEED}:${label}`).digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function deterministicFraction(label: string): number {
  return createHash("sha256").update(`${FIXTURE_SEED}:${label}`).digest().readUInt32BE(0) / 0xffff_ffff;
}

function historicalStart(anchor: Date, label: string): number {
  return anchor.getTime() - (0.2 + deterministicFraction(label) * 29.6) * DAY_MS;
}

function occurredAt(start: number, order: number): string {
  return new Date(start + order * 750).toISOString();
}

function tracedEvent(
  scenario: "success" | "retry" | "failure",
  index: number,
  order: number,
  start: number,
  traceId: string,
  parentEventId: string | null,
  values: Omit<IngestEvent, "eventId" | "traceId" | "parentEventId" | "occurredAt">,
): IngestEvent {
  return {
    ...values,
    eventId: deterministicUuid(`trace:${scenario}:${index}:event:${order}`),
    traceId,
    parentEventId,
    occurredAt: occurredAt(start, order),
    data: { ...values.data, demoScenario: scenario },
  };
}

function buildTrace(scenario: "success" | "retry" | "failure", index: number, anchor: Date): IngestEvent[] {
  const traceId = deterministicUuid(`trace:${scenario}:${index}`);
  const start = historicalStart(anchor, `trace-time:${scenario}:${index}`);
  const notification = index % 4 === 0;
  const queueName = notification ? "notifications" : "order-processing";
  const worker = notification ? "notification-worker" : "payment-worker";
  const jobName = notification ? "send-order-confirmation" : "process-order-payment";
  const jobId = `demo-${scenario}-${String(index + 1).padStart(3, "0")}`;
  const events: IngestEvent[] = [];
  const add = (values: Omit<IngestEvent, "eventId" | "traceId" | "parentEventId" | "occurredAt">): IngestEvent => {
    const event = tracedEvent(scenario, index, events.length, start, traceId, events.at(-1)?.eventId ?? null, values);
    events.push(event);
    return event;
  };
  const queueData = (attempt: number) => ({ queueName, jobId, jobName, attempt });
  add({
    type: "http_request", status: "success", source: "orders-api", durationMs: 35 + index % 180,
    data: { method: "POST", route: "/orders", statusCode: 202 },
  });
  add({ type: "queue_job", status: "pending", source: "orders-api", durationMs: null, data: queueData(0) });
  add({ type: "queue_job", status: "processing", source: worker, durationMs: null, data: queueData(1) });
  if (scenario === "success") {
    add({ type: "queue_job", status: "success", source: worker, durationMs: 80 + index % 240, data: queueData(1) });
    return events;
  }

  const providerError = notification
    ? { name: "NotificationProviderTimeout", message: "Email provider timed out while accepting the notification" }
    : { name: "PaymentProviderUnavailable", message: "Payment provider returned a temporary upstream failure" };
  add({
    type: "queue_retry", status: "retrying", source: worker, durationMs: null,
    data: { ...queueData(1), maxAttempts: scenario === "failure" ? 3 : 2, nextRetryAt: occurredAt(start, events.length + 1), error: providerError },
  });
  add({ type: "queue_job", status: "processing", source: worker, durationMs: null, data: queueData(2) });
  if (scenario === "retry") {
    add({ type: "queue_job", status: "success", source: worker, durationMs: 140 + index % 260, data: queueData(2) });
    return events;
  }
  add({
    type: "queue_retry", status: "retrying", source: worker, durationMs: null,
    data: { ...queueData(2), maxAttempts: 3, nextRetryAt: occurredAt(start, events.length + 1), error: providerError },
  });
  add({ type: "queue_job", status: "processing", source: worker, durationMs: null, data: queueData(3) });
  add({
    type: "queue_failed", status: "failure", source: worker, durationMs: 420 + index % 200,
    data: { ...queueData(3), maxAttempts: 3, error: { ...providerError, message: `${providerError.message}; retry budget exhausted` } },
  });
  return events;
}

export function buildDemoEvents(anchor = new Date()): DemoFixtureSummary {
  const events: IngestEvent[] = [];
  const routes = [
    { method: "GET", route: "/orders", successCode: 200 },
    { method: "GET", route: "/orders/:orderId", successCode: 200 },
    { method: "POST", route: "/orders", successCode: 202 },
    { method: "POST", route: "/payments/:paymentId/confirm", successCode: 200 },
    { method: "POST", route: "/notifications", successCode: 202 },
    { method: "GET", route: "/health", successCode: 200 },
  ] as const;
  const standaloneHttp = 600;
  for (let index = 0; index < standaloneHttp; index += 1) {
    const route = routes[index % routes.length]!;
    const failed = index % 17 === 0;
    events.push({
      eventId: deterministicUuid(`http:${index}`),
      traceId: deterministicUuid(`http-trace:${index}`),
      parentEventId: null,
      type: "http_request",
      status: failed ? "failure" : "success",
      source: "orders-api",
      occurredAt: new Date(historicalStart(anchor, `http-time:${index}`)).toISOString(),
      durationMs: failed ? 450 + index % 900 : 12 + index % 280,
      data: {
        method: route.method,
        route: route.route,
        statusCode: failed ? 503 : route.successCode,
        demoScenario: "historical-http",
        ...(failed ? { error: { name: "UpstreamServiceUnavailable", message: "A dependency returned a temporary failure" } } : {}),
      },
    });
  }
  const successTraces = 100;
  const retryTraces = 25;
  const failureTraces = 10;
  for (let index = 0; index < successTraces; index += 1) events.push(...buildTrace("success", index, anchor));
  for (let index = 0; index < retryTraces; index += 1) events.push(...buildTrace("retry", index, anchor));
  for (let index = 0; index < failureTraces; index += 1) events.push(...buildTrace("failure", index, anchor));
  events.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId));
  return { events, standaloneHttp, successTraces, retryTraces, failureTraces };
}

async function sendBatch(endpoint: string, apiKey: string, events: IngestEvent[]): Promise<IngestionResponse> {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await fetch(`${endpoint}/v1/events/batch`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        sdk: { name: "@queue-monitor/demo-generator", version: "1.0.0", service: "demo-data-generator", environment: "demo" },
        events,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (response.ok) return await response.json() as IngestionResponse;
    if (response.status === 429 && attempt < 4) {
      const retryAfter = Math.min(30, Math.max(1, Number(response.headers.get("retry-after") ?? 1)));
      await new Promise((resolve) => setTimeout(resolve, retryAfter * 1_000));
      continue;
    }
    throw new Error(`ingestion returned HTTP ${response.status}: ${await response.text()}`);
  }
  throw new Error("ingestion retry budget exhausted");
}

export async function generateDemoData(anchor = new Date()): Promise<{ accepted: number; duplicates: number; total: number }> {
  loadLocalEnvironment();
  const apiKey = requiredEnvironment("DEMO_SEED_API_KEY", 24);
  const environmentId = requiredEnvironment("DEMO_ENVIRONMENT_ID");
  const endpoint = ingestionEndpoint();
  const health = await fetch(`${endpoint}/ready`, { signal: AbortSignal.timeout(5_000) }).catch((error) => {
    throw new Error(`ingestion API is unavailable at ${endpoint}; start npm run dev:api first`, { cause: error });
  });
  if (!health.ok) throw new Error(`ingestion API is not ready at ${endpoint}: HTTP ${health.status}`);
  const fixture = buildDemoEvents(anchor);
  let accepted = 0;
  let duplicates = 0;
  for (let offset = 0; offset < fixture.events.length; offset += 100) {
    const batch = fixture.events.slice(offset, offset + 100);
    const result = await sendBatch(endpoint, apiKey, batch);
    if (result.rejected.length > 0) {
      throw new Error(`demo ingestion rejected ${result.rejected.length} events: ${result.rejected.slice(0, 3).map((item) => `${item.eventId ?? "unknown"}: ${item.reason}`).join("; ")}`);
    }
    if (result.accepted + result.duplicates !== batch.length) throw new Error("ingestion response did not account for every demo event");
    accepted += result.accepted;
    duplicates += result.duplicates;
  }
  console.log(JSON.stringify({
    level: "info", event: "demo_history_generated", environmentId,
    accepted, duplicates, total: fixture.events.length,
    httpEvents: fixture.events.filter((event) => event.type === "http_request").length,
    successTraces: fixture.successTraces, retryTraces: fixture.retryTraces, failureTraces: fixture.failureTraces,
    days: 30,
  }));
  return { accepted, duplicates, total: fixture.events.length };
}

const mainModule = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === mainModule) await generateDemoData();

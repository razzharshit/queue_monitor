import assert from "node:assert/strict";
import test from "node:test";
import { QueueMonitorClient } from "../src/client.js";

const baseOptions = {
  apiKey: "qmon_live_test_secret_123",
  endpoint: "http://ingestion.test",
  service: "test-service",
  environment: "test",
  flushIntervalMs: 60_000,
};

const event = (eventId = "a7a266f2-f4ee-4fa5-b974-0a2e0e6fa284") => ({
  eventId,
  traceId: "7a9a3860-73fd-49cc-bf9c-58d5b2edbd5a",
  parentEventId: null,
  type: "http_request" as const,
  status: "success" as const,
  source: "test-service",
  occurredAt: "2026-07-16T12:30:15.185Z",
  durationMs: 2,
  data: { method: "GET", route: "/health", statusCode: 200 },
});

test("buffers and batch-sends events", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const client = new QueueMonitorClient({
    ...baseOptions,
    fetch: async (input, init) => {
      requests.push({
        url: String(input),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return new Response(JSON.stringify({ accepted: 1, duplicates: 0, rejected: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  client.emit(event());
  await client.flush();
  await client.close();

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "http://ingestion.test/v1/events/batch");
  assert.equal((requests[0]?.body.events as unknown[]).length, 1);
});

test("validates public configuration with actionable errors", () => {
  assert.throws(() => new QueueMonitorClient({ ...baseOptions, apiKey: undefined }), /apiKey is required/);
  assert.throws(() => new QueueMonitorClient({ ...baseOptions, endpoint: "ftp://bad" }), /http:\/\/ or https:\/\//);
  assert.throws(() => new QueueMonitorClient({ ...baseOptions, sampleRate: 2 }), /between 0 and 1/);
  assert.throws(() => new QueueMonitorClient({ ...baseOptions, maxBufferSize: 0 }), /maxBufferSize/);
});

test("redacts nested sensitive fields and reports diagnostics", async () => {
  let body: { events: Array<{ data: Record<string, unknown> }> } | undefined;
  const client = new QueueMonitorClient({
    ...baseOptions,
    fetch: async (_input, init) => {
      body = JSON.parse(String(init?.body)) as typeof body;
      return Response.json({ accepted: 1, duplicates: 0, rejected: [] });
    },
  });
  client.emit({ ...event(), data: { ...event().data, authorization: "Bearer secret", nested: { password: "secret" } } });
  await client.flush();
  assert.equal(body?.events[0]?.data.authorization, "[REDACTED]");
  assert.deepEqual(body?.events[0]?.data.nested, { password: "[REDACTED]" });
  assert.deepEqual(client.diagnostics(), {
    eventsQueued: 1,
    eventsSent: 1,
    eventsDropped: 0,
    retryCount: 0,
    bufferedEvents: 0,
    lastError: null,
    lastFlushAt: client.diagnostics().lastFlushAt,
  });
  await client.close();
});

test("retries retryable responses and never crashes after exhaustion", async () => {
  let attempts = 0;
  const client = new QueueMonitorClient({
    ...baseOptions,
    retry: { maxAttempts: 3, initialDelayMs: 0, maxDelayMs: 0, jitter: false },
    fetch: async () => {
      attempts += 1;
      return new Response("unavailable", { status: 503 });
    },
  });
  client.emit(event());
  await client.flush();
  assert.equal(attempts, 3);
  assert.equal(client.diagnostics().retryCount, 2);
  assert.equal(client.diagnostics().eventsDropped, 1);
  assert.match(client.diagnostics().lastError ?? "", /HTTP 503/);
  await client.close();
});

test("does not retry non-retryable responses", async () => {
  let attempts = 0;
  const client = new QueueMonitorClient({
    ...baseOptions,
    fetch: async () => {
      attempts += 1;
      return new Response("bad request", { status: 400 });
    },
  });
  client.emit(event());
  await client.flush();
  assert.equal(attempts, 1);
  assert.equal(client.diagnostics().eventsDropped, 1);
  await client.close();
});

test("applies a bounded drop-newest queue and sampling", async () => {
  const client = new QueueMonitorClient({
    ...baseOptions,
    batchSize: 100,
    maxBufferSize: 2,
    overflowStrategy: "drop-newest",
    sampleRate: 1,
    fetch: async () => Response.json({ accepted: 2, duplicates: 0, rejected: [] }),
  });
  client.emit(event("a7a266f2-f4ee-4fa5-b974-0a2e0e6fa281"));
  client.emit(event("a7a266f2-f4ee-4fa5-b974-0a2e0e6fa282"));
  client.emit(event("a7a266f2-f4ee-4fa5-b974-0a2e0e6fa283"));
  assert.equal(client.diagnostics().bufferedEvents, 2);
  assert.equal(client.diagnostics().eventsDropped, 1);
  await client.close();

  const sampled = new QueueMonitorClient({ ...baseOptions, sampleRate: 0, random: () => 0.5 });
  sampled.emit(event());
  assert.equal(sampled.diagnostics().eventsDropped, 1);
  assert.equal(sampled.diagnostics().bufferedEvents, 0);
  await sampled.close();
});

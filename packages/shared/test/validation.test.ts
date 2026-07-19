import assert from "node:assert/strict";
import test from "node:test";
import { redactTelemetryData, validateBatchShape, validateEvent } from "../src/validation.js";

const baseEvent = {
  eventId: "a7a266f2-f4ee-4fa5-b974-0a2e0e6fa284",
  traceId: "7a9a3860-73fd-49cc-bf9c-58d5b2edbd5a",
  parentEventId: null,
  type: "http_request",
  status: "success",
  source: "order-api",
  occurredAt: "2026-07-16T12:30:15.185Z",
  durationMs: 42,
  data: { method: "POST", route: "/orders/:orderId", statusCode: 201 },
};

test("accepts a valid HTTP event", () => {
  assert.deepEqual(validateEvent(baseEvent), baseEvent);
});

test("accepts a W3C OpenTelemetry trace ID", () => {
  const traceId = "0af7651916cd43dd8448eb211c80319c";
  assert.equal(validateEvent({ ...baseEvent, traceId }).traceId, traceId);
  assert.throws(() => validateEvent({ ...baseEvent, traceId: "0".repeat(32) }), /W3C 32-character trace ID/);
});

test("rejects negative duration", () => {
  assert.throws(
    () => validateEvent({ ...baseEvent, durationMs: -1 }),
    /durationMs must be greater than or equal to 0/,
  );
});

test("rejects raw bodies recursively", () => {
  assert.throws(
    () => validateEvent({ ...baseEvent, data: { ...baseEvent.data, nested: { body: "secret" } } }),
    /data\.nested\.body is not allowed/,
  );
});

test("allows explicitly allowlisted sensitive fields", () => {
  const event = {
    ...baseEvent,
    data: { ...baseEvent.data, headers: { "x-request-id": "req_1" } },
  };
  assert.deepEqual(validateEvent(event, new Set(["headers"])), event);
});

test("rejects oversized metadata using UTF-8 byte size", () => {
  assert.throws(
    () => validateEvent({ ...baseEvent, data: { ...baseEvent.data, padding: "é".repeat(6000) } }),
    /data must not exceed 10240 bytes/,
  );
});

test("requires failure details for failed requests", () => {
  assert.throws(
    () => validateEvent({ ...baseEvent, status: "failure" }),
    /data\.error must be an object/,
  );
});

test("rejects statuses that do not belong to an event type", () => {
  assert.throws(
    () => validateEvent({ ...baseEvent, type: "queue_retry", status: "success" }),
    /status success is not valid for type queue_retry/,
  );
});

test("rejects likely high-cardinality HTTP routes", () => {
  assert.throws(
    () => validateEvent({ ...baseEvent, data: { ...baseEvent.data, route: "/orders/92738" } }),
    /must use parameter placeholders/,
  );
});

test("accepts queue, retry, failure, and webhook event shapes", () => {
  const queueBase = { queueName: "orders", jobId: "214", jobName: "process-order", attempt: 1 };
  const cases = [
    { type: "queue_job", status: "processing", data: queueBase },
    {
      type: "queue_retry",
      status: "retrying",
      data: {
        ...queueBase,
        maxAttempts: 3,
        nextRetryAt: "2026-07-16T12:30:21.058Z",
        error: { name: "Timeout", message: "Inventory timed out" },
      },
    },
    {
      type: "queue_failed",
      status: "failure",
      data: {
        ...queueBase,
        attempt: 3,
        maxAttempts: 3,
        error: { name: "Timeout", message: "Inventory timed out" },
      },
    },
    {
      type: "webhook_received",
      status: "success",
      data: {
        provider: "stripe",
        eventType: "payment_intent.succeeded",
        providerEventId: "evt_1",
        statusCode: 200,
      },
    },
  ];

  for (const [index, item] of cases.entries()) {
    const event = {
      ...baseEvent,
      eventId: `a7a266f2-f4ee-4fa5-b974-0a2e0e6fa28${index}`,
      ...item,
    };
    assert.equal(validateEvent(event).type, item.type);
  }
});

test("redacts default secrets and detected financial or identity values recursively", () => {
  assert.deepEqual(redactTelemetryData({
    authorization: "Bearer visible-token",
    nested: {
      api_key: "qmon_live_secret",
      note: "SSN 123-45-6789 and card 4242 4242 4242 4242",
    },
  }), {
    authorization: "[REDACTED]",
    nested: {
      api_key: "[REDACTED]",
      note: "SSN [REDACTED] and card [REDACTED]",
    },
  });
});

test("supports configurable email, phone, and custom-field redaction", () => {
  assert.deepEqual(redactTelemetryData({
    customerEmail: "person@example.test",
    contact: "+1 (415) 555-2671",
    account_reference: "customer_123",
  }, {
    redactEmails: true,
    redactPhoneNumbers: true,
    customFields: ["account-reference"],
  }), {
    customerEmail: "[REDACTED]",
    contact: "[REDACTED]",
    account_reference: "[REDACTED]",
  });
});

test("phone redaction preserves schema-critical ISO timestamps", () => {
  const timestamp = "2026-07-17T12:30:21.058Z";
  assert.equal(redactTelemetryData(timestamp, { redactPhoneNumbers: true }), timestamp);
});

test("enforces configured event size and nesting-depth limits", () => {
  assert.throws(() => validateEvent(baseEvent, new Set(), { maxEventBytes: 100 }), /must not exceed 100 bytes/);
  const nested = { first: { second: { third: "value" } } };
  assert.throws(() => validateEvent({ ...baseEvent, data: { ...baseEvent.data, nested } }, new Set(), { maxNestingDepth: 2 }), /must not exceed 2 nested levels/);
});

test("enforces configurable batch limits", () => {
  assert.throws(() => validateBatchShape({ sdk: { name: "sdk", version: "1", service: "api", environment: "test" }, events: [baseEvent, baseEvent] }, 1), /at most 1 items/);
});

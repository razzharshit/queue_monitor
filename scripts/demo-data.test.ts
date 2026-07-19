import assert from "node:assert/strict";
import test from "node:test";
import { validateEvent } from "@queue-monitor/shared";
import { buildDemoEvents } from "./generate-demo-data.js";

test("demo history is deterministic, realistic, and causally ordered", () => {
  const anchor = new Date("2026-07-17T12:00:00.000Z");
  const first = buildDemoEvents(anchor);
  const second = buildDemoEvents(anchor);
  assert.deepEqual(first, second);
  assert.equal(first.events.length, 1_230);
  assert.equal(first.events.filter((event) => event.type === "http_request").length, 735);
  assert.equal(first.successTraces, 100);
  assert.equal(first.retryTraces, 25);
  assert.equal(first.failureTraces, 10);
  for (const event of first.events) {
    assert.deepEqual(validateEvent(event), event);
    const age = anchor.getTime() - Date.parse(event.occurredAt);
    assert.ok(age >= 0 && age <= 30 * 24 * 60 * 60 * 1_000);
  }

  const traces = new Map<string, typeof first.events>();
  for (const event of first.events) {
    if (event.data.demoScenario === "historical-http") continue;
    const items = traces.get(event.traceId!) ?? [];
    items.push(event);
    traces.set(event.traceId!, items);
  }
  assert.equal(traces.size, 135);
  for (const events of traces.values()) {
    events.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    for (let index = 1; index < events.length; index += 1) {
      assert.equal(events[index]!.parentEventId, events[index - 1]!.eventId);
    }
  }
  const failureTraces = [...traces.values()].filter((events) => events[0]!.data.demoScenario === "failure");
  assert.equal(failureTraces.length, 10);
  for (const events of failureTraces) {
    assert.deepEqual(events.map((event) => `${event.type}:${event.status}`), [
      "http_request:success", "queue_job:pending", "queue_job:processing", "queue_retry:retrying",
      "queue_job:processing", "queue_retry:retrying", "queue_job:processing", "queue_failed:failure",
    ]);
  }
  assert.deepEqual(new Set(first.events.map((event) => event.source)), new Set(["orders-api", "payment-worker", "notification-worker"]));
  assert.deepEqual(new Set(first.events.map((event) => event.data.queueName).filter(Boolean)), new Set(["order-processing", "notifications"]));
});

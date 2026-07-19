import assert from "node:assert/strict";
import test from "node:test";
import type { IngestEvent } from "@queue-monitor/shared";
import {
  addMonitoredJob,
  instrumentBullMqProcessor,
  type InstrumentedJob,
  type QueueLike,
  type TelemetryEmitter,
} from "../src/index.js";

const traceId = "7a9a3860-73fd-49cc-bf9c-58d5b2edbd5a";
const httpEventId = "a7a266f2-f4ee-4fa5-b974-0a2e0e6fa284";

function collectingClient(events: IngestEvent[]): TelemetryEmitter {
  return { service: "queue-test", emit: (event) => events.push(event) };
}

test("enqueue emits pending and injects the queued event as worker parent", async () => {
  const events: IngestEvent[] = [];
  let submitted: Record<string, unknown> | undefined;
  const queue: QueueLike = {
    async add(name, data) {
      submitted = data;
      return { id: "214", name };
    },
  };

  await addMonitoredJob(
    "process-order",
    queue,
    collectingClient(events),
    "process-order",
    { orderId: "order_123" },
    { traceId, parentEventId: httpEventId },
  );

  assert.equal(events[0]?.type, "queue_job");
  assert.equal(events[0]?.status, "pending");
  assert.equal(events[0]?.parentEventId, httpEventId);
  assert.deepEqual((submitted?._monitor as Record<string, unknown>).traceId, traceId);
  assert.equal((submitted?._monitor as Record<string, unknown>).parentEventId, events[0]?.eventId);
});

test("worker emits active and retry, then updates the next parent", async () => {
  const events: IngestEvent[] = [];
  let updated: unknown;
  const processor = instrumentBullMqProcessor<{ orderId: string }, void>(
    "process-order",
    collectingClient(events),
    async () => {
      throw new Error("provider timeout");
    },
    { retryDelayMs: 250 },
  );
  const job: InstrumentedJob<{ orderId: string }> = {
    id: "214",
    name: "process-order",
    data: { orderId: "order_123", _monitor: { traceId, parentEventId: httpEventId } },
    attemptsMade: 0,
    opts: { attempts: 3, backoff: { type: "fixed", delay: 250 } },
    async updateData(data) {
      updated = data;
    },
  };

  await assert.rejects(() => processor(job), /provider timeout/);

  assert.deepEqual(
    events.map((event) => [event.type, event.status]),
    [
      ["queue_job", "processing"],
      ["queue_retry", "retrying"],
    ],
  );
  assert.equal(
    (updated as { _monitor: { parentEventId: string } })._monitor.parentEventId,
    events[1]?.eventId,
  );
});

test("worker emits a terminal failure when attempts are exhausted", async () => {
  const events: IngestEvent[] = [];
  const processor = instrumentBullMqProcessor<{ orderId: string }, void>(
    "process-order",
    collectingClient(events),
    async () => {
      throw new Error("provider permanently unavailable");
    },
  );
  const job: InstrumentedJob<{ orderId: string }> = {
    id: "214",
    name: "process-order",
    data: { orderId: "order_123", _monitor: { traceId, parentEventId: httpEventId } },
    attemptsMade: 2,
    opts: { attempts: 3 },
    async updateData() {
      throw new Error("final failures must not update job context");
    },
  };

  await assert.rejects(() => processor(job), /permanently unavailable/);
  assert.deepEqual(
    events.map((event) => `${event.type}:${event.status}`),
    ["queue_job:processing", "queue_failed:failure"],
  );
  assert.equal(events[1]?.data.attempt, 3);
});

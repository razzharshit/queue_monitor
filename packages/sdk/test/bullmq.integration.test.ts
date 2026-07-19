import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { ConnectionOptions } from "bullmq";
import type { IngestEvent } from "@queue-monitor/shared";
import {
  InstrumentedQueue,
  createInstrumentedWorker,
  type InstrumentedJob,
  type TelemetryEmitter,
} from "../src/index.js";

const redisUrl = process.env.QMON_TEST_REDIS_URL;

function connectionFrom(value: string): ConnectionOptions {
  const url = new URL(value);
  return {
    host: url.hostname,
    port: Number.parseInt(url.port || "6379", 10),
    maxRetriesPerRequest: null,
  };
}

test(
  "real BullMQ retry keeps one trace across pending, active, retry, active, and complete",
  { skip: redisUrl ? false : "QMON_TEST_REDIS_URL is not configured", timeout: 10_000 },
  async () => {
    const events: IngestEvent[] = [];
    const client: TelemetryEmitter = {
      service: "integration-test",
      emit: (event) => events.push(event),
    };
    const queueName = `qmon-test-${randomUUID()}`;
    const connection = connectionFrom(redisUrl!);
    const queue = new InstrumentedQueue(queueName, client, { connection });
    let resolveCompleted: (() => void) | undefined;
    const completed = new Promise<void>((resolve) => {
      resolveCompleted = resolve;
    });
    const worker = createInstrumentedWorker<{ behavior: "retry" }, void>(
      queueName,
      client,
      async (job: InstrumentedJob<{ behavior: "retry" }>) => {
        if (job.attemptsMade === 0) throw new Error("fail once");
      },
      { connection },
      { retryDelayMs: 20 },
    );
    worker.on("completed", () => resolveCompleted?.());
    const traceId = randomUUID();

    try {
      await queue.add(
        "process-order",
        { behavior: "retry" },
        { traceId, parentEventId: randomUUID() },
        { attempts: 2, backoff: { type: "fixed", delay: 20 } },
      );
      await completed;

      assert.deepEqual(
        events.map((event) => `${event.type}:${event.status}`),
        [
          "queue_job:pending",
          "queue_job:processing",
          "queue_retry:retrying",
          "queue_job:processing",
          "queue_job:success",
        ],
      );
      assert.deepEqual(new Set(events.map((event) => event.traceId)), new Set([traceId]));
      for (let index = 2; index < events.length; index += 1) {
        assert.equal(events[index]?.parentEventId, events[index - 1]?.eventId);
      }
    } finally {
      await worker.close();
      await queue.close();
    }
  },
);

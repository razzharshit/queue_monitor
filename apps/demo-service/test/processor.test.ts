import assert from "node:assert/strict";
import test from "node:test";
import type { InstrumentedJob } from "@queue-monitor/node";
import { createOrderProcessor } from "../src/processor.js";
import type { ProcessOrderData } from "../src/types.js";

function job(behavior: ProcessOrderData["behavior"], attemptsMade: number): InstrumentedJob<ProcessOrderData> {
  return {
    id: "214",
    name: "process-order",
    data: {
      orderId: "order_123",
      behavior,
      _monitor: {
        traceId: "7a9a3860-73fd-49cc-bf9c-58d5b2edbd5a",
        parentEventId: "a7a266f2-f4ee-4fa5-b974-0a2e0e6fa284",
      },
    },
    attemptsMade,
    opts: { attempts: 3 },
    async updateData() {},
  };
}

test("retry mode fails once and then succeeds", async () => {
  const processor = createOrderProcessor(0);
  await assert.rejects(() => processor(job("retry", 0)), /failed once/);
  assert.deepEqual(await processor(job("retry", 1)), { orderId: "order_123", processed: true });
});

test("failure mode always fails", async () => {
  await assert.rejects(() => createOrderProcessor(0)(job("failure", 2)), /failed permanently/);
});

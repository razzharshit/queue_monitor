import assert from "node:assert/strict";
import test from "node:test";
import { monitor } from "../src/monitor.js";

test("monitor exposes a stable singleton lifecycle", async () => {
  assert.throws(() => monitor.diagnostics(), /monitor.init must be called/);
  monitor.init({
    apiKey: "qmon_live_test_secret_123",
    endpoint: "http://ingestion.test",
    service: "test",
    environment: "test",
    flushIntervalMs: 60_000,
    fetch: async () => Response.json({ accepted: 1, duplicates: 0, rejected: [] }),
  });
  assert.throws(() => monitor.init({
    apiKey: "qmon_live_test_secret_123",
    endpoint: "http://ingestion.test",
    service: "test",
    environment: "test",
  }), /already been called/);
  monitor.capture({
    type: "http_request",
    status: "success",
    data: { method: "GET", route: "/health", statusCode: 200 },
  });
  await monitor.flush();
  assert.equal(monitor.diagnostics().eventsSent, 1);
  await monitor.shutdown();
});

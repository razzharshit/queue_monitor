import assert from "node:assert/strict";
import test from "node:test";
import inject from "light-my-request";
import type { IngestEvent } from "@queue-monitor/shared";
import type { DemoOrderQueue } from "../src/types.js";
import { createDemoApp } from "../src/app.js";

test("POST /orders creates one trace and passes HTTP context to the queue", async () => {
  const events: IngestEvent[] = [];
  let queuedContext: { traceId: string; parentEventId: string } | undefined;
  let queuedBehavior: string | undefined;
  const queue: DemoOrderQueue = {
    async add(_name, data, context) {
      queuedContext = context;
      queuedBehavior = data.behavior;
      return { id: "214", name: "process-order" };
    },
  };
  const app = createDemoApp({
    client: { service: "demo-test", emit: (event) => events.push(event) },
    queue,
  });
  const incomingTrace = "7a9a3860-73fd-49cc-bf9c-58d5b2edbd5a";

  const response = await inject(app, {
    method: "POST",
    url: "/orders",
    headers: { "x-trace-id": incomingTrace, "content-type": "application/json" },
    payload: { behavior: "retry" },
  });

  assert.equal(response.statusCode, 202);
  assert.equal(response.json().traceId, incomingTrace);
  assert.equal(response.json().jobId, "214");
  assert.equal(queuedBehavior, "retry");
  assert.equal(queuedContext?.traceId, incomingTrace);
  assert.equal(events[0]?.type, "http_request");
  assert.equal(events[0]?.eventId, queuedContext?.parentEventId);
  assert.equal(events[0]?.data.route, "/orders");
});

test("POST /orders rejects unsafe behavior values", async () => {
  const events: IngestEvent[] = [];
  const queue: DemoOrderQueue = {
    async add() {
      throw new Error("queue must not be called");
    },
  };
  const app = createDemoApp({
    client: { service: "demo-test", emit: (event) => events.push(event) },
    queue,
  });

  const response = await inject(app, {
    method: "POST",
    url: "/orders",
    headers: { "content-type": "application/json" },
    payload: { behavior: "arbitrary-code" },
  });

  assert.equal(response.statusCode, 400);
  assert.match(response.json().error, /behavior must be one of/);
});

test("health, readiness, and version endpoints are probe-safe", async () => {
  const app = createDemoApp({
    client: { service: "demo-test", emit() {} },
    queue: { async add() { return { id: "unused", name: "unused" }; } },
    readiness: async () => {},
    version: {
      version: "1.2.3",
      gitCommitSha: "abc123",
      buildTimestamp: "2026-07-17T00:00:00.000Z",
      environment: "test",
    },
  });
  const health = await inject(app, { method: "GET", url: "/health", headers: { "x-request-id": "demo-request-1" } });
  assert.equal(health.statusCode, 200);
  assert.equal(health.headers["x-request-id"], "demo-request-1");
  assert.equal((await inject(app, { method: "GET", url: "/ready" })).statusCode, 200);
  assert.equal((await inject(app, { method: "GET", url: "/version" })).json().gitCommitSha, "abc123");
});

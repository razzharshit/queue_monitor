import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { IngestEvent } from "@queue-monitor/shared";
import {
  fastifyInstrumentation,
  getFastifyMonitoringContext,
  type TelemetryEmitter,
} from "../src/index.js";

test("Fastify instrumentation applies to routes outside its registration scope", async () => {
  const events: IngestEvent[] = [];
  const client: TelemetryEmitter = { service: "fastify-test", emit: (event) => events.push(event) };
  const app = Fastify();
  await app.register(fastifyInstrumentation(client));
  app.get("/orders/:orderId", async (request) => getFastifyMonitoringContext(request));
  const traceId = "7a9a3860-73fd-49cc-bf9c-58d5b2edbd5a";

  const response = await app.inject({
    method: "GET",
    url: "/orders/92738",
    headers: { "x-trace-id": traceId },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["x-trace-id"], traceId);
  assert.equal(response.json().traceId, traceId);
  assert.equal(events[0]?.data.route, "/orders/:orderId");
  assert.equal(events[0]?.traceId, traceId);
  await app.close();
});

test("Fastify instrumentation adopts W3C traceparent", async () => {
  const events: IngestEvent[] = [];
  const client: TelemetryEmitter = { service: "fastify-test", emit: (event) => events.push(event) };
  const app = Fastify();
  await app.register(fastifyInstrumentation(client));
  app.get("/health", async () => ({ ok: true }));
  const traceparent = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
  const response = await app.inject({ method: "GET", url: "/health", headers: { traceparent } });
  assert.match(String(response.headers.traceparent), /^00-0af7651916cd43dd8448eb211c80319c-[0-9a-f]{16}-01$/);
  assert.equal(events[0]?.traceId, "0af7651916cd43dd8448eb211c80319c");
  assert.equal(events[0]?.data.otelParentSpanId, "b7ad6b7169203331");
  await app.close();
});

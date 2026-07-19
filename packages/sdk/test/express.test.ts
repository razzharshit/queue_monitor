import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import inject from "light-my-request";
import type { IngestEvent } from "@queue-monitor/shared";
import {
  expressMiddleware,
  getExpressMonitoringContext,
  type TelemetryEmitter,
} from "../src/index.js";

test("Express middleware accepts a trace ID and emits the route template", async () => {
  const events: IngestEvent[] = [];
  const client: TelemetryEmitter = { service: "express-test", emit: (event) => events.push(event) };
  const app = express();
  app.use(expressMiddleware(client));
  app.get("/orders/:orderId", (req, res) => {
    res.json(getExpressMonitoringContext(req));
  });
  const traceId = "7a9a3860-73fd-49cc-bf9c-58d5b2edbd5a";

  const response = await inject(app, {
    method: "GET",
    url: "/orders/92738",
    headers: { "x-trace-id": traceId },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["x-trace-id"], traceId);
  assert.equal(response.json().traceId, traceId);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.data.route, "/orders/:orderId");
  assert.equal(events[0]?.traceId, traceId);
});

test("Express middleware adopts and propagates W3C traceparent", async () => {
  const events: IngestEvent[] = [];
  const client: TelemetryEmitter = { service: "express-test", emit: (event) => events.push(event) };
  const app = express();
  app.use(expressMiddleware(client));
  app.get("/health", (_req, res) => res.sendStatus(204));
  const traceparent = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
  const response = await inject(app, { method: "GET", url: "/health", headers: { traceparent } });
  assert.match(String(response.headers.traceparent), /^00-0af7651916cd43dd8448eb211c80319c-[0-9a-f]{16}-01$/);
  assert.equal(events[0]?.traceId, "0af7651916cd43dd8448eb211c80319c");
  assert.equal(events[0]?.data.otelParentSpanId, "b7ad6b7169203331");
});

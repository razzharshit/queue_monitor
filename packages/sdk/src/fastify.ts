import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import fastifyPlugin from "fastify-plugin";
import type { IngestEvent } from "@queue-monitor/shared";
import type { TelemetryEmitter } from "./client.js";
import type { MonitoringContext } from "./context.js";
import { parseTraceContext, traceparentFor } from "./context.js";
import type { HttpMiddlewareOptions } from "./express.js";

interface FastifyState {
  traceId: string;
  eventId: string;
  startedAt: string;
  startedNs: bigint;
  error?: Error;
  incomingTraceparent: string | null;
  parentSpanId: string | null;
}

const states = new WeakMap<FastifyRequest, FastifyState>();

export function fastifyInstrumentation(
  client: TelemetryEmitter,
  options: HttpMiddlewareOptions = {},
): FastifyPluginAsync {
  const traceHeader = (options.traceHeader ?? "x-trace-id").toLowerCase();

  return fastifyPlugin(async (fastify) => {
    fastify.addHook("onRequest", async (request, reply) => {
      const parsedTrace = parseTraceContext(request.headers[traceHeader], request.headers.traceparent);
      states.set(request, {
        traceId: parsedTrace.traceId,
        eventId: randomUUID(),
        startedAt: new Date().toISOString(),
        startedNs: process.hrtime.bigint(),
        incomingTraceparent: parsedTrace.traceparent,
        parentSpanId: parsedTrace.parentSpanId,
      });
      reply.header(traceHeader, parsedTrace.traceId);
      reply.header("traceparent", traceparentFor(parsedTrace.traceId, states.get(request)!.eventId));
    });

    fastify.addHook("onError", async (request, _reply, error) => {
      const state = states.get(request);
      if (state) state.error = error;
    });

    fastify.addHook("onResponse", async (request, reply) => {
      const state = states.get(request);
      if (!state) return;
      const durationMs = Math.max(0, Math.round(Number(process.hrtime.bigint() - state.startedNs) / 1e6));
      const failed = Boolean(state.error) || reply.statusCode >= 500;
      const error = state.error ?? (failed ? new Error(`HTTP ${reply.statusCode}`) : undefined);
      const data: Record<string, unknown> = {
        method: request.method,
        route: request.routeOptions.url,
        statusCode: reply.statusCode,
      };
      if (state.incomingTraceparent) data.traceparent = state.incomingTraceparent;
      if (state.parentSpanId) data.otelParentSpanId = state.parentSpanId;
      if (error) {
        data.error = {
          name: error.name,
          message: error.message,
          ...(options.includeErrorStack && error.stack ? { stack: error.stack } : {}),
        };
      }
      const event: IngestEvent = {
        eventId: state.eventId,
        traceId: state.traceId,
        parentEventId: null,
        type: "http_request",
        status: failed ? "failure" : "success",
        source: options.source ?? client.service,
        occurredAt: state.startedAt,
        durationMs,
        data,
      };
      client.emit(event);
      states.delete(request);
    });
  }, { name: "queue-monitor-instrumentation" });
}

export function getFastifyMonitoringContext(request: FastifyRequest): MonitoringContext {
  const state = states.get(request);
  if (!state) throw new Error("queue-monitor Fastify instrumentation is not installed");
  return { traceId: state.traceId, parentEventId: state.eventId };
}

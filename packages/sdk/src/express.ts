import { randomUUID } from "node:crypto";
import type { ErrorRequestHandler, Request, RequestHandler } from "express";
import type { IngestEvent } from "@queue-monitor/shared";
import type { MonitoringContext } from "./context.js";
import { parseTraceContext, traceparentFor } from "./context.js";
import type { TelemetryEmitter } from "./client.js";

interface RequestState {
  traceId: string;
  eventId: string;
  startedAt: string;
  startedNs: bigint;
  error?: Error;
  emitted: boolean;
  incomingTraceparent: string | null;
  parentSpanId: string | null;
}

export interface HttpMiddlewareOptions {
  source?: string;
  traceHeader?: string;
  includeErrorStack?: boolean;
}

const states = new WeakMap<Request, RequestState>();

function routeTemplate(request: Request): string {
  const path = request.route?.path;
  if (typeof path === "string") return `${request.baseUrl}${path}` || "/";
  return request.path || "<unmatched>";
}

function errorData(error: Error, includeStack: boolean): Record<string, string> {
  const result: Record<string, string> = { name: error.name, message: error.message };
  if (includeStack && error.stack) result.stack = error.stack;
  return result;
}

export function expressMiddleware(
  client: TelemetryEmitter,
  options: HttpMiddlewareOptions = {},
): RequestHandler {
  const traceHeader = (options.traceHeader ?? "x-trace-id").toLowerCase();

  return (request, response, next) => {
    const parsedTrace = parseTraceContext(request.headers[traceHeader], request.headers.traceparent);
    const state: RequestState = {
      traceId: parsedTrace.traceId,
      eventId: randomUUID(),
      startedAt: new Date().toISOString(),
      startedNs: process.hrtime.bigint(),
      emitted: false,
      incomingTraceparent: parsedTrace.traceparent,
      parentSpanId: parsedTrace.parentSpanId,
    };
    states.set(request, state);
    response.setHeader(traceHeader, state.traceId);
    response.setHeader("traceparent", traceparentFor(state.traceId, state.eventId));

    response.once("finish", () => {
      if (state.emitted) return;
      state.emitted = true;
      const durationMs = Math.max(0, Math.round(Number(process.hrtime.bigint() - state.startedNs) / 1e6));
      const failed = Boolean(state.error) || response.statusCode >= 500;
      const error = state.error ?? (failed ? new Error(`HTTP ${response.statusCode}`) : undefined);
      const data: Record<string, unknown> = {
        method: request.method,
        route: routeTemplate(request),
        statusCode: response.statusCode,
      };
      const requestId = request.headers["x-request-id"];
      if (typeof requestId === "string") data.requestId = requestId;
      if (state.incomingTraceparent) data.traceparent = state.incomingTraceparent;
      if (state.parentSpanId) data.otelParentSpanId = state.parentSpanId;
      if (error) data.error = errorData(error, options.includeErrorStack ?? false);

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
    });

    next();
  };
}

export function expressErrorMiddleware(): ErrorRequestHandler {
  return (error: unknown, request, _response, next) => {
    const state = states.get(request);
    if (state) state.error = error instanceof Error ? error : new Error(String(error));
    next(error);
  };
}

export function getExpressMonitoringContext(request: Request): MonitoringContext {
  const state = states.get(request);
  if (!state) throw new Error("queue-monitor Express middleware is not installed");
  return { traceId: state.traceId, parentEventId: state.eventId };
}

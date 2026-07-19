import { randomUUID } from "node:crypto";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OTEL_TRACE_ID_RE = /^(?!0{32})[0-9a-f]{32}$/i;
const TRACEPARENT_RE = /^[\da-f]{2}-((?!0{32})[\da-f]{32})-((?!0{16})[\da-f]{16})-([\da-f]{2})$/i;

export interface MonitoringContext {
  traceId: string;
  parentEventId: string;
}

export interface ParsedTraceContext {
  traceId: string;
  parentSpanId: string | null;
  traceparent: string | null;
}

export function traceIdFrom(value: unknown): string {
  return typeof value === "string" && (UUID_RE.test(value) || OTEL_TRACE_ID_RE.test(value))
    ? value.toLowerCase()
    : randomUUID();
}

export function parseTraceContext(traceIdHeader: unknown, traceparentHeader: unknown): ParsedTraceContext {
  if (typeof traceparentHeader === "string") {
    const match = TRACEPARENT_RE.exec(traceparentHeader.trim());
    if (match) {
      return {
        traceId: match[1]!.toLowerCase(),
        parentSpanId: match[2]!.toLowerCase(),
        traceparent: traceparentHeader.trim().toLowerCase(),
      };
    }
  }
  return { traceId: traceIdFrom(traceIdHeader), parentSpanId: null, traceparent: null };
}

export function traceparentFor(traceId: string, eventId: string, sampled = true): string {
  const normalizedTraceId = traceId.replaceAll("-", "").toLowerCase();
  const safeTraceId = OTEL_TRACE_ID_RE.test(normalizedTraceId)
    ? normalizedTraceId
    : randomUUID().replaceAll("-", "");
  const spanId = eventId.replaceAll("-", "").slice(0, 16).padEnd(16, "1");
  return `00-${safeTraceId}-${spanId}-${sampled ? "01" : "00"}`;
}

export function withMonitoringContext<T extends Record<string, unknown>>(
  data: T,
  context: MonitoringContext,
): T & { _monitor: MonitoringContext } {
  return { ...data, _monitor: context };
}

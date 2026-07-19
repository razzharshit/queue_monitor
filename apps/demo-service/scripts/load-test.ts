import process from "node:process";
import pg from "pg";
import { DEMO_BEHAVIORS, type DemoBehavior } from "../src/types.js";

interface OrderResponse {
  traceId: string;
  behavior: DemoBehavior;
}

interface RunMetricsRow {
  event_count: string;
  trace_count: string;
  completed_traces: string;
  failed_traces: string;
  average_ingestion_latency_ms: string | null;
  p95_ingestion_latency_ms: string | null;
  first_received_at: Date | null;
  last_received_at: Date | null;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  const parsed = Number.parseInt(value ?? String(fallback), 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const total = positiveInteger(process.env.LOAD_TOTAL, 1_000, "LOAD_TOTAL");
const concurrency = Math.min(positiveInteger(process.env.LOAD_CONCURRENCY, 25, "LOAD_CONCURRENCY"), total);
const timeoutSeconds = positiveInteger(process.env.LOAD_TIMEOUT_SECONDS, 240, "LOAD_TIMEOUT_SECONDS");
const demoUrl = (process.env.DEMO_SERVICE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const health = await fetch(`${demoUrl}/health`, { signal: AbortSignal.timeout(3_000) });
if (!health.ok) throw new Error(`demo service health check returned HTTP ${health.status}`);

const behaviorCounts: Record<DemoBehavior, number> = { success: 0, retry: 0, failure: 0 };
const statusCounts = new Map<number, number>();
const traceIds: string[] = [];
const errors: string[] = [];
let cursor = 0;
const submissionStartedAt = new Date();
const submissionStartedMs = performance.now();

async function submitOrders(): Promise<void> {
  while (true) {
    const index = cursor;
    cursor += 1;
    if (index >= total) return;
    const behavior = DEMO_BEHAVIORS[index % DEMO_BEHAVIORS.length]!;
    behaviorCounts[behavior] += 1;
    try {
      const response = await fetch(`${demoUrl}/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ behavior }),
        signal: AbortSignal.timeout(10_000),
      });
      statusCounts.set(response.status, (statusCounts.get(response.status) ?? 0) + 1);
      if (!response.ok) {
        errors.push(`order ${index + 1}: HTTP ${response.status}`);
        continue;
      }
      const order = (await response.json()) as OrderResponse;
      traceIds.push(order.traceId);
    } catch (error) {
      errors.push(`order ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, () => submitOrders()));
const submissionEndedAt = new Date();
const submissionSeconds = (performance.now() - submissionStartedMs) / 1_000;
const expectedEvents =
  behaviorCounts.success * 4 + behaviorCounts.retry * 6 + behaviorCounts.failure * 8;

if (traceIds.length === 0) throw new Error("no orders were accepted");

const pool = new pg.Pool({ connectionString: databaseUrl });
const terminalDeadline = Date.now() + timeoutSeconds * 1_000;
let terminalTraces = 0;
try {
  while (Date.now() < terminalDeadline) {
    const progress = await pool.query<{ terminal_traces: string; event_count: string }>(
      `SELECT
         count(DISTINCT trace_id) FILTER (
           WHERE type = 'queue_failed' OR (type = 'queue_job' AND status = 'success')
         )::text AS terminal_traces,
         count(*)::text AS event_count
       FROM events
       WHERE trace_id = ANY($1::uuid[])`,
      [traceIds],
    );
    terminalTraces = Number(progress.rows[0]?.terminal_traces ?? 0);
    const recordedEvents = Number(progress.rows[0]?.event_count ?? 0);
    if (terminalTraces >= traceIds.length && recordedEvents >= expectedEvents) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const completedAt = new Date();
  const metricsResult = await pool.query<RunMetricsRow>(
    `SELECT
       count(*)::text AS event_count,
       count(DISTINCT trace_id)::text AS trace_count,
       count(*) FILTER (WHERE type = 'queue_job' AND status = 'success')::text AS completed_traces,
       count(*) FILTER (WHERE type = 'queue_failed')::text AS failed_traces,
       avg(extract(epoch FROM (received_at - occurred_at)) * 1000)::text AS average_ingestion_latency_ms,
       percentile_cont(0.95) WITHIN GROUP (
         ORDER BY extract(epoch FROM (received_at - occurred_at)) * 1000
       )::text AS p95_ingestion_latency_ms,
       min(received_at) AS first_received_at,
       max(received_at) AS last_received_at
     FROM events
     WHERE trace_id = ANY($1::uuid[])`,
    [traceIds],
  );
  const missingParentsResult = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM events child
       LEFT JOIN events parent
         ON parent.environment_id = child.environment_id
        AND parent.event_id = child.parent_event_id
      WHERE child.trace_id = ANY($1::uuid[])
        AND child.parent_event_id IS NOT NULL
        AND parent.id IS NULL`,
    [traceIds],
  );
  const storageResult = await pool.query<{
    table_bytes: string;
    index_bytes: string;
    total_bytes: string;
    all_event_rows: string;
  }>(
    `SELECT
       pg_relation_size('events')::text AS table_bytes,
       pg_indexes_size('events')::text AS index_bytes,
       pg_total_relation_size('events')::text AS total_bytes,
       (SELECT count(*) FROM events)::text AS all_event_rows`,
  );
  const sampleTraceStarted = performance.now();
  await pool.query(
    `SELECT event_id, parent_event_id, type, status, occurred_at
       FROM events
      WHERE trace_id = $1
      ORDER BY occurred_at ASC, received_at ASC`,
    [traceIds[0]],
  );
  const sampleTraceQueryMs = performance.now() - sampleTraceStarted;

  const row = metricsResult.rows[0]!;
  const storage = storageResult.rows[0]!;
  const eventCount = Number(row.event_count);
  const traceCount = Number(row.trace_count);
  const completedTraces = Number(row.completed_traces);
  const failedTraces = Number(row.failed_traces);
  const ingestionWindowSeconds = row.first_received_at && row.last_received_at
    ? Math.max((row.last_received_at.getTime() - row.first_received_at.getTime()) / 1_000, 0.001)
    : 0;
  const endToEndSeconds = (completedAt.getTime() - submissionStartedAt.getTime()) / 1_000;
  const report = {
    generatedAt: completedAt.toISOString(),
    configuration: { total, concurrency, demoUrl, timeoutSeconds },
    submitted: {
      startedAt: submissionStartedAt.toISOString(),
      endedAt: submissionEndedAt.toISOString(),
      acceptedOrders: traceIds.length,
      requestErrors: errors.length,
      statusCounts: Object.fromEntries([...statusCounts.entries()].sort(([a], [b]) => a - b)),
      behaviorCounts,
      submissionSeconds: round(submissionSeconds),
      throughputOrdersPerSecond: round(traceIds.length / submissionSeconds),
    },
    ingestion: {
      expectedEvents,
      recordedEvents: eventCount,
      completenessPercent: round((eventCount / expectedEvents) * 100),
      averageLatencyMs: round(Number(row.average_ingestion_latency_ms ?? 0)),
      p95LatencyMs: round(Number(row.p95_ingestion_latency_ms ?? 0)),
      ingestionWindowSeconds: round(ingestionWindowSeconds),
      writeThroughputEventsPerSecond: ingestionWindowSeconds > 0 ? round(eventCount / ingestionWindowSeconds) : 0,
    },
    outcomes: {
      terminalTraces,
      completedTraces,
      failedTraces,
      businessFailureRatePercent: round((failedTraces / Math.max(completedTraces + failedTraces, 1)) * 100),
      endToEndSeconds: round(endToEndSeconds),
    },
    database: {
      runTraces: traceCount,
      runEvents: eventCount,
      missingParentEvents: Number(missingParentsResult.rows[0]?.count ?? 0),
      sampleTraceQueryMs: round(sampleTraceQueryMs),
      allEventRows: Number(storage.all_event_rows),
      tableBytes: Number(storage.table_bytes),
      indexBytes: Number(storage.index_bytes),
      totalBytes: Number(storage.total_bytes),
    },
    errors: errors.slice(0, 10),
  };
  console.log(JSON.stringify(report, null, 2));

  if (errors.length > 0 || eventCount !== expectedEvents || terminalTraces !== traceIds.length) {
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}

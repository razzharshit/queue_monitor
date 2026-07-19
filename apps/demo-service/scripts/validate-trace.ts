import process from "node:process";
import pg from "pg";
import { DEMO_BEHAVIORS, type DemoBehavior } from "../src/types.js";
import { orderTraceByParent } from "../src/timeline.js";

interface TimelineRow {
  event_id: string;
  parent_event_id: string | null;
  type: string;
  status: string;
  source: string;
  occurred_at: Date;
  attempt: number | null;
}

const behavior = (process.argv[2] ?? "success") as DemoBehavior;
if (!DEMO_BEHAVIORS.includes(behavior)) {
  throw new Error(`behavior must be one of: ${DEMO_BEHAVIORS.join(", ")}`);
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const demoUrl = (process.env.DEMO_SERVICE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const ingestionUrl = (process.env.INGESTION_ENDPOINT ?? "http://localhost:3000").replace(/\/$/, "");

async function requireHealthy(name: string, url: string): Promise<void> {
  try {
    const health = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2_000) });
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${name} is unavailable at ${url}: ${reason}`, { cause: error });
  }
}

await requireHealthy("ingestion API", ingestionUrl);
await requireHealthy("demo service", demoUrl);

const response = await fetch(`${demoUrl}/orders`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ behavior }),
});
if (!response.ok) throw new Error(`demo service returned HTTP ${response.status}: ${await response.text()}`);
const order = (await response.json()) as { traceId: string; orderId: string; jobId: string };
console.log(`Created ${order.orderId}; trace ${order.traceId}; job ${order.jobId}`);

const pool = new pg.Pool({ connectionString: databaseUrl });
const deadline = Date.now() + 15_000;
let rows: TimelineRow[] = [];
try {
  while (Date.now() < deadline) {
    const result = await pool.query<TimelineRow>(
      `SELECT event_id,
              parent_event_id,
              type,
              status,
              source,
              occurred_at,
              CASE WHEN metadata ? 'attempt' THEN (metadata->>'attempt')::integer END AS attempt
         FROM events
        WHERE trace_id = $1
        ORDER BY occurred_at ASC, received_at ASC`,
      [order.traceId],
    );
    rows = result.rows;
    const terminal = rows.some(
      (row) => row.type === "queue_failed" || (row.type === "queue_job" && row.status === "success"),
    );
    if (terminal && rows.some((row) => row.type === "http_request")) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
} finally {
  await pool.end();
}

const expected: Record<DemoBehavior, string[]> = {
  success: [
    "http_request:success",
    "queue_job:pending",
    "queue_job:processing",
    "queue_job:success",
  ],
  retry: [
    "http_request:success",
    "queue_job:pending",
    "queue_job:processing",
    "queue_retry:retrying",
    "queue_job:processing",
    "queue_job:success",
  ],
  failure: [
    "http_request:success",
    "queue_job:pending",
    "queue_job:processing",
    "queue_retry:retrying",
    "queue_job:processing",
    "queue_retry:retrying",
    "queue_job:processing",
    "queue_failed:failure",
  ],
};

if (rows.length === 0) {
  throw new Error(
    `no telemetry reached PostgreSQL for trace ${order.traceId}; verify QMON_API_KEY is active and both the ingestion API and validator use the same DATABASE_URL`,
  );
}

rows = orderTraceByParent(rows);
const actual = rows.map((row) => `${row.type}:${row.status}`);

console.table(
  rows.map((row, index) => ({
    order: index + 1,
    event: `${row.type}:${row.status}`,
    attempt: row.attempt ?? "-",
    source: row.source,
    parent: row.parent_event_id?.slice(0, 8) ?? "-",
    eventId: row.event_id.slice(0, 8),
  })),
);

if (JSON.stringify(actual) !== JSON.stringify(expected[behavior])) {
  throw new Error(`unexpected timeline\nexpected: ${expected[behavior].join(" -> ")}\nactual:   ${actual.join(" -> ")}`);
}

for (let index = 1; index < rows.length; index += 1) {
  if (rows[index]?.parent_event_id !== rows[index - 1]?.event_id) {
    throw new Error(`broken parent chain between timeline positions ${index} and ${index + 1}`);
  }
}
console.log(`Validated one correlated ${behavior} trace with ${rows.length} ordered events.`);

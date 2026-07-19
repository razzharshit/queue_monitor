import pg from "pg";
import { loadLocalEnvironment, requiredEnvironment } from "./demo-support.js";

interface TimelineRow {
  event_id: string;
  parent_event_id: string | null;
  type: string;
  status: string;
  source: string;
  occurred_at: Date | string;
  received_at: Date | string;
}

loadLocalEnvironment();
const databaseUrl = requiredEnvironment("DATABASE_URL");
const environmentId = requiredEnvironment("DEMO_ENVIRONMENT_ID");
requiredEnvironment("DEMO_SEED_API_KEY", 24);
const demoUrl = (process.env.DEMO_SERVICE_URL ?? "http://localhost:3001").replace(/\/$/, "");
const health = await fetch(`${demoUrl}/health`, { signal: AbortSignal.timeout(5_000) }).catch((error) => {
  throw new Error(`demo service is unavailable at ${demoUrl}; restart npm run dev after demo:seed-account`, { cause: error });
});
if (!health.ok) throw new Error(`demo service health returned HTTP ${health.status}`);
const response = await fetch(`${demoUrl}/orders`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ behavior: "failure" }),
  signal: AbortSignal.timeout(5_000),
});
if (!response.ok) throw new Error(`demo service returned HTTP ${response.status}: ${await response.text()}`);
const order = await response.json() as { orderId: string; jobId: string; traceId: string };
const expected = [
  "http_request:success", "queue_job:pending", "queue_job:processing", "queue_retry:retrying",
  "queue_job:processing", "queue_retry:retrying", "queue_job:processing", "queue_failed:failure",
];
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
let rows: TimelineRow[] = [];
try {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const result = await pool.query<TimelineRow>(
      `SELECT event_id, parent_event_id, type, status, source, occurred_at, received_at
         FROM events WHERE environment_id = $1 AND trace_id = $2
        ORDER BY occurred_at, received_at`,
      [environmentId, order.traceId],
    );
    rows = result.rows;
    if (rows.some((row) => row.type === "queue_failed")) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
} finally {
  await pool.end();
}
const actual = rows.map((row) => `${row.type}:${row.status}`);
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(
    `live failure did not reach the dedicated demo environment with eight ordered events; restart npm run dev after seeding\nexpected: ${expected.join(" -> ")}\nactual:   ${actual.join(" -> ")}`,
  );
}
for (let index = 1; index < rows.length; index += 1) {
  if (rows[index]!.parent_event_id !== rows[index - 1]!.event_id) throw new Error(`broken parent chain at live timeline position ${index + 1}`);
}
console.table(rows.map((row, index) => ({ order: index + 1, event: `${row.type}:${row.status}`, source: row.source, eventId: row.event_id.slice(0, 8), parent: row.parent_event_id?.slice(0, 8) ?? "-" })));
console.log(JSON.stringify({ level: "info", event: "demo_live_failure_validated", environmentId, orderId: order.orderId, jobId: order.jobId, traceId: order.traceId, timelineEvents: rows.length }));

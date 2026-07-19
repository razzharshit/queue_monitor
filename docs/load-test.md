# Load-test record

## Run

- Date: 2026-07-16
- Topology: one local API process, one demo-service process, one Redis instance, one PostgreSQL instance
- Runtime: Node.js 24.18.0
- Database: PostgreSQL 18.4
- BullMQ worker concurrency: 4
- Order concurrency: 25
- Scenarios: 1,000 mixed orders
- Distribution: 334 success, 333 retry, 333 final failure

Reproduction:

```sh
set -a
source .env
set +a

LOAD_TOTAL=1000 \
LOAD_CONCURRENCY=25 \
LOAD_TIMEOUT_SECONDS=240 \
npm run demo:load
```

The load runner records every returned trace ID, waits until each trace has a terminal event, and queries only those trace IDs. This prevents older database rows from affecting the result.

## Results

| Measurement | Value |
|---|---:|
| HTTP 202 responses | 1,000 |
| Request errors | 0 |
| Submission duration | 0.28 s |
| HTTP acceptance throughput | 3,583.03 orders/s |
| Expected events | 5,998 |
| Recorded events | 5,998 |
| Completeness | 100% |
| Average ingestion latency | 46.09 ms |
| P95 ingestion latency | 101.44 ms |
| Ingestion window | 51.38 s |
| Sustained write throughput | 116.74 events/s |
| End-to-end terminal completion | 51.81 s |
| Successful terminal traces | 667 |
| Final-failure traces | 333 |
| Business failure rate | 33.3% |
| Missing parent events | 0 |
| Sample trace query latency | 0.8 ms |

Ingestion latency is calculated in PostgreSQL as `received_at - occurred_at` for each event. P95 uses `percentile_cont(0.95)` over the exact run’s 5,998 rows.

## Database behavior

- The run inserted the exact expected number of events with no missing causal parent.
- `(environment_id, event_id)` enforces idempotency without allowing collisions to cross environment boundaries.
- The indexed sample trace query completed in 0.8 ms.
- After the run, the database contained 12,885 cumulative event rows.
- Cumulative table storage was 4,923,392 bytes.
- Cumulative index storage was 6,209,536 bytes.
- Cumulative table-plus-index storage was 11,173,888 bytes (about 10.66 MiB).
- Indexes were larger than the heap at this small scale, which is expected from several project/time/trace/status indexes and fixed page overhead.

## Interpretation

The 3,583 orders/s number measures enqueue acceptance on a loopback development machine, not durable worker completion. The endpoint returns 202 after enqueueing. Four BullMQ workers then perform the 100 ms simulated provider work and retry backoffs, producing a sustained 116.74 telemetry events/s and a 51.81 second end-to-end drain time.

The next scaling constraint is worker and direct-database write throughput, not HTTP order acceptance. The recommended evolution is multiple stateless ingestion replicas, a durable broker, independent persistence/aggregation consumers, and time-partitioned raw storage with pre-aggregated metrics.

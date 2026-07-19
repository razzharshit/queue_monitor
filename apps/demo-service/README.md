# Demo order service

Express and BullMQ order-flow example instrumented by `@queue-monitor/node`.

`POST /orders` accepts a safe demo behavior:

```json
{ "behavior": "success" }
```

Allowed values are `success`, `retry`, and `failure`. Retry fails once and then succeeds; failure exhausts all three attempts. The response includes the trace and job IDs.

`GET /health` checks process liveness, `GET /ready` verifies Redis and the ingestion API, and `GET /version` returns release metadata. Startup configuration is validated with Zod before Redis connections are created.

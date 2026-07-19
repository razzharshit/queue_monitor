# `@queue-monitor/node`

The official Node.js SDK for Queue Monitor. It buffers telemetry off the request path, batches delivery, redacts configured fields, and safely drops events after bounded retries instead of destabilizing the host application.

## Five-minute quick start

```sh
npm install @queue-monitor/node
```

Configure the API key in your environment, never in source control:

```sh
export QMON_API_KEY='qmon_live_...'
```

Initialize once during process startup:

```ts
import { monitor } from "@queue-monitor/node";

monitor.init({
  apiKey: process.env.QMON_API_KEY,
  endpoint: "https://ingest.example.com",
  service: "payments-api",
  environment: "production",
  sampleRate: 1,
  redact: ["authorization", "password", "token", "cardNumber"],
});
```

Send a custom event:

```ts
monitor.capture({
  type: "webhook_received",
  status: "success",
  traceId: "0af7651916cd43dd8448eb211c80319c",
  data: {
    provider: "stripe",
    eventType: "payment_intent.succeeded",
    providerEventId: "evt_123",
    statusCode: 200,
  },
});
```

Call `await monitor.shutdown()` during graceful process termination. Open **Event stream** in the dashboard, select the same environment as the key, and filter by service or trace ID.

## HTTP instrumentation

Express:

```ts
import express from "express";
import { expressMiddleware, expressErrorMiddleware, monitor } from "@queue-monitor/node";

const app = express();
app.use(expressMiddleware(monitor.init({ /* configuration */ })));
// register routes
app.use(expressErrorMiddleware());
```

Fastify:

```ts
import { fastifyInstrumentation, monitor } from "@queue-monitor/node";

await fastify.register(fastifyInstrumentation(monitor.init({ /* configuration */ })));
```

Both integrations capture the route template, method, status, latency, and error. They adopt a valid W3C `traceparent`, propagate a response `traceparent`, and continue accepting the backward-compatible `x-trace-id` UUID header.

## Configuration API

| Option | Default | Description |
|---|---:|---|
| `apiKey` | required | Environment-scoped `qmon_live_…` key |
| `endpoint` | required | Absolute HTTP(S) ingestion origin |
| `service` | required | Stable service name |
| `environment` | required | SDK environment label |
| `sampleRate` | `1` | Fraction from 0 through 1 |
| `redact` | common secrets | Case-insensitive keys to recursively redact |
| `batchSize` | `25` | Events per request, maximum 100 |
| `flushIntervalMs` | `500` | Periodic flush interval |
| `maxBufferSize` | `1000` | Hard in-memory event bound |
| `overflowStrategy` | `drop-oldest` | `drop-oldest` or `drop-newest` |
| `requestTimeoutMs` | `5000` | Per-request timeout |
| `retry.maxAttempts` | `3` | Total delivery attempts |
| `retry.initialDelayMs` | `200` | First backoff delay |
| `retry.maxDelayMs` | `5000` | Backoff ceiling |
| `retry.jitter` | `true` | Randomize retry timing |
| `debug` | `false` | Emit structured diagnostic logs |
| `logger` | — | Custom safe diagnostic logger |

Defaults redact `authorization`, `cookie`, `password`, `token`, `apiKey`, and `cardNumber`. Keys are never included in logs or diagnostics.

## Reliability and diagnostics

HTTP 408, 425, 429, 5xx, timeouts, and network failures use exponential backoff with jitter. Other 4xx responses are not retried. The SDK respects numeric `Retry-After`, never holds more than `maxBufferSize`, and never throws delivery errors into application code.

```ts
console.log(monitor.diagnostics());
// {
//   eventsQueued, eventsSent, eventsDropped, retryCount,
//   bufferedEvents, lastError, lastFlushAt
// }
```

## Troubleshooting

- `apiKey is required`: set `QMON_API_KEY` before process startup.
- 401 delivery errors: verify the key is for the selected environment and has not been revoked or expired.
- Events dropped with `non_retryable_response`: enable `debug`, inspect `lastError`, and validate the event shape.
- Events not visible: select the key's environment in the dashboard; streams never mix across environments.
- High drops under load: increase `maxBufferSize`, shorten the flush interval, or reduce sampling only after checking ingestion health.

## Compatibility and releases

Node.js 20 or newer is supported. The package publishes ESM, CommonJS, declarations, and source maps. Public API changes follow Semantic Versioning; see the repository `CHANGELOG.md` and `docs/versioning.md`.

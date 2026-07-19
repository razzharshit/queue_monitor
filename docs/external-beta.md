# External developer beta guide

## First integration

1. Create an account at `/signup`.
2. Follow **Setup** to create an organization, project, Production environment, and API key.
3. Copy the key once into `QMON_API_KEY` in your secret manager or uncommitted `.env`.
4. Run `npm install @queue-monitor/node` and copy the initialization snippet.
5. Send one event or add Express/Fastify middleware.
6. Select Production in **Event stream**, then open the event's trace.

The setup checklist persists per user and organization. The support address remains visible in the left navigation.

## Zero-downtime API-key rotation

Open **Settings**, choose the environment, and click **Rotate** on the active key. Copy the replacement (it appears once), deploy it to every producer, verify its **Last used** value, then click **Revoke** on the old key and confirm. Revocation takes effect on the next request and does not affect the replacement.

## Roles

| Capability | Owner | Admin | Developer | Viewer |
|---|:---:|:---:|:---:|:---:|
| Read telemetry/traces | ✓ | ✓ | ✓ | ✓ |
| Generate/revoke API keys | ✓ | ✓ | ✓ | — |
| Manage projects/environments | ✓ | ✓ | — | — |
| Invite teammates | ✓ | ✓ | — | — |
| Change roles | ✓ | — | — | — |

Invitation tokens are random, stored only as SHA-256 hashes, expire after seven days, can be revoked, and can only be accepted by an authenticated account with the invited email. Configure `SMTP_HOST`, `SMTP_FROM`, and optional SMTP credentials to send the link by email; local installations without SMTP receive a copyable one-time link in Settings.

## FAQ

**Why is an event missing?** Check SDK diagnostics, the selected dashboard environment, sampling, and whether the API key was revoked.

**Why did an event drop?** Delivery retries are bounded. Inspect `lastError`, `retryCount`, debug logs, and ingestion health. Drops never crash the application.

**Can development and production data mix?** No. Keys, writes, reads, metrics, Socket.IO rooms, and traces are environment-scoped.

**How is trace context propagated?** HTTP integrations prefer W3C `traceparent`, preserve the incoming parent span in event metadata, and return a child `traceparent`. UUID `x-trace-id` remains supported.

**Where do I get help?** Use **Contact support** in the application or email `support@queue-monitor.dev` with the request ID, environment, SDK version, and diagnostics. Never send an API key.

## Beta limitations

- SMTP sending is synchronous and best-effort. A failed delivery keeps the invitation valid and returns a copyable link; a transactional email outbox is the next reliability step.
- The current ingestion path writes directly to PostgreSQL. The documented scaling path adds a durable broker and consumers before public high-volume use.
- OpenTelemetry support interoperates at the W3C trace-context boundary; this release is not an OTLP exporter or a replacement for the OpenTelemetry SDK.
- Payment collection, SSO/SCIM, formal support SLAs, and compliance certification are intentionally outside the 1–5 customer beta. Organization/data deletion and a verified billing-meter interface are available before payment-provider integration.

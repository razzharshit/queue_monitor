# Usage metering and billing readiness

Payment collection is intentionally not implemented. PostgreSQL provides a billing-ready subscription and usage boundary so metering can be verified before connecting Stripe or another provider.

## Meter definitions

`usage_monthly` is keyed by organization and UTC month. It records ingestion requests, events submitted, events stored after validation/deduplication, request bandwidth, logical stored bytes ingested during the month, rate-limited requests, and quota rejections. `organization_storage` separately tracks currently retained database row bytes and event count through insert/delete triggers. The usage API also derives active services seen this month, environments, and non-revoked API keys.

Billable definitions must be frozen in customer terms before launch:

- **events ingested:** valid events admitted by quota controls, including duplicates submitted by a client;
- **events stored:** new idempotent event rows actually inserted;
- **bandwidth:** UTF-8 bytes of accepted ingestion request JSON before decompression support exists;
- **storage used:** current PostgreSQL event-row bytes, excluding index/backup overhead;
- **active service:** distinct `source` with an event in the current UTC month.

The authenticated `GET /v1/organizations/:organizationId/usage` endpoint exposes the current plan, limits, status, counters, and active-resource counts. `GET /v1/billing/plans` exposes public plan descriptions. Use an offline reconciliation query against raw events and storage before issuing invoices.

## Plans

`subscription_plans` seeds Free, Team, and Business with event/request/bandwidth/storage limits, three scope rates, burst multiplier, default retention, and feature flags. `organization_subscriptions.custom_limits` can override individual numeric limits for a negotiated contract. Only an internal billing service/operator should change plan/subscription rows; there is deliberately no customer endpoint that self-upgrades without payment authorization.

## Future provider interface

A billing adapter should consume these internal domain events through a transactional outbox (to be added with the provider):

```text
subscription.created
subscription.plan_changed
subscription.status_changed
usage.month_closed
usage.adjusted
invoice.meter_snapshot_created
```

Each envelope should contain an immutable event ID, organization ID, UTC occurrence time, billing period, schema version, non-secret provider customer/subscription IDs, actor, reason, and idempotency key. Provider webhooks must be signature-verified, replay-safe, stored before processing, and mapped to an audit entry (`billing.plan_change` or `billing.status_change`) on success/failure.

Before enabling collection: run at least two monthly shadow invoices; reconcile a sample of tenants to raw events within an agreed tolerance; define late-arrival/duplicate/credit behavior; add tax/currency/invoice policies; implement provider webhook recovery; restrict billing administration; and review all plan-change audit evidence. Usage counters use ordinary PostgreSQL `BIGINT`; at higher ingest volume, move writes to an append-only usage ledger and aggregate idempotently.

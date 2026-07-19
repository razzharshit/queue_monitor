# PostgreSQL data operations

Queue Monitor stores identities, tenant configuration, API-key/session hashes, audit evidence, usage ledgers, and telemetry in PostgreSQL. Backups therefore contain sensitive customer data.

The canonical backup, encryption, restore, RPO/RTO, retention-job, migration, rollback, and incident procedures are in [Production operations and disaster recovery](operations.md). Use [the manual security test guide](manual-security-testing.md) for a disposable restore exercise.

## Private-beta baseline

| Control | Baseline |
|---|---|
| Logical backup | Daily at 02:15 UTC |
| Client encryption | `age` recipient encryption before upload |
| Object encryption | S3 SSE-KMS in a private versioned bucket |
| Backup retention | 35 daily, 12 monthly (bucket lifecycle) |
| Verification | Checksum, `age` decryption, `pg_restore --list` |
| Restore drill | Automated monthly; human tabletop/cutover quarterly |
| RPO target | ≤ 24 hours |
| RTO target | ≤ 4 hours |

These are initial targets, not contractual SLAs. A managed PostgreSQL service should also provide encrypted storage, multi-zone availability, deletion protection, continuous WAL/PITR, and a cross-account/region recovery copy. With tested PITR and failover, a later enterprise target can be tightened to RPO 15 minutes and RTO 2 hours.

## Data lifecycle and migration safety

The hourly retention job removes telemetry older than each organization policy. Inserts/deletes update `organization_storage`; monthly billable ingestion remains in `usage_monthly`. Audit evidence has a separate retention decision and is not removed by telemetry cleanup.

Migrations are ordered, checksummed, recorded in `schema_migrations`, and validated with `npm run db:migrate:validate`. Never edit an applied migration. Prefer expand/backfill/contract and roll-forward fixes. Restore a verified pre-change backup into a new isolated database when corruption makes application rollback insufficient.

Production data must never be copied to a developer laptop. Use generated or irreversibly sanitized datasets for development and load tests.

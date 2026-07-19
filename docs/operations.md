# Production operations and disaster recovery

## Service ownership and health

The API exposes `/health` (process liveness), `/ready` (database readiness), `/version`, and public `/v1/status`. The dashboard exposes `/status`. Monitor availability, error rate, ingestion P95, queue lag where applicable, PostgreSQL saturation/replication lag, rate/quota rejects, storage growth, retention failures, backup age, and restore-drill results. Page the primary on-call for critical alerts; send lower severity alerts to the operations channel.

Status incidents and maintenance windows live in `status_incidents` and `maintenance_windows`; the public endpoint intentionally contains no tenant data. Automating updates from incident tooling is a future adapter, not a public unauthenticated write API.

## Incident response

### Severity

| Severity | Definition | Initial response | Customer update |
|---|---|---:|---:|
| SEV-1 | Confirmed data exposure/loss, cross-tenant access, or broad production outage | 15 min | 30 min |
| SEV-2 | Major degradation, delayed ingestion, failed backup/restore objective | 30 min | 60 min |
| SEV-3 | Limited impact with workaround | Business hours | As agreed |

### Procedure

1. **Detect and declare:** open an incident channel, assign incident commander, operations lead, communications lead, and scribe. Record UTC times and evidence links.
2. **Contain:** revoke exposed sessions/API keys, block networks, disable a risky release, isolate affected tenants, or stop nonessential writes. Preserve logs and do not destroy evidence.
3. **Assess:** identify affected organizations, environments, data classes, time window, integrity, and ongoing risk. Engage security/privacy/legal for suspected data incidents.
4. **Communicate:** publish a plain-language status update without secrets or unverified claims. Notify contractual contacts/regulators on counsel-approved timelines.
5. **Mitigate and recover:** prefer a tested roll-forward. Restore only into an isolated database first, validate, then execute the approved cutover.
6. **Validate:** check readiness, migration invariants, tenant isolation, event counts, trace reads, usage ledgers, application errors, and customer workflows.
7. **Close and learn:** resolve the status incident, preserve the timeline, and publish a blameless postmortem within five business days for SEV-1/2.

Postmortem template: summary; impact; detection; UTC timeline; root and contributing causes; what worked/did not; recovery; data/privacy assessment; corrective actions with owner/due date; evidence links.

## Encrypted backups

The `Production Operations` workflow creates a PostgreSQL custom-format backup every day at 02:15 UTC. `scripts/backup.sh` validates the archive with `pg_restore --list`, encrypts it client-side with `age` (X25519 recipient encryption and authenticated ChaCha20-Poly1305 payload encryption), writes a SHA-256 checksum, and uploads both over HTTPS to a private S3 bucket with SSE-KMS enabled.

Required controls:

- private bucket, public access blocked, versioning enabled, CloudTrail data events, and a bucket policy limited to the backup/restore roles;
- dedicated KMS key with least-privilege encrypt/decrypt grants and automatic key rotation;
- `age` private identity stored only in the production operations secret store, separate from the backup-writer role;
- database URL requiring TLS certificate verification in production;
- S3 lifecycle: 35 daily copies, 12 monthly copies, then permanent deletion (adjust to contract/legal hold);
- cross-account or cross-region copy for regional failure, also KMS protected;
- alerts when the workflow fails or the newest successful object is older than 26 hours.

Rotate the `age` recipient annually or after suspected compromise: add the new public recipient, create/verify a new backup, update the writer, retain the old private key only until old backups age out, then destroy it under dual control. Rotate IAM/KMS credentials per cloud policy. Never place private identities in the repository or backup bucket.

Local creation and verification:

```sh
BACKUP_AGE_RECIPIENT='age1…' BACKUP_DIR=./backups npm run backup:create
BACKUP_FILE=./backups/queue-monitor-….dump.age \
BACKUP_AGE_IDENTITY=/secure/path/age-key.txt npm run backup:verify
```

## Restore procedure and objectives

Private-beta objectives are **RPO ≤ 24 hours** and **RTO ≤ 4 hours**. They are targets, not an SLA, until observed over repeated drills. Daily backups define the RPO; the measured workflow duration plus validation/cutover defines the RTO.

1. Declare an incident/change and select the newest verified backup before the recovery point.
2. Provision a new isolated PostgreSQL instance with the supported major version, encryption, private networking, and no application traffic.
3. Download the `.dump.age` and `.sha256` through the restore role. Verify object/KMS audit logs.
4. Run the guarded restore:

```sh
BACKUP_FILE=/secure/queue-monitor.dump.age \
BACKUP_AGE_IDENTITY=/secure/age-key.txt \
TARGET_DATABASE_URL='postgresql://…/queue_monitor_restore?sslmode=verify-full' \
RESTORE_CONFIRMATION=RESTORE \
npm run backup:restore
```

5. Point `DATABASE_URL` to the restored database in an isolated API job and run `npm run db:migrate:validate`, test login/session creation, one environment-scoped read, a trace lookup, ingestion/idempotency, usage, audit reads, and row/count/storage reconciliation.
6. Record backup timestamp, latest recoverable data timestamp, recovery-point gap, restore start/end, validation results, and observed RPO/RTO.
7. Obtain incident/change approval, stop writes or drain traffic, take a final backup when possible, atomically switch connection configuration, and watch errors/latency/ingestion.
8. Retain the old database read-only until the change window closes, then dispose of it according to policy.

The monthly `Production Restore Drill` workflow downloads the newest encrypted production backup, restores into an ephemeral isolated PostgreSQL service, validates migration invariants, counts events, records duration, and alerts on failure. Review its result monthly and conduct a human cutover/tabletop drill quarterly.

## Retention operations

The production workflow runs `npm run db:retention` hourly. It deletes bounded-by-policy expired event rows and logs deleted event/organization counts. Monitor runtime, dead tuples, transaction duration, and database IO. At higher volume, time-partition events and drop expired partitions instead of row deletion. Vacuum/analyze and capacity policies remain managed PostgreSQL responsibilities.

## Migration and rollback strategy

Migrations are checksummed and append-only. Never edit a migration recorded in `schema_migrations`.

Before deployment: review SQL locks and rewrite risk; test on a recent sanitized copy; verify backup; record baseline counts/latency; deploy backward-compatible expand changes; run `npm run db:migrate`; run `npm run db:migrate:validate`; then deploy code. Contract/drop changes require a later release after all code stops using the old shape.

Rollback order:

1. Stop the rollout and preserve logs. If schema is backward compatible, roll application code back while leaving the expanded schema.
2. Prefer a corrective roll-forward migration. It preserves evidence and avoids destructive reversal.
3. For a data-corrupting migration, stop writes, verify/select the pre-migration backup, restore it into a new database, validate it, reconcile the lost-write window against the RPO, and switch only with incident/change approval.
4. Never manually delete a `schema_migrations` row or reverse a destructive DDL statement in production without an independently reviewed recovery plan.

Validation includes migration checksums/invariants, foreign-key/orphan checks, tenant isolation, audit immutability, organization storage accounting, usage counters, representative traces, and application readiness. Document the exact roll-forward/restore choice in the incident timeline.

## Routine operating checklist

- Daily: backup success/age, critical alerts, error and reject rates, database capacity.
- Weekly: dependency/secret scan, abnormal audit activity, API-key/session review, retention outcomes.
- Monthly: automated restore drill, access review, plan/usage reconciliation sample, incident action review.
- Quarterly: human disaster cutover tabletop, credential rotation review, tenant-isolation tests, risk register.
- Annually: key rotation, retention/legal review, external penetration test and incident exercise before enterprise claims.

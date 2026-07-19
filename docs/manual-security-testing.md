# Manual security and operations test guide

Use a disposable local database and non-production keys. Export `.env`, run `npm run db:migrate`, and start the stack. Never paste production credentials into commands, screenshots, or test fixtures.

## Authentication and sessions

1. Sign in and inspect the cookie: it must be `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
2. Call `GET /v1/auth/sessions`, revoke another ID, and confirm its cookie receives `401` on the next request.
3. Call `POST /v1/auth/logout-all`; every prior cookie must receive `401`.
4. Request a password reset for an existing and unknown email. Both responses must be identical `202` bodies. Use the link once; a second use must fail and all old sessions must be invalid.
5. Behind a trusted proxy, send HTTP and confirm `308` to HTTPS; HTTPS must include HSTS, CSP, frame/content/referrer/permissions headers.

## Tenant and role isolation

Create two organizations and environments. Verify a session from A cannot read B using `x-environment-id`, create/delete B resources, join B's live room, export B, or view B audit logs. Verify Viewer cannot mutate, Developer only manages keys, Admin cannot assign owner, and the last owner cannot be removed/delete their account.

## Ingestion controls

1. Set a test subscription `custom_limits` to very small request/event/bandwidth/storage and rate values.
2. Submit valid batches until each quota/rate fails. Confirm `429`, stable `code`, `Retry-After`, and incremented usage reject counters.
3. Assign Business, enable an allowlist that excludes the client, and confirm `403 ip_allowlist`; include the client CIDR and retry.
4. Submit a request over `MAX_REQUEST_BYTES`, a batch over `MAX_BATCH_SIZE`, event over `MAX_EVENT_BYTES`, and object deeper than `MAX_NESTING_DEPTH`. Confirm graceful `413`/`400` and API stability.
5. Submit nested authorization/password/API-key/card/CVV/SSN values and optional email/phone/custom fields. Query PostgreSQL and confirm only `[REDACTED]` is stored.

## Audit, usage, lifecycle

Perform login/logout/reset, invitation, role, key, settings, export, and delete operations. Confirm audit rows contain actor/context/result but no secret. Run `UPDATE audit_logs SET action='tamper'`; PostgreSQL must reject it. Reconcile usage counts with raw event counts and `organization_storage` with a direct `pg_column_size` aggregate.

Set a disposable organization's retention to seven days, backdate an event, run `npm run db:retention`, and verify only expired in-scope data is removed and storage decreases. Export JSON/CSV and verify no key hash/secret exists; verify truncation signaling over 50,000 events. Exercise telemetry/environment/project/organization/account deletion with confirmations and verify cross-tenant rows remain.

## Backup and rollback

Create an `age` test identity, run `npm run backup:create`, alter one byte in a copy and confirm verification fails, then verify the original. Restore to an empty disposable database with `RESTORE_CONFIRMATION=RESTORE`, run migration validation, compare event/tenant/usage counts, and record duration. Repeat the migration procedure against a recent copy, simulate an application rollback that leaves the expanded schema, and document the roll-forward choice for any failed migration.

## Automated suite

```sh
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
npm run security:secrets
npm run security:audit
```

Database integration tests require `QMON_TEST_DATABASE_URL` pointing only to a disposable migrated database. CI runs fresh migrations and invariants; production restore workflows must never target the live database.

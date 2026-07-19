#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${BACKUP_FILE:?BACKUP_FILE is required}"
: "${BACKUP_AGE_IDENTITY:?BACKUP_AGE_IDENTITY is required}"
: "${TARGET_DATABASE_URL:?TARGET_DATABASE_URL is required}"
: "${RESTORE_CONFIRMATION:?RESTORE_CONFIRMATION must be set to RESTORE}"

if [[ "$RESTORE_CONFIRMATION" != "RESTORE" ]]; then
  echo "RESTORE_CONFIRMATION must equal RESTORE" >&2
  exit 2
fi

temporary="$(mktemp "${TMPDIR:-/tmp}/queue-monitor-restore.XXXXXX.dump")"
trap 'rm -f "$temporary"' EXIT

expected_checksum="$(cut -d ' ' -f 1 "$BACKUP_FILE.sha256")"
actual_checksum="$(shasum -a 256 "$BACKUP_FILE" | cut -d ' ' -f 1)"
if [[ -z "$expected_checksum" || "$actual_checksum" != "$expected_checksum" ]]; then
  echo "backup checksum verification failed" >&2
  exit 3
fi
age --decrypt --identity "$BACKUP_AGE_IDENTITY" --output "$temporary" "$BACKUP_FILE"
pg_restore --list "$temporary" >/dev/null
pg_restore --dbname="$TARGET_DATABASE_URL" --clean --if-exists --no-owner --no-acl "$temporary"
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT count(*) AS migration_count FROM schema_migrations;"
printf '{"level":"info","event":"backup_restored_and_validated"}\n'

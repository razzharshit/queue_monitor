#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required}"

BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary="$(mktemp "$BACKUP_DIR/.queue-monitor-${timestamp}.XXXXXX.dump")"
encrypted="$BACKUP_DIR/queue-monitor-${timestamp}.dump.age"
trap 'rm -f "$temporary"' EXIT

command -v pg_dump >/dev/null
command -v pg_restore >/dev/null
command -v age >/dev/null

pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl --file="$temporary"
pg_restore --list "$temporary" >/dev/null
age --recipient "$BACKUP_AGE_RECIPIENT" --output "$encrypted" "$temporary"
shasum -a 256 "$encrypted" > "$encrypted.sha256"

printf '{"level":"info","event":"encrypted_backup_created","path":"%s","checksum":"%s.sha256"}\n' "$encrypted" "$encrypted"

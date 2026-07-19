#!/usr/bin/env bash
set -euo pipefail
umask 077

: "${BACKUP_FILE:?BACKUP_FILE is required}"
: "${BACKUP_AGE_IDENTITY:?BACKUP_AGE_IDENTITY is required}"

temporary="$(mktemp "${TMPDIR:-/tmp}/queue-monitor-verify.XXXXXX.dump")"
trap 'rm -f "$temporary"' EXIT

expected_checksum="$(cut -d ' ' -f 1 "$BACKUP_FILE.sha256")"
actual_checksum="$(shasum -a 256 "$BACKUP_FILE" | cut -d ' ' -f 1)"
if [[ -z "$expected_checksum" || "$actual_checksum" != "$expected_checksum" ]]; then
  echo "backup checksum verification failed" >&2
  exit 3
fi
age --decrypt --identity "$BACKUP_AGE_IDENTITY" --output "$temporary" "$BACKUP_FILE"
pg_restore --list "$temporary" >/dev/null
printf '{"level":"info","event":"backup_verified","path":"%s"}\n' "$BACKUP_FILE"

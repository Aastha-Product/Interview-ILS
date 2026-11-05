#!/usr/bin/env bash
# Backup and restore drill (docs/backup-restore.md): takes a full logical backup of a database,
# restores it into a fresh scratch database, and checks that every table has the same number of
# rows. Run monthly against staging, and in CI on every push. Run it while the app is quiet: a
# student saving something between the backup and the count shows up as a difference (re-run).
#
#   SOURCE_URL=postgresql://user:pass@host:5432/pathfinder \
#   ADMIN_URL=postgresql://user:pass@host:5432/postgres \
#   scripts/backup-drill.sh
#
# ADMIN_URL must be allowed to CREATE/DROP DATABASE; the scratch database is pathfinder_restore_drill
# on that server, and is dropped again at the end. Uses the postgres:17 image for pg_dump, pg_restore
# and psql (set PG_IMAGE to change it), so it only needs Docker. Linux: uses --network host.
set -euo pipefail

: "${SOURCE_URL:?Set SOURCE_URL to the database to back up}"
: "${ADMIN_URL:?Set ADMIN_URL to a database URL that may create databases}"
PG_IMAGE="${PG_IMAGE:-postgres:17}"
DRILL_DB="pathfinder_restore_drill"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

pg() { docker run --rm -i --network host -v "$WORKDIR:/backup" "$PG_IMAGE" "$@"; }
# The restore target: ADMIN_URL with its database name swapped for the drill database.
RESTORE_URL="$(printf '%s' "$ADMIN_URL" | sed -E "s#/[^/?]+(\?|$)#/${DRILL_DB}\1#")"

counts() {
  # One line per table: schema.table rowcount. Every app table except the rate-limit counters, which
  # change with every request (the pg-boss queue tables in schema pgboss are restored but not compared).
  pg psql "$1" -At -v ON_ERROR_STOP=1 <<'SQL'
SELECT format('SELECT %L || '' '' || count(*) FROM %I.%I;', table_schema || '.' || table_name, table_schema, table_name)
FROM information_schema.tables
WHERE table_type = 'BASE TABLE' AND table_schema = 'public' AND table_name <> 'RateLimit'
ORDER BY table_schema, table_name
\gexec
SQL
}

started=$(date +%s)
echo "1/4 Backing up (pg_dump, custom format)…"
pg pg_dump --format=custom --no-owner --no-privileges --file=/backup/pathfinder.dump "$SOURCE_URL"
echo "    $(du -h "$WORKDIR/pathfinder.dump" | cut -f1) written"

echo "2/4 Creating scratch database ${DRILL_DB}…"
pg psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -q -c "DROP DATABASE IF EXISTS ${DRILL_DB};" -c "CREATE DATABASE ${DRILL_DB};"

echo "3/4 Restoring (pg_restore)…"
pg pg_restore --no-owner --no-privileges --exit-on-error --dbname="$RESTORE_URL" /backup/pathfinder.dump

echo "4/4 Comparing row counts…"
counts "$SOURCE_URL" > "$WORKDIR/source.txt"
counts "$RESTORE_URL" > "$WORKDIR/restored.txt"
pg psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS ${DRILL_DB};"

if diff -u "$WORKDIR/source.txt" "$WORKDIR/restored.txt"; then
  tables=$(wc -l < "$WORKDIR/source.txt")
  rows=$(awk '{ s += $2 } END { print s }' "$WORKDIR/source.txt")
  echo "PASS: ${tables} tables, ${rows} rows restored identically in $(( $(date +%s) - started )) s."
else
  echo "FAIL: the restored database differs from the source (see the diff above)." >&2
  exit 1
fi

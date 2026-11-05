# Backup and restore runbook

Pathfinder keeps student data in two places, and both must be backed up:

| What | Where | Holds |
| --- | --- | --- |
| **Database** | Managed PostgreSQL 17 | Accounts, profiles, jobs, applications, drafts, the audit log, the job queue |
| **Files** | S3-compatible bucket | Uploaded resumes and generated PDFs (`users/<id>/...`) |

Everything else (the containers) can be rebuilt from this repository.

**Targets for the pilot** (adjust as you learn):

| Target | Value | Meaning |
| --- | --- | --- |
| Recovery point (RPO) | at most 24 h of data lost | Minutes, if the provider has point-in-time recovery |
| Recovery time (RTO) | about 2 hours to a working site | |
| Restore drill | monthly, on staging | Plus automatically in CI on every push (`scripts/backup-drill.sh`) |

## 1. Turn on backups (once per environment)

**Database**
1. In the provider's console, turn on **automatic daily backups**, and **point-in-time recovery (PITR)** if offered. Keep at least 7 days, ideally 30.
2. Note where backups are stored and how a restore works: usually "restore into a new database" or "create a branch from a point in time".

**Files**
1. Turn on **object versioning** for the bucket if the provider supports it, so overwritten or deleted files can be recovered for a limited time. Where it isn't available (check your provider), rely on the weekly copy below.
2. Weekly, copy the bucket to a second bucket in another account or region with any S3 tool, for example `rclone sync` or `aws s3 sync --endpoint-url ...`. Generated PDFs can always be re-rendered, but uploaded resumes cannot.

**Extra logical backup (recommended weekly):** a `pg_dump` kept outside the provider protects against losing the provider account itself:

```bash
pg_dump --format=custom --no-owner --no-privileges --file="pathfinder-$(date +%F).dump" "$DATABASE_URL"
```

Store the file encrypted (it contains personal data), in a place only the people running Pathfinder can reach. The `pg_dump` version must be **17 or newer**; `docker run --rm -v "$PWD:/backup" postgres:17 pg_dump ... --file=/backup/...` works anywhere Docker does.

## 2. Monthly restore drill (staging)

Do this when the staging site is quiet.

```bash
SOURCE_URL='postgresql://USER:PASS@HOST:5432/pathfinder_staging?sslmode=require' \
ADMIN_URL='postgresql://USER:PASS@HOST:5432/postgres?sslmode=require' \
scripts/backup-drill.sh
```

The script:
1. takes a full backup of `SOURCE_URL` with `pg_dump`
2. restores it into a scratch database `pathfinder_restore_drill` on the `ADMIN_URL` server
3. compares the row count of every table
4. drops the scratch database

It prints `PASS: N tables, M rows restored identically`, or a diff. It needs only Docker (it uses the `postgres:17` image) and a user allowed to create databases. On macOS and Windows, Docker's `--network host` doesn't reach your machine, so run it from Linux or from CI.

Also, once a quarter, practise the provider's own restore: restore yesterday's backup into a new staging database, point a staging deploy at it, and sign in.

Record each drill: date, who, result and time taken.

## 3. Restoring after an incident

Decide first **what** was lost and **when**.

| Situation | Do this |
| --- | --- |
| A bad deploy, but data is fine | Roll back the app ([deploy.md §7](deploy.md#7-updating-and-rolling-back)). No restore. |
| Data was deleted or corrupted at a known time | Restore the database to just before that time (PITR), or to the last daily backup. |
| The database is lost entirely | Restore the latest backup into a new database. |
| Files were deleted | Restore the objects from versioning or the weekly copy. |

**Database restore, step by step**
1. **Stop writes:** scale the web and worker services to 0, or put the site in maintenance with the host's controls.
2. **Restore into a new database.** Don't overwrite the damaged one, which you may still need.
   - **Provider backup or PITR:** use the console's restore, choosing the time.
   - **From a `pg_dump` file:**

     ```bash
     createdb -h HOST -U USER pathfinder_restored
     pg_restore --no-owner --no-privileges --exit-on-error --dbname='postgresql://USER:PASS@HOST:5432/pathfinder_restored' pathfinder-YYYY-MM-DD.dump
     ```
3. **Check it:** row counts look right, and `SELECT max(finished_at) FROM _prisma_migrations;` shows the expected latest migration.
4. **Point both services' `DATABASE_URL` at the restored database,** and deploy. The release step applies any newer migrations.
5. **Start the services,** then check `/api/health`, sign in, and open an application with a PDF.
6. **Reconcile files:** a restore to an earlier time can reference PDFs created after that time (harmless), and can miss files uploaded since (re-upload or re-render).
7. **Write down** what happened, what was lost, and the time taken. If personal data was exposed, follow the breach steps below.

**Queued jobs** (drafting and PDFs) are part of the database. After a restore, some may run again, and some tasks may be stuck. The worker fails tasks stuck for more than 30 minutes, and students can press **Try again**.

## 4. Deletion and backups (DPDP Act)

When a student deletes their account, Pathfinder deletes their rows and files at once. Copies in **backups** remain until those backups expire (7–30 days, depending on your settings above). That is normal practice. The privacy notice says so, and the retention window should stay short.

**If you restore a backup taken before someone deleted their account,** their data comes back. After any restore, delete those accounts again:
1. Collect the `userHash` values from `account deleted` log lines since the backup was taken. The logs never hold the id or email, only this keyed hash.
2. For each user in the restored database, compute the same hash: HMAC-SHA256 of `user:<id>`, keyed with that environment's `AUTH_SECRET`, first 32 hex characters (see `deleteAccount` in `packages/core/src/account/service.ts`).
3. For every match, remove the account's files (`users/<id>/` in the bucket) and its `User` row (deleting the row removes everything else). Keep your logs long enough to cover your backup retention.

## 5. Personal data breach

If personal data may have been exposed (a leaked backup or credentials, or the wrong student seeing data):
1. **Contain it:** rotate the exposed credentials (database, bucket key, `AUTH_SECRET`), and revoke leaked backups or links.
2. **Record it:** what happened, when, which data and how many students.
3. **Notify:** India's DPDP rules require notifying the Data Protection Board and the affected students. Get the current timelines and format from your legal adviser, and do it without delay.

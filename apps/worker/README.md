# apps/worker

The background worker: a separate Node process (`pnpm worker`) that runs the pg-boss queues stored in the main Postgres, keeping slow work off web requests.

| Queue | What it does | Concurrency |
| --- | --- | --- |
| `ai.tailor` | Drafts the tailored resume and answers (fact-checked), then queues the PDF. Runs under a deadline inside the queue's expiry. | 4 per worker, 2 per student |
| `pdf.render` | Renders a resume version to PDF with Chromium (scripts and network off) and stores it. | 2 per worker |
| `cleanup.retention` | Nightly at 03:00 India time: deletes derived or expired data (see `RETENTION` in `packages/db/src/maintenance.ts`). | 1 |
| `*.dead` | Jobs that used up their retries: logged by id and shown to the student as failed. | — |

Every 5 minutes it also fails tasks stuck for 30 minutes and drops old rate-limit counters.

Not built yet: `ai.extract` runs inline in the web request (results are cached per posting), and `jobs.ingest` (daily feed search per student) isn't scheduled, because the JSearch free plan allows about 200 requests a month.

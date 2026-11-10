# Handoff

Read this first, update it last. Several Claude accounts work on Pathfinder from the same laptop and
the same folder, one at a time. This file is how one session tells the next what happened.

## Where things are

- **Repository:** https://github.com/Aastha-Product/Interview-ILS (`origin`). Push here.
- **Local folder:** `C:\Users\Aastha Pandey\Downloads\Deepa F\Pathfinder\code`, a link to
  `D:\Pathfinder\dossier` (the C: drive is full, so the code and its packages live on D:).
- **Other remotes:** `dossier-fork` (Aastha-Product/dossier, the earlier home of this code) and
  `upstream` (AienTech/dossier, the original project; pushing to it is disabled). The local branch
  `upstream-dossier-main` is upstream's `main`, kept for reference: never push it to `origin`.
- **Licence:** AGPL-3.0 (from Dossier). Keep the notices; the source stays public.
- **Rules and the remaining v1 tasks:** `docs/pathfinder-v1-plan.md`. Never automate job portals or
  scrape them, never invent experience, never log resume or prompt text, never commit secrets,
  don't deploy or use real API keys without asking.

## How every session works

1. **Start:** make sure no other account is working in this folder. Then `git status` (anything
   uncommitted? ask before touching it), `git fetch origin`, check out your branch and
   `git pull`, and read the latest entry below.
2. **Work on a branch,** never on `main`: one per task, from the latest `main`, named
   `fix/...`, `feature/...` or `chore/...`. Commit small, with clear messages.
3. **Before a pull request,** run the checks (below) and merge the latest `main` into your branch,
   so any conflicts are solved on the branch.
4. **Code reaches `main` only through a pull request** that passes CI, merged by the owner.
   Never force-push, never rewrite history, never push straight to `main`.
5. **End:** commit everything, push your branch, and add an entry at the top of the log below.
   Nothing stays only in the folder.

## Checks (Windows)

Use Yarn through corepack, and keep temp files on D: (C: is full):

```powershell
$env:COREPACK_HOME='D:\Pathfinder\.corepack'; $env:TEMP='D:\Pathfinder\tmp'; $env:TMP='D:\Pathfinder\tmp'
corepack yarn typecheck
corepack yarn lint
corepack yarn test
```

The database tests need `TEST_DATABASE_URL` set (it's in the local `.env`, which vitest doesn't
load by itself). The local Postgres runs on port 5432: start it from `D:\Pathfinder\pathfinder`
with `pnpm services:up`. Six tests in `env.test.ts` and `session-audit.test.ts` fail on Windows
only (path separators); everything else must pass. The browser tests (`yarn test:e2e`) don't run
on Windows yet; they need Linux or CI.

**CI also checks test coverage** (`yarn test:coverage`, thresholds in `vitest.config.mts`): new code
needs tests or the check fails. Locally the coverage summary only prints when every test passes, so
move `src/lib/env.test.ts` and `src/lib/session-audit.test.ts` aside for that run and put them back.

**Migrations are written by hand** here, named after the latest one (their dates run ahead of the
calendar, so a generated one would sort first). Never run `prisma migrate dev` against this schema:
`SharedPosting.search` (a generated full-text column) and the same-owner foreign keys live only in
the migrations, and Prisma would try to drop them. Check a new migration with `prisma migrate diff
--from-config-datasource --to-schema prisma/schema.prisma --script` against the test database.

## Current state (8 November 2026)

| Branch | What it holds |
| --- | --- |
| `main` | **This app:** private student accounts, the QA fixes, the UI redesign (#1), the www redirect (#3) and the scale-audit P0 work (#4 to #8: managed mode, the job tools for students, the Postgres job queue with a worker, the pool and caching, backups/M-1/M-6). Start every new branch from here. |
| `pathfinder-v1` | The earlier Pathfinder app (Next.js monorepo, Phases 1–5), kept for reference; also in `main`'s history. |
| Every other branch | Merged into `main`; no new work there. |

**Live:** https://pathfinderedtech.com runs `main` (deployed 8 November) on AWS Lightsail, Sydney
(`docs/deploy-aws-lightsail.md`), with Firebase sign-in (project `interview-final-295ef`: email and
password with email verification, Google, password reset); the access code is off. The server's
settings are in `/opt/pathfinder/deploy/lightsail/.env` (not in Git), changed in the Lightsail
browser terminal (Lightsail console, region Sydney, the instance's terminal icon); to deploy, there:
`sudo git -C /opt/pathfinder fetch origin && sudo git -C /opt/pathfinder checkout -B main origin/main`
then `sudo BRANCH=main bash /opt/pathfinder/deploy/lightsail/setup.sh https://github.com/Aastha-Product/Interview-ILS.git pathfinderedtech.com`.
Vercel is not used for this site.

**Done:** QA audit (report: https://claude.ai/artifact/NszT6XWfFbikbb3syqmxZz) and fixes for
C-1, C-2/H-2, H-1, H-3, M-1, M-3, M-4, the unit half of M-6. UI redesign (report:
https://claude.ai/artifact/4DwdbGGvd2MtBhCryBeXPN). Scale audit (report:
https://claude.ai/artifact/GSHLW1T2jiX99CUiBtAUov): all five P0 tasks.

**Open, in priority order:**

1. **Firebase console (owner):** add `pathfinderedtech.com` and `www.pathfinderedtech.com` under
   Authentication → Settings → Authorized domains (until then sign-in fails on the live site with
   "unauthorized domain"), and check that Email/Password is enabled (Google is). Then test sign-up
   and sign-in on the live site.
2. **Live server (owner):** confirm `sudo docker compose -f /opt/pathfinder/deploy/lightsail/compose.yml ps`
   lists app, worker, db and caddy; rotate the shared AI key (`DOSSIER_AI_KEY`); with the job tools
   on, set `DOSSIER_JOBS_SOURCE` and its key, or `PATHFINDER_TOOLS=off`.
3. **M-6, browser tests:** "Lint, type-check and test" passes; make it a required check on `main`.
   "End-to-end tests" is still red: the demo seed (`prisma/seed/demo.ts`) and the raw SQL in
   `e2e/support.ts` write rows without an owner, and the 142 specs were written for single-user
   Dossier, before the student mode and the redesign. They don't run on Windows (use CI or a Linux
   container).
4. **C-3 in code:** refuse to start in production on the access code unless
   `PATHFINDER_SIGN_IN=code` is set; never let the code open an account linked to Google or
   Firebase. Started and stopped on 7 November at the owner's request: ask before resuming.
5. **Scale audit P1 and later:** Sentry and off-site database backups need the owner's approval
   (paid or cloud resources); then the managed AWS setup in the report (ECS, RDS, S3) for thousands
   of students at once.
6. **M-2:** address guard for AI provider URLs; **M-5:** bind the Gmail OAuth state to the student.
7. Low items L-1 to L-8 in the QA report.
8. Before a public launch: legal review of the privacy notice (DPDP Act).

## Repository settings (done by the owner, 7 November 2026)

- Default branch: `main`.
- Ruleset **protect main** (active): pull request required (0 approvals), merge commits only,
  force pushes blocked, deletion blocked. "Require status checks" is off until CI is green (M-6);
  then turn it on and add the CI check.
- The previous `main` (Phases 1–5 monorepo) is kept as the branch `pathfinder-v1`.

## Log

Newest first. One entry per session: date, account, branch, what changed, what's next.

- **2026-11-10 · account 3 · `feature/extension-api`** — Auto-apply **step 5a, the extension's API**
  (built on #20, `fix/pipeline-findings`: merge that first). Also done this session: step 4 part 2
  (Set up job search and the dashboard, #19, merged) and the pipeline check against 89 real
  Greenhouse forms (`src/lib/pipeline-check.db.test.ts`, run with `PATHFINDER_PIPELINE_CHECK=1`;
  34% of forms answerable in full, 100 students at once with no duplicates or crossed data; results
  on #20). This branch: table `ExtensionToken` (only a hash stored, 90 days, revocable; migration
  `20261117090000_extension_tokens`), `src/lib/extension/` (`extensionRoute()` checks the bearer
  token and runs the handler as its student; the session audit test requires it on every
  `/api/ext/` route), `src/lib/apply/lease.ts` (lease the oldest READY task for 10 minutes; once the
  extension says SUBMITTING it's never handed out again: no answer within 3 minutes makes it
  UNCERTAIN for the student to check, so nothing is ever submitted twice; "applied" marks the
  application SENT), routes `/api/ext/status`, `lease`, `tasks/[id]/answers` (answers a form the
  extension read), `document` (the tailored PDF) and `report`; the page Connect the extension
  (`/auto-apply/extension`, hands the token to the extension through `window.postMessage`) and
  Mark as applied on the dashboard. **Next:** step 5b, the Chrome extension itself (`extension/`:
  bridge, background loop, Greenhouse filler; dry run fills only), then 5c (Lever, Ashby) and step
  6 (tests on mock boards, load test, dry-run pilot). **Owner:** add companies that hire freshers
  (the starter list is mostly global firms); legal review of `CONSENT_TEXT`.

- **2026-11-10 · account 3 · `feature/auto-apply-prepare`** — Merged #14 to #17 into `main` at the
  owner's request (not deployed). Auto-apply **step 4, part 1 (server)**: `src/lib/apply/`. Tables
  `AutoApplySettings` (consent with its wording's version, preferences, tier, daily and per-company
  limits, dry run on by default, saved answers) and `ApplyTask` (one per student and job, ever;
  states PREPARING → READY → LEASED → SUBMITTING → APPLIED, or NEEDS_STUDENT, UNCERTAIN, FAILED,
  SKIPPED); `ApplicationOrigin.AUTO_APPLY`; migration `20261116090000_auto_apply`. A Strong/Good
  score (or the half-hourly schedule, which also runs matching daily) plans tasks within the limits;
  `prepare-application` writes the tailored resume and letter through the same path as New
  application (claim kind `auto-apply`: never two applications per task) and answers Greenhouse
  forms from the public API with `answerForm` (rules for the questions most forms ask; nothing is
  guessed: a required question it can't answer makes the task NEEDS_STUDENT). Consent wording
  (`CONSENT_TEXT`) needs a legal review before launch. **Next:** step 4 part 2, the screens: Set up
  job search (preferences, saved answers, consent, limits) and the auto-apply dashboard.

- **2026-11-10 · account 3 · `feature/job-matching`** — Auto-apply **step 3 of 6** (built on #16 and
  #15; merge those first). Matching (`src/lib/match/`): `startMatchRun()` ranks the shared pool for a
  student with Postgres full-text search (generated column `SharedPosting.search`, GIN index;
  migration `20261115090000_job_matching`), no pgvector or embedding model: it's fast (under 20 ms on
  455 real jobs), installs nothing, and the AI reads every shortlisted job anyway; embeddings can
  slot in behind `rankPool` later if recall is weak. Title vs target roles counts 3× skills; hard
  filters for countries/cities/remote, internships, not shortlisted before; for freshers, senior
  titles and jobs asking 3+ years are dropped (`forNewGraduates`). Shortlists 25 per run; each gets
  a `score-match` job (queue `ai`, 3 attempts) storing score, reasons, gaps and tier in `JobMatch`
  (owned): Strong 80+, Good 65+, Partial 50+, else Not recommended. Preferences come from the
  profile until step 4. **Finding:** a live check on 6 starter companies (455 jobs) found almost
  no fresher software roles: global tech boards hire experienced people. The company list needs
  employers that hire freshers and interns. Also on #16: tests added after CI's coverage check
  failed. **Next:** step 4, auto-apply settings, consent, apply tasks and preparation.

- **2026-11-10 · account 3 · `feature/job-board-crawler`** — Auto-apply **step 2 of 6** (built on
  #15, merge that first). The crawler (`src/lib/crawl/`) reads companies' public job boards on
  Greenhouse, Lever, Ashby and SmartRecruiters every 6 hours into `SharedPosting`, one shared pool
  for every student (tables `Company`, which is also the crawl schedule, and `SharedPosting`; both
  system tables, no owner; migration `20261114090000_job_boards`). Keeps jobs in each company's
  countries (India by default) and remote jobs open worldwide or in Asia; loads only new or changed
  jobs; closes jobs gone from a board; a failing board waits 15 min, 1 h, 4 h… up to a day; a board
  that doesn't exist is paused. Uses step 1's shared rate limits. **Off unless `PATHFINDER_CRAWL=on`**.
  Starter list: 33 companies checked live on 10 Nov to have India jobs (~1,700 then), in
  `src/lib/crawl/companies.ts`. A live crawl of one board per system matched the boards exactly.
  **Next:** step 3, matching (pgvector, CPU embeddings, AI score and tiers).

- **2026-11-10 · account 3 · `feature/queue-hardening`** — **New direction (owner's decision):** the
  core MVP feature is end-to-end auto-apply, through a Pathfinder extension in the student's own
  Chrome (Greenhouse, Lever and Ashby forms all carry CAPTCHAs, so never from our servers). Plans:
  https://claude.ai/artifact/LkinRgs8DH835N4qVVgKc5 (engine), https://claude.ai/artifact/LWn7WryAWi62rVTGjykG6J
  (costs, free job sources), https://claude.ai/artifact/QDaCvksqrdvACSyazdrtmS (audit). The rule in
  `docs/pathfinder-v1-plan.md` is updated to match. **Step 1 of 6 (this branch):** the job queue gains
  queues (`PATHFINDER_QUEUES`), priorities, automatic retries for background jobs (`attempts` in a
  job definition; passing AI failures and `RetryLater` wait 30 s, 2 min, 8 min… up to 15 min), a
  stopped worker's background jobs queued again, and a worker's writes only while it still holds
  the job; plus a shared rate limit per outside service (`src/lib/jobs/rate-limit.ts`, table
  `ProviderBudget`). Jobs a student starts keep one run, as before. Migration
  `20261113090000_queue_hardening`. Checks: type-check and lint clean; all tests pass except the 6
  known Windows-only ones. Also open from this session: #14 (Google sign-in fix) waits for merge and
  deploy. **Next:** step 2, the job-board crawler (Greenhouse, Lever, Ashby, SmartRecruiters) and the
  shared job pool.

- **2026-11-10 · account 3 · `fix/google-popup-coop`** — Found why "Continue with Google" fails: the
  site sent `Cross-Origin-Opener-Policy: same-origin` (`next.config.ts`), which cuts the Google
  popup off from the sign-in page (the popup's `/__/auth/handler` page has no COOP), so Firebase's
  `signInWithPopup` never got the result and nothing reached the server. Now
  `same-origin-allow-popups`, with a test (`src/lib/security-headers.test.ts`). Checks: type-check
  and lint clean; unit tests pass except the 6 known Windows-only failures. **Next:** owner merges the
  pull request and deploys (commands under Current state), then tests Google sign-in on the live
  site. If it still fails, get the screenshot and follow the plan in the entry below
  (`signInWithRedirect`, or the firebaseapp.com authDomain fallback).

- **2026-11-09 · account 2 · `chore/handoff-google-sign-in`** — Merged and deployed #11 (backup model;
  server has `PATHFINDER_AI_FALLBACK_MODEL=gemini-3.5-flash-lite`) and #12 (no email verification:
  sign-up goes straight in, an unverified address never takes over an existing student; a verified
  Google sign-in moves the student to its new Firebase account; Caddy serves Firebase's
  `/__/auth/` and `/__/firebase/` from the domain). Server `.env`: the real 39-character Firebase
  Web API key (a masked `•••` copy had broken all sign-in; `~/firebase-key.sh` saves it hidden),
  `PATHFINDER_FIREBASE_AUTH_DOMAIN=pathfinderedtech.com`. Google Cloud (project interview-final-295ef):
  OAuth web client has origin `https://pathfinderedtech.com` and redirect
  `https://pathfinderedtech.com/__/auth/handler`; Branding app name `Pathfinder` (shown only after
  "Verify branding", not submitted). Checked: sign-up and email sign-in work on the live site.
  **Open, top priority:** "Continue with Google" still fails. The Google popup opens, but no sign-in
  reaches the server (nothing in the app log, no new user), so it fails in the browser after the
  account is chosen. Get the owner's screenshot of the popup / message first. If it's
  `redirect_uri_mismatch`, Google hadn't picked up the new redirect yet (can take hours); otherwise
  switch `withGoogle` in `src/app/login/firebase-auth.tsx` to `signInWithRedirect` +
  `getRedirectResult` (works with the same-domain authDomain), with a test. Fallback if needed: set
  `PATHFINDER_FIREBASE_AUTH_DOMAIN` back to `interview-final-295ef.firebaseapp.com` and re-run setup.
  Also open: the 2 GB server builds in ~30 minutes and the site is slow meanwhile (4 GB plan advised);
  the AI key on the server is the shared hackathon Gemini key (replace with the owner's own).

- **2026-11-09 · account 2 · `feature/backup-model-any-provider`** — Deployed `main` with the admin
  console to pathfinderedtech.com (Sydney `pathfinder-app`; `PATHFINDER_ADMIN_EMAILS` set). The live
  server had no AI; the owner saved a Gemini key with `~/ai-key.sh` on the server (hidden paste;
  Lightsail's paste markers are stripped). Google sometimes refuses `gemini-3.5-flash` as "high
  demand", so `PATHFINDER_AI_FALLBACK_MODEL` now also works on other providers: set it to
  `gemini-3.5-flash-lite` (tested with the key) for a backup. Builds on the 2 GB server make the site
  unavailable for ~10 minutes. Next: merge, deploy, set the backup on the server.

- **2026-11-08 · account 2 · `feature/admin-console`** — Firebase's authorized domains now include
  pathfinderedtech.com and www (open item 1, done by the owner; checked through Firebase's API).
  Admin console at `/admin` for the emails in `PATHFINDER_ADMIN_EMAILS` (404 and no menu item for
  anyone else): students, analyses, AI calls with tokens and cost by model, latest feedback, and a
  per-student free allowance (`User.aiDailyLimit`, migration 20261112090000_admin_allowance; the
  daily limit now reads it per request). Calls on the server's key with any provider (Gemini too)
  go in the cost log; prices are known for Claude only. Next: owner sets
  `PATHFINDER_ADMIN_EMAILS` on the server and deploys after merging; then open item 2.

- **2026-11-08 · account 1 · `chore/handoff-live-firebase`** — Merged #4 to #8 at the owner's request.
  The owner deployed `main` to pathfinderedtech.com and switched sign-in to Firebase (checked from
  outside: the sign-in and sign-up pages are Firebase's, the access code is gone, `/jobs` asks for
  sign-in, www redirects). Firebase's authorized domains still lack the site (open item 1). The
  local `.env` has the Firebase settings for local testing. Next: open items 1 and 2 (owner), then 3.

- **2026-11-08 · account 1 · `fix/backups-race-ci`** — P0 task 5. Nightly per-student backups don't run
  in managed mode (the server's nightly pg_dump covers the database). M-1: the first of several
  analyses at once fills the empty profile, under a per-student advisory lock; the others find it
  filled (a test reproduced the failures first). M-6: the unit and database tests pass without the
  local `.env`, as on CI (`toolsEnabled()` no longer needs the full environment; the Google sign-in
  tests don't read it); coverage meets the thresholds. The browser tests are still to do (open
  item 3). Built on #7.

- **2026-11-08 · account 1 · `feature/db-pool`** — P0 task 4: the pool has 20 connections per process
  (`PATHFINDER_DB_POOL`), waits 10 s at most for a free one, and stops statements after 30 s; interactive
  transactions wait 10 s (was 2 s, the cause of the P2028 errors) and run 15 s. The settings and the
  profile name are read once per page render (React cache), fresh in actions and jobs. Load, one
  process, 2,000 users: errors 13% (was 49.6%), no P2028; the rest is one Node process at full CPU.
  4 web processes: 1,000 users median 372 ms with no errors, 2,000 users median 3.0 s with 0.9% errors.
  Built on #6. Next, P0 task 5: nightly per-student backups off by default, M-1, M-6.

- **2026-11-08 · account 1 · `feature/job-queue`** — P0 task 3: the Job table is the queue (migration
  20261111090000_job_queue). Workers claim jobs with `FOR UPDATE SKIP LOCKED`, students take turns
  (at most 2 running each, `PATHFINDER_JOBS_PER_STUDENT`), 10 at once per worker
  (`PATHFINDER_JOB_CONCURRENCY`). `PATHFINDER_ROLE` = all (default) | web | worker; compose now runs
  `app` (web) and `worker`. Progress, new jobs and cancels cross processes by LISTEN/NOTIFY; a
  heartbeat every 5 s, stale after 60 s = interrupted. Queued jobs survive restarts. Load check, 30
  analyses with 10 s AI calls: median 42 s, max 64 s (was 105 s and 208 s). Built on #5 and #4.
  Next: P0 task 4 (pool size and timeout, per-request caching of settings).

- **2026-11-08 · account 1 · `feature/student-tools`** — P0 task 2: students get Dossier's tools.
  `PATHFINDER_TOOLS` is now on unless set to off (compose and `.env.example` too). Off closes the
  tools on the server, not just the menu: their pages answer 404 in the proxy (`src/lib/tool-paths.ts`),
  their actions use `toolAction()` and refuse, and the inbox and agent schedules don't start.
  Managed Settings: Account, Plan, Job agent, Documents, Google (with a server client), Your data
  (no backup switch), Privacy and data, Help; no About. Built on `feature/managed-mode` (pull
  request #4), so merge that first. Next, P0 task 3: a Postgres job queue and a worker.

- **2026-11-08 · account 1 · `feature/managed-mode`** — P0 task 1 of the scale audit
  (https://claude.ai/artifact/GSHLW1T2jiX99CUiBtAUov): `PATHFINDER_MANAGED` (on by default). The
  AI, job search, scoring and Google client come only from the server's DOSSIER_* variables; what
  a student saved is ignored; their settings actions refuse; Settings hides AI provider, Job
  search, Scoring (and Google without a server client); "check your key / choose a provider"
  messages become plain ones, logged for the operator. Inherited tests run self-hosted
  (`PATHFINDER_MANAGED=off` in the test setup and e2e). Next, P0 task 2: show students the
  Dossier tools and enforce the tools gate on the server.

- **2026-11-07 · account 1 · `chore/handoff-after-merge`** — Merged pull request #1: `main` is now
  this app (old app kept as `pathfinder-v1`). Made the Pages workflow manual-only (site/ is
  upstream Dossier's website). Next: the open list above, starting with the live server (owner)
  and M-6 so CI goes green.

- **2026-11-07 · account 1 · `pathfinder-redesign`** — Checked Interview-ILS: default branch is
  `main`, the protect-main ruleset is active, all work is pushed. Next: the owner opens the pull
  request `release/new-main` → `main`
  (https://github.com/Aastha-Product/Interview-ILS/compare/main...release/new-main), sets Vercel's
  production branch to `pathfinder-v1` or disconnects it, and merges with "Create a merge commit".

- **2026-11-07 · account 1 · `pathfinder-redesign`** — Moved the work to Interview-ILS: pushed
  `pathfinder-multiuser` and `pathfinder-redesign`, made Interview-ILS `origin`, linked the code
  into the Pathfinder folder, added this file. Next: owner sets the GitHub default branch and the
  `main` protection rules, then merges the pull request that makes `pathfinder-redesign` the new
  `main`.

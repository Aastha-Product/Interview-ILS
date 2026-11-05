# Pathfinder

Pathfinder helps Indian freshers apply to jobs off-campus. A student builds one profile, adds jobs, gets a tailored resume and answers drawn **only from their own profile**, submits each application themselves on the job site, and tracks responses.

This repository is the MVP, built in phases: **1** foundation (sign-in, user-scoped data, profile, resume import), **2** jobs and matching, **3** the application flow (drafting with a fact check, PDFs, tracker, dashboard) **4** reliability, security and privacy (limits, AI fallback, export and delete, CSP, retention, injection and load tests) and **5** pilot readiness (demo data, staging config, container images, deployment guide, backup runbook, privacy notice draft). Nothing is deployed: see [Deploying](#deploying).

## Rules the code must keep

- **No automation on job portals.** Pathfinder never logs in to, fills or submits forms on Naukri, LinkedIn, Indeed, Internshala or any other portal, and never asks for or stores portal passwords or cookies.
- **No scraping.** Jobs come only from licensed APIs (JSearch, Adzuna) or from links and text the student pastes. No CAPTCHA bypass, IP rotation or bot-detection evasion.
- **Never invent experience.** Generated content may only use facts from the student's profile. Anything else is shown as a gap.
- **Job descriptions and resumes are untrusted input.** They go to the model inside a marked data block and can never change instructions.
- **Personal data (India DPDP Act, 2023).** Resume text, profile content and AI prompts are never logged. Only a hash of each prompt is stored. Production storage and the database use the provider's encryption at rest.
- **No code from `AienTech/dossier`** (AGPL-3.0). This is a clean implementation.

## What you need

- **Node.js 22 or newer**
- **pnpm 10**. Install it with:

  ```bash
  npm i -g pnpm@10
  ```

  (`corepack enable` can fail on Windows without admin rights, so the npm install is the reliable route.)
- **No Docker.** The database runs from npm-packaged PostgreSQL 17 binaries, and files are stored in a local folder.

## Set up and run

1. Install dependencies. This also generates the Prisma client.

   ```bash
   pnpm install
   ```

2. Create your local settings file:

   ```bash
   cp .env.example .env
   ```

3. Replace `AUTH_SECRET=change-me` in `.env` with a random value. This prints one:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

4. Start the local database. On the first run this creates `.local/pg` and the `pathfinder` and `pathfinder_test` databases.

   ```bash
   pnpm services:up
   ```

5. Apply the database migrations:

   ```bash
   pnpm db:deploy
   ```

6. Start the web app, then open http://localhost:3000.

   ```bash
   pnpm dev
   ```

7. In a second terminal, start the queue worker. It writes tailored drafts and renders PDFs; without it, "Start application" stays at "in the queue".

   ```bash
   pnpm worker
   ```

   The worker renders PDFs with Chromium. Install it once with `pnpm --filter @pathfinder/e2e install-browsers` (it goes into `node_modules`).

The app starts and every test passes with all AI and job-feed keys left empty.

8. *Optional:* fill a demo account so every screen has something to show, then sign in with **Dev sign-in** as `demo@example.test`:

   ```bash
   pnpm db:seed
   ```

   It adds a fictional student's profile, 8 scored jobs and 7 applications over five weeks (3 with drafts; their PDFs render while `pnpm worker` runs). It only fills an empty account and is refused when `APP_ENV=production`.

### Applications, drafts and the worker

- **Queues.** pg-boss stores its queues in the same Postgres (schema `pgboss`). Queues: `ai.tailor` (drafting), `pdf.render` and `cleanup.retention` (nightly). Jobs that fail every retry go to a `.dead` queue, and the student sees "failed" with a reason and a "Try again" button. Drafting runs under a deadline inside the queue's 120 s expiry, so a slow run can't be handed to a second worker; a redelivered job whose task already finished is skipped.
- **Housekeeping.** Every 5 minutes the worker fails tasks stuck for 30 minutes (a crash can't hold a student's slot forever) and drops old rate-limit counters. Every night at 03:00 India time `cleanup.retention` deletes derived or expired data only (`RETENTION` in `packages/db/src/maintenance.ts`): AI call detail after 30 days (daily totals stay), match scores, closed unapplied listings and search history after 90 days, expired cache entries, usage totals after 2 years. Profiles, applications, documents and the audit log are kept until the student deletes their account.
- **Limits.** A student can have at most `AI_CONCURRENT_PER_USER` (2) drafts or PDFs in progress and `TAILOR_DAILY_LIMIT` (20) drafts a day. Requesting the same draft twice (same job and profile version) returns the existing one.
- **No invented experience.** The resume and answers are written only from numbered facts in the profile. Code rejects any point that cites no facts, cites unknown facts or facts from another item, or adds a number or skill the facts don't contain. A second, cheaper AI check confirms each remaining point. Failing drafts are regenerated once; anything still unsupported is left out and listed for the student. What the job asks for but the profile lacks is shown as a gap.
- **PDFs** are rendered from fixed HTML with scripts and network access disabled. They are downloaded through a link that expires after 5 minutes and only works for the student who owns the file.
- **Response rate** = responses ÷ applications sent. "Sent" is set when the student presses "I've applied"; a response is any employer reply (response, interview, offer or rejection). Weeks run Monday to Sunday, India time.

### Limits and the AI fallback

| Limit | Setting | Default | When hit |
| --- | --- | --- | --- |
| API requests per student | `RATE_LIMIT_API_PER_MINUTE` | 60 a minute | 429 with `Retry-After` and a friendly message |
| Sign-in attempts per IP | `RATE_LIMIT_SIGNIN_PER_MINUTE` | 10 a minute | back to sign-in with a message |
| Drafts per student | `TAILOR_DAILY_LIMIT` | 20 a day | 429 |
| Drafts or PDFs in progress per student | `AI_CONCURRENT_PER_USER` | 2 | 429 |
| Live job searches per student | `SEARCH_COOLDOWN_SECONDS` | 1 per 5 minutes | cached results, or 429 |

Counters live in Postgres (`RateLimit` table), so every web instance shares them and simultaneous requests can't slip past.

The AI client retries with backoff (1 s, 2 s), and after 5 outages (timeouts, 429s, 5xx) in a minute it opens a circuit for 2 minutes. While open, calls go to the **fallback model** if `FALLBACK_AI_BASE_URL`, `FALLBACK_AI_API_KEY` and `FALLBACK_AI_MODEL` are set (any OpenAI-compatible Chat Completions API), or fail fast if not. The fallback also gets one try when Gemini fails every retry. It receives the same student data, so use a paid tier that doesn't train on inputs.

### Security and privacy

- **Content-Security-Policy** with a fresh nonce per request (`apps/web/proxy.ts`): only the app's own scripts run. HSTS is sent when `APP_URL` is https.
- **Uploads** are checked by size (and must declare it) and by file content, not name.
- **Job text and resumes are untrusted.** They reach the model inside a data block that the text can't close or fake (`packages/ai/src/untrusted.ts`), control characters are dropped before storage, and `fixtures/injection-payloads.json` is the prompt-injection test set.
- **Export and delete** (Settings): the student downloads everything as JSON, or deletes the account, which removes their files and every row they own and signs them out everywhere. Both are in the audit log (until the account is deleted); a deletion is logged as a keyed hash of the id.

### Signing in locally

- **Dev sign-in.** A **Dev sign-in** button appears only when `NODE_ENV` is not `production` **and** `AUTH_GOOGLE_ID` is empty. It creates or reuses a local test user, and the end-to-end tests use it. It can never appear in production.
- **Real Google sign-in.**
  1. In Google Cloud Console, create an OAuth client ID of type *Web application*.
  2. Add the authorised redirect URI `http://localhost:3000/api/auth/callback/google`.
  3. Put the client ID and secret in `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` in `.env`.

  The dev button then disappears.

### AI (optional)

With `GEMINI_API_KEY` empty, a built-in mock is used. It reads resumes with simple rules, so import still works offline.

To use Gemini, set `GEMINI_API_KEY`. `GEMINI_MODEL` defaults to the alias `gemini-flash-latest`, which Google moves to new releases automatically. For a pilot, pin a specific stable model instead, for example `GEMINI_MODEL=gemini-3.6-flash`. Use a paid tier for student data, so inputs are not used for training.

### File storage

| `STORAGE_DRIVER` | Where files go | Use for |
| --- | --- | --- |
| `local` (default) | `.local/storage` (or `STORAGE_LOCAL_DIR`) | Development only |
| `s3` | Any S3-compatible bucket (Cloudflare R2, AWS S3, MinIO), using the `S3_*` settings | Staging and production (required in production) |

### Jobs: feeds and pasted jobs

- **Feeds.** With `JSEARCH_API_KEY` or `ADZUNA_APP_ID`/`ADZUNA_APP_KEY` empty, searches use the recorded fixtures in `packages/feeds/fixtures/`, so no live calls are made in development or tests.
  - JSearch v5: `GET https://jsearch.p.rapidapi.com/search-v2` with `x-rapidapi-key` and `x-rapidapi-host` headers, `country=in`, cursor paging. Each page of up to 10 jobs costs one request; the free plan is about 200 a month.
  - Adzuna: `GET https://api.adzuna.com/v1/api/jobs/{ADZUNA_COUNTRY}/search/1`. Its public docs don't confirm India (`in`), so check in your Adzuna account. Its descriptions are short snippets.
- **Limits.** Each search is cached for `SEARCH_CACHE_HOURS` (24). A student can make one live search every `SEARCH_COOLDOWN_SECONDS` (300); cached searches are always allowed. Live calls also count against the global daily budgets `JSEARCH_DAILY_BUDGET` and `ADZUNA_DAILY_BUDGET`.
- **Duplicates.** The same job from two sources, or the same link with different tracking parameters, is stored once (same company, title and city within 30 days).
- **Pasted links.** Pathfinder fetches only the one page a student pasted, as `PathfinderBot`, after checking that site's robots.txt. It refuses private network addresses, follows at most 3 redirects, and reads at most 2 MB. If a page can't be read (robots.txt, sign-in wall, script-only page), the student is asked to paste the description instead. It never signs in to job sites.
- **Adzuna terms.** Every Adzuna job shown must be labelled and linked "Adzuna", and students apply through Adzuna's `redirect_url`. The app does both. Using Adzuna in a product that earns revenue needs a licence from them.

### Local services

| Command | What it does |
| --- | --- |
| `pnpm services:up` | Starts Postgres in the background, creating it on the first run |
| `pnpm services:down` | Stops it |
| `pnpm services:status` | Shows whether it is running |
| `pnpm services:reset` | Stops it and **deletes all local data**: the database and stored files in `.local/` |

The port, user and password come from `DATABASE_URL` in `.env`. The script only manages a database on `localhost`.

**Optional: Docker.** If you prefer Docker, `infra/docker-compose.yml` runs Postgres and MinIO instead. Its header explains the `.env` changes. Don't run it at the same time as `pnpm services:up`, because both use port 5432.

## Tests

| Command | What it runs |
| --- | --- |
| `pnpm test` | Unit tests (Vitest). No database needed. |
| `pnpm test:integration` | Integration tests against `TEST_DATABASE_URL`, which must be a database whose name ends in `_test`. Migrations are applied automatically, and tables are emptied between tests. Needs `pnpm services:up`. |
| `pnpm e2e` | End-to-end tests (Playwright). Needs `pnpm services:up` and `pnpm db:deploy`. Install the browser once with `pnpm --filter @pathfinder/e2e install-browsers` (it goes into `node_modules`, on the same drive as the project). |
| `pnpm lint` / `pnpm typecheck` | ESLint and TypeScript (strict mode) |
| `pnpm check` | Lint, typecheck, unit and integration tests in one go |
| `pnpm load-test` | 50 simulated students run the main flow at once (needs `pnpm dev` and `pnpm worker` running with the mock AI). Passes when all finish and posting-to-PDF p95 is under 2 minutes. Local only; cleans up after itself. |

GitHub Actions (`.github/workflows/ci.yml`) runs the same steps on every push and pull request, using the same embedded Postgres and no real keys.

**After pulling new migrations:** run `pnpm db:generate` (Prisma 7's `migrate` no longer regenerates the client) and `pnpm db:deploy`.

## Deploying

Pushes to `main` redeploy wherever the repository is connected (Vercel, Render). To run Pathfinder on a server, follow these guides in order:

| Guide | What it covers |
| --- | --- |
| [docs/deploy-vercel.md](docs/deploy-vercel.md) | Quickest staging setup, step by step: website on Vercel, Neon, AWS S3 (Mumbai), Google sign-in, worker on Render |
| [docs/deploy.md](docs/deploy.md) | Staging, then production: managed Postgres, S3/R2 storage, Google sign-in, settings (`.env.staging.example`), the two container images (`infra/Dockerfile.web`, `infra/Dockerfile.worker`), first-deploy checks, rollback |
| [docs/backup-restore.md](docs/backup-restore.md) | Backups, the monthly restore drill (`scripts/backup-drill.sh`), restoring after an incident, breaches |
| [docs/privacy-notice-draft.md](docs/privacy-notice-draft.md) | The privacy notice, **draft for legal review** |

`APP_ENV` says which deployment this is: `development` (local), `staging` (a production build with test data, an amber banner and no search indexing) or `production`. `GET /api/health` answers 200 when the app can reach its database, for the host's health check.

The CI job **Container images and restore drill** builds both images on every push and runs them against Postgres 17: migrations, health check, staging banner, PDF rendering in the worker image, and a backup-and-restore drill.

## Repository layout

```
apps/web/        Next.js app (App Router): pages, components, server code and API route handlers
apps/worker/     Queue worker (pg-boss): drafting, PDF rendering, housekeeping and nightly retention
packages/core/   Domain logic: config, profile, jobs and matching, applications, account export/delete, limits, storage
packages/ai/     The single entry point for model calls (retries, circuit breaker, fallback), prompts, schemas, providers (Gemini, OpenAI-compatible fallback, mock)
packages/db/     Prisma schema, migrations, the user-scoped data layer, rate limits and cross-user housekeeping
packages/feeds/  JSearch and Adzuna adapters, URL normalisation and dedupe keys
e2e/             Playwright tests
infra/           Dockerfiles for the web and worker images, optional Docker Compose for local services
docs/            Deployment guide, backup and restore runbook, privacy notice draft
scripts/         services.mjs (local Postgres), fixture generation, the load test and the backup drill
fixtures/        Sample (fictional) resumes and job, and the prompt-injection payloads
test/            Shared integration-test setup
.github/         CI workflow
```

## Data access rule

Every user-owned table has a `userId` column. App code reaches the database only through `scopedDb(userId)` from `@pathfinder/db`. That client:

- adds the owner condition to every query
- sets the owner on every create
- refuses to move a row to another owner
- refuses nested relation writes
- refuses raw SQL and the Auth.js tables
- refuses reads of other users' rows through shared job listings

The unscoped client (`@pathfinder/db/raw`) is blocked by ESLint everywhere except the auth adapter, the dev sign-in, `packages/db` and tests. The integration tests in `packages/db/test/scoped.int.test.ts` prove that one user cannot read or change another user's data.

When you add a model with a `userId` column, add it to `USER_OWNED_MODELS` in `packages/db/src/scoped.ts`; a test fails until you do.

## Troubleshooting

- **Port 5432 is already in use** (for example, by another Postgres install): change the port in both `DATABASE_URL` and `TEST_DATABASE_URL` in `.env`, for example to `54320`. Then run `pnpm services:down` and `pnpm services:up`.
- **Postgres won't start:** read `.local/pg.log`. To start completely fresh, run `pnpm services:reset`, which deletes local data.
- **"Invalid configuration" on startup:** the message names the missing or wrong variable. Compare your `.env` with `.env.example`.
- **`pnpm` not found after installing:** open a new terminal so `PATH` picks up the global npm folder.
- **Disk space:** keep at least 3 GB free on the drive that holds the project. `node_modules`, the Playwright browser, build caches and the database all live there. If the disk fills up, stop Postgres with `pnpm services:down` before freeing space.
- **System drive full (Windows):** Chromium (PDFs, end-to-end tests) writes temporary files to `%TEMP%`, usually on C:. If C: is nearly full, PDFs silently never render. Point temp at another drive for the session, e.g. in Git Bash `export TEMP='D:\tmp' TMP='D:\tmp'`, before `pnpm worker` or `pnpm e2e`.

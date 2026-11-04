# Pathfinder

Pathfinder helps Indian freshers apply to jobs off-campus. A student builds one profile, adds jobs, gets a tailored resume and answers drawn **only from their own profile**, submits each application themselves on the job site, and tracks responses.

This repository is the MVP, built in phases. **Phase 1 (foundation)** covers Google sign-in, the user-scoped database, the profile editor and resume import.

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

The app starts and every test passes with all AI and job-feed keys left empty.

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

GitHub Actions (`.github/workflows/ci.yml`) runs the same steps on every push and pull request, using the same embedded Postgres and no real keys.

## Repository layout

```
apps/web/        Next.js app (App Router): pages, components, server code and API route handlers
apps/worker/     Queue worker (pg-boss): placeholder until Phase 3
packages/core/   Domain logic: config, logging, profile, storage, resume import, usage
packages/ai/     The single entry point for model calls, plus prompts, schemas and providers (Gemini, mock)
packages/db/     Prisma schema, migrations and the user-scoped data layer
packages/feeds/  JSearch and Adzuna adapters: placeholder until Phase 2
e2e/             Playwright tests
infra/           Optional Docker Compose
scripts/         services.mjs (local Postgres) and fixture generation
fixtures/        Sample (fictional) resumes for tests
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

# Deploying Pathfinder

This guide takes you from this repository to a running **staging** site, then lists what changes for **production**. Nothing in the repository deploys anything by itself: you create the accounts and services, and you decide when to deploy.

Do staging first, with test data only. Keep staging and production completely separate: a different database, bucket, Google sign-in client and secrets for each.

> Provider names below are examples, not tested recommendations. Check their current pricing, regions and limits before you sign up, and prefer a region in or close to India (Mumbai or Singapore).

## What you are deploying

```
Students ──HTTPS──> web container (Next.js, infra/Dockerfile.web)  ──┐
                                                                     ├──> managed PostgreSQL 17 (data + job queue)
                    worker container (infra/Dockerfile.worker)    ──┘
                    (drafting, PDFs with Chromium, nightly cleanup)
                         │
                         └──> S3-compatible bucket (resumes, PDFs) <── web (signed download links)
```

| Piece | What it needs | Notes |
| --- | --- | --- |
| Web container | ~512 MB RAM, a public HTTPS URL, health check `/api/health` | Can run more than one copy: sessions, limits and the queue all live in Postgres. |
| Worker container | ~1 GB RAM (Chromium), no public port, always on | One copy is enough for a pilot; add copies for faster PDFs. |
| PostgreSQL 17 | A direct (not transaction-pooled) connection string with TLS | Holds everything except files. Daily backups and point-in-time recovery if offered. |
| Object storage | A private S3-compatible bucket and a key scoped to it | Cloudflare R2, AWS S3, Backblaze B2 and others work. |
| Google sign-in | An OAuth client per environment | The only way to sign in outside local development. |
| Gemini (optional) | A paid-tier API key | Without one, the mock AI is used (fine for staging demos). |

## 1. Database

1. Create a **PostgreSQL 17** database at a managed provider (for example Neon, Supabase, Render, Railway or AWS RDS), in a region close to India.
2. Use a **separate database** for staging (`pathfinder_staging`) and production.
3. Turn on automatic backups, and point-in-time recovery if the provider offers it (see [backup-restore.md](backup-restore.md)).
4. Copy the **direct** connection string and add `?sslmode=require` if it isn't there. If the provider gives you both a pooled and a direct string, use the direct one: the job queue (pg-boss) needs ordinary session connections. If only a pooled string exists, the pool must be in *session* mode.
5. Connections: each web copy uses up to about 13 and the worker up to about 20. Check the plan's connection limit.

## 2. File storage

Example: Cloudflare R2.

1. Create a bucket, e.g. `pathfinder-staging`. Leave **public access off**: students download through short-lived signed links, never public URLs. No CORS rules are needed.
2. Create an API token with **Object Read & Write** for that bucket only.
3. Note: `S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com`, `S3_REGION=auto`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`.

Other S3-compatible stores work the same way with their own endpoint and region. Files are deleted by the app itself (account deletion); don't add lifecycle rules that delete them.

## 3. Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project for the environment.
2. **OAuth consent screen**: type *External*, publishing status *Testing*, and add the Google accounts of your pilot testers as **test users**. While it's in Testing, only those accounts can sign in, which suits staging and a small pilot.
3. **Credentials → Create OAuth client ID → Web application**:
   - Authorised JavaScript origin: `https://<your-staging-host>`
   - Authorised redirect URI: `https://<your-staging-host>/api/auth/callback/google`
4. Copy the client ID and secret into `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET`.

Pathfinder asks only for name, email and profile picture. Before opening production to the public, publish the consent screen; Google may ask for branding verification. Check their current requirements.

## 4. Settings

`.env.staging.example` lists every setting with staging values and comments. Enter each one in your host's **secret/environment settings** for both containers. Don't upload a `.env` file. Generate `AUTH_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

The settings that differ between environments:

| Setting | Staging | Production |
| --- | --- | --- |
| `APP_ENV` | `staging` (banner, not indexed, demo seeding allowed) | `production` |
| `NODE_ENV` | `production` | `production` |
| `DATABASE_URL`, `S3_*`, `AUTH_GOOGLE_*`, `AUTH_SECRET` | staging's own | production's own |
| `APP_URL` | `https://<staging-host>` | `https://<your-domain>` |
| `GEMINI_API_KEY` | empty (mock) or a paid key | paid-tier key, with `GEMINI_MODEL` pinned to a stable model |
| Job feed keys | empty (sample jobs) | real keys; set the daily budgets to your plan |
| `TRUSTED_PROXY_HOPS` | `1` | `1` behind the host's load balancer, `2` with a CDN proxy (e.g. Cloudflare) in front as well |

The app refuses to start in production without Google sign-in configured and with local file storage. The error names the missing setting, never its value.

## 5. Services on the container host

Any host that builds from a Dockerfile and runs long-lived containers works (for example Render, Railway, Fly.io or a VM with Docker). Vercel-style serverless hosting doesn't suit the worker, because Chromium needs a long-running container.

Create two services from this repository, both with the same settings from step 4.

**Web service**

| Option | Value |
| --- | --- |
| Dockerfile | `infra/Dockerfile.web` (build context: repository root) |
| Port | the host's `PORT` (the image listens on it; default 3000) |
| Health check path | `/api/health` |
| Release / pre-deploy command | `sh -c "cd /app/packages/db && ./node_modules/.bin/prisma migrate deploy"` |
| Instances | 1 to start |

The release command applies new database migrations before the new version starts. If the host has no release step, run the same command once from a shell in the web container before switching traffic.

**Worker service** (often called a *background worker*)

| Option | Value |
| --- | --- |
| Dockerfile | `infra/Dockerfile.worker` |
| Port | none |
| Instances | 1 (add copies for more PDF throughput) |
| Memory | at least 1 GB |

The worker logs `Worker ready` when it has started. It also schedules the nightly cleanup (03:00 India time) itself, so no separate cron job is needed.

Both images run as the unprivileged `node` user and contain no secrets.

## 6. First deploy and checks

1. Deploy the web service (its release command creates the tables), then the worker.
2. Open `https://<staging-host>/api/health`. It should say `{"status":"ok"}`.
3. Open the site: the amber **Staging site: test data only** banner should show. Sign in with a test-user Google account.
4. *Optional: demo data.* With that account signed in once, open a shell in the **worker** container and run:

   ```bash
   ./node_modules/.bin/tsx src/seed.ts --email you@example.com
   ```

   It adds a fictional profile, 8 scored jobs and 7 applications (3 with drafts) to that account (only if the account is empty).
5. Walk the main flow:
   - import a resume
   - paste a job
   - start an application
   - wait for the draft
   - download the PDF
   - press "I've applied"
   - check the dashboard
6. In Settings, download your data, then delete the test account. Sign-in should start fresh afterwards.
7. Check the logs: web and worker write JSON lines without personal data. Look for `job moved to dead-letter queue` (failed jobs) or `housekeeping sweep failed`.

The CI job **Container images and restore drill** builds both images and runs them against Postgres 17 on every push. A green run means the images start, migrate, serve `/api/health`, render PDFs and survive a backup and restore.

## 7. Updating and rolling back

- **Deploy only commits whose CI is green.** The release command runs new migrations before the new web version takes traffic.
- **Migrations must work with the previous version for one release**, so you can roll back the app: add columns and tables first, and remove old ones in a later release.
- **Roll back** by redeploying the previous image or commit. Most hosts keep recent deploys; keep at least the last 3. Database migrations are not undone automatically. If data itself was damaged, follow [backup-restore.md](backup-restore.md).
- **Rotating `AUTH_SECRET`** signs everyone out and changes the IP hashes in the audit log. That's fine, but do it deliberately.

## 8. Before production

- Separate production database, bucket, Google OAuth client and secrets; nothing shared with staging.
- `APP_ENV=production`, a custom domain on HTTPS (HSTS turns on automatically), and `TRUSTED_PROXY_HOPS` set for your proxy setup.
- A paid-tier Gemini key whose terms exclude training on inputs, with `GEMINI_MODEL` pinned. Same for the fallback model, if used.
- Feed keys and budgets set; the Adzuna licence if the product earns revenue (README).
- The privacy notice ([privacy-notice-draft.md](privacy-notice-draft.md)) reviewed by someone qualified in India's DPDP Act and published at `/privacy`.
- Backups on, and one restore drill done on staging ([backup-restore.md](backup-restore.md)).
- An uptime monitor on `/api/health`, and someone who reads the worker's error logs. Error tracking (Sentry) is not set up yet and needs a decision.
- The Google OAuth consent screen published, or pilot students added as test users.

## 9. Capacity

The load test (`pnpm load-test`) ran 50 students through the whole flow at once against one web process and one worker, with the mock AI on a laptop. It took about 31 s typical and 53 s for the slowest 5% from pasting a job to a downloadable PDF, with no errors. PDF rendering, 2 at a time per worker, is the bottleneck: add worker copies before adding web copies. With the real Gemini, expect each draft to add the model's response time.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| The app won't start: "Invalid configuration" | A required setting is missing; the message names it. |
| `/api/health` returns 503 | The database is unreachable: check `DATABASE_URL`, TLS and IP allow-lists. |
| Drafts stay "in the queue" | The worker isn't running, or can't reach the database. |
| PDFs never become ready | The worker has too little memory for Chromium, or can't write to the bucket. Check the worker logs. |
| Google sign-in fails | The redirect URI doesn't exactly match `https://<host>/api/auth/callback/google`, or the account isn't a test user. |
| "Too many sign-in attempts" for everyone | `TRUSTED_PROXY_HOPS` is too high, so every request looks like the same address. |

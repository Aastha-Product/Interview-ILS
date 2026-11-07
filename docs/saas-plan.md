# Pathfinder SaaS plan: audit and architecture (Phases 1–2)

Written 2026-11-07 in answer to the "Final SaaS product" brief. Nothing here is built yet
beyond what section A lists as live. Decisions marked **(you)** need the owner's answer.

## A. Current technical audit

There are two codebases:

| Codebase | Where | State |
|---|---|---|
| **Fork of Dossier** (the foundation) | `D:\Pathfinder\dossier`, branch `pathfinder-multiuser`, github.com/Aastha-Product/dossier | Live at https://52-64-48-163.sslip.io (AWS Lightsail, Sydney, 2 GB) |
| Original Pathfinder | `D:\Pathfinder\pathfinder` | A Vercel demo mode only; superseded by the fork |

Firebase is not used anywhere in either codebase yet.

**Working and verified in the fork (live):**
- Private accounts. Every table is scoped to its student in code, and the database fills in the owner itself, so changing an ID in a URL returns "not found".
- Resume upload (PDF, .docx, Markdown), then automatic reading, then a resume review, then a results page. History of past analyses, "Save as PDF" (print), and delete.
- Progress shown step by step. The analysis runs as a background job, so the page doesn't wait on an open request.
- A daily AI limit per student, a privacy notice, "Delete everything", and a health check.
- Claude (Anthropic) as the server's AI. It is wired and unit-tested, **but not yet switched on**: the API key hasn't been added. Nothing has been tested against the real Claude API yet.
- HTTPS, daily snapshots, Docker Compose deploy.

**Built but not switched on:** Google sign-in (needs Google OAuth credentials).

**Missing for the SaaS:**
- Email/password registration and password reset.
- A public homepage.
- Plans, payments and webhooks.
- An admin console.
- Private object storage. Files are on the server's disk today.
- A separate queue and workers. Jobs run inside the web process today.
- Choosing a model per task, with fallback.
- AI cost tracking.
- API rate limits beyond sign-in throttling.
- File retention.
- An audit log.
- A simpler customer Settings page.
- Load tests.

## B. Final technology stack (recommended)

| Need | Choice | Why |
|---|---|---|
| Identity | **Firebase Authentication** (email/password, password reset, email verification, Google) | You already have Firebase. It sends reset emails itself, and it is free up to 50K monthly users. The server verifies the Firebase ID token once, then issues its own session cookie. |
| Database | **PostgreSQL**: today on the server, then **Amazon RDS** (with RDS Proxy for pooling) | Dossier's data model is relational and the privacy scoping is built on Postgres. Firestore would mean rewriting the whole data layer. |
| File storage | **Amazon S3**, private bucket, encrypted | Uploads go straight to S3 with a 5-minute signed URL. Reads use 60-second signed URLs. Keys look like `students/<userId>/<uuid>`. Nothing is public. |
| Queue and workers | **Postgres-backed queue** at launch, then **Amazon SQS** at scale. The worker is its own container. | Adds no new service at launch. Retries, status and recovery live in the jobs table that already exists. |
| Hosting | **AWS** (decision 2 below) | The AWS account already exists. Dossier needs long-running jobs, Chromium for PDFs, and timers. |
| AI | **Anthropic Claude** through the existing provider layer, with a model chosen per task (section F) | The key stays server-side, and customers never see it. |
| Payments | **(you)**: Razorpay or Paddle (decision 1 below) | Depends on where customers pay from. |
| Email | Firebase sends auth emails. Receipts come from the payment provider. | No mail server of our own at launch. |
| Monitoring | CloudWatch logs and alarms, the health check, and an uptime monitor | |

## C. Architecture

```
Browser ──HTTPS──> Caddy / load balancer ──> Next.js web (stateless; 1 box now, 2–4 copies at scale)
   │                                             │  verifies session, scopes every query to the student
   │  signed PUT (5 min)                         ├──> PostgreSQL (accounts, analyses, plans, usage, jobs)
   └──────────────> S3 private bucket <──────────┤
                                                 └──> queue ──> worker(s) ──> Claude API
                                                                   │  read file from S3, extract, review,
                                                                   │  save results, charge or refund the credit
Payment provider ──webhook (signature checked, de-duplicated)──> web ──> subscriptions table
Firebase Auth <── sign-up / sign-in / reset (browser) ; ID token verified by the server once per sign-in
```

## D. Dossier feature mapping

| Feature | Decision |
|---|---|
| Resume reading (PDF/.docx) and profile extraction | REUSE |
| Resume review and results page | Built (Stop 2), MODIFY: add model routing |
| Owner scoping and private data | REUSE |
| Background jobs and progress | MODIFY: separate worker, queue, retries |
| Daily AI limit | MODIFY: becomes plan entitlements |
| Access-code sign-in, own Google OAuth | REPLACE: Firebase Authentication |
| Files on local disk | REPLACE: S3 |
| Dashboard ("/") | REPLACE: customer dashboard (upload, latest, history, usage) |
| Settings | MODIFY: only Profile, Security, History, Privacy and deletion, Plan and billing, Support |
| AI provider and model settings | INTERNAL ONLY: admin console |
| Base resume, tailored resume, cover letter, applications, job search, agent, Gmail inbox, Startups, Claude connector | INTERNAL ONLY: hidden at launch; candidates for paid tiers later |
| PDF export (Chromium) | REUSE: real PDF of the results later |
| Privacy notice, Delete everything | REUSE, extended to S3 files and the Firebase account |
| Homepage, billing, admin console, audit log, retention | BUILD |

## E. Database and security

New tables:
- `Plan`: name, analyses per month, price reference at the provider, active.
- `Subscription`: user, provider, provider subscription ID, plan, status, period end, cancel at period end.
- `PaymentEvent`: provider and event ID, unique, so a duplicate webhook is a no-op; type and processed time.
- `ResumeFile`: user, S3 key, size, type, delete-after date.
- `AiCall`: user, task, model, input and output tokens, cost, outcome.
- `AdminAuditLog`: who, what, when, and which student.
- `User` gains `firebaseUid` and `role` (student or admin).

Access rules:
- Every student table keeps the database-level owner default and the scoped client. A wrong ID gives 404, never someone else's row.
- Admins use a separate admin client. Every read of a student's data writes an audit row.
- Rate limits per user and per IP: uploads, analyses, sign-in.
- File checks: the size and the magic bytes (already done), never the browser's claimed type.
- Resume text is sent to the model as data inside tags, and the model is told never to follow instructions found in it (already done).
- Retention: the original file is deleted after N days (admin-set, default 30). Results stay until the student deletes them.

## F. AI orchestration

Each task has a primary model and a fallback model, set in the admin console. Defaults:

| Task | Primary | Fallback | Reason |
|---|---|---|---|
| Profile extraction | claude-sonnet-5-5 | claude-haiku-5-5 | Structured copying; doesn't need Opus |
| Resume review (what the customer pays for) | claude-opus-5-5 | claude-sonnet-5-5 | Quality of judgement matters here |

Rough cost per analysis, assuming about 5K tokens in and 2K out per call; to be measured with real calls:

| Setup | Cost |
|---|---|
| Opus for both | ≈ $0.10 |
| Sonnet extraction + Opus review | ≈ $0.08 |
| Sonnet for both | ≈ $0.05 |

Failure handling:
- The SDK retries rate-limit and server errors.
- When the primary model is overloaded or unavailable, the call switches to the fallback.
- If both fail, the job shows "We couldn't finish. Try again" and the analysis credit is refunded.

Cost tracking: tokens and cost go into `AiCall`, and the admin console shows a daily total.

Concurrency: the worker caps the number of simultaneous Claude calls to the account's Anthropic rate limit. The rest wait in the queue.

## G. Billing

- Free plan: N analyses a month (admin-set; suggest 3). Shown on the dashboard as "2 of 3 free analyses left this month".
- Paid plans: limits and prices live at the payment provider and in `Plan`. Nothing is hard-coded.
- Checkout uses the provider's hosted page. Access changes **only** from a signature-checked webhook, never from the success page.
- Handled events: paid, failed (grace period), renewed, cancelled (access until period end), expired, refunded. Each event ID is processed once.
- A credit is charged when an analysis starts and refunded if it fails.

## H–K. Delivery in stops (each stop reviewed before the next)

Decided 2026-11-07:
- **Hosting:** stay on AWS.
- **Sign-in:** Firebase Authentication.
- **Payments:** none until the product works properly. Paid plans launch in India first (Razorpay), then for international users (Paddle or Stripe).
- **Free plan:** until payments launch, every student is on it, with an admin-set monthly limit. The tables are built so paid plans can be added without a rewrite.

1. **Stop 3: accounts.** Firebase sign-up, sign-in, password reset and Google. Public homepage. Customer dashboard with usage left. Simplified Settings.
2. **Stop 4: processing.** S3 storage, a separate worker, the queue, model routing with fallback, the AI cost log, a monthly free allowance.
3. **Stop 5: admin console.** At `/admin`, admins only: users, jobs, costs, models, limits, the audit log.
4. **Stop 6: deploy.** Production on AWS with your domain.
5. **Stop 7: testing.** End-to-end tests for every flow in J except payments, then load tests.
6. **Later, billing in India:** Razorpay plans, checkout, webhooks, the billing page.
7. **Later, billing worldwide:** a second provider for other countries.

### What "10,000 concurrent users" means

| Load | What it takes | Realistic target |
|---|---|---|
| 10,000 signed-in sessions | Stateless web plus cookies | Easy: 2 web copies |
| 10,000 active users clicking around | 2–4 web copies, pooled database | Verify with a load test at p95 < 500 ms |
| 10,000 simultaneous uploads | Uploads go straight to S3, not through our server | S3 handles it |
| 10,000 simultaneous AI jobs | Limited by Anthropic's rate limit, not our servers | Queue them. At about 200 analyses a minute, the last waits ~50 min. Needs a higher Anthropic usage tier. |

No 10,000-user claim will be made until the load tests pass.

## What I need from you

1. **Anthropic API key** with billing, added on the server (deploy guide section 8). Never paste it in chat.
2. **Firebase:**
   - The project's web config (it's public).
   - A service-account JSON, put on the server only.
   - Email/password and Google sign-in turned on in Firebase.
3. **Payment provider account**, verified (decision 1).
4. **A domain name.**
5. **Product name** and **privacy contacts**.
6. **AWS budget** for S3, and later RDS and SQS. Expect roughly $15–40/month at launch.
